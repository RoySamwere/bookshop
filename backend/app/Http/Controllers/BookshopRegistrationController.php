<?php

namespace App\Http\Controllers;

use App\Http\Requests\BookshopRegistrationRequest;
use App\Models\PlatformSetting;
use App\Services\BookshopRegistrationService;
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

        // Browser sign-ups continue straight into onboarding; unverified owners only reach onboarding routes.
        if ($request->hasSession()) {
            Auth::guard('web')->login($owner);
            $request->session()->regenerate();
            $request->session()->put('auth_last_activity_at', now()->timestamp);
        }

        return response()->json([
            'message' => 'Your bookshop has been registered and is awaiting Platform Owner approval.',
            'data' => [
                'email' => $owner->email,
                'verification_email_sent' => false,
                'signed_in' => $request->hasSession(),
                'next' => '/onboarding/verify-email',
                'bookshop' => $owner->bookshop->only(['id', 'name', 'slug', 'status']),
            ],
        ], 201);
    }
}
