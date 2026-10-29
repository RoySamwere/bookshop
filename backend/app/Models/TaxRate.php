<?php

namespace App\Models;

use App\Support\Tenancy\BelongsToBookshop;
use Illuminate\Database\Eloquent\Model;

class TaxRate extends Model
{
    use BelongsToBookshop;

    protected $fillable = ['name', 'code', 'rate', 'is_default', 'is_active'];

    protected function casts(): array
    {
        return [
            'rate' => 'decimal:2',
            'is_default' => 'boolean',
            'is_active' => 'boolean',
        ];
    }
}
