<?php

namespace App\Http\Controllers;

use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

class UserController extends Controller
{
    /**
     * List users visible to the authenticated caller.
     *
     * system_owner → sees every user except themselves
     * admin        → sees only users they created
     */
    public function index(Request $request): JsonResponse
    {
        $caller = $request->user();

        if ($caller->role === 'system_owner') {
            $users = User::where('id', '!=', $caller->id)
                ->orderBy('created_at', 'desc')
                ->get(['id', 'name', 'email', 'role', 'created_at']);
        } elseif ($caller->role === 'admin') {
            $users = User::where('created_by', $caller->id)
                ->whereIn('role', ['user', 'staff'])
                ->orderBy('created_at', 'desc')
                ->get(['id', 'name', 'email', 'role', 'created_at']);
        } else {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        return response()->json(['users' => $users]);
    }

    /**
     * Create a new user.
     */
    public function store(Request $request): JsonResponse
    {
        $caller = $request->user();
        $allowed = $caller->assignableRoles();

        if (empty($allowed)) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $data = $request->validate([
            'name'     => ['required', 'string', 'max:255'],
            'email'    => ['required', 'email', 'max:255', Rule::unique('users', 'email')],
            'password' => ['required', 'string', 'min:8', 'confirmed'],
            'role'     => ['required', Rule::in($allowed)],
        ]);

        $user = new User([
            'name'       => $data['name'],
            'email'      => $data['email'],
            'password'   => $data['password'],   // cast auto-hashes
            'role'       => $data['role'],
        ]);
        $user->created_by = $caller->id;
        $user->save();

        return response()->json([
            'message' => 'User created successfully.',
            'user'    => $user->only(['id', 'name', 'email', 'role', 'created_at']),
        ], 201);
    }

    public function updateRole(Request $request, User $user): JsonResponse
    {
        $caller = $request->user();

        if ($caller->role !== 'system_owner') {
            return response()->json(['message' => 'Only the system owner can change roles.'], 403);
        }

        if (! $caller->canManageUser($user)) {
            return response()->json(['message' => 'Your own account and system owner roles are protected.'], 422);
        }

        $data = $request->validate(['role' => ['required', Rule::in($caller->assignableRoles())]]);
        $user->role = $data['role'];
        $user->save();
        // Force a fresh sign-in after access rights change.
        $user->tokens()->delete();

        return response()->json(['user' => $user->only(['id', 'name', 'email', 'role', 'created_at'])]);
    }

    /**
     * Delete a user.
     *
     * system_owner → can delete any non-system_owner
     * admin        → can delete only users they created
     */
    public function destroy(Request $request, User $user): JsonResponse
    {
        $caller = $request->user();

        if ($user->id === $caller->id) {
            return response()->json(['message' => 'You cannot delete your own account.'], 422);
        }

        if ($user->role === 'system_owner') {
            return response()->json(['message' => 'System owner accounts cannot be deleted.'], 422);
        }

        if (! $caller->canManageUser($user)) {
            return response()->json(['message' => 'Forbidden.'], 403);
        }

        $user->tokens()->delete();
        $user->delete();

        return response()->json(['message' => 'User deleted.']);
    }
}
