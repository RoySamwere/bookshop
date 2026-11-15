<?php

namespace App\Console\Commands;

use App\Models\BookshopSubscription;
use App\Services\CommunicationService;
use Illuminate\Console\Command;

/**
 * Reminds owners before a trial or paid period ends. Each reminder is keyed to the exact end date,
 * so running this every hour sends it once; extending the trial or renewing creates a new end date
 * and therefore one new reminder.
 */
class SendSubscriptionReminders extends Command
{
    protected $signature = 'communications:subscription-reminders';

    protected $description = 'Email bookshop owners once before their trial or subscription ends';

    public const TRIAL_NOTICE_DAYS = 3;
    public const RENEWAL_NOTICE_DAYS = 7;

    public function handle(CommunicationService $communications): int
    {
        $sent = 0;
        BookshopSubscription::with(['bookshop', 'plan'])
            ->where('status', BookshopSubscription::TRIALING)
            ->whereBetween('trial_ends_at', [now(), now()->addDays(self::TRIAL_NOTICE_DAYS)])
            ->chunkById(100, function ($rows) use ($communications, &$sent) {
                foreach ($rows as $subscription) {
                    if (! $subscription->bookshop?->isActive()) {
                        continue;
                    }
                    $sent += $communications->notify('trial_ending', $subscription->bookshop, 'ends-'.$subscription->trial_ends_at->getTimestamp(), [
                        'ends_on' => $subscription->trial_ends_at->format('j M Y'),
                        'days' => BookshopSubscription::daysUntil($subscription->trial_ends_at),
                    ]);
                }
            });
        BookshopSubscription::with(['bookshop', 'plan'])
            ->whereIn('status', [BookshopSubscription::ACTIVE, BookshopSubscription::PAST_DUE, BookshopSubscription::GRACE_PERIOD])
            ->whereBetween('current_period_ends_at', [now(), now()->addDays(self::RENEWAL_NOTICE_DAYS)])
            ->chunkById(100, function ($rows) use ($communications, &$sent) {
                foreach ($rows as $subscription) {
                    if (! $subscription->bookshop?->isActive()) {
                        continue;
                    }
                    $sent += $communications->notify('renewal_due', $subscription->bookshop, 'ends-'.$subscription->current_period_ends_at->getTimestamp(), [
                        'ends_on' => $subscription->current_period_ends_at->format('j M Y'),
                        'days' => BookshopSubscription::daysUntil($subscription->current_period_ends_at),
                        'plan' => $subscription->plan?->name ?? 'current',
                    ]);
                }
            });
        $this->info("Queued {$sent} reminder email(s).");

        return self::SUCCESS;
    }
}
