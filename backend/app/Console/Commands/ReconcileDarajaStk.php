<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;

/** Kept for existing cron entries and scripts; the work now happens in billing:reconcile-payments. */
class ReconcileDarajaStk extends Command
{
    protected $signature = 'billing:reconcile-stk';

    protected $description = 'Verify pending M-Pesa payments with Safaricom (alias of billing:reconcile-payments)';

    public function handle(): int
    {
        return $this->call('billing:reconcile-payments');
    }
}
