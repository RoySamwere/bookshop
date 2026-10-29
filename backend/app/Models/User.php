<?php

namespace App\Models;

use App\Support\Roles;
use Database\Factories\UserFactory;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable implements MustVerifyEmail
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    public const SOURCE_PUBLIC = 'public';

    public const SOURCE_BOOKSHOP_REGISTRATION = 'bookshop_registration';

    public const SOURCE_INVITATION = 'invitation';

    public const ACCESS_PENDING = 'pending';

    public const ACCESS_APPROVED = 'approved';

    public const ACCESS_REJECTED = 'rejected';

    protected $fillable = [
        'name',
        'email',
        'phone',
        'password',
        'role',
        'is_active',
    ];

    /** Mirror the column defaults so freshly created models behave like stored ones. */
    protected $attributes = [
        'role' => Roles::CASHIER,
        'is_active' => true,
    ];

    protected $hidden = [
        'password',
        'remember_token',
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'last_login_at' => 'datetime',
            'password' => 'hashed',
            'created_by' => 'integer',
            'bookshop_id' => 'integer',
            'is_active' => 'boolean',
            'terms_accepted_at' => 'datetime',
            'staff_access_requested_at' => 'datetime',
            'staff_access_reviewed_at' => 'datetime',
            'staff_access_reviewed_by' => 'integer',
        ];
    }

    /** The bookshop this account works in (its tenant membership); null for platform staff and public customers. */
    public function bookshop(): BelongsTo
    {
        return $this->belongsTo(Bookshop::class);
    }

    public function branches(): BelongsToMany
    {
        return $this->belongsToMany(Branch::class)->withTimestamps();
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(self::class, 'created_by');
    }

    public function staffAccessReviewer(): BelongsTo
    {
        return $this->belongsTo(self::class, 'staff_access_reviewed_by');
    }

    public function hasPendingStaffRequest(): bool
    {
        return $this->staff_access_status === self::ACCESS_PENDING;
    }

    public function hasKnownRole(): bool
    {
        return Roles::exists($this->role);
    }

    /** Owner of their bookshop (Bookshop Owner, or the legacy System Owner). */
    public function isOwner(): bool
    {
        return Roles::isTenantOwner($this->role);
    }

    public function isPlatformUser(): bool
    {
        return Roles::isPlatform($this->role);
    }

    /** Whether both accounts work in the same bookshop. */
    public function sharesBookshopWith(self $user): bool
    {
        return $this->bookshop_id !== null && $this->bookshop_id === $user->bookshop_id;
    }

    public function canSignIn(): bool
    {
        return $this->is_active && $this->hasKnownRole();
    }

    public function canAccessWorkspace(): bool
    {
        return $this->canSignIn() && $this->hasPermission('workspace.access');
    }

    public function permissions(): array
    {
        return $this->is_active ? Roles::permissionsFor($this->role) : [];
    }

    public function hasPermission(string $permission): bool
    {
        return in_array($permission, $this->permissions(), true);
    }

    public function assignableRoles(): array
    {
        return Roles::assignableBy($this->role);
    }

    /** Branch ids this user works in, always within their own bookshop; the owner works in every branch of it. */
    public function branchIds(): array
    {
        if ($this->isPlatformUser() || $this->bookshop_id === null) {
            return [];
        }

        $ids = $this->isOwner()
            ? Branch::withoutGlobalScope('bookshop')->where('bookshop_id', $this->bookshop_id)->pluck('id')
            : $this->branches()->withoutGlobalScope('bookshop')->where('branches.bookshop_id', $this->bookshop_id)->pluck('branches.id');

        return $ids->map(fn ($id) => (int) $id)->all();
    }

    public function sharesBranchWith(self $user): bool
    {
        return (bool) array_intersect($this->branchIds(), $user->branches()->pluck('branches.id')->all());
    }

    /** Whether this user may edit, deactivate, reset or delete the given account. */
    public function canManageUser(self $user): bool
    {
        if ($this->id === $user->id || $user->isOwner() || ! $this->hasPermission('users.manage') || ! $this->sharesBookshopWith($user)) {
            return false;
        }
        if ($this->isOwner()) {
            return true;
        }
        if (! in_array($user->role, $this->assignableRoles(), true)) {
            return false;
        }

        return $user->role === Roles::CUSTOMER || $user->created_by === $this->id || $this->sharesBranchWith($user);
    }

    /** Accounts the caller may see in the team directory. */
    public function scopeVisibleTo(Builder $query, self $caller): Builder
    {
        $query->whereKeyNot($caller->id)->whereNotIn('role', Roles::PLATFORM_ROLES);
        // Never outside the caller's own bookshop.
        if ($caller->bookshop_id === null) {
            return $query->whereRaw('1 = 0');
        }
        $query->where('bookshop_id', $caller->bookshop_id);
        if ($caller->isOwner()) {
            return $query;
        }

        $branchIds = $caller->branchIds();
        $staffRoles = $caller->hasPermission('users.manage')
            ? array_values(array_diff($caller->assignableRoles(), [Roles::CUSTOMER]))
            : [Roles::STORE_MANAGER, Roles::CASHIER, Roles::INVENTORY_OFFICER];

        return $query->where(function (Builder $visible) use ($caller, $branchIds, $staffRoles) {
            $visible->where(function (Builder $staff) use ($branchIds, $staffRoles) {
                $staff->whereIn('role', $staffRoles)
                    ->whereHas('branches', fn (Builder $branch) => $branch->whereIn('branches.id', $branchIds));
            })->orWhere(function (Builder $own) use ($caller) {
                $own->where('created_by', $caller->id)->whereIn('role', $caller->assignableRoles());
            });
            if ($caller->hasPermission('users.manage')) {
                $visible->orWhere('role', Roles::CUSTOMER);
            }
        });
    }

    /** platform | bookshop | customer: which area of the application the account belongs to. */
    public function accountType(): string
    {
        return match (true) {
            $this->isPlatformUser() => 'platform',
            $this->role !== Roles::CUSTOMER && $this->hasKnownRole() => 'bookshop',
            default => 'customer',
        };
    }

    public function authData(): array
    {
        $bookshopId = $this->isPlatformUser() ? null : $this->bookshop_id;
        $bookshop = $bookshopId ? $this->bookshop()->with('subscription.plan')->first() : null;

        return [
            ...$this->only(['id', 'name', 'email', 'phone', 'role']),
            'account_type' => $this->accountType(),
            'bookshop_id' => $bookshopId,
            'bookshop' => $bookshop ? [
                ...$bookshop->summary(),
                'is_owner' => $this->isOwner(),
                'subscription' => $bookshop->subscription?->summary(),
            ] : null,
            'role_label' => Roles::label($this->role),
            'is_active' => $this->is_active,
            'email_verified' => $this->hasVerifiedEmail(),
            'staff_access_status' => $this->staff_access_status,
            'staff_access_note' => $this->staff_access_status === self::ACCESS_REJECTED ? $this->staff_access_note : null,
            'permissions' => $this->permissions(),
            'assignable_roles' => $this->assignableRoles(),
            'branches' => $this->isPlatformUser() ? [] : $this->branches()->withoutGlobalScope('bookshop')->where('branches.bookshop_id', $bookshopId)
                ->get(['branches.id', 'name', 'code', 'is_main'])
                ->map(fn (Branch $branch) => $branch->only(['id', 'name', 'code', 'is_main']))->all(),
        ];
    }
}
