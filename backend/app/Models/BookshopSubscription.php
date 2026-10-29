<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** A bookshop's current subscription state. Changing it never deletes business records. */
class BookshopSubscription extends Model
{
    public const TRIALING = 'trialing';
    public const ACTIVE = 'active';
    public const PAST_DUE = 'past_due';
    public const GRACE_PERIOD = 'grace_period';
    public const SUSPENDED = 'suspended';
    public const CANCELLED = 'cancelled';
    public const EXPIRED = 'expired';

    public const STATUSES = [self::TRIALING, self::ACTIVE, self::PAST_DUE, self::GRACE_PERIOD, self::SUSPENDED, self::CANCELLED, self::EXPIRED];

    protected $fillable = ['subscription_plan_id', 'status', 'trial_starts_at', 'trial_ends_at', 'current_period_starts_at', 'current_period_ends_at', 'grace_ends_at', 'cancelled_at'];

    protected function casts(): array
    {
        return [
            'trial_starts_at' => 'datetime', 'trial_ends_at' => 'datetime',
            'current_period_starts_at' => 'datetime', 'current_period_ends_at' => 'datetime',
            'grace_ends_at' => 'datetime', 'cancelled_at' => 'datetime',
        ];
    }

    public function bookshop(): BelongsTo
    {
        return $this->belongsTo(Bookshop::class);
    }

    public function plan(): BelongsTo
    {
        return $this->belongsTo(SubscriptionPlan::class, 'subscription_plan_id');
    }

    public function events(): HasMany
    {
        return $this->hasMany(SubscriptionEvent::class);
    }

    public function summary(): array
    {
        return [
            'status' => $this->status,
            'plan' => $this->plan?->only(['code', 'name']),
            'trial_ends_at' => $this->trial_ends_at?->toIso8601String(),
            'trial_days_left' => $this->status === self::TRIALING && $this->trial_ends_at
                ? max(0, (int) ceil(now()->diffInHours($this->trial_ends_at, false) / 24)) : null,
            'current_period_ends_at' => $this->current_period_ends_at?->toIso8601String(),
        ];
    }
}
