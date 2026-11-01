<?php

namespace App\Console\Commands;

use App\Models\SubscriptionPlan;
use App\Services\PlatformBillingInvoiceService;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class GeneratePlatformRenewalInvoices extends Command
{
    protected $signature = 'billing:generate-renewals';

    protected $description = 'Create one renewal invoice when a calendar subscription approaches expiry';

    public function handle(PlatformBillingInvoiceService $invoices): int
    {
        $subscriptions = DB::table('bookshop_subscriptions')
            ->whereNotNull('current_period_ends_at')
            ->where('current_period_ends_at', '<=', now()->addDays(7))
            ->whereIn('status', ['active', 'past_due', 'grace_period', 'expired'])
            ->get();
        foreach ($subscriptions as $subscription) {
            $due = Carbon::parse($subscription->current_period_ends_at);
            $pending = DB::table('platform_billing_invoices')
                ->where('bookshop_id', $subscription->bookshop_id)
                ->where('environment', config('services.mpesa.environment'))->whereIn('status', ['pending', 'partially_paid'])
                ->exists();
            if ($pending) {
                continue;
            }
            $plan = SubscriptionPlan::find($subscription->subscription_plan_id);
            if (! $plan || ! $plan->is_active || $plan->price <= 0) {
                continue;
            }
            $invoices->create($subscription->bookshop_id, $plan);
            $this->info('Renewal invoice generated for bookshop '.$subscription->bookshop_id);
        }

        return self::SUCCESS;
    }
}
