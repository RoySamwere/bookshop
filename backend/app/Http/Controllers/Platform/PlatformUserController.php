<?php

namespace App\Http\Controllers\Platform;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\User;
use App\Support\Roles;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

/**
 * Platform staff accounts. Only Platform Administrators can be created here; a Platform Owner can only
 * be provisioned from the server console (php artisan platform:owner), never through the API.
 */
class PlatformUserController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(['data' => User::whereIn('role', Roles::PLATFORM_ROLES)->orderBy('name')->get()
            ->map(fn (User $user) => $this->row($user))]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'password' => ['required', 'confirmed', Password::defaults()],
            'role' => ['required', Rule::in($request->user()->assignableRoles())],
            'bookshop_id' => ['prohibited'],
        ], ['role.in' => 'You cannot assign this role.']);

        $user = new User(['name' => $data['name'], 'email' => strtolower(trim($data['email'])), 'password' => $data['password']]);
        $user->forceFill(['role' => $data['role'], 'bookshop_id' => null, 'is_active' => true, 'email_verified_at' => now(), 'created_by' => $request->user()->id])->save();
        AuditLog::record('platform.user_created', "Created platform account {$user->name} as ".Roles::label($user->role), $user, ['role' => $user->role], bookshopId: null);

        return response()->json(['message' => "{$user->name} was created.", 'data' => $this->row($user)], 201);
    }

    public function updateStatus(Request $request, User $user): JsonResponse
    {
        abort_unless($user->isPlatformUser(), 404);
        abort_if($user->id === $request->user()->id || $user->role === Roles::PLATFORM_OWNER, 422, 'Your own account and Platform Owner accounts are protected.');
        $data = $request->validate(['is_active' => ['required', 'boolean']]);

        $user->forceFill(['is_active' => $data['is_active']])->save();
        if (! $user->is_active) {
            $user->tokens()->delete();
        }
        AuditLog::record($user->is_active ? 'platform.user_activated' : 'platform.user_deactivated', ($user->is_active ? 'Activated ' : 'Deactivated ')."platform account {$user->name}", $user, bookshopId: null);

        return response()->json(['message' => $user->is_active ? "{$user->name} can sign in again." : "{$user->name} has been deactivated.", 'data' => $this->row($user)]);
    }

    private function row(User $user): array
    {
        return [
            ...$user->only(['id', 'name', 'email', 'role', 'is_active']),
            'role_label' => Roles::label($user->role),
            'last_login_at' => $user->last_login_at?->toIso8601String(),
            'created_at' => $user->created_at?->toIso8601String(),
        ];
    }
}
