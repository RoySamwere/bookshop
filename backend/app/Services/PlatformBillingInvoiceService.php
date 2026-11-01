<?php

namespace App\Services;

use App\Models\SubscriptionPlan;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class PlatformBillingInvoiceService
{
    public static function months(string $interval): int
    {
        return match ($interval) {
            'monthly' => 1, 'quarterly' => 3, 'annual', 'annually', 'yearly' => 12,
            default => throw ValidationException::withMessages(['plan' => 'Unsupported billing interval.']),
        };
    }

    public function create(int $bookshopId, SubscriptionPlan $plan): object
    {
        if (! $plan->is_active || $plan->price <= 0 || $plan->currency !== 'KES' || round((float) $plan->price) !== (float) $plan->price) {
            throw ValidationException::withMessages(['plan' => 'Select an active paid KES plan with a whole-shilling price.']);
        }
        $months = self::months($plan->billing_interval);
        $environment = config('services.mpesa.environment');
        abort_unless(in_array($environment, ['sandbox', 'production'], true), 503, 'Invalid payment environment.');

        return DB::transaction(function () use ($bookshopId, $plan, $months, $environment) {
            // The global sequence row serializes allocation until COMMIT, across all plans.
            $sequence = DB::table('platform_billing_sequences')->where('id', 1)->lockForUpdate()->first();
            $subscription = DB::table('bookshop_subscriptions')->where('bookshop_id', $bookshopId)->lockForUpdate()->first();
            abort_unless($subscription, 422, 'Bookshop subscription missing.');
            $pending = DB::table('platform_billing_invoices')->where('bookshop_id', $bookshopId)
                ->where('environment', $environment)->whereIn('status', ['pending', 'partially_paid'])->first();
            if ($pending) {
                if ((int) $pending->subscription_plan_id !== $plan->id) {
                    throw ValidationException::withMessages(['plan' => 'Settle the outstanding invoice before selecting another plan.']);
                }

                return $pending;
            }
            if (! $sequence || $sequence->next_account > 999999) {
                throw ValidationException::withMessages(['invoice' => 'Paybill account capacity exhausted. Contact platform support.']);
            }
            $start = now();
            foreach ([$subscription->current_period_ends_at, $subscription->trial_ends_at] as $expiry) {
                if ($expiry && Carbon::parse($expiry)->greaterThan($start)) {
                    $start = Carbon::parse($expiry);
                }
            }
            $number = (string) $sequence->next_account;
            DB::table('platform_billing_sequences')->where('id', 1)->increment('next_account');
            $id = DB::table('platform_billing_invoices')->insertGetId([
                'bookshop_id' => $bookshopId, 'subscription_plan_id' => $plan->id,
                'account_number' => $number, 'amount' => $plan->price, 'currency' => 'KES',
                'environment' => $environment, 'billing_months' => $months, 'status' => 'pending',
                'period_starts_at' => $start, 'period_ends_at' => $start->copy()->addMonthsNoOverflow($months),
                'due_at' => $start, 'created_at' => now(), 'updated_at' => now(),
            ]);

            return DB::table('platform_billing_invoices')->where('id', $id)->first();
        }, 3);
    }
}
