<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Support\Str;

/** A tenant: one independent bookshop business with its own staff, branches and records. */
class Bookshop extends Model
{
    use HasFactory;

    public const STATUS_PENDING = 'pending_verification';
    public const STATUS_ACTIVE = 'active';
    public const STATUS_SUSPENDED = 'suspended';

    /** Status, ownership and lifecycle timestamps are never mass assigned. */
    protected $fillable = ['name', 'business_email', 'phone', 'location', 'country', 'currency', 'timezone'];

    protected $attributes = [
        'status' => self::STATUS_ACTIVE,
        'is_active' => true,
        'country' => 'Kenya',
        'currency' => 'KES',
        'timezone' => 'Africa/Nairobi',
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'owner_user_id' => 'integer',
            'registered_at' => 'datetime',
            'verified_at' => 'datetime',
            'suspended_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        // is_active predates status; keep it in step for any older reader.
        // A block, not an arrow function: returning false from a saving listener would cancel the save.
        static::saving(function (self $bookshop): void {
            $bookshop->is_active = $bookshop->status !== self::STATUS_SUSPENDED;
        });
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_user_id');
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public function branches(): HasMany
    {
        return $this->hasMany(Branch::class)->withoutGlobalScope('bookshop');
    }

    public function subscription(): HasOne
    {
        return $this->hasOne(BookshopSubscription::class);
    }

    public function isSuspended(): bool
    {
        return $this->status === self::STATUS_SUSPENDED;
    }

    public function isActive(): bool
    {
        return $this->status === self::STATUS_ACTIVE;
    }

    /** A URL-safe identifier that is unique across the platform. */
    public static function uniqueSlug(string $name): string
    {
        $base = Str::limit(Str::slug($name) ?: 'bookshop', 60, '');
        $slug = $base;
        while (self::where('slug', $slug)->exists()) {
            $slug = $base.'-'.Str::lower(Str::random(5));
        }

        return $slug;
    }

    public function summary(): array
    {
        return [
            ...$this->only(['id', 'name', 'slug', 'status', 'business_email', 'phone', 'location', 'country', 'currency', 'timezone']),
            'verified_at' => $this->verified_at?->toIso8601String(),
            'suspended_at' => $this->suspended_at?->toIso8601String(),
            'suspension_reason' => $this->isSuspended() ? $this->suspension_reason : null,
        ];
    }
}
