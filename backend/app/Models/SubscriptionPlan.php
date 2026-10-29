<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** Global reference data: a plan and the features/limits it entitles a bookshop to. */
class SubscriptionPlan extends Model
{
    protected $fillable = ['code', 'name', 'description', 'price', 'currency', 'billing_interval', 'trial_days', 'is_active', 'sort_order'];

    protected function casts(): array
    {
        return ['price' => 'decimal:2', 'trial_days' => 'integer', 'is_active' => 'boolean', 'sort_order' => 'integer'];
    }

    public function features(): HasMany
    {
        return $this->hasMany(PlanFeature::class);
    }
}
