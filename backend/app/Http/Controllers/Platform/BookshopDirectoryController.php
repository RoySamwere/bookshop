<?php

namespace App\Http\Controllers\Platform;

use App\Http\Controllers\Controller;
use App\Http\Resources\AuditLogResource;
use App\Models\AuditLog;
use App\Models\Bookshop;
use App\Models\User;
use App\Services\SubscriptionService;
use App\Support\Roles;
use App\Support\SafeMail;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Bookshop directory for platform staff: tenant metadata, owner contact, subscription and lifecycle.
 * Business data (products, stock, sales, customers) is deliberately not exposed here.
 */
class BookshopDirectoryController extends Controller
{
    public function store(\App\Http\Requests\BookshopRegistrationRequest $request, \App\Services\BookshopRegistrationService $registration): JsonResponse
    {
        // Reuse registration without replacing the platform operator's authenticated session.
        $owner = $registration->register($request->validated());
        $owner->forceFill(['created_by' => $request->user()->id])->save();
        AuditLog::record('platform.bookshop_created', 'Created a bookshop and its separate owner account', $owner->bookshop, actor: $request->user(), bookshopId: $owner->bookshop_id);

        return response()->json(['message' => 'Bookshop created. Awaiting Platform Owner approval.', 'data' => $owner->bookshop->summary()], 201);
    }

