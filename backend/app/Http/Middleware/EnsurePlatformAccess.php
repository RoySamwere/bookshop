<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Platform administration is only for platform staff; bookshop accounts never reach it. */
class EnsurePlatformAccess
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if (! $user?->isPlatformUser() || ! $user->hasPermission('platform.access')) {
            return response()->json(['message' => 'You do not have access to platform administration.'], 403);
        }

        return $next($request);
    }
}
