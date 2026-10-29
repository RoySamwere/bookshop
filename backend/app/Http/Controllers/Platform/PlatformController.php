<?php

namespace App\Http\Controllers\Platform;

use App\Http\Controllers\Controller;
use App\Http\Resources\AuditLogResource;
use App\Models\AuditLog;
use App\Models\Bookshop;
use App\Models\BookshopSubscription;
use App\Models\PlatformSetting;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Support\Roles;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * Platform-wide aggregates and settings. Nothing here reads a bookshop's business records
 * (products, stock, sales, customers); platform staff only see tenant-level metadata.
 */
class PlatformController extends Controller
{
    public function overview(): JsonResponse
    {
        $byStatus = Bookshop::query()->selectRaw('status, COUNT(*) as total')->groupBy('status')->pluck('total', 'status');
        $subscriptions = BookshopSubscription::query()->selectRaw('status, COUNT(*) as total')->groupBy('status')->pluck('total', 'status');

        return response()->json(['data' => [
            'bookshops' => [
                'total' => (int) $byStatus->sum(),
                'active' => (int) ($byStatus[Bookshop::STATUS_ACTIVE] ?? 0),
                'pending_verification' => (int) ($byStatus[Bookshop::STATUS_PENDING] ?? 0),
                'suspended' => (int) ($byStatus[Bookshop::STATUS_SUSPENDED] ?? 0),
                'registered_last_30_days' => Bookshop::where('created_at', '>=', now()->subDays(30))->count(),
            ],
            'subscriptions' => collect(BookshopSubscription::STATUSES)->mapWithKeys(fn ($status) => [$status => (int) ($subscriptions[$status] ?? 0)]),
            'users' => [
                'bookshop_staff' => User::whereNotNull('bookshop_id')->whereNotIn('role', [Roles::CUSTOMER, ...Roles::PLATFORM_ROLES])->count(),
                'platform_staff' => User::whereIn('role', Roles::PLATFORM_ROLES)->count(),
                'unassigned_legacy_staff' => User::whereNull('bookshop_id')->whereNotIn('role', [Roles::CUSTOMER, ...Roles::PLATFORM_ROLES])->count(),
            ],
            'recent_bookshops' => Bookshop::query()->latest('id')->limit(5)->get(['id', 'name', 'slug', 'status', 'country', 'created_at']),
        ]]);
    }

    /** Platform-level events only: registrations, activations, suspensions and platform administration. */
    public function audit(Request $request): AnonymousResourceCollection
    {
        $filters = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'bookshop_id' => ['nullable', 'integer'],
            'per_page' => ['nullable', 'integer', 'min:10', 'max:100'],
        ]);

        return AuditLogResource::collection(AuditLog::query()->with('user:id,name,email,role')
            ->where(fn (Builder $query) => $query->where('action', 'like', 'platform.%')->orWhere('action', 'like', 'bookshop.%'))
            ->when($filters['bookshop_id'] ?? null, fn ($query, $id) => $query->where('bookshop_id', $id))
            ->when($filters['search'] ?? null, fn ($query, $search) => $query->where('description', 'like', "%{$search}%"))
            ->latest('id')->paginate($filters['per_page'] ?? 25)->withQueryString());
    }

    public function plans(): JsonResponse
    {
        return response()->json(['data' => SubscriptionPlan::with('features:id,subscription_plan_id,feature,is_enabled,limit')->orderBy('sort_order')->get()]);
    }

    public function settings(): JsonResponse
    {
        return response()->json(['data' => [
            ...PlatformSetting::values(),
            'default_trial_days' => (int) config('subscriptions.trial_days'),
        ]]);
    }

    public function updateSettings(Request $request): JsonResponse
    {
        $data = $request->validate([
            'bookshop_registration_open' => ['sometimes', 'boolean'],
            'support_email' => ['sometimes', 'nullable', 'email', 'max:255'],
            'trial_days' => ['sometimes', 'nullable', 'integer', 'min:0', 'max:365'],
        ]);
        foreach ($data as $key => $value) {
            PlatformSetting::updateOrCreate(['key' => $key], ['value' => $value, 'updated_by' => $request->user()->id]);
        }
        AuditLog::record('platform.settings_updated', 'Updated platform settings', metadata: ['changed' => array_keys($data)], bookshopId: null);

        return response()->json(['message' => 'Platform settings saved.', 'data' => PlatformSetting::values()]);
    }
}
