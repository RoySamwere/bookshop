<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class EnsureWorkspaceAccess
{
    public function handle(Request $request, Closure $next): Response
    {
        if (! $request->user()?->canAccessWorkspace()) {
            return response()->json(['message' => 'Your account is not authorised to access the system.'], 403);
        }

        return $next($request);
    }
}
