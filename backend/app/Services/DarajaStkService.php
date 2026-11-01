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
        if ($settings['environment'] === 'production' && (string) $settings['shortcode'] !== '152451') {
            throw new RuntimeException('Live STK shortcode must match the authorized platform Paybill 152451.');
        }

        return $settings;
    }

    private function request(string $path, array $payload): array
    {
        $settings = $this->settings();
        $base = $settings['environment'] === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
        $token = $this->authenticate();
        $timestamp = now('Africa/Nairobi')->format('YmdHis');
        $response = Http::acceptJson()->timeout(25)->withToken($token)->post($base.$path, [
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

    /** The returned token is for server-side use only; never log or return it to a browser. */
    public function authenticate(): string
    {
        $settings = $this->settings();
        $base = $settings['environment'] === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
        $auth = Http::acceptJson()->timeout(15)->withBasicAuth($settings['consumer_key'], $settings['consumer_secret'])
            ->get($base.'/oauth/v1/generate', ['grant_type' => 'client_credentials'])->throw()->json();
        if (! is_string($auth['access_token'] ?? null) || $auth['access_token'] === '') {
            throw new RuntimeException('Daraja OAuth token missing.');
        }

        return $auth['access_token'];
    }

    public function query(string $checkoutRequestId): array
    {
        return $this->request('/mpesa/stkpushquery/v1/query', ['CheckoutRequestID' => $checkoutRequestId]);
    }

    /**
     * Asks Safaricom for the authoritative status of a received transaction (Transaction Status API).
     * The answer is posted to the result URL and is only accepted when it carries both correlation IDs
     * from this authenticated request.
     *
     * @return array{OriginatorConversationID?: string, ConversationID?: string, ResponseCode?: string}
     */
    public function transactionStatus(string $transactionId, string $originatorConversationId): array
    {
        $settings = $this->settings();
        foreach (['initiator_name', 'security_credential', 'result_url', 'timeout_url'] as $key) {
            if (empty($settings[$key])) {
                throw new RuntimeException('Daraja transaction status configuration is incomplete.');
            }
        }
        foreach (['result_url', 'timeout_url'] as $key) {
            if (parse_url((string) $settings[$key], PHP_URL_SCHEME) !== 'https') {
                throw new RuntimeException('Daraja result URLs must be public HTTPS URLs.');
            }
        }

        return $this->post('/mpesa/transactionstatus/v1/query', [
            'Initiator' => $settings['initiator_name'], 'SecurityCredential' => $settings['security_credential'],
            'CommandID' => 'TransactionStatusQuery', 'TransactionID' => $transactionId,
            'OriginatorConversationID' => $originatorConversationId,
            'PartyA' => (string) $settings['shortcode'], 'IdentifierType' => '4',
            'ResultURL' => $settings['result_url'], 'QueueTimeOutURL' => $settings['timeout_url'],
            'Remarks' => 'Subscription payment check', 'Occasion' => 'Subscription',
        ]);
    }

    /**
     * Pull Transactions API: a synchronous, authenticated list of C2B transactions received by the shortcode.
     *
     * @return array<int, array<string, mixed>>
     */
    public function pullTransactions(\DateTimeInterface $from, \DateTimeInterface $to, int $offset = 0): array
    {
        $settings = $this->settings();
        $response = $this->post('/pulltransactions/v1/query', [
            'ShortCode' => (string) $settings['shortcode'],
            'StartDate' => \Illuminate\Support\Carbon::instance(\DateTime::createFromInterface($from))->setTimezone('Africa/Nairobi')->format('Y-m-d H:i:s'),
            'EndDate' => \Illuminate\Support\Carbon::instance(\DateTime::createFromInterface($to))->setTimezone('Africa/Nairobi')->format('Y-m-d H:i:s'),
            'OffSetValue' => (string) $offset,
        ]);
        $rows = $response['Response'] ?? [];
        // The API wraps the list in another array on some versions.
        if (isset($rows[0]) && is_array($rows[0]) && isset($rows[0][0]) && is_array($rows[0][0])) {
            $rows = $rows[0];
        }

        return array_values(array_filter(is_array($rows) ? $rows : [], 'is_array'));
    }

    /** Registers the Paybill confirmation/validation URLs so Safaricom posts C2B payments to this platform. */
    public function registerC2bUrls(string $confirmationUrl, string $validationUrl): array
    {
        $settings = $this->settings();

        return $this->post('/mpesa/c2b/v2/registerurl', [
            'ShortCode' => (string) $settings['shortcode'], 'ResponseType' => 'Completed',
            'ConfirmationURL' => $confirmationUrl, 'ValidationURL' => $validationUrl,
        ]);
    }

    /** An authenticated JSON POST without the STK password block. */
    private function post(string $path, array $payload): array
    {
        $settings = $this->settings();
        $base = $settings['environment'] === 'production' ? 'https://api.safaricom.co.ke' : 'https://sandbox.safaricom.co.ke';
        $response = Http::acceptJson()->timeout(25)->withToken($this->authenticate())->post($base.$path, $payload)->throw()->json();
        if (! is_array($response)) {
            throw new RuntimeException('Invalid Daraja response.');
        }

        return $response;
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
