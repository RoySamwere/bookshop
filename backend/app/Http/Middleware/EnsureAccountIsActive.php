<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureAccountIsActive
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user?->canSignIn()) {
            // Tokens of deactivated or unknown-role accounts stop working immediately.
            $user?->currentAccessToken()?->delete();

            return response()->json(['message' => 'Your account is not authorised to access the system.'], 403);
        }

        return $next($request);
    }
}
