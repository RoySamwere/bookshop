<?php

namespace App\Notifications;

use App\Support\FrontendUrl;
use App\Support\Roles;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** Emails an applicant the outcome of their staff access request. */
class StaffAccessDecision extends Notification
{
    public function __construct(
        private readonly bool $approved,
        private readonly ?string $role = null,
        private readonly ?string $note = null,
    ) {
    }

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $app = config('app.name');
        $mail = (new MailMessage)->greeting("Hello {$notifiable->name},");

        if ($this->approved) {
            return $mail->subject("Your {$app} staff access is ready")
                ->line('Your request for staff access has been approved. You have been given the '.Roles::label((string) $this->role).' role.')
                ->action('Sign in to the management system', FrontendUrl::to('/login'))
                ->line('If you were already signed in, sign in again so your new access applies.');
        }

        $mail->subject("Update on your {$app} staff access request")
            ->line('Your request for staff access was not approved. Your customer account is still active.');
        if ($this->note) {
            $mail->line('Note from the reviewer: '.$this->note);
        }

        return $mail->line('If you think this is a mistake, contact the bookshop management.');
    }
}
