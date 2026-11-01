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

    /** The confirmation code in the customer's M-Pesa SMS, e.g. TJ4K8L2M9P. */
    public const CODE_PATTERN = '/^[A-Z0-9]{10}$/';

    public static function normalizeCode(mixed $value): ?string
    {
        $code = strtoupper(preg_replace('/\s+/', '', (string) $value));

        return preg_match(self::CODE_PATTERN, $code) ? $code : null;
    }

    public static function minimize(array $payload): array
    {
        $clean = [];
        foreach ($payload as $key => $value) {
            // STK callback metadata is a list of {Name, Value}: keep the payment facts (code, amount, date), never the phone.
            if (is_array($value) && array_key_exists('Name', $value) && in_array($value['Name'], ['MpesaReceiptNumber', 'Amount', 'TransactionDate'], true)) {
                $clean[$key] = ['Name' => $value['Name'], 'Value' => is_scalar($value['Value'] ?? null) ? $value['Value'] : null];
                continue;
            }
            if (is_array($value)) {
                $nested = self::minimize($value);
                if ($nested) $clean[$key] = $nested;
            } elseif (in_array($key, self::PAYLOAD_KEYS, true) && (is_scalar($value) || $value === null)) {
                $clean[$key] = is_string($value) ? mb_substr($value, 0, 120) : $value;
            }
        }

        return $clean;
    }

    /** The M-Pesa code in an STK callback that reports success, or null. */
    public static function receiptFromCallback(mixed $callback): ?string
    {
        if (is_string($callback)) $callback = json_decode($callback, true);
        if (! is_array($callback)) return null;
        $callback = $callback['Body']['stkCallback'] ?? $callback['stk_callback'] ?? $callback;
        if ((string) ($callback['ResultCode'] ?? '') !== '0') return null;
        foreach ($callback['CallbackMetadata']['Item'] ?? [] as $item) {
            if (($item['Name'] ?? null) === 'MpesaReceiptNumber') return self::normalizeCode($item['Value'] ?? null) ?? (preg_match('/^[A-Z0-9]{6,30}$/', (string) ($item['Value'] ?? '')) ? (string) $item['Value'] : null);
        }

        return null;
    }

    /**
     * Finds the M-Pesa code of an STK payment in what Safaricom has already sent us (the callback stored on the
     * STK request or on the ledger row), for rows saved before the code was kept.
     */
    public function recoverStkCode(object $row): ?string
    {
        $payload = json_decode($row->provider_payload ?? '{}', true) ?: [];
        $code = self::receiptFromCallback($payload['stk_callback'] ?? null);
        if (! $code && $row->stk_attempt_id) {
            $attempt = DB::table('platform_billing_payments')->where('id', $row->stk_attempt_id)->first(['callback_payload', 'provider_response', 'mpesa_receipt']);
            $code = $attempt?->mpesa_receipt ?: self::receiptFromCallback($attempt?->callback_payload) ?: self::receiptFromCallback($attempt?->provider_response);
        }

        return $code;
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
            $this->mergeNotificationIntoClaim($existing, $data);

            return (int) $existing->id; // Duplicate callback, or a code a customer already gave us.
        }
        // The same money paid by STK push and already recorded without its code: the code completes that row.
        $stk = $this->stkRowForSameMoney($environment, SafPaymentReconciler::normalizeAccount((string) $data['BillRefNumber']), round((float) $data['TransAmount'], 2), $this->mpesaTime($data['TransTime'] ?? null) ?? now());
        if ($stk) {
            $this->attachReceipt((int) $stk->id, $receipt);
            $payload = json_decode($stk->provider_payload ?? '{}', true) ?: [];
            DB::table('saf_payments')->where('id', $stk->id)->update(['provider_payload' => json_encode([...$payload, 'c2b_confirmation' => self::minimize($data)]), 'updated_at' => now()]);

            return (int) $stk->id;
        }
        DB::table('saf_payments')->insertOrIgnore([
            'account_number' => mb_substr(SafPaymentReconciler::normalizeAccount((string) $data['BillRefNumber']), 0, 20),
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
        if ($receipt) {
            $owner = DB::table('saf_payments')->where('environment', $attempt->environment)->where('mpesa_receipt_number', $receipt)
                ->when($existing, fn ($q) => $q->where('id', '!=', $existing->id))->first();
            if ($owner) {
                $merged = $this->mergeStkIntoReceiptRow($owner, $existing, $attempt, $callback);
                if ($merged !== null) return $merged;
                $receipt = null; // Belongs to a different payment; never trusted from a callback.
            }
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
            $receiptUpdate = $updates['mpesa_receipt_number'] ?? null;
            unset($updates['mpesa_receipt_number']);
            if ($existing->verification_status === 'rejected' && $callback && (string) ($callback['ResultCode'] ?? '') === '0') {
                // Safaricom reports success after an earlier "failed/timed out" answer: check again before anything else.
                $updates += ['verification_status' => 'pending', 'next_verification_at' => now(), 'verification_attempts' => 0,
                    'exception_reason' => 'Safaricom sent a success notification after an earlier failure; checking again.'];
                DB::table('platform_billing_payments')->where('id', $attempt->id)->whereIn('status', ['failed', 'cancelled', 'timed_out'])
                    ->update(['status' => 'awaiting_verification', 'updated_at' => now()]);
            }
            if ($updates) DB::table('saf_payments')->where('id', $existing->id)->update([...$updates, 'updated_at' => now()]);
            if ($receiptUpdate && ! $existing->mpesa_receipt_number) $this->attachReceipt((int) $existing->id, $receiptUpdate);

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

    /**
     * A payment identified only by its M-Pesa confirmation code (typed by a customer from their SMS, or by an
     * operator). It stays pending until Safaricom confirms the code; the amount comes from Safaricom, never the claimant.
     */
    public function recordClaim(string $code, string $environment, ?string $account, string $source, int $userId, ?int $invoiceId = null, ?string $note = null): int
    {
        $existing = DB::table('saf_payments')->where('environment', $environment)->where(fn ($q) => $q
            ->where('mpesa_receipt_number', $code)->orWhere(fn ($w) => $w->where('payment_channel', 'paybill')->where('provider_transaction_id', $code)))->first();
        if ($existing) return (int) $existing->id;
        DB::table('saf_payments')->insertOrIgnore([
            'account_number' => $account, 'mpesa_receipt_number' => $code, 'amount' => 0,
            'shortcode' => PlatformPaymentSettlementService::expectedShortcode($environment),
            'payment_channel' => 'paybill', 'environment' => $environment, 'verification_status' => 'pending',
            'provider_transaction_id' => $code, 'next_verification_at' => now(),
            'provider_payload' => json_encode(['claim' => array_filter(['source' => $source, 'user_id' => $userId, 'invoice_id' => $invoiceId,
                'account' => $account, 'note' => $note ? mb_substr($note, 0, 500) : null, 'at' => now()->toIso8601String()], fn ($v) => $v !== null)]),
            'created_at' => now(), 'updated_at' => now(),
        ]);

        return (int) DB::table('saf_payments')->where('environment', $environment)->where('mpesa_receipt_number', $code)->value('id');
    }

    /**
     * Records the confirmation code on a payment that did not have it yet (e.g. an STK payment whose
     * callback arrived late) and on the credited invoice payment, so both histories show the real code.
     */
    public function attachReceipt(int $safPaymentId, string $receipt): bool
    {
        $row = DB::table('saf_payments')->where('id', $safPaymentId)->first();
        if (! $row || $row->mpesa_receipt_number) return false;
        if (DB::table('saf_payments')->where('environment', $row->environment)->where('mpesa_receipt_number', $receipt)->exists()) return false;
        DB::table('saf_payments')->where('id', $safPaymentId)->whereNull('mpesa_receipt_number')->update(['mpesa_receipt_number' => $receipt, 'updated_at' => now()]);
        if ($row->platform_billing_payment_id && ! DB::table('platform_billing_payments')->where('mpesa_receipt', $receipt)->exists()) {
            DB::table('platform_billing_payments')->where('id', $row->platform_billing_payment_id)->whereNull('mpesa_receipt')->update(['mpesa_receipt' => $receipt, 'updated_at' => now()]);
        }

        return true;
    }

    public function findByReceipt(string $environment, string $receipt): ?object
    {
        return DB::table('saf_payments')->where('environment', $environment)->where('mpesa_receipt_number', strtoupper($receipt))->first();
    }

    /** An STK payment still without its code, for the same account and amount, close in time. */
    private function stkRowForSameMoney(string $environment, string $account, float $amount, Carbon $at): ?object
    {
        return DB::table('saf_payments')->where('environment', $environment)->where('payment_channel', 'stk')->whereNull('mpesa_receipt_number')
            ->where('account_number', $account)->where('amount', $amount)->where('verification_status', '!=', 'rejected')
            ->whereBetween(DB::raw('COALESCE(transaction_date, created_at)'), [$at->copy()->subHours(2), $at->copy()->addHours(2)])
            ->get()->sortBy(fn ($row) => abs(Carbon::parse($row->transaction_date ?? $row->created_at)->diffInSeconds($at, false)))->first();
    }

    /**
     * The STK callback's code is already on a Paybill row (Safaricom sent both notifications for one payment).
     * Keep one row per code: link the STK request to that row, and retire any separate STK row that has not
     * been applied. Returns the surviving row id, or null when the code belongs to a different payment.
     */
    private function mergeStkIntoReceiptRow(object $owner, ?object $stkRow, object $attempt, ?array $callback): ?int
    {
        $account = DB::table('platform_billing_invoices')->where('id', $attempt->platform_billing_invoice_id)->value('account_number');
        $same = $owner->payment_channel === 'paybill' && (! $owner->stk_attempt_id || (int) $owner->stk_attempt_id === (int) $attempt->id)
            && ((float) $owner->amount <= 0 || abs((float) $owner->amount - (float) $attempt->amount) < 0.005)
            && (! $owner->account_number || $owner->account_number === $account);
        if (! $same) return null;

        $payload = json_decode($owner->provider_payload ?? '{}', true) ?: [];
        if ($callback) $payload['stk_callback'] = self::minimize($callback);
        if ($stkRow && $stkRow->verification_status === 'reconciled' && $owner->verification_status !== 'reconciled') {
            // The STK row already credited the invoice: it keeps the money, takes the code, and the Paybill row is retired.
            DB::table('saf_payments')->where('id', $owner->id)->update([
                'mpesa_receipt_number' => null, 'verification_status' => 'rejected', 'next_verification_at' => null,
                'exception_reason' => 'Same M-Pesa payment as #'.$stkRow->id.' (already applied).', 'updated_at' => now(),
            ]);
            $this->attachReceipt((int) $stkRow->id, (string) $owner->mpesa_receipt_number);

            return (int) $stkRow->id;
        }
        DB::table('saf_payments')->where('id', $owner->id)->update([
            'stk_attempt_id' => $attempt->id, 'account_number' => $owner->account_number ?? $account,
            'amount' => (float) $owner->amount > 0 ? $owner->amount : round((float) $attempt->amount, 2),
            'phone_number' => $owner->phone_number ?? self::phone($attempt->phone), 'provider_payload' => json_encode($payload), 'updated_at' => now(),
        ]);
        if ($stkRow && $stkRow->verification_status !== 'reconciled') {
            DB::table('saf_payments')->where('id', $stkRow->id)->update([
                'verification_status' => 'rejected', 'next_verification_at' => null,
                'exception_reason' => 'Same M-Pesa payment as '.$owner->mpesa_receipt_number.' (#'.$owner->id.').', 'updated_at' => now(),
            ]);
        } elseif ($stkRow) {
            \App\Models\AuditLog::record('billing.payment_duplicate_review', 'Two ledger rows applied for one M-Pesa code; review', null,
                ['saf_payment_id' => $owner->id, 'other_saf_payment_id' => $stkRow->id, 'receipt' => $owner->mpesa_receipt_number]);
        }

        return (int) $owner->id;
    }

    /** A Safaricom notification for a code someone already gave us supplies the account number and amount. */
    private function mergeNotificationIntoClaim(object $existing, array $data): void
    {
        $payload = json_decode($existing->provider_payload ?? '{}', true) ?: [];
        if (! isset($payload['claim']) || isset($payload['c2b_confirmation']) || $existing->verification_status === 'reconciled') return;
        $payload['c2b_confirmation'] = self::minimize($data);
        $notified = round((float) $data['TransAmount'], 2);
        DB::table('saf_payments')->where('id', $existing->id)->update([
            'account_number' => mb_substr(SafPaymentReconciler::normalizeAccount((string) $data['BillRefNumber']), 0, 20),
            'phone_number' => $existing->phone_number ?? self::phone($data['MSISDN'] ?? null),
            'amount' => (float) $existing->amount > 0 ? $existing->amount : $notified,
            'transaction_date' => $this->mpesaTime($data['TransTime'] ?? null) ?? $existing->transaction_date,
            'provider_payload' => json_encode($payload), 'updated_at' => now(),
            // Already confirmed by Safaricom and only waiting for the account: allocate it now.
            ...($existing->verification_status === 'unmatched' && $existing->verified_at && abs((float) $existing->amount - $notified) < 0.005
                ? ['verification_status' => 'verified', 'exception_reason' => null] : []),
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
