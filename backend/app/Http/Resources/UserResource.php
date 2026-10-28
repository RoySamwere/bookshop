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
            'email_verified' => $this->hasVerifiedEmail(),
            'email_verified_at' => $this->email_verified_at?->toIso8601String(),
            'registration_source' => $this->registration_source,
            'staff_access_status' => $this->staff_access_status,
            'staff_access_requested_at' => $this->staff_access_requested_at?->toIso8601String(),
            'staff_access_reviewed_at' => $this->staff_access_reviewed_at?->toIso8601String(),
            'staff_access_note' => $this->staff_access_note,
            'created_at' => $this->created_at?->toIso8601String(),
            'branches' => $this->whenLoaded('branches', fn () => $this->branches
                ->map(fn ($branch) => $branch->only(['id', 'name', 'code']))->values()),
            'can_manage' => $request->user()?->canManageUser($this->resource) ?? false,
            'can_review' => $request->user()?->can('reviewStaffAccess', $this->resource) ?? false,
        ];
    }
}
