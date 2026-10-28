<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class LaunchSubscriber extends Model
{
    protected $fillable = ['email', 'source', 'ip_address', 'notified_at'];

    protected $hidden = ['ip_address'];

    protected function casts(): array
    {
        return ['notified_at' => 'datetime'];
    }
}
