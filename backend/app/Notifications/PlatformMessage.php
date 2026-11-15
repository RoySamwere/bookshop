<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** The email form of a logged platform message: a subject and plain paragraphs, escaped by the mail template. */
class PlatformMessage extends Notification
{
    public function __construct(private readonly string $subject, private readonly string $body) {}

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $message = (new MailMessage)->subject($this->subject)->salutation(config('app.name'));
        $paragraphs = array_map('trim', preg_split('/\R{2,}/', trim($this->body)) ?: []);
        // A template's own "Hello Jane," line becomes the greeting instead of Laravel's default "Hello!".
        if ($paragraphs && preg_match('/^(Hello|Hi|Dear)\b.{0,80}$/u', $paragraphs[0])) {
            $message->greeting(array_shift($paragraphs));
        }
        foreach ($paragraphs as $paragraph) {
            $message->line($paragraph);
        }

        return $message;
    }
}
