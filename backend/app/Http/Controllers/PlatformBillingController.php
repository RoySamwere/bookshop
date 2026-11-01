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

    public function index(Request $request)
    {
        $tenant = $this->tenant($request);

        return response()->json([
            'invoices' => $this->invoices()->where('i.bookshop_id', $tenant)->orderByDesc('i.id')->paginate(20),
            'subscription' => BookshopSubscription::where('bookshop_id', $tenant)->first()?->summary(),
            'plans' => SubscriptionPlan::where('is_active', true)->where('currency', 'KES')->where('price', '>', 0)->get(),
            'paybill' => '153283', 'environment' => config('services.mpesa.environment'),
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
            ->select('id', 'channel', 'status', 'amount', 'mpesa_receipt', 'created_at', 'confirmed_at', 'environment')->orderByDesc('id')->get();

        return response()->json(['data' => $row, 'payments' => $payments, 'paid' => $row->paid,
            'balance' => max(0, round((float) $row->amount - (float) $row->paid, 2)),
            'overpayment' => max(0, round((float) $row->paid - (float) $row->amount, 2)), 'paybill' => '153283']);
    }

    public function stk(Request $request, int $invoice, DarajaStkService $daraja)
    {
        $tenant = $this->tenant($request);
        $data = $request->validate(['phone' => ['required', 'regex:/^254[17][0-9]{8}$/'], 'amount' => 'required|integer|min:1|max:250000']);

        return DB::transaction(function () use ($invoice, $tenant, $data, $daraja) {
            $row = DB::table('platform_billing_invoices')->where('id', $invoice)->where('bookshop_id', $tenant)->lockForUpdate()->first();
            abort_unless($row && in_array($row->status, ['pending', 'partially_paid'], true), 404);
            if ($row->environment !== config('services.mpesa.environment')) {
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

            return response()->json(['message' => 'STK request sent. Awaiting verified settlement.', 'checkout_request_id' => $checkout], 202);
        });
    }
}
