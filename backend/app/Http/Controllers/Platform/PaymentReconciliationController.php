<?php

namespace App\Http\Controllers\Platform;

use App\Http\Controllers\Controller;
use App\Services\DarajaStkService;
use App\Services\PlatformPaymentSettlementService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class PaymentReconciliationController extends Controller
{
    public function index(Request $request)
    {
        return response()->json(DB::table('platform_payment_reconciliation_items')->orderByDesc('id')->paginate(30));
    }

    public function stkAttempts(Request $request)
    {
        return response()->json(DB::table('platform_billing_payments as p')
            ->join('platform_billing_invoices as i', 'i.id', '=', 'p.platform_billing_invoice_id')
            ->where('p.channel', 'stk')
            ->select('p.id', 'p.checkout_request_id', 'p.amount', 'p.status', 'p.created_at', 'p.environment',
                'i.account_number', 'i.bookshop_id', 'i.status as invoice_status')->orderByDesc('p.id')->paginate(30));
    }

    private function evidence(Request $request, bool $manual): array
    {
        return $request->validate([
            'verified_receipt' => ['required', 'regex:/^[A-Z0-9]{6,30}$/'],
            'verified_amount' => 'required|numeric|gt:0|max:9999999999.99|decimal:0,2',
            'verified_at' => 'required|date|before_or_equal:now',
            'verified_shortcode' => 'required|string|max:20',
            'statement_reference' => 'required|string|max:255',
            'statement_verified' => 'required|accepted',
            ...($manual ? ['verified_account' => ['required', 'regex:/^[0-9]{6}$/']] : []),
        ]);
    }

    private function environment(string $environment): void
    {
        if (! in_array($environment, ['sandbox', 'production'], true) || $environment !== config('services.mpesa.environment')
            || ($environment === 'sandbox' && app()->environment('production'))) {
            throw ValidationException::withMessages(['payment' => 'Payment environment is not eligible for settlement on this installation.']);
        }
    }

    public function confirmStk(Request $request, int $attempt, PlatformPaymentSettlementService $settlement, DarajaStkService $daraja)
    {
        $data = $this->evidence($request, false);

        return DB::transaction(function () use ($request, $attempt, $settlement, $daraja, $data) {
            $payment = DB::table('platform_billing_payments')->where('id', $attempt)->where('channel', 'stk')->lockForUpdate()->first();
            abort_unless($payment, 404);
            $this->environment($payment->environment);
            $invoice = DB::table('platform_billing_invoices')->where('id', $payment->platform_billing_invoice_id)->first();
            abort_unless($invoice, 404);
            if ((float) $data['verified_amount'] !== (float) $payment->amount) {
                throw ValidationException::withMessages(['payment' => 'Statement amount differs from initiated STK amount.']);
            }
            if ($payment->status === 'reconciled') {
                $existing = DB::table('platform_billing_payments')->where('mpesa_receipt', $data['verified_receipt'])
                    ->where('platform_billing_invoice_id', $invoice->id)->first();
                abort_unless($existing, 422, 'Reconciled attempt has a different receipt.');

                return response()->json(['invoice_id' => $invoice->id, 'invoice_status' => $invoice->status]);
            }
            abort_unless($payment->checkout_request_id, 422, 'Use independent statement reconciliation for an unknown checkout.');
            // A forged callback cannot make an attempt failed or successful. Query is authoritative.
            try {
                $query = $daraja->query($payment->checkout_request_id);
            } catch (\Throwable $e) {
                return response()->json(['message' => 'Provider verification unavailable. No funds credited.'], 502);
            }
            if ((string) ($query['ResponseCode'] ?? '') !== '0' || (string) ($query['ResultCode'] ?? '') !== '0'
                || (isset($query['CheckoutRequestID']) && $query['CheckoutRequestID'] !== $payment->checkout_request_id)) {
                throw ValidationException::withMessages(['payment' => 'Safaricom has not verified this checkout as successful.']);
            }
            $result = $settlement->settle($data['verified_receipt'], $invoice->account_number, $data['verified_shortcode'],
                (float) $data['verified_amount'], new \DateTimeImmutable($data['verified_at']), 'stk', [
                    'environment' => $payment->environment, 'checkout_request_id' => $payment->checkout_request_id,
                    'statement_reference' => $data['statement_reference'], 'verified_by' => $request->user()->id,
                ]);
            DB::table('platform_billing_payments')->where('id', $payment->id)->update([
                'status' => 'reconciled', 'query_response' => json_encode($query), 'queried_at' => now(), 'updated_at' => now(),
            ]);

            return response()->json(['invoice_id' => $result->id, 'invoice_status' => $result->status]);
        }, 3);
    }

    /** Recovery for payments whose callback was lost or whose STK response timed out. */
    public function statement(Request $request, PlatformPaymentSettlementService $settlement)
    {
        $data = $this->evidence($request, true);
        $environment = (string) config('services.mpesa.environment');
        $this->environment($environment);

        return DB::transaction(function () use ($request, $settlement, $data, $environment) {
            $invoice = $settlement->settle($data['verified_receipt'], $data['verified_account'], $data['verified_shortcode'],
                (float) $data['verified_amount'], new \DateTimeImmutable($data['verified_at']), 'paybill', [
                    'environment' => $environment, 'statement_reference' => $data['statement_reference'], 'verified_by' => $request->user()->id,
                ]);
            DB::table('platform_billing_payments')->where('platform_billing_invoice_id', $invoice->id)
                ->where('status', 'unknown')->where('amount', $data['verified_amount'])->update([
                    'status' => 'reconciled', 'provider_response' => json_encode(['statement_receipt' => $data['verified_receipt'], 'verified_by' => $request->user()->id]), 'updated_at' => now(),
                ]);
            DB::table('platform_payment_reconciliation_items')->insertOrIgnore([
                'source' => 'statement', 'environment' => $environment, 'provider_transaction_id' => $data['verified_receipt'],
                'account_number' => $data['verified_account'], 'destination_shortcode' => $data['verified_shortcode'],
                'amount' => $data['verified_amount'], 'status' => 'settled',
                'payload' => json_encode(['statement_reference' => $data['statement_reference'], 'verified_by' => $request->user()->id]),
                'created_at' => now(), 'updated_at' => now(),
            ]);

            return response()->json(['invoice_id' => $invoice->id, 'invoice_status' => $invoice->status]);
        }, 3);
    }

    public function resolveUnknown(Request $request, int $attempt)
    {
        $data = $request->validate(['statement_reference' => 'required|string|max:255', 'no_payment_verified' => 'required|accepted']);

        return DB::transaction(function () use ($request, $attempt, $data) {
            $row = DB::table('platform_billing_payments')->where('id', $attempt)->lockForUpdate()->first();
            abort_unless($row && $row->status === 'unknown', 422, 'Only unknown requests can be released after checking the statement.');
            $this->environment($row->environment);
            DB::table('platform_billing_payments')->where('id', $attempt)->update([
                'status' => 'failed', 'provider_response' => json_encode([...$data, 'verified_by' => $request->user()->id]), 'updated_at' => now(),
            ]);

            return response()->json(['message' => 'Unknown request resolved. Any late payment still requires statement reconciliation.']);
        });
    }

    /** Record a refund already completed through the merchant's approved process. */
    public function resolveOverpayment(Request $request, int $item)
    {
        $data = $request->validate(['refund_reference' => 'required|string|max:255', 'refund_verified' => 'required|accepted']);

        return DB::transaction(function () use ($request, $item, $data) {
            $record = DB::table('platform_payment_reconciliation_items')->where('id', $item)->lockForUpdate()->first();
            abort_unless($record && $record->source === 'overpayment', 404);
            $this->environment($record->environment);
            if ($record->status === 'resolved') {
                return response()->json(['message' => 'Refund already recorded.']);
            }
            abort_unless($record->status === 'requires_review', 422);
            $payload = json_decode($record->payload, true) ?? [];
            DB::table('platform_payment_reconciliation_items')->where('id', $item)->update([
                'status' => 'resolved', 'payload' => json_encode([...$payload, 'refund_reference' => $data['refund_reference'],
                    'resolved_by' => $request->user()->id, 'resolved_at' => now()->toIso8601String()]), 'updated_at' => now(),
            ]);

            return response()->json(['message' => 'Externally verified refund recorded. No subscription period changed.']);
        }, 3);
    }

    /** Only authorized platform operators attest to independently obtained merchant statements. */
    public function confirm(Request $request, int $item, PlatformPaymentSettlementService $settlement)
    {
        $data = $this->evidence($request, true);

        return DB::transaction(function () use ($request, $item, $settlement, $data) {
            $record = DB::table('platform_payment_reconciliation_items')->where('id', $item)->lockForUpdate()->first();
            abort_unless($record, 404);
            $this->environment($record->environment);
            if ($record->source !== 'c2b' || $data['verified_receipt'] !== $record->provider_transaction_id
                || $data['verified_account'] !== $record->account_number
                || (float) $data['verified_amount'] !== (float) $record->amount
                || $data['verified_shortcode'] !== $record->destination_shortcode) {
                throw ValidationException::withMessages(['payment' => 'Statement values do not match the captured transaction.']);
            }
            $invoice = $settlement->settle($data['verified_receipt'], $data['verified_account'], $data['verified_shortcode'],
                (float) $data['verified_amount'], new \DateTimeImmutable($data['verified_at']), 'paybill', [
                    'environment' => $record->environment, 'reconciliation_item' => $item,
                    'statement_reference' => $data['statement_reference'], 'verified_by' => $request->user()->id,
                ]);
            DB::table('platform_payment_reconciliation_items')->where('id', $item)->update(['status' => 'settled', 'updated_at' => now()]);

            return response()->json(['message' => 'Payment reconciled', 'invoice_id' => $invoice->id, 'invoice_status' => $invoice->status]);
        }, 3);
    }
}
