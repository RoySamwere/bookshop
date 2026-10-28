<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin \App\Models\AuditLog */
class AuditLogResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'action' => $this->action,
            'description' => $this->description,
            'metadata' => $this->metadata,
            'ip_address' => $this->ip_address,
            'subject_type' => $this->subject_type ? class_basename($this->subject_type) : null,
            'subject_id' => $this->subject_id,
            'user' => $this->user?->only(['id', 'name', 'email', 'role']),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
