<?php

namespace App\Http\Controllers;

use App\Http\Requests\UserRequest;
use App\Http\Resources\UserResource;
use App\Models\AuditLog;
use App\Models\User;
use App\Notifications\AccountNotification;
use App\Services\EntitlementService;
use App\Support\Roles;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

class UserController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $filters = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'role' => ['nullable', Rule::in(Roles::all())],
            'status' => ['nullable', Rule::in(['active', 'inactive', 'pending', 'unverified'])],
            'branch_id' => ['nullable', 'integer'],
            'per_page' => ['nullable', 'integer', 'min:5', 'max:100'],
        ]);

        $visible = User::query()->visibleTo($request->user());
        $counts = [
            'active' => (clone $visible)->where('is_active', true)->count(),
            'inactive' => (clone $visible)->where('is_active', false)->count(),
            'pending' => (clone $visible)->where('staff_access_status', User::ACCESS_PENDING)->count(),
            'unverified' => (clone $visible)->whereNull('email_verified_at')->count(),
        ];

        $users = $visible->with('branches')
            ->when($filters['search'] ?? null, fn (Builder $query, string $search) => $query->where(
                fn (Builder $match) => $match->where('name', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%")->orWhere('phone', 'like', "%{$search}%"),
            ))
            ->when($filters['role'] ?? null, fn (Builder $query, string $role) => $query->where('role', $role))
            ->when($filters['status'] ?? null, fn (Builder $query, string $status) => match ($status) {
                'pending' => $query->where('staff_access_status', User::ACCESS_PENDING),
                'unverified' => $query->whereNull('email_verified_at'),
                default => $query->where('is_active', $status === 'active'),
            })
            ->when($filters['branch_id'] ?? null, fn (Builder $query, int $branchId) => $query->whereHas(
                'branches', fn (Builder $branch) => $branch->whereKey($branchId),
            ))
            ->latest()->paginate($filters['per_page'] ?? 25)->withQueryString();

        return UserResource::collection($users)->additional(['counts' => $counts]);
    }

    public function show(Request $request, User $user): UserResource
    {
        abort_unless(User::query()->visibleTo($request->user())->whereKey($user->id)->exists(), 404);

        return new UserResource($user->load('branches'));
    }

    public function store(UserRequest $request, EntitlementService $entitlements): JsonResponse
    {
        $caller = $request->user();
        if (in_array($request->input('role'), Roles::BRANCH_ROLES, true)) {
            $entitlements->ensureCanAddUser($caller->bookshop);
        }
        $user = DB::transaction(function () use ($request, $caller) {
            $user = new User($request->safe()->only(['name', 'email', 'phone', 'password', 'role']));
            $user->is_active = $request->boolean('is_active', true);
            // New accounts always join the creator's own bookshop.
            $user->bookshop_id = $caller->bookshop_id;
            $user->created_by = $caller->id;
            $user->email_verified_at = now();
            $user->save();
            $user->branches()->sync($request->branchIds() ?? []);

            return $user;
        });

        AuditLog::record('user.created', "Created {$user->name} as ".Roles::label($user->role), $user, [
            'role' => $user->role, 'branch_ids' => $user->branches()->pluck('branches.id')->all(),
        ]);
        if (! $caller->isOwner()) {
            $this->notifyOwners($caller, 'New team member', "{$caller->name} added {$user->name} as ".Roles::label($user->role).'.');
        }

        return (new UserResource($user->load('branches')))
            ->additional(['message' => "{$user->name} was created successfully."])
            ->response()->setStatusCode(201);
    }

    public function update(UserRequest $request, User $user): UserResource
    {
        $before = ['role' => $user->role, 'branch_ids' => $user->branches()->pluck('branches.id')->sort()->values()->all()];

        DB::transaction(function () use ($request, $user) {
            $user->fill($request->safe()->only(['name', 'email', 'phone', 'role']))->save();
            if (($branchIds = $request->branchIds()) !== null) {
                // Keep branches outside the caller's reach that the caller could not have submitted.
                $outside = array_diff($user->branches()->pluck('branches.id')->all(), $request->user()->branchIds());
                $user->branches()->sync($user->role === Roles::CUSTOMER ? [] : array_unique([...$outside, ...$branchIds]));
            }
        });

        $after = ['role' => $user->role, 'branch_ids' => $user->branches()->pluck('branches.id')->sort()->values()->all()];
        $changes = array_keys($user->getChanges());
        AuditLog::record('user.updated', "Updated {$user->name}'s account", $user, ['changed' => $changes, 'before' => $before, 'after' => $after]);

        if ($before['role'] !== $after['role']) {
            // New access rights take effect on the next sign-in.
            $user->tokens()->delete();
            AuditLog::record('user.role_changed', "Changed {$user->name}'s role to ".Roles::label($user->role), $user, ['from' => $before['role'], 'to' => $user->role]);
            $user->notify(new AccountNotification('Your role changed', 'You are now '.Roles::label($user->role).'. Sign in again to continue.', 'warning'));
        } elseif ($before['branch_ids'] !== $after['branch_ids']) {
            $user->notify(new AccountNotification('Branch access updated', 'The branches you can work in have changed.', 'info'));
        }

        return (new UserResource($user->load('branches')))->additional(['message' => "{$user->name}'s account was updated."]);
    }

    public function updateStatus(Request $request, User $user): UserResource
    {
        $this->authorizeManagement($request, $user);
        $data = $request->validate(['is_active' => ['required', 'boolean']]);

        $user->is_active = $data['is_active'];
        $user->save();
        if (! $user->is_active) {
            $user->tokens()->delete();
        }
        AuditLog::record($user->is_active ? 'user.activated' : 'user.deactivated', ($user->is_active ? 'Activated ' : 'Deactivated ')."{$user->name}'s account", $user);

        return (new UserResource($user->load('branches')))->additional([
            'message' => $user->is_active ? "{$user->name} can sign in again." : "{$user->name} has been deactivated and signed out.",
        ]);
    }

    public function resetPassword(Request $request, User $user): JsonResponse
    {
        $this->authorizeManagement($request, $user);
        $data = $request->validate(['password' => ['required', 'confirmed', Password::defaults()]]);

        $user->password = $data['password'];
        $user->save();
        $user->tokens()->delete();
        AuditLog::record('user.password_reset', "Reset {$user->name}'s password", $user);
        $user->notify(new AccountNotification('Password reset', "{$request->user()->name} reset your password. Change it after you sign in.", 'warning'));

        return response()->json(['message' => "{$user->name}'s password was reset and their sessions were signed out."]);
    }

    public function destroy(Request $request, User $user): JsonResponse
    {
        if ($user->id === $request->user()->id) {
            return response()->json(['message' => 'You cannot delete your own account.'], 422);
        }
        if ($user->isOwner() || $user->isPlatformUser()) {
            return response()->json(['message' => 'Owner accounts cannot be deleted.'], 422);
        }
        $this->authorizeManagement($request, $user);

        AuditLog::record('user.deleted', "Deleted {$user->name}'s account", $user, ['email' => $user->email, 'role' => $user->role]);
        $user->tokens()->delete();
        $user->delete();

        return response()->json(['message' => "{$user->name} was deleted."]);
    }

    private function authorizeManagement(Request $request, User $user): void
    {
        $caller = $request->user();
        if ($caller->id === $user->id || $user->isOwner()) {
            abort(422, 'Your own account and system owner accounts are protected.');
        }
        abort_unless($caller->canManageUser($user), 403, 'You cannot manage this account.');
    }

    private function notifyOwners(User $caller, string $title, string $body): void
    {
        User::where('bookshop_id', $caller->bookshop_id)->whereIn('role', Roles::TENANT_OWNER_ROLES)->where('is_active', true)->get()
            ->each(fn (User $owner) => $owner->notify(new AccountNotification($title, $body, 'info', 'Users')));
    }
}
