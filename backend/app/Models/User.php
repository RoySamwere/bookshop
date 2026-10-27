<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    public const WORKSPACE_ROLES = ['system_owner', 'admin', 'user', 'staff'];

    public function canAccessWorkspace(): bool
    {
        return in_array($this->role, self::WORKSPACE_ROLES, true);
    }

    public function assignableRoles(): array
    {
        return match ($this->role) {
            'system_owner' => ['admin', 'user'],
            'admin' => ['user'],
            default => [],
        };
    }

    public function permissions(): array
    {
        if (! $this->canAccessWorkspace()) {
            return [];
        }

        return match ($this->role) {
            'system_owner' => ['workspace.access', 'users.manage', 'users.assign_roles', 'settings.manage'],
            'admin' => ['workspace.access', 'users.manage', 'settings.manage'],
            default => ['workspace.access'],
        };
    }

    public function canManageUser(self $user): bool
    {
        if ($this->id === $user->id || $user->role === 'system_owner') {
            return false;
        }

        return $this->role === 'system_owner'
            || ($this->role === 'admin' && $user->created_by === $this->id
                && in_array($user->role, ['user', 'staff'], true));
    }

    public function authData(): array
    {
        return [
            ...$this->only(['id', 'name', 'email', 'role']),
            'permissions' => $this->permissions(),
            'assignable_roles' => $this->assignableRoles(),
        ];
    }
    /**
     * The attributes that are mass assignable.
     *
     * @var list<string>
     */
    protected $fillable = [
        'name',
        'email',
        'password',
        'role',
    ];

    /**
     * The attributes that should be hidden for serialization.
     *
     * @var list<string>
     */
    protected $hidden = [
        'password',
        'remember_token',
    ];

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'created_by' => 'integer',
        ];
    }
}
