<?php

namespace App\Http\Controllers;

use App\Http\Requests\BookshopRegistrationRequest;
use App\Models\PlatformSetting;
use App\Services\BookshopRegistrationService;
use App\Support\SafeMail;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Auth;

/** Self-service registration of a new bookshop and its owner account. */
class BookshopRegistrationController extends Controller
{
    public function register(BookshopRegistrationRequest $request, BookshopRegistrationService $registration): JsonResponse
    {
        if (! PlatformSetting::get('bookshop_registration_open')) {
            return response()->json(['message' => 'New bookshop registrations are paused. Please try again later.'], 403);
        }

        $owner = $registration->register($request->validated());
        $sent = SafeMail::send(fn () => $owner->sendEmailVerificationNotification());

        // Browser sign-ups continue straight into onboarding; unverified owners only reach onboarding routes.
        if ($request->hasSession()) {
            Auth::guard('web')->login($owner);
            $request->session()->regenerate();
            $request->session()->put('auth_last_activity_at', now()->timestamp);
        }

        return response()->json([
            'message' => $sent
                ? 'Your bookshop has been created. Check your email for a link to verify your address.'
                : 'Your bookshop has been created, but we could not send the verification email right now. You can request a new link shortly.',
            'data' => [
                'email' => $owner->email,
                'verification_email_sent' => $sent,
                'signed_in' => $request->hasSession(),
                'next' => '/onboarding/verify-email',
                'bookshop' => $owner->bookshop->only(['id', 'name', 'slug', 'status']),
            ],
        ], 201);
    }
}
