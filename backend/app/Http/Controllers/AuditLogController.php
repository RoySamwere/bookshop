<?php

namespace App\Http\Controllers;

use App\Http\Resources\AuditLogResource;
use App\Models\AuditLog;
use App\Models\User;
use App\Support\Tenancy\Tenant;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class AuditLogController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $filters = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'action' => ['nullable', 'string', 'max:60'],
            'user_id' => ['nullable', 'integer'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'per_page' => ['nullable', 'integer', 'min:10', 'max:100'],
        ]);
        $caller = $request->user();

        $logs = AuditLog::query()->with('user:id,name,email,role')
            ->where('bookshop_id', Tenant::requireId())
            // Administrators see activity by themselves and the accounts they can see.
            ->when(! $caller->isOwner(), fn ($query) => $query->whereIn(
                'user_id', User::query()->visibleTo($caller)->pluck('id')->push($caller->id),
            ))
            ->when($filters['search'] ?? null, fn ($query, $search) => $query->where('description', 'like', "%{$search}%"))
            ->when($filters['action'] ?? null, fn ($query, $action) => $query->where('action', 'like', "{$action}%"))
            ->when($filters['user_id'] ?? null, fn ($query, $userId) => $query->where('user_id', $userId))
            ->when($filters['from'] ?? null, fn ($query, $from) => $query->whereDate('created_at', '>=', $from))
            ->when($filters['to'] ?? null, fn ($query, $to) => $query->whereDate('created_at', '<=', $to))
            ->latest('created_at')->latest('id')
            ->paginate($filters['per_page'] ?? 25)->withQueryString();

        return AuditLogResource::collection($logs);
    }
}
