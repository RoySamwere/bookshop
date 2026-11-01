<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use RuntimeException;

class DarajaStkService
{
    private function base(): string
    {
        return config('services.mpesa.environment') === 'production'
            ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
    }

    public function query(string $checkoutRequestId): array
    {
        $key = config('services.mpesa.consumer_key');
        $secret = config('services.mpesa.consumer_secret');
        $passkey = config('services.mpesa.passkey');
        $shortcode = (string) config('services.mpesa.shortcode');
        if (!$key || !$secret || !$passkey || !$shortcode) {
            throw new RuntimeException('Daraja STK configuration is incomplete.');
        }
        $auth = Http::timeout(15)->withBasicAuth($key, $secret)
            ->get($this->base().'/oauth/v1/generate', ['grant_type' => 'client_credentials'])
            ->throw()->json();
        $timestamp = now('Africa/Nairobi')->format('YmdHis');
        return Http::timeout(25)->withToken($auth['access_token'])
            ->post($this->base().'/mpesa/stkpushquery/v1/query', [
                'BusinessShortCode' => $shortcode,
                'Password' => base64_encode($shortcode.$passkey.$timestamp),
                'Timestamp' => $timestamp,
                'CheckoutRequestID' => $checkoutRequestId,
            ])->throw()->json();
    }

    public function push(string $phone, int $amount, string $account): array
    {
        $key = config('services.mpesa.consumer_key');
        $secret = config('services.mpesa.consumer_secret');
        $passkey = config('services.mpesa.passkey');
        $shortcode = (string) config('services.mpesa.shortcode');
        $callback = config('services.mpesa.callback_url');
        if (!$key || !$secret || !$passkey || !$shortcode || !$callback) {
            throw new RuntimeException('Daraja STK configuration is incomplete.');
        }
        $auth = Http::timeout(15)->withBasicAuth($key, $secret)
            ->get($this->base().'/oauth/v1/generate', ['grant_type' => 'client_credentials'])
            ->throw()->json();
        $token = $auth['access_token'] ?? null;
        if (!$token) throw new RuntimeException('Daraja OAuth token missing.');
        $timestamp = now('Africa/Nairobi')->format('YmdHis');
        return Http::timeout(25)->withToken($token)->post($this->base().'/mpesa/stkpush/v1/processrequest', [
            'BusinessShortCode' => $shortcode,
            'Password' => base64_encode($shortcode.$passkey.$timestamp),
            'Timestamp' => $timestamp,
            'TransactionType' => config('services.mpesa.transaction_type', 'CustomerPayBillOnline'),
            'Amount' => $amount,
            'PartyA' => $phone,
            'PartyB' => $shortcode,
            'PhoneNumber' => $phone,
            'CallBackURL' => $callback,
            'AccountReference' => $account,
            'TransactionDesc' => 'Nifunze subscription invoice '.$account,
        ])->throw()->json();
    }
}
