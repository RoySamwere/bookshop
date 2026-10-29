<?php

namespace App\Http\Middleware;

use App\Models\Bookshop;
use App\Support\Roles;
use App\Support\Tenancy\ManagementContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class ResolveBookshopManagement
{
    public function handle(Request $request, Closure $next): Response
    {
        $request->attributes->remove(ManagementContext::SESSION_KEY);
        $user = $request->user();
        // Platform endpoints always operate as the SaaS actor, never as a tenant owner.
        if ($user?->role === Roles::PLATFORM_OWNER && $request->hasSession()
            && ! $request->is('api/platform/*', 'api/v1/platform/*')) {
            $id = $request->session()->get(ManagementContext::SESSION_KEY);
            if ($id && DB::table('platform_bookshop_management')->where('user_id', $user->id)
                ->where('bookshop_id', $id)->whereNull('revoked_at')->exists()
                && Bookshop::whereKey($id)->where('status', Bookshop::STATUS_ACTIVE)->exists()) {
                $request->attributes->set(ManagementContext::SESSION_KEY, ['user_id' => $user->id, 'bookshop_id' => (int) $id]);
            } elseif ($id) {
                $request->session()->forget(ManagementContext::SESSION_KEY);
            }
        }
        try {
            return $next($request);
        } finally {
            $request->attributes->remove(ManagementContext::SESSION_KEY);
        }
    }
}
