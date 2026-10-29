<?php

namespace App\Http\Controllers;

use App\Http\Resources\UserResource;
use App\Models\AuditLog;
use App\Models\User;
use App\Notifications\StaffInvitation;
use App\Services\EntitlementService;
use App\Support\Roles;
use App\Support\SafeMail;
use App\Support\Tenancy\Tenant;
use Illuminate\Auth\Events\Verified;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password as PasswordRule;
use Illuminate\Validation\ValidationException;

/**
 * Employees are invited by email into the inviter's own bookshop with a role and branches the inviter
 * may assign. The account exists but cannot be used until the invitee sets a password from the link,
 * which also confirms their email address.
 */
class StaffInvitationController extends Controller
{
    public function invite(Request $request, EntitlementService $entitlements): JsonResponse
    {
        $caller = $request->user();
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'phone' => ['nullable', 'string', 'max:30', 'regex:/^[0-9+()\s-]{7,30}$/'],
            'role' => ['required', Rule::in(array_values(array_intersect($caller->assignableRoles(), Roles::BRANCH_ROLES)))],
            'branch_ids' => ['required', 'array', 'min:1'],
            'branch_ids.*' => ['integer', 'distinct', Rule::in($caller->branchIds())],
            'bookshop_id' => ['prohibited'],
        ], [
            'role.in' => 'You cannot assign this role.',
            'branch_ids.required' => 'Assign at least one branch.',
            'branch_ids.*.in' => 'You can only assign branches of your bookshop that you have access to.',
            'email.unique' => 'An account with this email address already exists.',
        ]);
        $entitlements->ensureCanAddUser($caller->bookshop);

        $user = DB::transaction(function () use ($data, $caller) {
            $user = new User(['name' => $data['name'], 'email' => strtolower(trim($data['email'])), 'phone' => $data['phone'] ?? null, 'role' => $data['role']]);
            // Unusable until the invitation is accepted; the invitee chooses their own password.
            $user->password = Str::random(64);
            $user->forceFill([
                'bookshop_id' => $caller->bookshop_id,
                'is_active' => true,
                'email_verified_at' => null,
                'created_by' => $caller->id,
                'registration_source' => User::SOURCE_INVITATION,
            ])->save();
            $user->branches()->sync(array_map('intval', $data['branch_ids']));

            return $user;
        });

        $sent = $this->sendInvitation($user, $caller);
        AuditLog::record('user.invited', "Invited {$user->name} as ".Roles::label($user->role), $user, [
            'role' => $user->role, 'branch_ids' => $user->branches()->pluck('branches.id')->all(), 'sent' => $sent,
        ]);

        return (new UserResource($user->load('branches')))->additional([
            'message' => $sent ? "An invitation was sent to {$user->email}." : "{$user->name} was added, but the invitation email could not be sent. Resend it shortly.",
        ])->response()->setStatusCode(201);
    }

    public function resend(Request $request, User $user): JsonResponse
    {
        abort_unless($user->bookshop_id === Tenant::requireId() && $request->user()->canManageUser($user), 404);
        if ($user->hasVerifiedEmail() || $user->registration_source !== User::SOURCE_INVITATION) {
            return response()->json(['message' => "{$user->name} has already accepted their invitation."], 422);
        }
        $sent = $this->sendInvitation($user, $request->user());
        AuditLog::record('user.invitation_resent', "Resent the invitation to {$user->name}", $user, ['sent' => $sent]);

        return response()->json(['message' => $sent ? "A new invitation was sent to {$user->email}." : 'The email could not be sent. Try again later.'], $sent ? 200 : 503);
    }

    /** Public: the invitee sets their password from the emailed link. */
    public function accept(Request $request): JsonResponse
    {
        $request->validate([
            'token' => ['required', 'string'],
            'email' => ['required', 'email'],
            'password' => ['required', 'confirmed', PasswordRule::defaults()],
        ]);
        $email = strtolower(trim($request->input('email')));
        $invitee = User::where('email', $email)->first();
        $invalid = fn () => ValidationException::withMessages(['token' => ['This invitation link is invalid or has expired. Ask your manager to resend it.']]);
        if (! $invitee || $invitee->registration_source !== User::SOURCE_INVITATION || $invitee->hasVerifiedEmail() || ! $invitee->canSignIn()) {
            throw $invalid();
        }

        $status = Password::broker('invitations')->reset(
            ['email' => $email, 'token' => $request->input('token'), 'password' => $request->input('password'), 'password_confirmation' => $request->input('password_confirmation')],
            function (User $user, string $password) {
                $user->password = $password;
                $user->setRememberToken(Str::random(60));
                $user->markEmailAsVerified();
                event(new Verified($user));
                AuditLog::record('user.invitation_accepted', "{$user->name} accepted their invitation", $user, actor: $user);
            },
        );
        if ($status !== Password::PASSWORD_RESET) {
            throw $invalid();
        }

        return response()->json(['message' => 'Your account is ready. Sign in with your new password.']);
    }

    private function sendInvitation(User $user, User $inviter): bool
    {
        return SafeMail::send(function () use ($user, $inviter) {
            $token = Password::broker('invitations')->createToken($user);
            $user->notify(new StaffInvitation($token, $inviter->name, $inviter->bookshop?->name ?? 'your bookshop'));
        });
    }
}
