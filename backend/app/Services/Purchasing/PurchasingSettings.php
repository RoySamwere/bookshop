<?php

namespace App\Services\Purchasing;

use Illuminate\Support\Facades\DB;

/** Per-bookshop purchasing preferences (approval step, default reorder level and target stock). */
class PurchasingSettings
{
    public const DEFAULTS = [
        'approval_required' => false,
        'default_reorder_level' => 5,
        'default_target_stock' => 30,
        'default_payment_terms' => null,
        'default_delivery_location' => null,
    ];

    public static function for(int $bookshopId): array
    {
        $row = DB::table('purchasing_settings')->where('bookshop_id', $bookshopId)->first();
        if (! $row) return self::DEFAULTS;

        return [
            'approval_required' => (bool) $row->approval_required,
            'default_reorder_level' => (int) $row->default_reorder_level,
            'default_target_stock' => (int) $row->default_target_stock,
            'default_payment_terms' => $row->default_payment_terms,
            'default_delivery_location' => $row->default_delivery_location,
        ];
    }

    public static function update(int $bookshopId, array $values): array
    {
        $values = array_intersect_key($values, self::DEFAULTS);
        $exists = DB::table('purchasing_settings')->where('bookshop_id', $bookshopId)->exists();
        if ($exists) {
            DB::table('purchasing_settings')->where('bookshop_id', $bookshopId)->update([...$values, 'updated_at' => now()]);
        } else {
            DB::table('purchasing_settings')->insert([...self::DEFAULTS, ...$values, 'bookshop_id' => $bookshopId, 'created_at' => now(), 'updated_at' => now()]);
        }

        return self::for($bookshopId);
    }
}
