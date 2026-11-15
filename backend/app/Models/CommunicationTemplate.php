<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** A Platform Owner's edit of a built-in email template. Deleting the row restores the default. */
class CommunicationTemplate extends Model
{
    protected $primaryKey = 'key';

    public $incrementing = false;

    protected $keyType = 'string';

    protected $guarded = [];

    protected function casts(): array
    {
        return ['is_enabled' => 'boolean'];
    }
}
