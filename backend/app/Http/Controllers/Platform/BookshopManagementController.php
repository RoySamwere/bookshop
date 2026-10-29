<?php

namespace App\Http\Controllers\Platform;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Bookshop;
use App\Support\Roles;
use App\Support\Tenancy\ManagementContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class BookshopManagementController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        abort_unless($request->user()->role === Roles::PLATFORM_OWNER, 403);
        $ids = DB::table('platform_bookshop_management')->where('user_id', $request->user()->id)->whereNull('revoked_at')->pluck('bookshop_id');

        return response()->json(['data' => Bookshop::whereIn('id', $ids)->get()->map(fn ($shop) => $shop->summary())]);
    }

    public function enter(Request $request, Bookshop $bookshop): JsonResponse
    {
        $user = $request->user();
        abort_unless($user->role === Roles::PLATFORM_OWNER && $user->hasVerifiedEmail() && $request->hasSession(), 403);
        abort_unless(DB::table('platform_bookshop_management')->where('user_id', $user->id)
            ->where('bookshop_id', $bookshop->id)->whereNull('revoked_at')->exists(), 403, 'This bookshop is not authorized for management.');
        abort_unless($bookshop->isActive(), 403, 'Only active bookshops can be managed.');
        $request->session()->regenerate();
        $request->session()->put(ManagementContext::SESSION_KEY, $bookshop->id);
        AuditLog::record('platform.management_entered', 'Entered authorized bookshop management', $bookshop, actor: $user, bookshopId: $bookshop->id);

        return response()->json(['message' => 'Bookshop management opened.', 'data' => ['next' => '/dashboard']]);
    }

    public function leave(Request $request): JsonResponse
    {
        abort_unless($request->user()->role === Roles::PLATFORM_OWNER && $request->hasSession(), 403);
        $id = $request->session()->pull(ManagementContext::SESSION_KEY);
        $request->session()->regenerate();
        if ($id) {
            AuditLog::record('platform.management_left', 'Returned to platform administration', actor: $request->user(), bookshopId: (int) $id);
        }

        return response()->json(['message' => 'Returned to platform.', 'data' => ['next' => '/platform']]);
    }
}
