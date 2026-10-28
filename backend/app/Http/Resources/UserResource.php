<?php

namespace App\Http\Resources;

use App\Support\Roles;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\User */
class UserResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'phone' => $this->phone,
            'role' => $this->role,
            'role_label' => Roles::label($this->role),
            'is_active' => $this->is_active,
            'last_login_at' => $this->last_login_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
            'branches' => $this->whenLoaded('branches', fn () => $this->branches
                ->map(fn ($branch) => $branch->only(['id', 'name', 'code']))->values()),
            'can_manage' => $request->user()?->canManageUser($this->resource) ?? false,
        ];
    }
}
