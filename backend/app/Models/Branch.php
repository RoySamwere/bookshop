<?php

namespace App\Models;

use App\Support\Tenancy\BelongsToBookshop;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Branch extends Model
{
    use BelongsToBookshop, HasFactory;

    protected $fillable = ['name', 'code', 'email', 'phone', 'address', 'city', 'is_active'];

    protected function casts(): array
    {
        return [
            'is_main' => 'boolean',
            'is_active' => 'boolean',
            'bookshop_id' => 'integer',
        ];
    }

    public function users(): BelongsToMany
    {
        return $this->belongsToMany(User::class)->withTimestamps();
    }
}
