<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** A Platform Owner announcement; its individual emails are in communication_logs. */
class Announcement extends Model
{
    public const CATEGORIES = ['update', 'maintenance', 'feature', 'general'];

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['bookshop_ids' => 'array', 'recipient_count' => 'integer'];
    }

    public function logs(): HasMany
    {
        return $this->hasMany(CommunicationLog::class);
    }
}
