<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\BookshopSubscription;
use App\Models\SubscriptionPlan;
use App\Services\DarajaStkService;
use App\Services\PlatformBillingInvoiceService;
use App\Support\Roles;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class PlatformBillingController extends Controller
{
    private function tenant(Request $request): int
    {
        // Billing is available even when access expires, but only to the actual tenant owner.
        $user = $request->user();
        abort_unless($user->accountType() === 'bookshop' && in_array($user->role, Roles::TENANT_OWNER_ROLES, true) && $user->bookshop_id, 403);

        return (int) $user->bookshop_id;
    }

    public function context()
    {
        return response()->json($this->paymentContext());
    }

    private function paymentContext(?string $invoiceEnvironment = null): array
    {
        $environment = config('services.mpesa.environment');
        $shortcode = $environment === 'production' ? '152451' : ($environment === 'sandbox' ? (string) config('services.mpesa.shortcode') : null);
        $eligible = in_array($environment, ['sandbox', 'production'], true)
            && ($invoiceEnvironment === null || $invoiceEnvironment === $environment)
            && preg_match('/^[0-9]{5,7}$/', $shortcode ?? '');

        return ['environment' => $environment, 'paybill' => $shortcode,
            'can_pay' => (bool) $eligible, 'test_mode' => $environment === 'sandbox'];
    }

    public function index(Request $request)
    {
        $tenant = $this->tenant($request);

        return response()->json([
            'invoices' => $this->invoices()->where('i.bookshop_id', $tenant)->orderByDesc('i.id')->paginate(20)->through(fn ($row) => self::progress($row)),
            'subscription' => BookshopSubscription::where('bookshop_id', $tenant)->first()?->summary(),
            'plans' => SubscriptionPlan::where('is_active', true)->where('currency', 'KES')->where('price', '>', 0)->get(),
            ...$this->paymentContext(),
        ]);
    }

    public function admin(Request $request)
    {
        $data = $request->validate(['status' => 'nullable|in:pending,partially_paid,paid', 'environment' => 'nullable|in:sandbox,production,legacy']);

        return response()->json($this->invoices()->when($data['status'] ?? null, fn ($q, $s) => $q->where('i.status', $s))
            ->when($data['environment'] ?? null, fn ($q, $e) => $q->where('i.environment', $e))->orderByDesc('i.id')->paginate(30)->through(fn ($row) => self::progress($row)));
    }

    public function plan(Request $request)
    {
        $data = $request->validate([
            'code' => ['required', 'regex:/^[a-z0-9-]{1,40}$/', 'unique:subscription_plans,code'],
            'name' => 'required|string|max:100', 'price' => 'required|integer|min:1|max:999999999',
            'billing_interval' => 'required|in:monthly,quarterly,annual',
        ]);
        $plan = DB::transaction(function () use ($data, $request) {
            $plan = SubscriptionPlan::create([...$data, 'currency' => 'KES', 'is_active' => true]);
            AuditLog::record('billing.plan_created', 'Created paid subscription plan', $plan, $data, $request->user(), null);

            return $plan;
        });

        return response()->json(['data' => $plan], 201);
    }

    public function updatePlan(Request $request, int $plan)
    {
        $data = $request->validate(['name' => 'sometimes|required|string|max:100', 'price' => 'sometimes|required|integer|min:1|max:999999999',
            'billing_interval' => 'sometimes|required|in:monthly,quarterly,annual', 'is_active' => 'sometimes|required|boolean']);

        return DB::transaction(function () use ($request, $plan, $data) {
            $row = SubscriptionPlan::whereKey($plan)->lockForUpdate()->firstOrFail();
            $before = $row->only(array_keys($data));
            $row->update($data);
            AuditLog::record('billing.plan_updated', 'Updated subscription plan; existing invoices retain their quoted price and period', $row,
                ['before' => $before, 'after' => $data], $request->user());

            return response()->json(['data' => $row]);
        });
    }

    public function subscriptions(Request $request)
    {
        $data = $request->validate(['state' => 'nullable|in:expired,upcoming']);
        $rows = BookshopSubscription::with(['bookshop:id,name', 'plan'])->when($data['state'] ?? null, function ($q, $state) {
            $q->where(function ($q) use ($state) {
                if ($state === 'expired') {
                    $q->where('status', 'expired');
                }
                foreach (['current_period_ends_at', 'trial_ends_at'] as $column) {
                    $q->orWhere(function ($q) use ($state, $column) {
                        if ($column === 'trial_ends_at') {
                            $q->where('status', 'trialing');
                        } else {
                            $q->where('status', '!=', 'trialing');
                        }
                        if ($state === 'expired') {
                            $q->where($column, '<=', now());
                        } else {
                            $q->whereBetween($column, [now(), now()->addDays(7)]);
                        }
                    });
                }
            });
        })->orderBy('bookshop_id')->paginate(30);
        $rows->through(fn ($row) => ['id' => $row->id, 'bookshop_id' => $row->bookshop_id, 'bookshop_name' => $row->bookshop?->name, ...$row->summary()]);

        return response()->json($rows);
    }

    public function payments(Request $request)
    {
        $data = $request->validate(['environment' => 'nullable|in:sandbox,production,legacy']);
        $rows = DB::table('platform_billing_payments as p')->join('platform_billing_invoices as i', 'i.id', '=', 'p.platform_billing_invoice_id')
            ->select('p.id', 'p.status', 'p.channel', 'p.amount', 'p.environment', 'p.mpesa_receipt', 'p.confirmed_at', 'p.provider_response', 'i.account_number', 'i.bookshop_id')
            ->when($data['environment'] ?? null, fn ($q, $e) => $q->where('p.environment', $e))->orderByDesc('p.id')->paginate(30);
        $rows->through(function ($row) {
            $evidence = json_decode($row->provider_response ?? '{}', true);
            $row->statement_reference = $evidence['statement_reference'] ?? null;
            $row->verified_by = $evidence['verified_by'] ?? null;
            unset($row->provider_response);

            return $row;
        });

        return response()->json($rows);
    }

    private function invoices()
    {
        return DB::table('platform_billing_invoices as i')->select('i.*')
            ->selectSub(DB::table('platform_billing_payments as p')->selectRaw('COALESCE(SUM(amount),0)')
                ->whereColumn('p.platform_billing_invoice_id', 'i.id')->where('p.status', 'confirmed'), 'paid')
            // M-Pesa money already in saf_payments for this invoice's account but not yet applied
            // (Safaricom has reported it and the system is still confirming it).
            ->selectSub(DB::table('saf_payments as s')->selectRaw('COALESCE(SUM(s.amount),0)')
                ->whereColumn('s.account_number', 'i.account_number')->whereColumn('s.environment', 'i.environment')
                ->whereIn('s.verification_status', ['pending', 'verified'])->whereNotNull('s.mpesa_receipt_number')
                ->where('s.amount', '>', 0)->whereNull('s.platform_billing_payment_id'), 'receiving');
    }

    /**
     * Payment progress for an invoice: what is confirmed, what has reached the system and is being confirmed,
     * what remains, and the resulting state (pending / partially_paid / paid). Access is extended only by
     * confirmed money; "receiving" is shown so a bookshop sees its payment the moment it lands.
     */
    public static function progress(object $row): object
    {
        $amount = round((float) $row->amount, 2);
        $confirmed = round((float) $row->paid, 2);
        $receiving = round((float) ($row->receiving ?? 0), 2);
        $received = round($confirmed + $receiving, 2);
        $row->paid = $confirmed;
        $row->receiving = $receiving;
        $row->amount_received = $received;
        $row->remaining = max(0, round($amount - $received, 2));
        $row->confirming = $receiving > 0;
        $row->payment_state = match (true) {
            ! in_array($row->status, ['pending', 'partially_paid', 'paid'], true) => $row->status, // cancelled, superseded…
            $row->status === 'paid' || $received >= $amount => 'paid',
            $received > 0 => 'partially_paid',
            default => 'pending',
        };

        return $row;
    }

    public function create(Request $request, PlatformBillingInvoiceService $service)
    {
        $tenant = $this->tenant($request);
        $data = $request->validate(['plan_id' => 'required|integer|exists:subscription_plans,id']);

        return response()->json(['data' => $service->create($tenant, SubscriptionPlan::findOrFail($data['plan_id']))], 201);
    }

    public function invoice(Request $request, int $invoice)
    {
        $row = $this->invoices()->where('i.id', $invoice)->where('i.bookshop_id', $this->tenant($request))->first();
        abort_unless($row, 404);
        $payments = DB::table('platform_billing_payments')->where('platform_billing_invoice_id', $invoice)
            ->select('id', 'channel', 'status', 'amount', 'mpesa_receipt', 'created_at', 'confirmed_at', 'environment', 'query_response')->orderByDesc('id')->get()->map(function ($payment) {
                $query = json_decode($payment->query_response ?? '{}', true);
                $payment->result_code = is_scalar($query['ResultCode'] ?? null) ? (string) $query['ResultCode'] : null;
                unset($payment->query_response);

                return $payment;
            });

        $row = self::progress($row);

        return response()->json(['data' => $row, 'payments' => $payments, 'paid' => $row->paid,
            'receiving' => $row->receiving, 'remaining' => $row->remaining,
            'balance' => max(0, round((float) $row->amount - (float) $row->paid, 2)),
            'overpayment' => max(0, round((float) $row->paid - (float) $row->amount, 2)), ...$this->paymentContext($row->environment)]);
    }

    /**
     * The bookshop's own M-Pesa payments (shop Bills / billing payments table): rows credited to the bookshop,
     * plus rows not yet applied that were paid to one of its own invoice account numbers.
     */
    private function shopPayments(int $tenant)
    {
        $accounts = DB::table('platform_billing_invoices')->where('bookshop_id', $tenant)->select('account_number');

        return DB::table('saf_payments as s')->leftJoin('platform_billing_invoices as i', 'i.id', '=', 's.invoice_id')
            ->where(fn ($q) => $q->where('s.bookshop_id', $tenant)->orWhere(fn ($w) => $w->whereNull('s.bookshop_id')->whereIn('s.account_number', $accounts)));
    }

    private function presentShopPayment(object $row, string $bookshop): array
    {
        return [
            'id' => (int) $row->id, 'date' => $row->transaction_date ?? $row->created_at, 'bookshop_name' => $bookshop,
            'amount' => round((float) $row->amount, 2),
            'allocated_amount' => round((float) $row->allocated_amount, 2), 'excess_amount' => round((float) $row->excess_amount, 2),
            'invoice_id' => $row->invoice_id ? (int) $row->invoice_id : null, 'invoice_status' => $row->invoice_status,
            'account_number' => $row->account_number, 'mpesa_receipt_number' => $row->mpesa_receipt_number,
            // Only the first and last digits: enough to recognise the phone, not to reuse it.
            'phone' => $row->phone_number ? substr($row->phone_number, 0, 4).'•••'.substr($row->phone_number, -3) : null,
            'shortcode' => $row->shortcode, 'channel' => $row->payment_channel, 'environment' => $row->environment,
            'status' => match ($row->verification_status) {
                'reconciled' => 'confirmed', 'rejected' => 'failed', 'unmatched' => 'under_review', default => 'processing',
            },
            'has_receipt' => $row->verification_status === 'reconciled',
        ];
    }

    /** "My Payments" / shop Bills: the bookshop's M-Pesa payments with search, status and date filters. */
    public function myPayments(Request $request)
    {
        $tenant = $this->tenant($request);
        $data = $request->validate([
            'search' => 'nullable|string|max:40', 'status' => 'nullable|in:confirmed,processing,under_review,failed',
            'from' => 'nullable|date', 'to' => 'nullable|date|after_or_equal:from',
        ]);
        $statuses = ['confirmed' => ['reconciled'], 'processing' => ['pending', 'verified'], 'under_review' => ['unmatched'], 'failed' => ['rejected']];
        $search = trim((string) ($data['search'] ?? ''));
        $bookshop = (string) DB::table('bookshops')->where('id', $tenant)->value('name');
        $page = $this->shopPayments($tenant)
            ->when($data['status'] ?? null, fn ($q, $status) => $q->whereIn('s.verification_status', $statuses[$status]))
            ->when($data['from'] ?? null, fn ($q, $v) => $q->where(DB::raw('COALESCE(s.transaction_date, s.created_at)'), '>=', \Illuminate\Support\Carbon::parse($v, 'Africa/Nairobi')->startOfDay()->setTimezone(config('app.timezone'))))
            ->when($data['to'] ?? null, fn ($q, $v) => $q->where(DB::raw('COALESCE(s.transaction_date, s.created_at)'), '<=', \Illuminate\Support\Carbon::parse($v, 'Africa/Nairobi')->endOfDay()->setTimezone(config('app.timezone'))))
            ->when($search !== '', fn ($q) => $q->where(fn ($w) => $w->where('s.mpesa_receipt_number', 'like', '%'.strtoupper($search).'%')->orWhere('s.account_number', 'like', "%$search%")))
            ->orderByDesc(DB::raw('COALESCE(s.transaction_date, s.created_at)'))->orderByDesc('s.id')
            ->select('s.*', 'i.status as invoice_status')
            ->paginate(20);
        $page->through(fn ($row) => $this->presentShopPayment($row, $bookshop));
        $totals = DB::table('saf_payments')->where('bookshop_id', $tenant)->where('verification_status', 'reconciled')
            ->selectRaw('COUNT(*) as payments, COALESCE(SUM(amount),0) as total')->first();

        return response()->json([...$page->toArray(), 'totals' => ['payments' => (int) $totals->payments, 'total' => round((float) $totals->total, 2)]]);
    }

    /** Full details of one of the bookshop's own payments (the eye icon). */
    public function myPayment(Request $request, int $payment)
    {
        $tenant = $this->tenant($request);
        $row = $this->shopPayments($tenant)->where('s.id', $payment)->select('s.*', 'i.status as invoice_status')->first();
        abort_unless($row, 404);
        $invoice = $row->invoice_id ? DB::table('platform_billing_invoices as i')->leftJoin('subscription_plans as p', 'p.id', '=', 'i.subscription_plan_id')
            ->where('i.id', $row->invoice_id)->first(['i.*', 'p.name as plan_name']) : null;
        $paid = $invoice ? (float) DB::table('platform_billing_payments')->where('platform_billing_invoice_id', $invoice->id)->where('status', 'confirmed')->sum('amount') : null;

        return response()->json(['data' => [
            ...$this->presentShopPayment($row, (string) DB::table('bookshops')->where('id', $tenant)->value('name')),
            'verified_by' => match ($row->verification_source) {
                'daraja_stk_query', 'daraja_transaction_status', 'daraja_pull_api' => 'Safaricom (automatic)',
                'statement_attestation' => 'Nifunze team (M-Pesa statement)', 'legacy_record' => 'Payment records', default => null,
            },
            'verified_at' => $row->verified_at, 'applied_at' => $row->reconciled_at,
            'note' => match ($row->verification_status) {
                'pending', 'verified' => 'We are confirming this payment with Safaricom. It is applied automatically once confirmed.',
                'unmatched' => 'Our team is checking which invoice this payment belongs to. No action is needed from you unless we contact you.',
                'rejected' => 'This payment was not applied. Contact support if you were charged.',
                default => null,
            },
            'invoice' => $invoice ? ['id' => (int) $invoice->id, 'account_number' => $invoice->account_number, 'plan' => $invoice->plan_name,
                'amount' => (float) $invoice->amount, 'paid' => $paid, 'balance' => max(0, round((float) $invoice->amount - $paid, 2)),
                'status' => $invoice->status, 'period_starts_at' => $invoice->period_starts_at, 'period_ends_at' => $invoice->period_ends_at] : null,
        ]]);
    }

    /**
     * "Already paid?": the owner enters the confirmation code from their M-Pesa SMS. The code is checked with
     * Safaricom; nothing is credited on the customer's word, and the amount always comes from Safaricom.
     */
    public function confirmCode(Request $request, int $invoice, \App\Services\Billing\SafPaymentLedger $ledger)
    {
        $tenant = $this->tenant($request);
        $data = $request->validate(['mpesa_code' => ['required', 'string', 'max:20']]);
        $code = \App\Services\Billing\SafPaymentLedger::normalizeCode($data['mpesa_code']);
        if (! $code) {
            throw ValidationException::withMessages(['mpesa_code' => 'Enter the 10-character M-Pesa confirmation code from your SMS, e.g. TJ4K8L2M9P.']);
        }
        $row = DB::table('platform_billing_invoices')->where('id', $invoice)->where('bookshop_id', $tenant)->first();
        abort_unless($row, 404);
        $environment = (string) config('services.mpesa.environment');
        if (! $this->paymentContext($row->environment)['can_pay']) {
            throw ValidationException::withMessages(['mpesa_code' => 'This invoice cannot be paid in the current payment environment.']);
        }
        $existing = DB::table('saf_payments')->where('environment', $environment)->where('mpesa_receipt_number', $code)->first();
        if ($existing) {
            $mine = (int) $existing->invoice_id === (int) $row->id || ($existing->invoice_id === null && $existing->account_number === $row->account_number);
            if ($existing->verification_status === 'reconciled') {
                if (! $mine) throw ValidationException::withMessages(['mpesa_code' => 'This M-Pesa code has already been applied to another invoice. Contact support if this is your payment.']);

                return response()->json(['status' => 'confirmed', 'message' => "Payment {$code} is already confirmed on this invoice."]);
            }
            if ($existing->verification_status === 'rejected') {
                throw ValidationException::withMessages(['mpesa_code' => 'This M-Pesa code cannot be used. Contact support.']);
            }
            if ($existing->verification_status === 'unmatched' && ! $mine) {
                $payload = json_decode($existing->provider_payload ?? '{}', true) ?: [];
                $payload['claims'][] = ['source' => 'customer', 'user_id' => $request->user()->id, 'invoice_id' => $row->id, 'account' => $row->account_number, 'at' => now()->toIso8601String()];
                DB::table('saf_payments')->where('id', $existing->id)->update([
                    'provider_payload' => json_encode($payload), 'updated_at' => now(),
                    'exception_reason' => mb_substr(($existing->exception_reason ? $existing->exception_reason.' ' : '').'Customer says it is for invoice account '.$row->account_number.'.', 0, 255),
                ]);
                \App\Models\AuditLog::record('billing.payment_code_claimed', 'Bookshop owner submitted an M-Pesa code for an invoice', null, ['saf_payment_id' => $existing->id, 'invoice_id' => $row->id], $request->user(), $tenant);

                return response()->json(['status' => 'review', 'message' => "Thanks. Payment {$code} was received but paid to a different account number, so our team will check it and apply it to this invoice."]);
            }

            return response()->json(['status' => 'processing', 'message' => "We have payment {$code} and are confirming it with Safaricom. This page updates automatically."]);
        }
        $id = DB::transaction(fn () => $ledger->recordClaim($code, $environment, $row->account_number, 'customer', $request->user()->id, $row->id));
        \App\Models\AuditLog::record('billing.payment_code_claimed', 'Bookshop owner submitted an M-Pesa code for an invoice', null, ['saf_payment_id' => $id, 'invoice_id' => $row->id], $request->user(), $tenant);
        \App\Jobs\VerifySafPayment::dispatch($id);
        $status = DB::table('saf_payments')->where('id', $id)->value('verification_status');

        return response()->json(match ($status) {
            'reconciled' => ['status' => 'confirmed', 'message' => "Payment {$code} is confirmed and applied to this invoice."],
            'unmatched' => ['status' => 'review', 'message' => "Safaricom is checking payment {$code}. Our team will confirm which invoice it belongs to and apply it."],
            default => ['status' => 'processing', 'message' => "Checking payment {$code} with Safaricom. This usually takes a few minutes."],
        });
    }

    public function paymentReceipt(Request $request, int $payment, \App\Services\Billing\SubscriptionReceiptPdf $pdf)
    {
        $row = DB::table('saf_payments')->where('id', $payment)->where('bookshop_id', $this->tenant($request))
            ->where('verification_status', 'reconciled')->first();
        abort_unless($row, 404);
        $name = 'nifunze-receipt-'.($row->mpesa_receipt_number ?? $row->id).'.pdf';

        return response($pdf->render($row), 200, ['Content-Type' => 'application/pdf', 'Content-Disposition' => "attachment; filename=\"$name\"", 'Cache-Control' => 'private, no-store']);
    }

    /** How long a sent STK prompt can still be answered on the phone (Safaricom expires it after about a minute). */
    public const STK_PROMPT_WINDOW_SECONDS = 180;

    public function stk(Request $request, int $invoice, DarajaStkService $daraja)
    {
        $tenant = $this->tenant($request);
        $data = $request->validate(['phone' => ['required', 'regex:/^254[17][0-9]{8}$/'], 'amount' => 'required|integer|min:1|max:250000']);

        return DB::transaction(function () use ($invoice, $tenant, $data, $daraja) {
            $row = DB::table('platform_billing_invoices')->where('id', $invoice)->where('bookshop_id', $tenant)->lockForUpdate()->first();
            abort_unless($row && in_array($row->status, ['pending', 'partially_paid'], true), 404);
            if (! $this->paymentContext($row->environment)['can_pay']) {
                throw ValidationException::withMessages(['payment' => 'Invoice belongs to another payment environment.']);
            }
            $progress = self::progress($this->invoices()->where('i.id', $invoice)->first());
            if ($data['amount'] > $progress->remaining) {
                throw ValidationException::withMessages(['amount' => 'Amount exceeds the remaining balance of KES '.number_format($progress->remaining, 2).'.']);
            }
            // Only a prompt sent in the last few minutes can still be answered on the phone; an older one has
            // expired, so it no longer blocks a new prompt (any money it did collect is still applied when confirmed).
            if (DB::table('platform_billing_payments')->where('platform_billing_invoice_id', $invoice)->where('channel', 'stk')
                ->whereIn('status', ['pending', 'unknown'])->where('created_at', '>', now()->subSeconds(self::STK_PROMPT_WINDOW_SECONDS))->exists()) {
                throw ValidationException::withMessages(['payment' => 'A payment prompt was just sent to the phone. Complete or cancel it, or try again in a few minutes.']);
            }
            try {
                $result = $daraja->push($data['phone'], $data['amount'], $row->account_number);
            } catch (\Throwable $e) {
                // A timeout may follow an accepted provider request; do not blindly prompt twice.
                DB::table('platform_billing_payments')->insert([
                    'platform_billing_invoice_id' => $invoice, 'environment' => $row->environment, 'channel' => 'stk',
                    'status' => 'unknown', 'phone' => $data['phone'], 'amount' => $data['amount'], 'created_at' => now(), 'updated_at' => now(),
                ]);

                return response()->json(['message' => 'M-Pesa outcome is unknown. Platform staff must check the merchant statement before another attempt.'], 502);
            }
            $checkout = $result['CheckoutRequestID'] ?? null;
            if ((string) ($result['ResponseCode'] ?? '') !== '0' || ! is_string($checkout) || ! $checkout) {
                return response()->json(['message' => 'M-Pesa did not accept the STK request.'], 422);
            }
            DB::table('platform_billing_payments')->insert([
                'platform_billing_invoice_id' => $invoice, 'environment' => $row->environment,
                'channel' => 'stk', 'status' => 'pending', 'checkout_request_id' => $checkout,
                'merchant_request_id' => $result['MerchantRequestID'] ?? null, 'phone' => $data['phone'],
                'amount' => $data['amount'], 'provider_response' => json_encode($result), 'created_at' => now(), 'updated_at' => now(),
            ]);

            return response()->json(['message' => 'STK request sent. Awaiting verified settlement.', 'checkout_request_id' => $checkout, 'merchant_request_id' => $result['MerchantRequestID'] ?? null], 202);
        });
    }
}
