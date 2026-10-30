<?php

namespace App\Http\Middleware;

use App\Models\Bookshop;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Bookshop workspace gate. The tenant is the signed-in user's own bookshop; it must exist and not be
 * suspended. Business operations require platform approval and an activated bookshop, while
 * 'tenant:onboarding' routes stay open to owners who are still finishing registration.
 */
class EnsureTenantContext
{
    public function handle(Request $request, Closure $next, string $mode = 'operational'): Response
    {
        $user = $request->user();

        if ($user->isPlatformUser() && $user->workspaceBookshopId() === null) {
            return $this->deny('Platform accounts cannot open bookshop workspaces.', 'platform_account');
        }

        $bookshop = $user->workspaceBookshopId() ? Bookshop::find($user->workspaceBookshopId()) : null;
        if (! $bookshop) {
            return $this->deny('Your account is not linked to a bookshop yet. Ask your administrator to complete the bookshop setup.', 'no_bookshop');
        }
        if ($bookshop->isSuspended()) {
            return $this->deny('This bookshop has been suspended. Contact platform support to restore access.', 'bookshop_suspended');
        }

        if ($mode !== 'onboarding') {
            if (! $bookshop->isActive()) {
                return $this->deny('This bookshop is awaiting Platform Owner approval.', 'bookshop_pending');
            }
        }

        return $next($request);
    }

    private function deny(string $message, string $code): Response
    {
        return response()->json(['message' => $message, 'code' => $code], 403);
    }
}
