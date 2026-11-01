<?php

namespace App\Http\Controllers\Platform;

use App\Http\Controllers\Controller;
use App\Services\PlatformPaymentSettlementService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class PaymentReconciliationController extends Controller
{
    public function index(Request $request)
    {
        $items = DB::table('platform_payment_reconciliation_items')->orderByDesc('id')->paginate(30);
        return response()->json($items);
    }

    public function stkAttempts(Request $request)
    {
        return response()->json(DB::table('platform_billing_payments as p')
            ->join('platform_billing_invoices as i', 'i.id', '=', 'p.platform_billing_invoice_id')
            ->where('p.channel', 'stk')
            ->whereIn('p.status', ['pending', 'awaiting_verification'])
            ->select('p.id', 'p.checkout_request_id', 'p.amount', 'p.status', 'p.created_at',
                'i.account_number', 'i.bookshop_id', 'i.status as invoice_status')
            ->orderByDesc('p.id')->paginate(30));
    }

    public function confirmStk(Request $request, int $attempt, PlatformPaymentSettlementService $settlement,
        \\App\\Services\\DarajaStkService $daraja)
    {
        $data = $request->validate([
            'verified_receipt' => 'required|string|max:100',
            'verified_amount' => 'required|numeric|gt:0',
            'verified_at' => 'required|date',
            'statement_reference' => 'required|string|max:255',
        ]);
        $payment = DB::table('platform_billing_payments')->where('id', $attempt)
            ->where('channel', 'stk')->first();
        abort_unless($payment, 404);
        if (!in_array($payment->status, ['pending', 'awaiting_verification'], true)) {
            throw ValidationException::withMessages(['payment' => 'STK attempt is not awaiting reconciliation.']);
        }
        $invoice = DB::table('platform_billing_invoices')->where('id', $payment->platform_billing_invoice_id)->first();
        abort_unless($invoice, 404);
        if (abs((float) $data['verified_amount'] - (float) $payment->amount) > 0.005) {
            throw ValidationException::withMessages(['payment' => 'Statement amount differs from the initiated STK amount.']);
        }
        // Query the provider independently at confirmation time; callbacks alone are untrusted.
        $query = $daraja->query($payment->checkout_request_id);
        if ((string) ($query['ResponseCode'] ?? '') !== '0' || (string) ($query['ResultCode'] ?? '') !== '0') {
            throw ValidationException::withMessages(['payment' => 'Safaricom has not verified this STK checkout as successful.']);
        }
        // The operator must separately check the receipt, amount and shortcode against
        // a trusted merchant statement; Daraja's query does not return these details.
        $shortcode = (string) config('services.mpesa.platform_paybill');
        if (config('services.mpesa.environment') !== 'production') {
            throw ValidationException::withMessages(['payment' => 'Sandbox transactions are simulated and cannot activate production subscriptions.']);
        }
        $result = $settlement->settle($data['verified_receipt'], $invoice->account_number,
            $shortcode, (float) $data['verified_amount'], new \\DateTimeImmutable($data['verified_at']),
            'stk', ['checkout_request_id' => $payment->checkout_request_id,
                'statement_reference' => $data['statement_reference'], 'verified_by' => $request->user()->id]);
        DB::table('platform_billing_payments')->where('id', $payment->id)
            ->whereIn('status', ['pending', 'awaiting_verification'])
            ->update(['status' => 'reconciled', 'updated_at' => now()]);
        return response()->json(['invoice_id' => $result->id, 'invoice_status' => $result->status]);
    }

    /**
     * Operator reconciles a transaction against a trusted Safaricom statement.
     * This is not a customer receipt-submission endpoint.
     */
    public function confirm(Request $request, int $item, PlatformPaymentSettlementService $settlement)
    {
        $data = $request->validate([
            'verified_receipt' => 'required|string|max:100',
            'verified_amount' => 'required|numeric|gt:0',
            'verified_account' => ['required', 'regex:/^[0-9]{6}$/'],
            'verified_shortcode' => 'required|string|max:20',
            'verified_at' => 'required|date',
            'statement_reference' => 'required|string|max:255',
        ]);
        $record = DB::table('platform_payment_reconciliation_items')->where('id', $item)->first();
        abort_unless($record, 404);
        if ($record->status === 'settled') {
            return response()->json(['message' => 'Already settled']);
        }
        if ($record->source !== 'c2b') {
            throw ValidationException::withMessages(['payment' => 'Only manual Paybill statement items can be reconciled here.']);
        }
        if ($data['verified_receipt'] !== $record->provider_transaction_id ||
            $data['verified_account'] !== $record->account_number ||
            abs((float) $data['verified_amount'] - (float) $record->amount) > 0.005 ||
            $data['verified_shortcode'] !== $record->destination_shortcode) {
            throw ValidationException::withMessages(['payment' => 'Statement values do not match the captured transaction.']);
        }
        $invoice = $settlement->settle(
            $data['verified_receipt'], $data['verified_account'], $data['verified_shortcode'],
            (float) $data['verified_amount'], new \DateTimeImmutable($data['verified_at']),
            'paybill', ['reconciliation_item' => $item, 'statement_reference' => $data['statement_reference'],
                'verified_by' => $request->user()->id]
        );
        DB::table('platform_payment_reconciliation_items')->where('id', $item)->where('status', 'awaiting_verification')->update([
            'status' => 'settled', 'updated_at' => now(),
        ]);
        return response()->json(['message' => 'Payment reconciled', 'invoice_id' => $invoice->id,
            'invoice_status' => $invoice->status]);
    }
}
