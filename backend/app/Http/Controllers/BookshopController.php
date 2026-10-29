<?php

namespace App\Http\Controllers;

use App\Http\Resources\AuditLogResource;
use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\BusinessProfile;
use App\Models\User;
use App\Services\EntitlementService;
use App\Support\Roles;
use App\Support\Tenancy\Tenant;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/** The signed-in user's own bookshop: profile, status, subscription and onboarding progress. */
class BookshopController extends Controller
{
    public function show(Request $request, EntitlementService $entitlements): JsonResponse
    {
        $bookshop = Tenant::bookshop()->load('subscription.plan.features', 'owner:id,name,email');
        $user = $request->user();
        $branches = Branch::where('bookshop_id', $bookshop->id);
        $staff = User::where('bookshop_id', $bookshop->id)->whereNotIn('role', [Roles::CUSTOMER, ...Roles::PLATFORM_ROLES]);

        return response()->json(['data' => [
            ...$bookshop->summary(),
            'owner' => $bookshop->owner?->only(['id', 'name', 'email']),
            'registered_at' => $bookshop->registered_at?->toIso8601String(),
            'subscription' => $bookshop->subscription?->summary(),
            'entitlements' => [
                'branches_limit' => $entitlements->limit($bookshop, 'branches.max'),
                'users_limit' => $entitlements->limit($bookshop, 'users.max'),
                'can_add_branch' => $entitlements->canAddBranch($bookshop),
                'can_add_user' => $entitlements->canAddUser($bookshop),
            ],
            'counts' => [
                'branches' => (clone $branches)->count(),
                'active_branches' => (clone $branches)->where('is_active', true)->count(),
                'staff' => (clone $staff)->count(),
                'active_staff' => (clone $staff)->where('is_active', true)->count(),
                'pending_invitations' => (clone $staff)->whereNull('email_verified_at')->where('registration_source', User::SOURCE_INVITATION)->count(),
            ],
            'onboarding' => [
                'email_verified' => $user->hasVerifiedEmail(),
                'profile_completed' => (bool) ($bookshop->phone && $bookshop->location),
                'has_branch' => (clone $branches)->exists(),
                'has_staff' => (clone $staff)->whereKeyNot($bookshop->owner_user_id)->exists(),
            ],
        ]]);
    }

    public function update(Request $request): JsonResponse
    {
        $bookshop = Tenant::bookshop();
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'min:2', 'max:120'],
            'business_email' => ['nullable', 'email', 'max:255'],
            'phone' => ['sometimes', 'required', 'string', 'max:30', 'regex:/^[0-9+()\s-]{7,30}$/'],
            'location' => ['sometimes', 'required', 'string', 'max:255'],
            'country' => ['sometimes', 'required', 'string', 'max:100'],
            'currency' => ['sometimes', 'required', 'string', 'size:3', 'alpha'],
            'timezone' => ['sometimes', 'required', 'timezone:all'],
            'slug' => ['prohibited'], 'status' => ['prohibited'], 'owner_user_id' => ['prohibited'],
        ], ['phone.regex' => 'Enter a valid phone number.']);
        if (isset($data['currency'])) {
            $data['currency'] = strtoupper($data['currency']);
        }

        $bookshop->fill($data)->save();
        // Keep the receipt/business profile in step with the shared fields.
        $profile = BusinessProfile::current();
        $profile->fill(array_filter([
            'name' => $data['name'] ?? null, 'email' => $data['business_email'] ?? null, 'phone' => $data['phone'] ?? null,
            'city' => $data['location'] ?? null, 'country' => $data['country'] ?? null, 'currency' => $data['currency'] ?? null,
            'timezone' => $data['timezone'] ?? null,
        ], fn ($value) => $value !== null))->save();
        AuditLog::record('bookshop.updated', "Updated the bookshop profile of {$bookshop->name}", $bookshop, ['changed' => array_keys($bookshop->getChanges())]);

        return response()->json(['message' => 'Bookshop profile saved.', 'data' => $bookshop->summary()]);
    }

    /** Recent activity in this bookshop only. */
    public function activity(): AnonymousResourceCollection
    {
        return AuditLogResource::collection(
            AuditLog::query()->with('user:id,name,email,role')->where('bookshop_id', Tenant::requireId())->latest('id')->limit(20)->get()
        );
    }
}
