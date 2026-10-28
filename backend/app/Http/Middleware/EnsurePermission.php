<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/** Usage: ->middleware('permission:users.manage') or 'permission:users.view,users.manage' (any of). */
class EnsurePermission
{
    public function handle(Request $request, Closure $next, string ...$permissions): Response
    {
        $user = $request->user();

        foreach ($permissions as $permission) {
            if ($user?->hasPermission($permission)) {
                return $next($request);
            }
        }

        return response()->json(['message' => 'You do not have permission to perform this action.'], 403);
    }
}
