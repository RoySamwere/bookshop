<?php

namespace App\Services;

use App\Models\Bookshop;
use App\Models\BookshopSubscription;
use App\Models\Branch;
use App\Models\User;
use App\Support\Roles;
use Illuminate\Validation\ValidationException;

/**
 * Single place that answers "is this bookshop entitled to X?". Plans store features as rows in
 * plan_features (a NULL limit is unlimited). A bookshop without a subscription record (the adopted
 * legacy business) is unrestricted. Later milestones add billing-driven rules here, not in controllers.
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
        $status = $bookshop->subscription?->status;

        return $status === null || in_array($status, self::OPERATIONAL_STATUSES, true);
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

    private function feature(Bookshop $bookshop, string $feature): ?\App\Models\PlanFeature
    {
        $plan = $bookshop->subscription?->plan;

        return $plan?->features->firstWhere('feature', $feature);
    }
}
