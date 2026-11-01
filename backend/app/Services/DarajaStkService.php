<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use RuntimeException;

class DarajaStkService
{
    private function settings(): array
    {
        $settings = config('services.mpesa');
        if (! in_array($settings['environment'], ['sandbox', 'production'], true)) {
            throw new RuntimeException('Invalid Daraja environment.');
        }
        foreach (['consumer_key', 'consumer_secret', 'passkey', 'shortcode'] as $key) {
            if (empty($settings[$key])) {
                throw new RuntimeException('Daraja STK configuration is incomplete.');
            }
        }
        if ($settings['environment'] === 'production' && (string) $settings['shortcode'] !== '153283') {
            throw new RuntimeException('Live STK shortcode must match the authorized platform Paybill 153283.');
        }

        return $settings;
    }

    private function request(string $path, array $payload): array
    {
        $settings = $this->settings();
        $base = $settings['environment'] === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
        $auth = Http::acceptJson()->timeout(15)->withBasicAuth($settings['consumer_key'], $settings['consumer_secret'])
            ->get($base.'/oauth/v1/generate', ['grant_type' => 'client_credentials'])->throw()->json();
        if (! is_string($auth['access_token'] ?? null) || $auth['access_token'] === '') {
            throw new RuntimeException('Daraja OAuth token missing.');
        }
        $timestamp = now('Africa/Nairobi')->format('YmdHis');
        $response = Http::acceptJson()->timeout(25)->withToken($auth['access_token'])->post($base.$path, [
            'BusinessShortCode' => (string) $settings['shortcode'],
            'Password' => base64_encode($settings['shortcode'].$settings['passkey'].$timestamp),
            'Timestamp' => $timestamp,
            ...$payload,
        ])->throw()->json();
        if (! is_array($response)) {
            throw new RuntimeException('Invalid Daraja response.');
        }

        return $response;
    }

    public function query(string $checkoutRequestId): array
    {
        return $this->request('/mpesa/stkpushquery/v1/query', ['CheckoutRequestID' => $checkoutRequestId]);
    }

    public function push(string $phone, int $amount, string $account): array
    {
        $settings = $this->settings();
        $callback = $settings['callback_url'] ?? null;
        if (! is_string($callback) || ! filter_var($callback, FILTER_VALIDATE_URL) || parse_url($callback, PHP_URL_SCHEME) !== 'https') {
            throw new RuntimeException('Daraja callback must be a public HTTPS URL.');
        }
        if (! preg_match('/^254[17][0-9]{8}$/', $phone) || ! preg_match('/^[0-9]{6}$/', $account) || $amount < 1 || $amount > 250000) {
            throw new RuntimeException('Invalid STK phone, amount or account reference.');
        }

        return $this->request('/mpesa/stkpush/v1/processrequest', [
            'TransactionType' => 'CustomerPayBillOnline', 'Amount' => $amount,
            'PartyA' => $phone, 'PartyB' => (string) $settings['shortcode'], 'PhoneNumber' => $phone,
            'CallBackURL' => $callback, 'AccountReference' => $account, 'TransactionDesc' => 'Subscription',
        ]);
    }
}
