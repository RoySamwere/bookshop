<?php

namespace App\Console\Commands;

use App\Services\DarajaStkService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

class CheckDarajaSandbox extends Command
{
    protected $signature = 'billing:sandbox-check {--staging-confirmed : Confirm this is the authorized testing installation} {--checkout= : Query a known sandbox checkout; no new payment is initiated}';

    protected $description = 'Perform real sandbox OAuth and optional checkout query without exposing access tokens';

    public function handle(DarajaStkService $daraja): int
    {
        if (! $this->option('staging-confirmed') || config('services.mpesa.environment') !== 'sandbox') {
            $this->error('The authorized testing installation and sandbox payment configuration must be explicitly confirmed.');

            return self::FAILURE;
        }
        foreach (['consumer_key', 'consumer_secret', 'passkey', 'shortcode', 'callback_url'] as $name) {
            if (! config('services.mpesa.'.$name)) {
                $this->error('Missing sandbox setting: '.$name.'. No request sent.');

                return self::FAILURE;
            }
        }
        $checkout = $this->option('checkout');
        if ($checkout && ! DB::table('platform_billing_payments')->where('environment', 'sandbox')->where('checkout_request_id', $checkout)->exists()) {
            $this->error('Checkout is not a known sandbox request in this staging database.');

            return self::FAILURE;
        }
        try {
            $daraja->authenticate();
            $this->info('Real sandbox OAuth succeeded. Token withheld.');
            if ($checkout) {
                $result = $daraja->query($checkout);
                $this->line(json_encode(array_intersect_key($result, array_flip(['ResponseCode', 'ResultCode', 'CheckoutRequestID', 'MerchantRequestID']))));
                $this->info('Query only: no invoice settlement or subscription activation performed.');
            }
        } catch (Throwable $e) {
            $this->error('Real sandbox verification failed. Check credentials, HTTPS trust and outbound gateway access. Provider exception withheld to protect credentials.');

            return self::FAILURE;
        }

        return self::SUCCESS;
    }
}
