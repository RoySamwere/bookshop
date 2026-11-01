<?php

namespace App\Console\Commands;

use App\Services\DarajaStkService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

class ReconcileDarajaStk extends Command
{
    protected $signature = 'billing:reconcile-stk';
    protected $description = 'Verify pending M-Pesa STK requests against Safaricom without trusting unsigned callbacks';

    public function handle(DarajaStkService $daraja): int
    {
        $attempts = DB::table('platform_billing_payments')
            ->whereIn('status', ['pending', 'awaiting_verification'])
            ->where('channel', 'stk')->whereNotNull('checkout_request_id')
            ->where('created_at', '<=', now()->subMinutes(2))
            ->limit(100)->get();
        foreach ($attempts as $attempt) {
            try {
                $result = $daraja->query($attempt->checkout_request_id);
                if (($result['ResponseCode'] ?? null) != '0') continue;
                $code = (int) ($result['ResultCode'] ?? -1);
                if ($code === 0) {
                    // Query verifies the checkout outcome but does not provide an
                    // authenticated receipt and amount. Await statement reconciliation
                    // before crediting any funds.
                    DB::table('platform_billing_payments')->where('id', $attempt->id)
                        ->whereIn('status', ['pending', 'awaiting_verification'])
                        ->update(['status' => 'awaiting_verification', 'updated_at' => now()]);
                } elseif (array_key_exists('ResultCode', $result)) {
                    DB::table('platform_billing_payments')->where('id', $attempt->id)
                        ->whereIn('status', ['pending', 'awaiting_verification'])
                        ->update(['status' => 'failed', 'updated_at' => now()]);
                }
            } catch (Throwable $e) {
                $this->warn('Checkout '.$attempt->checkout_request_id.': '.$e->getMessage());
            }
        }
        return self::SUCCESS;
    }
}
