<?php

namespace App\Jobs;

use App\Services\Purchasing\PurchaseOrderMailService;
use App\Support\Tenancy\Tenant;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Support\Facades\DB;

/** Sends one queued LPO email attempt. Failures are recorded on the attempt; staff retry from the order. */
class SendPurchaseOrderEmail implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public int $tries = 1;
    public int $timeout = 120;

    public function __construct(public readonly int $attemptId) {}

    public function handle(PurchaseOrderMailService $mail): void
    {
        $bookshopId = DB::table('purchase_order_email_attempts')->where('id', $this->attemptId)->value('bookshop_id');
        if ($bookshopId === null) return;
        Tenant::run((int) $bookshopId, fn () => $mail->deliver($this->attemptId));
    }
}
