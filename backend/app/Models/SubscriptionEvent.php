<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Append-only subscription history. */
class SubscriptionEvent extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['bookshop_id', 'bookshop_subscription_id', 'subscription_plan_id', 'event', 'from_status', 'to_status', 'actor_id', 'note'];

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
