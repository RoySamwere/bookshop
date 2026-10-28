<?php

namespace App\Notifications;

use Illuminate\Notifications\Notification;

/** In-app notification shown in the workspace notification panel. */
class AccountNotification extends Notification
{
    public function __construct(
        private readonly string $title,
        private readonly string $body,
        private readonly string $level = 'info',
        private readonly ?string $section = null,
    ) {
    }

    public function via(object $notifiable): array
    {
        return ['database'];
    }

    public function toArray(object $notifiable): array
    {
        return [
            'title' => $this->title,
            'body' => $this->body,
            'level' => $this->level,
            'section' => $this->section,
        ];
    }
}
