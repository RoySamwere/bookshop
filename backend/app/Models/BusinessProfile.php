<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class BusinessProfile extends Model
{
    protected $fillable = [
        'name', 'legal_name', 'kra_pin', 'email', 'phone', 'website', 'address', 'city', 'country',
        'currency', 'timezone', 'prices_include_tax', 'receipt_prefix', 'receipt_header', 'receipt_footer',
        'low_stock_threshold',
    ];

    protected function casts(): array
    {
        return [
            'prices_include_tax' => 'boolean',
            'low_stock_threshold' => 'integer',
        ];
    }

    /** The application runs a single business; create its profile on first use. */
    public static function current(): self
    {
        return self::query()->firstOrCreate([], ['name' => 'Nifunze Bookshop']);
    }
}
