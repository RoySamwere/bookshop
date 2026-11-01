<?php

namespace App\Services;

use App\Models\SubscriptionPlan;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class PlatformBillingInvoiceService
{
    /**
     * Allocate one permanent six-digit Paybill account per invoice.
     * Numbers are never reused, avoiding late manual payments being attributed to another shop.
     */
    public function create(int $bookshopId, SubscriptionPlan $plan, \DateTimeInterface $start, \DateTimeInterface $end): object
    {
        if (!$plan->is_active || $plan->price <= 0 || $plan->currency !== 'KES') {
            throw ValidationException::withMessages(['plan' => 'Select an active paid KES subscription plan.']);
        }

        return DB::transaction(function () use ($bookshopId, $plan, $start, $end) {
            // Serialize allocation across concurrent tenant checkouts using a stable platform row.
            DB::table('subscription_plans')->where('id', $plan->id)->lockForUpdate()->first();
            // Locking only a plan does not serialize other plans; the account namespace is global.
            // MySQL's advisory lock ensures cross-plan allocation cannot race.
            $mysql = DB::getDriverName() === 'mysql';
            if ($mysql) {
                $lock = DB::selectOne("SELECT GET_LOCK('platform_invoice_account', 10) AS acquired");
                if ((int) ($lock->acquired ?? 0) !== 1) {
                    throw new \RuntimeException('Could not allocate a Paybill account. Please retry.');
                }
            }
            try {
                $used = DB::table('platform_billing_invoices')->pluck('account_number')->map(fn ($n) => (int) $n)->all();
                $occupied = array_fill_keys($used, true);
                $number = null;
                for ($candidate = 100000; $candidate <= 999999; $candidate++) {
                    if (!isset($occupied[$candidate])) {
                        $number = (string) $candidate;
                        break;
                    }
                }
                if ($number === null) {
                    throw new \RuntimeException('Six-digit Paybill account capacity exhausted; expand the account format.');
                }
                $id = DB::table('platform_billing_invoices')->insertGetId([
                    'bookshop_id' => $bookshopId,
                    'subscription_plan_id' => $plan->id,
                    'account_number' => $number,
                    'amount' => $plan->price,
                    'currency' => 'KES',
                    'status' => 'pending',
                    'period_starts_at' => $start,
                    'period_ends_at' => $end,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
                return DB::table('platform_billing_invoices')->where('id', $id)->first();
            } finally {
                if ($mysql) DB::select("SELECT RELEASE_LOCK('platform_invoice_account')");
            }
        });
    }
}
