<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\Bookshop;
use App\Models\BookshopSubscription;
use App\Models\PlatformSetting;
use App\Models\SubscriptionEvent;
use App\Models\SubscriptionPlan;
use App\Models\SubscriptionTrialExtension;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Subscription lifecycle bookkeeping and audited status history. Verified billing settlement
 * extends paid access; status changes never delete business records.
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

    public function maxTrialExtensionDays(): int
    {
        return max(1, (int) config('subscriptions.max_trial_extension_days', 90));
    }

    /**
     * Why this subscription cannot receive trial time, or null when it can. Paid subscriptions are never extended here.
     * Callers listing many rows pass a precomputed $hasPaidAccess to avoid one invoice query per row.
     */
    public function trialExtensionBlocker(BookshopSubscription $subscription, ?bool $hasPaidAccess = null): ?string
    {
        if ($hasPaidAccess ?? $subscription->hasPaidAccess()) {
            return 'This bookshop has paid subscription access. Trial extensions only apply to bookshops that have never paid.';
        }
        if (! in_array($subscription->status, [BookshopSubscription::TRIALING, BookshopSubscription::EXPIRED], true)) {
            return 'A '.str_replace('_', ' ', $subscription->status).' subscription cannot be given trial time.';
        }

        return null;
    }

    /**
     * Adds trial days for an unpaid bookshop: an active trial grows from its current end, a lapsed one restarts
     * from now. Only trial_ends_at (and, for a lapsed trial, the status) changes; plan, invoices and payments
     * are untouched. A repeated idempotency key returns the original grant without adding days again.
     *
     * @return array{0: SubscriptionTrialExtension, 1: bool} the extension and whether it was a duplicate submission
     */
    public function extendTrial(Bookshop $bookshop, int $days, ?string $reason, string $idempotencyKey, ?string $expectedTrialEndsAt, User $actor): array
    {
        if ($days < 1 || $days > $this->maxTrialExtensionDays()) {
            throw ValidationException::withMessages(['days' => "Enter a whole number of days between 1 and {$this->maxTrialExtensionDays()}."]);
        }

        try {
            return DB::transaction(function () use ($bookshop, $days, $reason, $idempotencyKey, $expectedTrialEndsAt, $actor) {
                $subscription = BookshopSubscription::where('bookshop_id', $bookshop->id)->lockForUpdate()->first();
                if (! $subscription) {
                    throw ValidationException::withMessages(['subscription' => 'This bookshop has no subscription record to extend.']);
                }
                if ($existing = $this->existingExtension($idempotencyKey, $bookshop)) {
                    return [$existing, true];
                }
                if ($blocker = $this->trialExtensionBlocker($subscription)) {
                    throw ValidationException::withMessages(['subscription' => $blocker]);
                }
                $previous = $subscription->trial_ends_at;
                $expected = $expectedTrialEndsAt ? Carbon::parse($expectedTrialEndsAt) : null;
                if ($expected?->getTimestamp() !== $previous?->getTimestamp()) {
                    abort(409, 'This trial changed since you opened it. Refresh and review the new expiry date before extending.');
                }

                $previousStatus = $subscription->status;
                $reactivated = ! $subscription->inActiveTrial();
                $base = ! $reactivated && $previous ? $previous->copy() : now();
                $newEnd = $base->addDays($days);

                $subscription->forceFill(['trial_ends_at' => $newEnd])->save();
                if ($subscription->status !== BookshopSubscription::TRIALING) {
                    $this->transition($subscription, BookshopSubscription::TRIALING, $actor, 'Trial reactivated by the Platform Owner');
                }
                $note = "Trial extended by {$days} day(s)".($reason ? ": {$reason}" : '');
                $this->record($subscription, 'trial_extended', $previousStatus, $actor, mb_substr($note, 0, 500));

                $extension = SubscriptionTrialExtension::create([
                    'bookshop_id' => $bookshop->id,
                    'bookshop_subscription_id' => $subscription->id,
                    'previous_status' => $previousStatus,
                    'previous_trial_ends_at' => $previous,
                    'new_trial_ends_at' => $newEnd,
                    'days_granted' => $days,
                    'reactivated' => $reactivated,
                    'extended_by' => $actor->id,
                    'extended_by_name' => $actor->name,
                    'reason' => $reason,
                    'idempotency_key' => $idempotencyKey,
                ]);
                AuditLog::record('billing.trial_extended', "Extended the trial of {$bookshop->name} by {$days} day(s)", $subscription, [
                    'trial_extension_id' => $extension->id, 'days' => $days, 'reactivated' => $reactivated,
                    'previous_trial_ends_at' => $previous?->toIso8601String(), 'new_trial_ends_at' => $newEnd->toIso8601String(),
                ], $actor, $bookshop->id);

                return [$extension, false];
            }, 3);
        } catch (UniqueConstraintViolationException $e) {
            // A simultaneous identical submission won the race; its grant stands and nothing else is added.
            $existing = $this->existingExtension($idempotencyKey, $bookshop);
            if (! $existing) {
                throw $e;
            }

            return [$existing, true];
        }
    }

    private function existingExtension(string $idempotencyKey, Bookshop $bookshop): ?SubscriptionTrialExtension
    {
        $existing = SubscriptionTrialExtension::where('idempotency_key', $idempotencyKey)->first();
        if ($existing && $existing->bookshop_id !== $bookshop->id) {
            throw ValidationException::withMessages(['idempotency_key' => 'This submission key was already used for another bookshop.']);
        }

        return $existing;
    }

    /** Sets the plan for future renewals. Status, current period, trial and issued invoices are left as they are. */
    public function changePlan(BookshopSubscription $subscription, SubscriptionPlan $plan, ?User $actor = null): SubscriptionEvent
    {
        $from = $subscription->plan?->name ?? 'no plan';
        $subscription->forceFill(['subscription_plan_id' => $plan->id])->save();

        return $this->record($subscription, 'plan_changed', $subscription->status, $actor, "Plan changed from {$from} to {$plan->name}");
    }

    private function record(BookshopSubscription $subscription, string $event, ?string $from, ?User $actor, ?string $note): SubscriptionEvent
    {
        return $subscription->events()->create([
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
