<?php

namespace App\Notifications;

use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Notifications\Messages\MailMessage;
use Illuminate\Notifications\Notification;

/** One alert when a stocked product crosses its configured reorder threshold. */
class LowStockAlert extends Notification implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public function __construct(
        public readonly string $product,
        public readonly int $available,
        public readonly int $threshold,
        public readonly string $branch,
    ) {}

    public function via(object $notifiable): array
    {
        return ['mail', 'database'];
    }

    public function toMail(object $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject('Low stock alert: '.$this->product.' — Nifunze Bookshop')
            ->greeting('Hello '.$notifiable->name.',')
            ->line($this->product.' has fallen below its reorder level at '.$this->branch.'.')
            ->line('Available: '.$this->available.' units. Reorder threshold: '.$this->threshold.' units.')
            ->line('Open Inventory & Stock or Purchase Orders → Reorder suggestions to replenish it.')
            ->action('View reorder suggestions', url('/dashboard?section=Purchase+Orders&po_tab=suggestions'));
    }

    public function toArray(object $notifiable): array
    {
        return ['title' => 'Low stock: '.$this->product, 'body' => $this->available.' units available at '.$this->branch.' (threshold '.$this->threshold.').', 'level' => 'warning', 'section' => 'Purchase Orders'];
    }
}
