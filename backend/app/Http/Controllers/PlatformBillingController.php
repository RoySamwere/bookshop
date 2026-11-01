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
            'invoices' => $this->invoices()->where('i.bookshop_id', $tenant)->orderByDesc('i.id')->paginate(20),
            'subscription' => BookshopSubscription::where('bookshop_id', $tenant)->first()?->summary(),
            'plans' => SubscriptionPlan::where('is_active', true)->where('currency', 'KES')->where('price', '>', 0)->get(),
            ...$this->paymentContext(),
        ]);
    }

    public function admin(Request $request)
    {
        $data = $request->validate(['status' => 'nullable|in:pending,partially_paid,paid', 'environment' => 'nullable|in:sandbox,production,legacy']);

        return response()->json($this->invoices()->when($data['status'] ?? null, fn ($q, $s) => $q->where('i.status', $s))
            ->when($data['environment'] ?? null, fn ($q, $e) => $q->where('i.environment', $e))->orderByDesc('i.id')->paginate(30));
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
                ->whereColumn('p.platform_billing_invoice_id', 'i.id')->where('p.status', 'confirmed'), 'paid');
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

        return response()->json(['data' => $row, 'payments' => $payments, 'paid' => $row->paid,
            'balance' => max(0, round((float) $row->amount - (float) $row->paid, 2)),
            'overpayment' => max(0, round((float) $row->paid - (float) $row->amount, 2)), ...$this->paymentContext($row->environment)]);
    }

    /** "My Payments": every M-Pesa payment linked to the signed-in owner's bookshop. */
    public function myPayments(Request $request)
    {
        $tenant = $this->tenant($request);
        $page = DB::table('saf_payments as s')->leftJoin('platform_billing_invoices as i', 'i.id', '=', 's.invoice_id')
            ->where('s.bookshop_id', $tenant)
            ->orderByDesc(DB::raw('COALESCE(s.transaction_date, s.created_at)'))->orderByDesc('s.id')
            ->select('s.id', 's.transaction_date', 's.created_at', 's.amount', 's.allocated_amount', 's.excess_amount', 's.account_number',
                's.mpesa_receipt_number', 's.phone_number', 's.payment_channel', 's.environment', 's.verification_status', 's.invoice_id', 'i.status as invoice_status')
            ->paginate(20);
        $page->through(fn ($row) => [
            'id' => (int) $row->id, 'date' => $row->transaction_date ?? $row->created_at, 'amount' => round((float) $row->amount, 2),
            'allocated_amount' => round((float) $row->allocated_amount, 2), 'excess_amount' => round((float) $row->excess_amount, 2),
            'invoice_id' => $row->invoice_id ? (int) $row->invoice_id : null, 'invoice_status' => $row->invoice_status,
            'account_number' => $row->account_number, 'mpesa_receipt_number' => $row->mpesa_receipt_number,
            // Only the last digits: enough to recognise the phone, not to reuse it.
            'phone' => $row->phone_number ? substr($row->phone_number, 0, 4).'•••'.substr($row->phone_number, -3) : null,
            'channel' => $row->payment_channel, 'environment' => $row->environment,
            'status' => match ($row->verification_status) {
                'reconciled' => 'confirmed', 'rejected' => 'failed', 'unmatched' => 'under_review', default => 'processing',
            },
            'has_receipt' => $row->verification_status === 'reconciled',
        ]);
        $totals = DB::table('saf_payments')->where('bookshop_id', $tenant)->where('verification_status', 'reconciled')
            ->selectRaw('COUNT(*) as payments, COALESCE(SUM(amount),0) as total')->first();

        return response()->json([...$page->toArray(), 'totals' => ['payments' => (int) $totals->payments, 'total' => round((float) $totals->total, 2)]]);
    }

    public function paymentReceipt(Request $request, int $payment, \App\Services\Billing\SubscriptionReceiptPdf $pdf)
    {
        $row = DB::table('saf_payments')->where('id', $payment)->where('bookshop_id', $this->tenant($request))
            ->where('verification_status', 'reconciled')->first();
        abort_unless($row, 404);
        $name = 'nifunze-receipt-'.($row->mpesa_receipt_number ?? $row->id).'.pdf';

        return response($pdf->render($row), 200, ['Content-Type' => 'application/pdf', 'Content-Disposition' => "attachment; filename=\"$name\"", 'Cache-Control' => 'private, no-store']);
    }

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
            $paid = (float) DB::table('platform_billing_payments')->where('platform_billing_invoice_id', $invoice)->where('status', 'confirmed')->sum('amount');
            if ($data['amount'] > round((float) $row->amount - $paid, 2)) {
                throw ValidationException::withMessages(['amount' => 'Amount exceeds outstanding balance.']);
            }
            if (DB::table('platform_billing_payments')->where('platform_billing_invoice_id', $invoice)
                ->whereIn('status', ['pending', 'awaiting_verification', 'unknown'])->exists()) {
                throw ValidationException::withMessages(['payment' => 'Reconcile the existing STK request before starting another.']);
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
