<?php

namespace App\Notifications;

use App\Support\FrontendUrl;
use Illuminate\Bus\Queueable;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** Email inviting an employee to set their password and join a bookshop workspace. */
class StaffInvitation extends Notification
{
    use Queueable;

    public function __construct(private string $token, private string $inviter, private string $bookshop) {}

    public function via(object $notifiable): array
    {
        return ['mail'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $minutes = (int) config('auth.passwords.invitations.expire');

        return (new MailMessage)
            ->subject("You're invited to {$this->bookshop}")
            ->greeting("Hello {$notifiable->name},")
            ->line("{$this->inviter} invited you to join {$this->bookshop} as a team member.")
            ->action('Accept invitation', FrontendUrl::to('/accept-invitation', ['token' => $this->token, 'email' => $notifiable->email]))
            ->line('The link expires in '.max(1, intdiv($minutes, 60)).' hours. If you were not expecting this invitation, you can ignore this email.');
    }
}
