<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** Append-only audit record of one manual trial extension. Existing rows can never be changed or removed. */
class SubscriptionTrialExtension extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = [
        'bookshop_id', 'bookshop_subscription_id', 'previous_status', 'previous_trial_ends_at', 'new_trial_ends_at',
        'days_granted', 'reactivated', 'extended_by', 'extended_by_name', 'reason', 'idempotency_key',
    ];

    protected function casts(): array
    {
        return [
            'previous_trial_ends_at' => 'datetime', 'new_trial_ends_at' => 'datetime', 'created_at' => 'datetime',
            'days_granted' => 'integer', 'reactivated' => 'boolean',
        ];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Trial extension history is permanent and cannot be edited.'));
        static::deleting(fn () => throw new LogicException('Trial extension history is permanent and cannot be deleted.'));
    }

    public function bookshop(): BelongsTo
    {
        return $this->belongsTo(Bookshop::class);
    }

    public function subscription(): BelongsTo
    {
        return $this->belongsTo(BookshopSubscription::class, 'bookshop_subscription_id');
    }

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'bookshop_id' => $this->bookshop_id,
            'bookshop_name' => $this->bookshop?->name,
            'previous_status' => $this->previous_status,
            'previous_trial_ends_at' => $this->previous_trial_ends_at?->toIso8601String(),
            'new_trial_ends_at' => $this->new_trial_ends_at->toIso8601String(),
            'days_granted' => $this->days_granted,
            'reactivated' => $this->reactivated,
            'extended_by' => $this->extended_by,
            'extended_by_name' => $this->extended_by_name,
            'reason' => $this->reason,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
