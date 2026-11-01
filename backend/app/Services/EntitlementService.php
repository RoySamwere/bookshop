<?php

namespace App\Services;

use App\Models\Bookshop;
use App\Models\BookshopSubscription;
use App\Models\Branch;
use App\Models\PlanFeature;
use App\Models\User;
use App\Support\Roles;
use Illuminate\Validation\ValidationException;

/**
 * Single place that answers "is this bookshop entitled to X?". Plans store features as rows in
 * plan_features (a NULL limit is unlimited). A bookshop without a subscription record (the adopted
 * legacy business) is unrestricted. Subscription expiry is checked here before workspace access.
 */
class EntitlementService
{
    /** Subscription states that keep the workspace fully usable. */
    public const OPERATIONAL_STATUSES = [BookshopSubscription::TRIALING, BookshopSubscription::ACTIVE, BookshopSubscription::PAST_DUE, BookshopSubscription::GRACE_PERIOD];

    public function enabled(Bookshop $bookshop, string $feature): bool
    {
        $row = $this->feature($bookshop, $feature);

        return $row === null || $row->is_enabled;
    }

    /** The plan's limit for a countable feature such as 'branches.max', or null for unlimited. */
    public function limit(Bookshop $bookshop, string $feature): ?int
    {
        return $this->feature($bookshop, $feature)?->limit;
    }

    public function isOperational(Bookshop $bookshop): bool
    {
        $subscription = $bookshop->subscription;
        if (! $subscription) {
            return true;
        } // Legacy shops keep their existing access.
        if (! in_array($subscription->status, self::OPERATIONAL_STATUSES, true)) {
            return false;
        }
        if ($subscription->status === BookshopSubscription::TRIALING) {
            return ! $subscription->trial_ends_at || $subscription->trial_ends_at->isFuture();
        }
        $expiry = $subscription->grace_ends_at ?? $subscription->current_period_ends_at;

        return ! $expiry || $expiry->isFuture();
    }

    public function canAddBranch(Bookshop $bookshop): bool
    {
        $limit = $this->limit($bookshop, 'branches.max');

        return $limit === null || Branch::withoutGlobalScope('bookshop')->where('bookshop_id', $bookshop->id)->count() < $limit;
    }

    public function canAddUser(Bookshop $bookshop): bool
    {
        $limit = $this->limit($bookshop, 'users.max');

        return $limit === null || User::where('bookshop_id', $bookshop->id)->whereIn('role', Roles::BRANCH_ROLES)->count() < $limit;
    }

    public function ensureCanAddBranch(Bookshop $bookshop): void
    {
        if (! $this->canAddBranch($bookshop)) {
            throw ValidationException::withMessages(['name' => 'Your plan does not include more branches.']);
        }
    }

    public function ensureCanAddUser(Bookshop $bookshop): void
    {
        if (! $this->canAddUser($bookshop)) {
            throw ValidationException::withMessages(['email' => 'Your plan does not include more staff accounts.']);
        }
    }

    private function feature(Bookshop $bookshop, string $feature): ?PlanFeature
    {
        $plan = $bookshop->subscription?->plan;

        return $plan?->features->firstWhere('feature', $feature);
    }
}
