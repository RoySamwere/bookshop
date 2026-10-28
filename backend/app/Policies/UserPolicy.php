<?php

namespace App\Policies;

use App\Models\User;

/**
 * Account-management rules. Route middleware checks the permission name first;
 * these checks then decide whether the caller may act on this particular account.
 */
class UserPolicy
{
    public function view(User $caller, User $target): bool
    {
        return $caller->hasPermission('users.view')
            && User::query()->visibleTo($caller)->whereKey($target->id)->exists();
    }

    public function manage(User $caller, User $target): bool
    {
        return $caller->canManageUser($target);
    }

    /** Approve or reject a pending staff access request. */
    public function reviewStaffAccess(User $caller, User $target): bool
    {
        return $caller->hasPermission('users.manage')
            && $target->hasPendingStaffRequest()
            && $caller->canManageUser($target);
    }

    public function resendVerification(User $caller, User $target): bool
    {
        return ! $target->hasVerifiedEmail() && $caller->canManageUser($target);
    }

    public function viewHistory(User $caller, User $target): bool
    {
        return $caller->hasPermission('audit.view') && $this->view($caller, $target);
    }
}
