<?php

namespace App\Console\Commands;

use App\Models\BookshopSubscription;
use App\Services\SubscriptionService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class ExpirePlatformSubscriptions extends Command
{
    protected $signature = 'billing:expire-subscriptions';

    protected $description = 'Expire elapsed trials and paid subscriptions without deleting business records';

    public function handle(): int
    {
        BookshopSubscription::whereIn('status', ['trialing', 'active', 'past_due', 'grace_period'])->chunkById(100, function ($rows) {
            foreach ($rows as $row) {
                DB::transaction(function () use ($row) {
                    $subscription = BookshopSubscription::whereKey($row->id)->lockForUpdate()->first();
                    if (! in_array($subscription->status, ['trialing', 'active', 'past_due', 'grace_period'], true)) {
                        return;
                    }
                    $expiry = $subscription->status === 'trialing' ? $subscription->trial_ends_at
                        : ($subscription->grace_ends_at ?? $subscription->current_period_ends_at);
                    if ($expiry && $expiry->lessThanOrEqualTo(now())) {
                        app(SubscriptionService::class)->transition($subscription, 'expired', null, 'Subscription period elapsed');
                    }
                }, 3);
            }
        });

        return self::SUCCESS;
    }
}
