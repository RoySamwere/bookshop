<?php

namespace App\Services\Billing;

use App\Services\PlatformPaymentSettlementService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Explains, without revealing any secret, why M-Pesa payments might not be confirmed automatically:
 * configuration, whether Safaricom notifications are arriving, and whether the scheduler and queue run.
 */
class BillingHealth
{
    /** @return array<int, array{key: string, ok: bool, title: string, detail: string, fix: ?string}> */
    public function checks(): array
    {
        $mpesa = (array) config('services.mpesa');
        $environment = (string) ($mpesa['environment'] ?? '');
        $checks = [];
        $add = function (string $key, bool $ok, string $title, string $detail, ?string $fix = null) use (&$checks) {
            $checks[] = compact('key', 'ok', 'title', 'detail') + ['fix' => $ok ? null : $fix];
        };
        $https = fn ($url) => is_string($url) && parse_url($url, PHP_URL_SCHEME) === 'https';

        $add('environment', $environment === 'production' && (string) ($mpesa['shortcode'] ?? '') === PlatformPaymentSettlementService::PRODUCTION_PAYBILL,
            'Live Paybill', "Payment environment: {$environment}, shortcode ".($mpesa['shortcode'] ?? 'not set').'.',
            'Set MPESA_ENVIRONMENT=production and MPESA_SHORTCODE=152451 in backend/.env, then php artisan config:cache.');

        $stkReady = ! empty($mpesa['consumer_key']) && ! empty($mpesa['consumer_secret']) && ! empty($mpesa['passkey']) && $https($mpesa['callback_url'] ?? null);
        $add('stk', $stkReady, 'M-Pesa prompts (STK)', $stkReady ? 'Credentials and callback URL are set; prompt payments are confirmed automatically.' : 'Consumer key/secret, passkey or the HTTPS callback URL is missing.',
            'Set MPESA_CONSUMER_KEY, MPESA_CONSUMER_SECRET, MPESA_PASSKEY and MPESA_CALLBACK_URL=https://<your-domain>/api/v1/billing/mpesa/stk/callback.');

        $lastC2b = DB::table('saf_payments')->where('environment', $environment)->where('payment_channel', 'paybill')
            ->where('provider_payload', 'like', '%c2b_confirmation%')->max('created_at');
        $add('c2b_notifications', $lastC2b !== null && $https($mpesa['confirmation_url'] ?? null), 'Paybill notifications from Safaricom',
            $lastC2b ? 'Last Paybill notification received '.\Illuminate\Support\Carbon::parse($lastC2b)->diffForHumans().'.' : 'No Paybill notification has reached this server yet, so direct Paybill payments are not recorded automatically.',
            'Set MPESA_C2B_CONFIRMATION_URL=https://<your-domain>/api/v1/billing/mpesa/c2b/confirmation, run php artisan config:cache, then php artisan billing:register-c2b-urls --confirm (once).');

        $mode = (string) ($mpesa['c2b_verification'] ?? 'none');
        $verifyReady = match ($mode) {
            'transaction_status' => ! empty($mpesa['initiator_name']) && ! empty($mpesa['security_credential']) && $https($mpesa['result_url'] ?? null) && $https($mpesa['timeout_url'] ?? null),
            'pull_api' => true,
            default => false,
        };
        $add('c2b_verification', $verifyReady, 'Confirming Paybill payments with Safaricom',
            match (true) {
                $verifyReady => "Mode {$mode}: Paybill payments and M-Pesa codes are confirmed automatically.",
                $mode === 'transaction_status' => 'Transaction Status is selected but the API initiator name, security credential or result URLs are missing, so Paybill payments stay pending.',
                default => 'Automatic confirmation of Paybill payments is switched off, so they wait for the platform team.',
            },
            'Ask Safaricom (Daraja) for Transaction Status access on Paybill 152451 and set MPESA_INITIATOR_NAME, MPESA_SECURITY_CREDENTIAL, MPESA_RESULT_URL and MPESA_TIMEOUT_URL; or set MPESA_C2B_VERIFICATION=pull_api if you have Pull API access. Until then, apply payments with "Safaricom cannot confirm the code? Record it from the merchant statement".');

        $overdue = DB::table('saf_payments')->where('environment', $environment)->where('verification_status', 'pending')
            ->whereNotNull('next_verification_at')->where('next_verification_at', '<', now()->subMinutes(5))->count();
        $add('scheduler', $overdue === 0, 'Automatic checking (scheduler)', $overdue === 0 ? 'No payment is waiting longer than expected for its next check.' : "{$overdue} payment(s) are overdue for their next check: the scheduler does not seem to run.",
            'Add a cron entry that runs every minute: cd <app>/backend && php artisan schedule:run');

        if (config('queue.default') === 'database' && Schema::hasTable('jobs')) {
            $stuck = DB::table('jobs')->where('created_at', '<', now()->subMinutes(5)->timestamp)->count();
            $add('queue', $stuck === 0, 'Background jobs (queue)', $stuck === 0 ? 'No background job is waiting.' : "{$stuck} background job(s) have waited over 5 minutes: no queue worker is running.",
                'Run a queue worker, e.g. in cron every minute: php artisan queue:work --stop-when-empty --tries=1');
        }

        return $checks;
    }
}
