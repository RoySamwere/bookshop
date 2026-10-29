<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Auth\Events\PasswordReset;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Password;
use Illuminate\Validation\Rules\Password as PasswordRule;
use Illuminate\Validation\ValidationException;

class AuthController extends Controller
{
    public function login(Request $request): JsonResponse
    {
        $credentials = $request->validate([
            'email' => ['required', 'email'],
            'password' => ['required', 'string'],
            'remember' => ['sometimes', 'boolean'],
        ]);
        $credentials['email'] = strtolower(trim($credentials['email']));

        $user = User::where('email', $credentials['email'])->first();

        if (! $user || ! Hash::check($credentials['password'], $user->password)) {
            AuditLog::record('auth.login_failed', 'Failed sign-in attempt', $user, ['email' => $credentials['email']], $user);
            throw ValidationException::withMessages(['email' => ['The email or password is incorrect.']]);
        }

        if (! $user->is_active) {
            return response()->json(['message' => 'Your account has been deactivated. Contact your administrator.'], 403);
        }

        if (! $user->canSignIn()) {
            return response()->json(['message' => 'Your account is not authorised to sign in.'], 403);
        }

        $remember = $request->boolean('remember');
        if ($request->is('api/v1/*') && ! $request->hasSession()) {
            return response()->json(['message' => 'SPA authentication requires a configured first-party origin and CSRF cookie.'], 400);
        }
        $token = null;
        if ($request->hasSession()) {
            Auth::guard('web')->login($user, $remember);
            $request->session()->regenerate();
            $request->session()->put('auth_last_activity_at', now()->timestamp);
        } else {
            // Compatibility for existing non-browser /api clients. The SPA never receives tokens.
            $token = $user->createToken($remember ? 'bookshop-web-remembered' : 'bookshop-web', ['*'], $this->tokenExpiry($remember))->plainTextToken;
        }
        $user->forceFill(['last_login_at' => now()])->save();
        AuditLog::record('auth.login', "{$user->name} signed in", $user, ['remember' => $remember], $user);

        return response()->json([
            'message' => 'Signed in successfully.',
            'data' => [...($token ? ['token' => $token] : []), 'user' => $user->authData()],
        ]);
    }

    public function me(Request $request): JsonResponse
    {
        return response()->json(['data' => $request->user()->authData()]);
    }

    public function logout(Request $request): JsonResponse
    {
        AuditLog::record('auth.logout', "{$request->user()->name} signed out", $request->user());
        $token = $request->user()->currentAccessToken();
        if ($token instanceof \Laravel\Sanctum\PersonalAccessToken) {
            $token->delete();
        }
        if ($request->hasSession()) {
            Auth::guard('web')->logout();
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        return response()->json(['message' => 'Signed out successfully.']);
    }

    public function updateProfile(Request $request): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'phone' => ['nullable', 'string', 'max:30', 'regex:/^[0-9+()\s-]{7,30}$/'],
        ], ['phone.regex' => 'Enter a valid phone number.']);

        $user->fill($data)->save();
        AuditLog::record('auth.profile_updated', "{$user->name} updated their profile", $user, ['fields' => array_keys($data)]);

        return response()->json(['message' => 'Profile updated.', 'data' => $user->authData()]);
    }

    public function changePassword(Request $request): JsonResponse
    {
        $user = $request->user();
        $request->validate([
            'current_password' => ['required', 'current_password:sanctum'],
            'password' => ['required', 'confirmed', 'different:current_password', PasswordRule::defaults()],
        ], ['current_password.current_password' => 'Your current password is incorrect.']);

        $user->password = $request->input('password');
        $user->save();
        // Keep this session; sign out every other device.
        $current = $user->currentAccessToken();
        $user->tokens()->when($current instanceof \Laravel\Sanctum\PersonalAccessToken,
            fn ($query) => $query->whereKeyNot($current->id))->delete();
        if ($request->hasSession()) {
            // Sanctum AuthenticateSession invalidates other cookie sessions on password mismatch.
            $request->session()->put('password_hash_web', $user->getAuthPassword());
            $request->session()->regenerate();
        }
        AuditLog::record('auth.password_changed', "{$user->name} changed their password", $user);

        return response()->json(['message' => 'Password changed. Other devices have been signed out.']);
    }

    public function forgotPassword(Request $request): JsonResponse
    {
        $request->validate(['email' => ['required', 'email']]);
        $user = User::where('email', $request->input('email'))->first();

        if ($user?->canSignIn()) {
            Password::sendResetLink(['email' => $user->email]);
            AuditLog::record('auth.password_reset_requested', "Password reset requested for {$user->email}", $user, actor: $user);
        }

        // Same response whether or not the account exists, so emails cannot be discovered.
        return response()->json(['message' => 'If that email belongs to an active account, a reset link has been sent.']);
    }

    public function resetPassword(Request $request): JsonResponse
    {
        $request->validate([
            'token' => ['required', 'string'],
            'email' => ['required', 'email'],
            'password' => ['required', 'confirmed', PasswordRule::defaults()],
        ]);

        $status = Password::reset(
            $request->only('email', 'password', 'password_confirmation', 'token'),
            function (User $user, string $password) {
                $user->password = $password;
                $user->setRememberToken(\Illuminate\Support\Str::random(60));
                $user->save();
                $user->tokens()->delete();
                event(new PasswordReset($user));
                AuditLog::record('auth.password_reset', "{$user->name} reset their password", $user, actor: $user);
            },
        );

        if ($status !== Password::PASSWORD_RESET) {
            // Never reveal whether the email exists; every broker failure means the link cannot be used.
            throw ValidationException::withMessages(['token' => ['This reset link is invalid or has expired. Request a new one.']]);
        }

        return response()->json(['message' => 'Your password has been reset. You can now sign in.']);
    }

    /** Per-token expiry, never later than Sanctum's hard ceiling. */
    private function tokenExpiry(bool $remember): ?\DateTimeInterface
    {
        $ceiling = (int) config('sanctum.expiration');
        $minutes = (int) config($remember ? 'sanctum.remember_lifetime' : 'sanctum.token_lifetime');
        if ($ceiling > 0) {
            $minutes = $minutes > 0 ? min($minutes, $ceiling) : $ceiling;
        }

        return $minutes > 0 ? now()->addMinutes($minutes) : null;
    }
}
