<?php

namespace App\Jobs;

use App\Services\Billing\SafPaymentVerifier;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;

/** Verifies one received M-Pesa transaction with Safaricom and allocates it. The scheduler retries anything missed. */
class VerifySafPayment implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable;

    public int $tries = 1;
    public int $timeout = 90;

    public function __construct(public readonly int $safPaymentId) {}

    public function handle(SafPaymentVerifier $verifier): void
    {
        $verifier->handle($this->safPaymentId);
    }
}
