<?php

namespace App\Http\Controllers;

use App\Http\Requests\RegisterRequest;
use App\Models\AuditLog;
use App\Models\Bookshop;
use App\Models\User;
use App\Notifications\AccountNotification;
use App\Support\Roles;
use App\Support\SafeMail;
use Illuminate\Auth\Events\Verified;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Public self-service customer accounts. Everyone registers as a customer; asking for staff access
 * only files a request with the named bookshop, whose owner or administrator must approve it.
 * Bookshop owners register through BookshopRegistrationController instead.
 */
class RegistrationController extends Controller
{
    public function register(RegisterRequest $request): JsonResponse
    {
        $data = $request->validated();
        $wantsStaffAccess = $request->boolean('request_staff_access');

        $bookshop = isset($data['bookshop']) ? Bookshop::where('slug', $data['bookshop'])->first() : null;

        $user = DB::transaction(function () use ($data, $wantsStaffAccess, $bookshop) {
            $user = new User([
                'name' => $data['name'],
                'email' => $data['email'],
                'phone' => $data['phone'] ?? null,
                'password' => $data['password'],
            ]);
            // Set explicitly, never from input: public sign-ups can only ever be customers.
            $user->forceFill([
                'role' => Roles::CUSTOMER,
                'bookshop_id' => $bookshop?->id,
                'is_active' => true,
                'email_verified_at' => null,
                'created_by' => null,
                'registration_source' => User::SOURCE_PUBLIC,
                'terms_accepted_at' => now(),
                'staff_access_status' => $wantsStaffAccess ? User::ACCESS_PENDING : null,
                'staff_access_requested_at' => $wantsStaffAccess ? now() : null,
            ])->save();

            return $user;
        });

        AuditLog::record('auth.registered', "{$user->name} registered an account", $user, [
            'staff_access_requested' => $wantsStaffAccess,
        ], $user);
        if ($wantsStaffAccess) {
            AuditLog::record('user.staff_access_requested', "{$user->name} requested staff access", $user, actor: $user);
            $this->notifyReviewers($user);
        }

        $sent = SafeMail::send(fn () => $user->sendEmailVerificationNotification());

        return response()->json([
            'message' => $sent
                ? 'Your account has been created. Check your email for a link to verify your address.'
                : 'Your account has been created, but we could not send the verification email right now. You can request a new link shortly.',
            'data' => [
                'email' => $user->email,
                'verification_email_sent' => $sent,
                'staff_access_status' => $user->staff_access_status,
            ],
        ], 201);
    }

    /** Opened from the emailed link (via the frontend). The signed URL is the proof of ownership. */
    public function verify(Request $request, string $id, string $hash): JsonResponse
    {
        if (! $request->hasValidRelativeSignature()) {
            return response()->json(['message' => 'This verification link is invalid or has expired. Request a new one.', 'status' => 'invalid'], 403);
        }

        $user = User::find($id);
        if (! $user || ! hash_equals(sha1($user->getEmailForVerification()), $hash)) {
            return response()->json(['message' => 'This verification link is invalid or has expired. Request a new one.', 'status' => 'invalid'], 403);
        }

        if ($user->hasVerifiedEmail()) {
            return response()->json(['message' => 'Your email address is already verified. You can sign in.', 'status' => 'already_verified']);
        }

        $user->markEmailAsVerified();
        event(new Verified($user));
        AuditLog::record('auth.email_verified', "{$user->name} verified their email address", $user, actor: $user);

        return response()->json([
            'message' => match (true) {
                $user->hasPendingStaffRequest() => 'Email verified. Your staff access request is now ready for review.',
                default => 'Email verified. You can now sign in.',
            },
            'status' => 'verified',
            'next' => $user->role === Roles::BOOKSHOP_OWNER ? '/onboarding/verify-email' : null,
        ]);
    }

    /** Public resend; the response never reveals whether the address has an account. */
    public function resend(Request $request): JsonResponse
    {
        $request->validate(['email' => ['required', 'email', 'max:255']]);
        $user = User::where('email', strtolower(trim($request->input('email'))))->first();

        if ($user && ! $user->hasVerifiedEmail() && $user->canSignIn()) {
            SafeMail::send(fn () => $user->sendEmailVerificationNotification());
            AuditLog::record('auth.verification_resent', "Verification email requested for {$user->email}", $user, actor: $user);
        }

        return response()->json(['message' => 'If that address has an unverified account, a new verification link is on its way.']);
    }

    /** Signed-in users who have not verified yet can ask for a fresh link from their account page. */
    public function resendForCurrentUser(Request $request): JsonResponse
    {
        $user = $request->user();
        if ($user->hasVerifiedEmail()) {
            return response()->json(['message' => 'Your email address is already verified.']);
        }

        $sent = SafeMail::send(fn () => $user->sendEmailVerificationNotification());
        AuditLog::record('auth.verification_resent', "{$user->name} requested a new verification email", $user);

        return response()->json([
            'message' => $sent ? "A new verification link has been sent to {$user->email}." : 'We could not send the email right now. Try again later.',
        ], $sent ? 200 : 503);
    }

    /** Only the bookshop the applicant named reviews their request. */
    private function notifyReviewers(User $applicant): void
    {
        User::where('bookshop_id', $applicant->bookshop_id)->whereIn('role', [...Roles::TENANT_OWNER_ROLES, Roles::ADMIN])->where('is_active', true)->get()
            ->each(fn (User $reviewer) => $reviewer->notify(new AccountNotification(
                'New staff access request',
                "{$applicant->name} ({$applicant->email}) registered and asked for staff access.",
                'info',
                'Users',
            )));
    }
}
