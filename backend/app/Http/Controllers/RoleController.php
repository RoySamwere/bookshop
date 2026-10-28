<?php

namespace App\Http\Controllers;

use App\Support\Roles;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class RoleController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $assignable = $request->user()->assignableRoles();

        return response()->json(['data' => array_map(
            fn (string $role) => [...Roles::describe($role), 'assignable' => in_array($role, $assignable, true)],
            Roles::all(),
        )]);
    }
}
