<?php

namespace App\Console\Commands;

use App\Services\DarajaStkService;
use Illuminate\Console\Command;
use Throwable;

/** One-off setup: tells Safaricom where to post Paybill 152451 payments. */
class RegisterC2bUrls extends Command
{
    protected $signature = 'billing:register-c2b-urls {--confirm : Required; registers the URLs with Safaricom}';

    protected $description = 'Register the Paybill confirmation and validation URLs with Safaricom';

    public function handle(DarajaStkService $daraja): int
    {
        $confirmation = (string) config('services.mpesa.confirmation_url');
        $validation = (string) (config('services.mpesa.validation_url') ?: $confirmation);
        if (parse_url($confirmation, PHP_URL_SCHEME) !== 'https') {
            $this->error('Set MPESA_C2B_CONFIRMATION_URL to the public HTTPS confirmation URL first.');

            return self::FAILURE;
        }
        if (! $this->option('confirm')) {
            $this->line('Would register '.$confirmation.' for shortcode '.config('services.mpesa.shortcode').' ('.config('services.mpesa.environment').'). Re-run with --confirm.');

            return self::FAILURE;
        }
        try {
            $response = $daraja->registerC2bUrls($confirmation, $validation);
        } catch (Throwable) {
            $this->error('Safaricom did not accept the registration. Check the credentials and shortcode.');

            return self::FAILURE;
        }
        $this->info('Safaricom response: '.($response['ResponseDescription'] ?? $response['ResponseCode'] ?? 'received'));

        return self::SUCCESS;
    }
}
