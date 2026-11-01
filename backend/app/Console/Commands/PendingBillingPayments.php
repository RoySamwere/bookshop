<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class PendingBillingPayments extends Command
{
    protected $signature = 'billing:pending-payments {--environment=sandbox}';
    protected $description = 'Report unresolved requests before a payment-mode switch; never changes records';

    public function handle(): int
    {
        $environment = $this->option('environment');
        if (!in_array($environment, ['sandbox', 'production'], true)) {
            $this->error('Select sandbox or production.');
            return self::FAILURE;
        }
        $counts = DB::table('platform_billing_payments')->where('environment', $environment)
            ->whereIn('status', ['pending', 'awaiting_verification', 'unknown'])->selectRaw('status, COUNT(*) as total')->groupBy('status')->pluck('total', 'status');
        $items = DB::table('platform_payment_reconciliation_items')->where('environment', $environment)
            ->whereIn('status', ['awaiting_verification', 'requires_review'])->count();
        $this->line(json_encode(['environment' => $environment, 'payment_requests' => $counts, 'reconciliation_items' => $items]));
        if ($counts->sum() || $items) {
            $this->warn('Unresolved records remain. Review and document them before requesting authorization to switch payment mode.');
            return self::FAILURE;
        }
        $this->info('No unresolved records found. This does not authorize a production switch or charge.');
        return self::SUCCESS;
    }
}