    public function approve(Request $request, Bookshop $bookshop): JsonResponse
    {
        abort_unless($request->user()->role === Roles::PLATFORM_OWNER, 403);
        abort_unless($bookshop->status === Bookshop::STATUS_PENDING, 422, 'Only pending bookshops can be approved.');
        abort_unless($bookshop->owner, 422, 'This bookshop has no owner account.');

        \Illuminate\Support\Facades\DB::transaction(function () use ($request, $bookshop) {
            $bookshop->forceFill(['status' => Bookshop::STATUS_ACTIVE, 'verified_at' => now()])->save();
            AuditLog::record('platform.bookshop_approved', "Approved {$bookshop->name}", $bookshop, actor: $request->user(), bookshopId: $bookshop->id);
        });

        return response()->json(['message' => 'Bookshop approved and activated.', 'data' => $this->row($bookshop->fresh())]);
    }

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', 'in:pending_verification,active,suspended'],
            'per_page' => ['nullable', 'integer', 'min:5', 'max:100'],
        ]);

        $bookshops = Bookshop::query()->with(['owner:id,name,email,email_verified_at', 'subscription.plan:id,code,name'])
            ->withCount(['branches', 'users as staff_count' => fn (Builder $query) => $query->whereNotIn('role', [Roles::CUSTOMER, ...Roles::PLATFORM_ROLES])])
            ->when($filters['search'] ?? null, fn (Builder $query, string $search) => $query->where(fn (Builder $match) => $match
                ->where('name', 'like', "%{$search}%")->orWhere('slug', 'like', "%{$search}%")->orWhere('business_email', 'like', "%{$search}%")))
            ->when($filters['status'] ?? null, fn (Builder $query, string $status) => $query->where('status', $status))
            ->latest('id')->paginate($filters['per_page'] ?? 25)->withQueryString();

        return response()->json([
            'data' => $bookshops->getCollection()->map(fn (Bookshop $bookshop) => $this->row($bookshop))->values(),
            'meta' => ['current_page' => $bookshops->currentPage(), 'last_page' => $bookshops->lastPage(), 'per_page' => $bookshops->perPage(), 'total' => $bookshops->total(), 'from' => $bookshops->firstItem(), 'to' => $bookshops->lastItem()],
        ]);
    }

    public function show(Bookshop $bookshop): JsonResponse
    {
        $bookshop->load(['owner:id,name,email,phone,email_verified_at,last_login_at', 'subscription.plan:id,code,name'])
            ->loadCount(['branches', 'users as staff_count' => fn (Builder $query) => $query->whereNotIn('role', [Roles::CUSTOMER, ...Roles::PLATFORM_ROLES])]);

        return response()->json(['data' => [
            ...$this->row($bookshop),
            'owner' => $bookshop->owner ? [
                ...$bookshop->owner->only(['id', 'name', 'email', 'phone']),
                'email_verified' => $bookshop->owner->hasVerifiedEmail(),
                'last_login_at' => $bookshop->owner->last_login_at?->toIso8601String(),
            ] : null,
            'subscription_history' => $bookshop->subscription?->events()->latest('id')->limit(20)->get(['event', 'from_status', 'to_status', 'note', 'created_at']) ?? [],
            'history' => AuditLogResource::collection(AuditLog::query()->with('user:id,name,email,role')->where('bookshop_id', $bookshop->id)
                ->where(fn (Builder $query) => $query->where('action', 'like', 'bookshop.%')->orWhere('action', 'like', 'platform.%'))
                ->latest('id')->limit(30)->get()),
        ]]);
    }

    /** Platform Owner edits tenant contact details without touching business records. */
    public function update(Request $request, Bookshop $bookshop): JsonResponse
    {
        abort_unless($request->user()->role === Roles::PLATFORM_OWNER, 403);
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'business_email' => ['nullable', 'email', 'max:255'],
            'phone' => ['nullable', 'string', 'max:30'],
            'location' => ['nullable', 'string', 'max:255'],
        ]);
        $bookshop->fill($data)->save();
        AuditLog::record('platform.bookshop_updated', "Updated {$bookshop->name} business details", $bookshop, ['fields' => array_keys($data)], actor: $request->user(), bookshopId: $bookshop->id);
        return response()->json(['message' => 'Bookshop details updated.', 'data' => $this->row($bookshop->fresh())]);
    }

    public function suspend(Request $request, Bookshop $bookshop, SubscriptionService $subscriptions): JsonResponse
    {
        $data = $request->validate(['reason' => ['required', 'string', 'min:3', 'max:500']]);
        abort_if($bookshop->isSuspended(), 422, 'This bookshop is already suspended.');

        $previous = $bookshop->status;
        $bookshop->forceFill(['status' => Bookshop::STATUS_SUSPENDED, 'suspended_at' => now(), 'suspension_reason' => trim($data['reason'])])->save();
        if ($bookshop->subscription) {
            $subscriptions->transition($bookshop->subscription, \App\Models\BookshopSubscription::SUSPENDED, $request->user(), 'Bookshop suspended by platform');
        }
        AuditLog::record('platform.bookshop_suspended', "Suspended {$bookshop->name}", $bookshop, ['reason' => $bookshop->suspension_reason, 'previous_status' => $previous], bookshopId: $bookshop->id);

        return response()->json(['message' => "{$bookshop->name} has been suspended. Its staff can no longer use the workspace; no records were changed.", 'data' => $this->row($bookshop->fresh())]);
    }

    public function reactivate(Request $request, Bookshop $bookshop, SubscriptionService $subscriptions): JsonResponse
    {
        $data = $request->validate(['note' => ['nullable', 'string', 'max:500']]);
        abort_unless($bookshop->isSuspended(), 422, 'This bookshop is not suspended.');

        $bookshop->forceFill(['status' => $bookshop->verified_at ? Bookshop::STATUS_ACTIVE : Bookshop::STATUS_PENDING, 'suspended_at' => null, 'suspension_reason' => null])->save();
        $last = $bookshop->subscription?->events()->where('to_status', \App\Models\BookshopSubscription::SUSPENDED)->latest('id')->value('from_status');
        if ($bookshop->subscription && $last) {
            $subscriptions->transition($bookshop->subscription, $last, $request->user(), 'Bookshop reactivated by platform');
        }
        AuditLog::record('platform.bookshop_reactivated', "Reactivated {$bookshop->name}", $bookshop, ['note' => $data['note'] ?? null], bookshopId: $bookshop->id);

        return response()->json(['message' => "{$bookshop->name} has been reactivated.", 'data' => $this->row($bookshop->fresh())]);
    }

    public function resendOwnerVerification(Bookshop $bookshop): JsonResponse
    {
        $owner = $bookshop->owner;
        abort_unless($owner, 422, 'This bookshop has no owner account.');
        if ($owner->hasVerifiedEmail()) {
            return response()->json(['message' => 'The owner has already verified their email address.'], 422);
        }
        $sent = SafeMail::send(fn () => $owner->sendEmailVerificationNotification());
        AuditLog::record('platform.owner_verification_resent', "Resent the owner verification email for {$bookshop->name}", $bookshop, ['sent' => $sent], bookshopId: $bookshop->id);

        return response()->json(['message' => $sent ? "A new verification link was sent to {$owner->email}." : 'The email could not be sent.'], $sent ? 200 : 503);
    }

    private function row(Bookshop $bookshop): array
    {
        return [
            ...$bookshop->summary(),
            'registered_at' => ($bookshop->registered_at ?? $bookshop->created_at)?->toIso8601String(),
            'owner' => $bookshop->owner ? ['id' => $bookshop->owner->id, 'name' => $bookshop->owner->name, 'email' => $bookshop->owner->email, 'email_verified' => $bookshop->owner->hasVerifiedEmail()] : null,
            'branches_count' => $bookshop->branches_count ?? null,
            'staff_count' => $bookshop->staff_count ?? null,
            'subscription' => $bookshop->subscription?->summary(),
        ];
    }
}
