<?php

namespace App\Http\Controllers;

use App\Http\Resources\AuditLogResource;
use App\Http\Resources\UserResource;
use App\Models\AuditLog;
use App\Models\User;
use App\Notifications\AccountNotification;
use App\Notifications\StaffAccessDecision;
use App\Support\Roles;
use App\Support\SafeMail;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/** Staff access approvals, verification resends and per-account history. */
class AccountReviewController extends Controller
{
    public function approve(Request $request, User $user): UserResource|JsonResponse
    {
        Gate::authorize('reviewStaffAccess', $user);
        $caller = $request->user();

        $data = $request->validate([
            'role' => ['required', Rule::in(array_values(array_diff($caller->assignableRoles(), [Roles::CUSTOMER])))],
            'branch_ids' => ['required', 'array', 'min:1'],
            'branch_ids.*' => ['integer', 'distinct', Rule::in($caller->branchIds())],
        ], [
            'role.in' => 'You cannot assign this role.',
            'branch_ids.required' => 'Assign at least one branch.',
            'branch_ids.min' => 'Assign at least one branch.',
            'branch_ids.*.in' => 'You can only assign branches you have access to.',
        ]);

        if (! $user->hasVerifiedEmail()) {
            return response()->json([
                'message' => "{$user->name} has not verified their email address yet. Resend the verification email and approve once it is confirmed.",
            ], 422);
        }

        DB::transaction(function () use ($user, $caller, $data) {
            $user->forceFill([
                'role' => $data['role'],
                'staff_access_status' => User::ACCESS_APPROVED,
                'staff_access_reviewed_at' => now(),
                'staff_access_reviewed_by' => $caller->id,
                'staff_access_note' => null,
                'created_by' => $user->created_by ?? $caller->id,
            ])->save();
            $user->branches()->sync(array_map('intval', $data['branch_ids']));
            // The old customer session must not carry over into staff access.
            $user->tokens()->delete();
        });

        AuditLog::record('user.staff_access_approved', "Approved staff access for {$user->name} as ".Roles::label($user->role), $user, [
            'role' => $user->role, 'branch_ids' => $user->branches()->pluck('branches.id')->all(),
        ]);
        $user->notify(new AccountNotification('Staff access approved', 'You are now '.Roles::label($user->role).'. Sign in to open the management system.', 'success'));
        SafeMail::send(fn () => $user->notify(new StaffAccessDecision(true, $user->role)));

        return (new UserResource($user->load('branches')))->additional([
            'message' => "{$user->name} now has ".Roles::label($user->role).' access.',
        ]);
    }

    public function reject(Request $request, User $user): UserResource
    {
        Gate::authorize('reviewStaffAccess', $user);
        $data = $request->validate(['note' => ['nullable', 'string', 'max:500']]);
        $note = isset($data['note']) && trim($data['note']) !== '' ? trim($data['note']) : null;

        $user->forceFill([
            'staff_access_status' => User::ACCESS_REJECTED,
            'staff_access_reviewed_at' => now(),
            'staff_access_reviewed_by' => $request->user()->id,
            'staff_access_note' => $note,
        ])->save();

        AuditLog::record('user.staff_access_rejected', "Declined staff access for {$user->name}", $user, ['note' => $note]);
        $user->notify(new AccountNotification('Staff access request declined', $note ?: 'Your request for staff access was not approved.', 'warning'));
        SafeMail::send(fn () => $user->notify(new StaffAccessDecision(false, note: $note)));

        return (new UserResource($user->load('branches')))->additional([
            'message' => "{$user->name}'s staff access request was declined. Their customer account stays active.",
        ]);
    }

    public function resendVerification(Request $request, User $user): JsonResponse
    {
        if ($user->hasVerifiedEmail()) {
            return response()->json(['message' => "{$user->name} has already verified their email address."], 422);
        }
        Gate::authorize('resendVerification', $user);

        $sent = SafeMail::send(fn () => $user->sendEmailVerificationNotification());
        AuditLog::record('user.verification_resent', "Resent the verification email to {$user->name}", $user, ['sent' => $sent]);

        return response()->json([
            'message' => $sent
                ? "A new verification link was sent to {$user->email}."
                : 'The email could not be sent. Check the mail settings in backend/.env.',
        ], $sent ? 200 : 503);
    }

    /** Recent activity on an account (changes made to it) and by it (sign-ins and its own actions). */
    public function history(Request $request, User $user): AnonymousResourceCollection
    {
        Gate::authorize('viewHistory', $user);

        $entries = AuditLog::query()->with('user')
            ->where(fn (Builder $query) => $query
                ->where(fn (Builder $about) => $about->where('subject_type', $user->getMorphClass())->where('subject_id', $user->id))
                ->orWhere('user_id', $user->id))
            ->latest('id')->limit(50)->get();

        return AuditLogResource::collection($entries);
    }
}
