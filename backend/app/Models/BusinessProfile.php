<?php

namespace App\Models;

use App\Support\Tenancy\BelongsToBookshop;
use App\Support\Tenancy\Tenant;
use Illuminate\Database\Eloquent\Model;

class BusinessProfile extends Model
{
    use BelongsToBookshop;

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

    /** The current bookshop's profile, created from the bookshop's own details on first use. */
    public static function current(): self
    {
        $bookshop = Tenant::bookshop();
        abort_unless($bookshop, 403, 'This action requires a bookshop workspace.');

        return self::query()->firstOrCreate(['bookshop_id' => $bookshop->id], [
            'name' => $bookshop->name, 'email' => $bookshop->business_email, 'phone' => $bookshop->phone,
            'city' => $bookshop->location, 'country' => $bookshop->country, 'currency' => $bookshop->currency,
            'timezone' => $bookshop->timezone,
        ]);
    }
}
