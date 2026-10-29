<?php

namespace App\Services;

use App\Models\Bookshop;
use App\Models\BookshopSubscription;
use App\Models\PlatformSetting;
use App\Models\SubscriptionPlan;
use App\Models\User;

/**
 * Subscription lifecycle bookkeeping. Milestone 1 has no billing: this only records state and
 * history. No status change here deletes or hides business records.
 */
class SubscriptionService
{
    public function trialDays(): int
    {
        $override = PlatformSetting::get('trial_days');

        return max(0, (int) ($override ?? config('subscriptions.trial_days')));
    }

    public function defaultPlan(): ?SubscriptionPlan
    {
        return SubscriptionPlan::where('code', config('subscriptions.default_plan'))->where('is_active', true)->first()
            ?? SubscriptionPlan::where('is_active', true)->orderBy('sort_order')->first();
    }

    public function startTrial(Bookshop $bookshop, ?User $actor = null): BookshopSubscription
    {
        $plan = $this->defaultPlan();
        $days = $plan?->trial_days ?? $this->trialDays();
        $subscription = new BookshopSubscription([
            'subscription_plan_id' => $plan?->id,
            'status' => BookshopSubscription::TRIALING,
            'trial_starts_at' => now(),
            'trial_ends_at' => now()->addDays($days),
        ]);
        $subscription->bookshop()->associate($bookshop)->save();
        $this->record($subscription, 'trial_started', null, $actor, "{$days}-day trial");

        return $subscription;
    }

    /** Records the existing single-shop business as an active subscriber, without a trial clock. */
    public function startLegacy(Bookshop $bookshop, ?User $actor = null): BookshopSubscription
    {
        $subscription = new BookshopSubscription([
            'subscription_plan_id' => $this->defaultPlan()?->id,
            'status' => BookshopSubscription::ACTIVE,
            'current_period_starts_at' => now(),
        ]);
        $subscription->bookshop()->associate($bookshop)->save();
        $this->record($subscription, 'legacy_adopted', null, $actor, 'Existing business adopted into multi-tenancy');

        return $subscription;
    }

    public function transition(BookshopSubscription $subscription, string $status, ?User $actor = null, ?string $note = null): BookshopSubscription
    {
        abort_unless(in_array($status, BookshopSubscription::STATUSES, true), 422, 'Unknown subscription status.');
        $from = $subscription->status;
        if ($from === $status) {
            return $subscription;
        }
        $subscription->forceFill([
            'status' => $status,
            'cancelled_at' => $status === BookshopSubscription::CANCELLED ? now() : $subscription->cancelled_at,
        ])->save();
        $this->record($subscription, 'status_changed', $from, $actor, $note);

        return $subscription;
    }

    private function record(BookshopSubscription $subscription, string $event, ?string $from, ?User $actor, ?string $note): void
    {
        $subscription->events()->create([
            'bookshop_id' => $subscription->bookshop_id,
            'subscription_plan_id' => $subscription->subscription_plan_id,
            'event' => $event,
            'from_status' => $from,
            'to_status' => $subscription->status,
            'actor_id' => $actor?->id,
            'note' => $note,
        ]);
    }
}
