<?php

namespace App\Console\Commands;

use App\Services\Billing\SafPaymentSync;
use Illuminate\Console\Command;

class SyncPayments extends Command
{
    protected $signature = 'billing:sync-payments {--environment=}';

    protected $description = 'Update every saf_payments row now, using the M-Pesa confirmation code as the key';

    public function handle(SafPaymentSync $sync): int
    {
        $this->line(json_encode($sync->run($this->option('environment') ?: null)));

        return self::SUCCESS;
    }
}
