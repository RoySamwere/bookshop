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
            ->where('environment', config('services.mpesa.environment'))->where('channel', 'stk')->whereNotNull('checkout_request_id')
            ->where('created_at', '<=', now()->subMinutes(2))
            ->orderBy('queried_at')->orderBy('id')->limit(100)->get();
        foreach ($attempts as $attempt) {
            try {
                $result = $daraja->query($attempt->checkout_request_id);
                DB::table('platform_billing_payments')->where('id', $attempt->id)
                    ->whereIn('status', ['pending', 'awaiting_verification'])
                    ->update(['query_response' => json_encode($result), 'queried_at' => now()]);
                if ((string) ($result['ResponseCode'] ?? '') !== '0') {
                    continue;
                }
                $code = (string) ($result['ResultCode'] ?? '');
                if (isset($result['CheckoutRequestID']) && $result['CheckoutRequestID'] !== $attempt->checkout_request_id) {
                    continue;
                }
                if ($code === '0') {
                    // Query verifies the checkout outcome but does not provide an
                    // authenticated receipt and amount. Await statement reconciliation
                    // before crediting any funds.
                    DB::table('platform_billing_payments')->where('id', $attempt->id)
                        ->whereIn('status', ['pending', 'awaiting_verification'])
                        ->update(['status' => 'awaiting_verification', 'query_response' => json_encode($result), 'queried_at' => now(), 'updated_at' => now()]);
                } elseif (in_array($code, ['1', '1032', '1037', '2001'], true)) {
                    DB::table('platform_billing_payments')->where('id', $attempt->id)
                        ->whereIn('status', ['pending', 'awaiting_verification'])
                        ->update(['status' => 'failed', 'query_response' => json_encode($result), 'queried_at' => now(), 'updated_at' => now()]);
                }
            } catch (Throwable $e) {
                DB::table('platform_billing_payments')->where('id', $attempt->id)
                    ->whereIn('status', ['pending', 'awaiting_verification'])->update(['queried_at' => now()]);
                $this->warn('Provider verification unavailable for attempt '.$attempt->id.'.');
            }
        }

        return self::SUCCESS;
    }
}
