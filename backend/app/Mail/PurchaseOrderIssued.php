<?php

namespace App\Mail;

use Illuminate\Mail\Attachment;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Address;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/** The LPO email to a supplier, with the stored LPO PDF attached. Sent from a queued job. */
class PurchaseOrderIssued extends Mailable
{
    public function __construct(
        public readonly string $lpoNumber,
        public readonly string $bookshopName,
        public readonly string $supplierName,
        public readonly array $contactLines,
        public readonly string $pdf,
        public readonly ?string $replyToAddress = null,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: "New Purchase Order {$this->lpoNumber} from {$this->bookshopName} via Nifunze Bookshop",
            replyTo: $this->replyToAddress ? [new Address($this->replyToAddress, $this->bookshopName)] : [],
        );
    }

    public function content(): Content
    {
        return new Content(view: 'emails.purchase-order', text: 'emails.purchase-order-text');
    }

    public function attachments(): array
    {
        return [Attachment::fromData(fn () => $this->pdf, "{$this->lpoNumber}.pdf")->withMime('application/pdf')];
    }
}
