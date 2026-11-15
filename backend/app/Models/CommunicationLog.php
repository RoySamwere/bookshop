<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** One email to one recipient, with its delivery state. */
class CommunicationLog extends Model
{
    public const QUEUED = 'queued';
    public const SENDING = 'sending';
    public const SENT = 'sent';
    public const FAILED = 'failed';

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['sent_at' => 'datetime', 'failed_at' => 'datetime', 'attempts' => 'integer'];
    }

    public function bookshop(): BelongsTo
    {
        return $this->belongsTo(Bookshop::class);
    }

    public function toApi(): array
    {
        return [
            'id' => $this->id,
            'event' => $this->event,
            'bookshop_id' => $this->bookshop_id,
            'bookshop_name' => $this->bookshop?->name,
            'announcement_id' => $this->announcement_id,
            'recipient_name' => $this->recipient_name,
            'recipient_email' => $this->recipient_email,
            'subject' => $this->subject,
            'body' => $this->body,
            'status' => $this->status,
            'attempts' => $this->attempts,
            'last_error' => $this->last_error,
            'sent_at' => $this->sent_at?->toIso8601String(),
            'failed_at' => $this->failed_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
