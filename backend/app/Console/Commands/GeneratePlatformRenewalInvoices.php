<?php

namespace App\Console\Commands;

use App\Models\SubscriptionPlan;
use App\Services\PlatformBillingInvoiceService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class GeneratePlatformRenewalInvoices extends Command
{
    protected $signature = 'billing:generate-renewals';
    protected $description = 'Create one renewal invoice when 28 days have elapsed since the last confirmed subscription payment';

    public function handle(PlatformBillingInvoiceService $invoices): int
    {
        $subscriptions = DB::table('bookshop_subscriptions')
            ->whereNotNull('current_period_ends_at')
            ->where('current_period_ends_at', '<=', now())
            ->whereIn('status', ['active', 'past_due', 'grace_period'])
            ->get();
        foreach ($subscriptions as $subscription) {
            $lastPaid = DB::table('platform_billing_invoices')
                ->where('bookshop_id', $subscription->bookshop_id)
                ->where('status', 'paid')
                ->orderByDesc('paid_at')->first();
            if (!$lastPaid) continue;
            $due = \Illuminate\Support\Carbon::parse($lastPaid->paid_at)->addDays(28);
            if ($due->isFuture()) continue;
            $pending = DB::table('platform_billing_invoices')
                ->where('bookshop_id', $subscription->bookshop_id)
                ->where('status', 'pending')
                ->exists();
            if ($pending) continue;
            $plan = SubscriptionPlan::find($subscription->subscription_plan_id);
            if (!$plan || !$plan->is_active || $plan->price <= 0) continue;
            $invoices->create($subscription->bookshop_id, $plan, $due, $due->copy()->addDays(28));
            $this->info('Renewal invoice generated for bookshop '.$subscription->bookshop_id);
        }
        return self::SUCCESS;
    }
}
