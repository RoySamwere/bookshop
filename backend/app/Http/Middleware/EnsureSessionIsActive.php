<?php

namespace App\Http\Middleware;

use Carbon\Carbon;
use Closure;
use Illuminate\Http\Request;
use Laravel\Sanctum\PersonalAccessToken;
use Symfony\Component\HttpFoundation\Response;

class EnsureSessionIsActive
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->user()?->currentAccessToken();
        if ($token instanceof PersonalAccessToken) {
            // Sanctum updates last_used_at on every request. Background requests must
            // not extend the user's inactivity deadline.
            $lastActivity = Carbon::parse($token->last_activity_at ?? $token->created_at);
            if ($lastActivity->addMinutes(10)->lessThanOrEqualTo(now())) {
                $token->delete();
                return response()->json(['message' => 'Your session ended after 10 minutes of inactivity.', 'reason' => 'idle'], 401);
            }
            if ($request->is('api/auth/activity')) {
                $token->forceFill(['last_activity_at' => now()])->save();
            }
        }

        return $next($request);
    }
}
