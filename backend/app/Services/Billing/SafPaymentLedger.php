<?php

namespace App\Services\Billing;

use App\Services\PlatformPaymentSettlementService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Writes M-Pesa transactions into saf_payments. Recording a row never credits anything: a row starts
 * as "pending" and only SafPaymentVerifier (Safaricom's own answer) or an operator attestation can move
 * it to "verified". Only server code writes here; there is no customer-facing write endpoint.
 */
class SafPaymentLedger
{
    /** Provider fields worth keeping. Names, raw MSISDN hashes and credentials are never stored. */
    private const PAYLOAD_KEYS = [
        'TransactionType', 'TransID', 'TransTime', 'TransAmount', 'BusinessShortCode', 'BillRefNumber', 'OrgAccountBalance',
        'MerchantRequestID', 'CheckoutRequestID', 'ResultCode', 'ResultDesc', 'MpesaReceiptNumber', 'Amount', 'TransactionDate',
        'ResponseCode', 'ResponseDescription', 'ReceiptNo', 'TransactionStatus', 'FinalisedTime', 'ConversationID', 'OriginatorConversationID',
        'ResultType', 'ReasonType', 'transactionId', 'trxDate', 'transactiontype', 'billreference', 'amount',
    ];

    public static function minimize(array $payload): array
    {
        $clean = [];
        foreach ($payload as $key => $value) {
            if (is_array($value)) {
                $nested = self::minimize($value);
                if ($nested) $clean[$key] = $nested;
            } elseif (in_array($key, self::PAYLOAD_KEYS, true) && (is_scalar($value) || $value === null)) {
                $clean[$key] = is_string($value) ? mb_substr($value, 0, 120) : $value;
            }
        }

        return $clean;
    }

    public static function phone(mixed $value): ?string
    {
        $digits = preg_replace('/\D/', '', (string) $value);

        return preg_match('/^254[17][0-9]{8}$/', $digits) ? $digits : null;
    }

    /** Paybill (C2B) confirmation from Safaricom. Returns the ledger row id. */
    public function recordC2b(array $data, string $environment): int
    {
        $receipt = strtoupper((string) $data['TransID']);
        $existing = DB::table('saf_payments')->where('environment', $environment)->where(fn ($q) => $q
            ->where('mpesa_receipt_number', $receipt)->orWhere(fn ($w) => $w->where('payment_channel', 'paybill')->where('provider_transaction_id', $receipt)))->first();
        if ($existing) {
            return (int) $existing->id; // Duplicate callback.
        }
        DB::table('saf_payments')->insertOrIgnore([
            'account_number' => mb_substr(trim((string) $data['BillRefNumber']), 0, 20),
            'mpesa_receipt_number' => $receipt,
            'phone_number' => self::phone($data['MSISDN'] ?? null),
            'amount' => round((float) $data['TransAmount'], 2),
            'transaction_date' => $this->mpesaTime($data['TransTime'] ?? null) ?? now(),
            'shortcode' => (string) $data['BusinessShortCode'],
            'payment_channel' => 'paybill', 'environment' => $environment,
            'verification_status' => 'pending', 'provider_transaction_id' => $receipt,
            'provider_payload' => json_encode(['c2b_confirmation' => self::minimize($data)]),
            'next_verification_at' => now(),
            'created_at' => now(), 'updated_at' => now(),
        ]);

        return (int) DB::table('saf_payments')->where('environment', $environment)->where('mpesa_receipt_number', $receipt)->value('id');
    }

    /**
     * One ledger row per STK request that reports success (from its callback or our own query).
     * The amount and account always come from our own request, never from the callback.
     */
    public function recordStk(object $attempt, ?array $callback = null): int
    {
        $existing = DB::table('saf_payments')->where('stk_attempt_id', $attempt->id)->first();
        $receipt = null;
        $phone = null;
        $date = null;
        if ($callback && (string) ($callback['ResultCode'] ?? '') === '0') {
            foreach ($callback['CallbackMetadata']['Item'] ?? [] as $item) {
                $name = $item['Name'] ?? null;
                $value = $item['Value'] ?? null;
                if ($name === 'MpesaReceiptNumber' && is_string($value) && preg_match('/^[A-Z0-9]{6,30}$/', $value)) $receipt = $value;
                if ($name === 'PhoneNumber') $phone = self::phone($value);
                if ($name === 'TransactionDate') $date = $this->mpesaTime($value);
            }
        }
        if ($receipt && DB::table('saf_payments')->where('environment', $attempt->environment)->where('mpesa_receipt_number', $receipt)
            ->when($existing, fn ($q) => $q->where('id', '!=', $existing->id))->exists()) {
            $receipt = null; // A receipt claimed by another transaction is never trusted from a callback.
        }
        if ($existing) {
            $updates = array_filter([
                'mpesa_receipt_number' => $existing->mpesa_receipt_number ?? $receipt,
                'phone_number' => $existing->phone_number ?? $phone,
                'transaction_date' => $existing->transaction_date ?? $date,
            ]);
            if ($callback) {
                $payload = json_decode($existing->provider_payload ?? '{}', true) ?: [];
                $payload['stk_callback'] = self::minimize($callback);
                $updates['provider_payload'] = json_encode($payload);
            }
            if ($updates) DB::table('saf_payments')->where('id', $existing->id)->update([...$updates, 'updated_at' => now()]);

            return (int) $existing->id;
        }
        $invoice = DB::table('platform_billing_invoices')->where('id', $attempt->platform_billing_invoice_id)->first();
        DB::table('saf_payments')->insertOrIgnore([
            'bookshop_id' => $invoice?->bookshop_id,
            'stk_attempt_id' => $attempt->id,
            'account_number' => $invoice?->account_number,
            'mpesa_receipt_number' => $receipt,
            'phone_number' => $phone ?? self::phone($attempt->phone),
            'amount' => round((float) $attempt->amount, 2),
            'transaction_date' => $date ?? now(),
            'shortcode' => PlatformPaymentSettlementService::expectedShortcode((string) $attempt->environment),
            'payment_channel' => 'stk', 'environment' => $attempt->environment,
            'verification_status' => 'pending', 'provider_transaction_id' => $attempt->checkout_request_id,
            'provider_payload' => json_encode($callback ? ['stk_callback' => self::minimize($callback)] : []),
            'next_verification_at' => now(),
            'created_at' => now(), 'updated_at' => now(),
        ]);

        return (int) DB::table('saf_payments')->where('stk_attempt_id', $attempt->id)->value('id');
    }

    /** Ledger entry for a payment an operator attested from the merchant statement (exception path). */
    public function recordAttested(array $credit, array $values): int
    {
        $invoice = $credit['invoice'];
        $existing = DB::table('saf_payments')->where('environment', $values['environment'])->where('mpesa_receipt_number', $values['receipt'])->first()
            ?? (! empty($values['stk_attempt_id']) ? DB::table('saf_payments')->where('stk_attempt_id', $values['stk_attempt_id'])->first() : null);
        $row = [
            'bookshop_id' => $invoice->bookshop_id, 'invoice_id' => $invoice->id,
            'account_number' => $values['account'], 'mpesa_receipt_number' => $values['receipt'],
            'amount' => $values['amount'], 'transaction_date' => Carbon::instance(\DateTime::createFromInterface($values['paid_at'])),
            'shortcode' => $values['shortcode'], 'payment_channel' => $values['channel'], 'environment' => $values['environment'],
            'verification_status' => 'reconciled', 'verification_source' => 'statement_attestation',
            'verification_reference' => mb_substr($values['statement_reference'], 0, 255), 'verified_at' => now(),
            'resolved_by' => $values['verified_by'], 'reconciled_at' => now(), 'updated_at' => now(),
        ];
        if ($existing) {
            if ($existing->verification_status !== 'reconciled') {
                DB::table('saf_payments')->where('id', $existing->id)->update([
                    ...$row, 'platform_billing_payment_id' => $existing->platform_billing_payment_id ?? $credit['payment_id'],
                    'allocated_amount' => $credit['duplicate'] ? $existing->allocated_amount : $credit['allocated'],
                    'excess_amount' => $credit['duplicate'] ? $existing->excess_amount : $credit['excess'],
                    'exception_reason' => null, 'next_verification_at' => null,
                ]);
            }

            return (int) $existing->id;
        }
        $linked = $credit['payment_id'] ? DB::table('saf_payments')->where('platform_billing_payment_id', $credit['payment_id'])->value('id') : null;
        if ($linked) {
            return (int) $linked;
        }

        return (int) DB::table('saf_payments')->insertGetId([
            ...$row, 'platform_billing_payment_id' => $credit['payment_id'], 'stk_attempt_id' => $values['stk_attempt_id'],
            'allocated_amount' => $credit['allocated'], 'excess_amount' => $credit['excess'],
            'provider_transaction_id' => $values['receipt'], 'provider_payload' => json_encode(['statement_reference' => $values['statement_reference']]),
            'created_at' => now(),
        ]);
    }

    /** M-Pesa sends times as YYYYMMDDHHMMSS in Nairobi time. */
    public function mpesaTime(mixed $value): ?Carbon
    {
        $value = (string) $value;
        if (! preg_match('/^\d{14}$/', $value)) return null;
        try {
            return Carbon::createFromFormat('YmdHis', $value, 'Africa/Nairobi')->setTimezone(config('app.timezone'));
        } catch (\Throwable) {
            return null;
        }
    }
}
