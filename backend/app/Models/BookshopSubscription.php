<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Facades\DB;

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

    public function trialExtensions(): HasMany
    {
        return $this->hasMany(SubscriptionTrialExtension::class);
    }

    /** Whole days (rounded up) until the given moment; zero once it has passed. */
    public static function daysUntil(?\DateTimeInterface $moment): ?int
    {
        return $moment ? max(0, (int) ceil(now()->diffInHours($moment, false) / 24)) : null;
    }

    /** True while the bookshop is inside a trial whose end date has not yet passed. */
    public function inActiveTrial(): bool
    {
        return $this->status === self::TRIALING && (! $this->trial_ends_at || $this->trial_ends_at->isFuture());
    }

    /** Whether paid access was ever granted: a paid period, a paid invoice, or a paid-only status. */
    public function hasPaidAccess(?bool $hasPaidInvoice = null): bool
    {
        return $this->current_period_ends_at !== null
            || in_array($this->status, [self::ACTIVE, self::PAST_DUE, self::GRACE_PERIOD], true)
            || ($hasPaidInvoice ?? DB::table('platform_billing_invoices')->where('bookshop_id', $this->bookshop_id)->where('status', 'paid')->exists());
    }

    public function summary(): array
    {
        $expiry = $this->status === self::TRIALING ? $this->trial_ends_at : $this->current_period_ends_at;
        return [
            'status' => $this->status,
            'plan' => $this->plan?->only(['code', 'name']),
            'days_remaining' => self::daysUntil($expiry),
            'trial_ends_at' => $this->trial_ends_at?->toIso8601String(),
            'trial_days_left' => $this->status === self::TRIALING ? self::daysUntil($this->trial_ends_at) : null,
            'current_period_ends_at' => $this->current_period_ends_at?->toIso8601String(),
        ];
    }
}
