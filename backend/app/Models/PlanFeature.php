<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PlanFeature extends Model
{
    protected $fillable = ['subscription_plan_id', 'feature', 'is_enabled', 'limit'];

    protected function casts(): array
    {
        return ['is_enabled' => 'boolean', 'limit' => 'integer'];
    }

    public function plan(): BelongsTo
    {
        return $this->belongsTo(SubscriptionPlan::class, 'subscription_plan_id');
    }
}
