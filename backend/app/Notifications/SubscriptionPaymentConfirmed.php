<?php

namespace App\Notifications;

use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** Sent to the bookshop owner when a subscription payment has been verified and applied. */
class SubscriptionPaymentConfirmed extends Notification
{
    public function __construct(private readonly array $payment, private readonly bool $withMail = true) {}

    public function via(object $notifiable): array
    {
        return $this->withMail && $notifiable->email ? ['database', 'mail'] : ['database'];
    }

    public function toArray(object $notifiable): array
    {
        return [
            'title' => 'Payment received',
            'body' => $this->summary(),
            'level' => 'success',
            'section' => 'billing',
        ];
    }

    public function toMail(object $notifiable): MailMessage
    {
        $p = $this->payment;

        return (new MailMessage)
            ->subject("Payment received: KES {$p['amount']} for invoice {$p['account_number']} · Nifunze Bookshop")
            ->greeting('Hello '.$notifiable->name.',')
            ->line("We have received and verified your M-Pesa payment {$p['receipt']} of KES {$p['amount']} for {$p['bookshop']}.")
            ->line("Invoice account: {$p['account_number']} · Invoice status: {$p['invoice_status']}.")
            ->line($p['invoice_status'] === 'paid'
                ? 'Your subscription is active until '.$p['access_until'].'.'
                : 'A balance of KES '.$p['balance'].' remains on this invoice. Pay it with the same account number to activate your subscription.')
            ->line('You can download a receipt from My Payments in your billing page.')
            ->salutation('Nifunze Bookshop');
    }

    private function summary(): string
    {
        $p = $this->payment;

        return "M-Pesa {$p['receipt']} · KES {$p['amount']} applied to invoice {$p['account_number']} (".
            ($p['invoice_status'] === 'paid' ? 'paid, subscription active until '.$p['access_until'] : "balance KES {$p['balance']}").').';
    }
}
