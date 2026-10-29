<?php

namespace App\Support\Tenancy;

use App\Models\Bookshop;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Eloquent tenant isolation: queries only see the current bookshop's rows (or nothing for a
 * signed-in account without a bookshop), and new rows are stamped with the current bookshop.
 * Platform code that needs cross-tenant aggregates must opt out with withoutGlobalScope('bookshop').
 */
trait BelongsToBookshop
{
    public static function bootBelongsToBookshop(): void
    {
        static::addGlobalScope('bookshop', function (Builder $query) {
            $scope = Tenant::scopeValue();
            if ($scope === false) {
                $query->whereRaw('1 = 0');
            } elseif ($scope !== null) {
                $query->where($query->qualifyColumn('bookshop_id'), $scope);
            }
        });

        static::creating(function ($model) {
            if (empty($model->bookshop_id) && ($id = Tenant::id()) !== null) {
                $model->bookshop_id = $id;
            }
        });
    }

    public function bookshop(): BelongsTo
    {
        return $this->belongsTo(Bookshop::class);
    }
}
