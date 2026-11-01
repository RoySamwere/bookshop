<?php

namespace App\Services\Billing;

use App\Services\DarajaStkService;
use App\Services\PlatformPaymentSettlementService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * Independently verifies pending saf_payments with Safaricom before anything is credited.
 *
 *  STK push  : our authenticated STK Query for our own CheckoutRequestID must return ResultCode 0.
 *              The amount, Paybill and account are the ones we sent in the request, which the payer
 *              cannot change; the callback's figures are ignored.
 *  Paybill   : "transaction_status" - our authenticated Transaction Status request; Safaricom's result is
 *              accepted only when it carries both correlation IDs from that request (and, when configured,
 *              comes from an allow-listed Safaricom IP), and its receipt, amount, Paybill and "Completed"
 *              status match the transaction.
 *              "pull_api" - the authenticated, synchronous Pull Transactions list must contain the receipt
 *              with the same amount and account.
 *
 * A callback on its own never verifies anything. Rows that cannot be verified after several attempts move
 * to the exception queue.
 */
class SafPaymentVerifier
{
    public const MAX_ATTEMPTS = 10;
    private const STK_FAILURES = ['1' => 'failed', '1032' => 'cancelled', '1037' => 'timed_out', '2001' => 'failed', '1025' => 'failed', '1019' => 'timed_out'];

    public function __construct(private readonly DarajaStkService $daraja, private readonly SafPaymentReconciler $reconciler) {}

    /** Verifies (when due) and then allocates one row. Returns the resulting status. */
    public function handle(int $id): string
    {
        $row = DB::table('saf_payments')->where('id', $id)->first();
        if (! $row) return 'missing';
        if ($row->verification_status === 'pending') {
            $this->verify($row);
            $row = DB::table('saf_payments')->where('id', $id)->first();
        }

        if ($row->verification_status === 'verified') {
            $this->afterVerified($id);

            return (string) DB::table('saf_payments')->where('id', $id)->value('verification_status');
        }

        return $row->verification_status;
    }

    private function verify(object $row): void
    {
        $environment = (string) config('services.mpesa.environment');
        if (! in_array($row->environment, ['sandbox', 'production'], true)) {
            $this->reconciler->exception($row->id, 'Legacy record without payment provenance. Review it manually.');

            return;
        }
        if ($row->environment !== $environment) {
            return; // Belongs to the other payment environment; this installation cannot verify it.
        }
        if ((string) $row->shortcode !== PlatformPaymentSettlementService::expectedShortcode($row->environment)) {
            $this->reconciler->exception($row->id, 'Payment was sent to shortcode '.$row->shortcode.', not the platform Paybill.');

            return;
        }
        // Anything linked to our own STK request can be confirmed with the STK query, even if it arrived as Paybill.
        if ($row->payment_channel === 'stk' || $row->stk_attempt_id) {
            $this->verifyStk($row);
        } else {
            $this->verifyPaybill($row);
        }
    }

    private function verifyStk(object $row): void
    {
        $attempt = $row->stk_attempt_id ? DB::table('platform_billing_payments')->where('id', $row->stk_attempt_id)->first() : null;
        if (! $attempt || ! $attempt->checkout_request_id) {
            $this->reconciler->exception($row->id, 'STK payment without a checkout request to verify.');

            return;
        }
        try {
            $result = $this->daraja->query($attempt->checkout_request_id);
        } catch (Throwable) {
            $this->retry($row, 'Safaricom verification unavailable; will retry.');

            return;
        }
        DB::table('platform_billing_payments')->where('id', $attempt->id)->update(['query_response' => json_encode(SafPaymentLedger::minimize($result)), 'queried_at' => now()]);
        if ((string) ($result['ResponseCode'] ?? '') !== '0' || (isset($result['CheckoutRequestID']) && $result['CheckoutRequestID'] !== $attempt->checkout_request_id)) {
            $this->retry($row, 'Safaricom has not confirmed this checkout yet.');

            return;
        }
        $code = (string) ($result['ResultCode'] ?? '');
        if ($code === '0') {
            $this->markVerified($row, 'daraja_stk_query', $attempt->checkout_request_id, ['stk_query' => SafPaymentLedger::minimize($result)]);
            DB::table('platform_billing_payments')->where('id', $attempt->id)->whereIn('status', ['pending', 'awaiting_verification'])
                ->update(['status' => 'awaiting_verification', 'updated_at' => now()]);
            // STK Query confirms the money but not the SMS confirmation code; the callback or Safaricom's list supplies it.
            if (! $row->mpesa_receipt_number) $this->lookupStkReceipt((int) $row->id);

            return;
        }
        if (isset(self::STK_FAILURES[$code])) {
            DB::transaction(function () use ($row, $attempt, $code, $result) {
                DB::table('platform_billing_payments')->where('id', $attempt->id)->whereIn('status', ['pending', 'awaiting_verification'])
                    ->update(['status' => self::STK_FAILURES[$code], 'updated_at' => now()]);
                DB::table('saf_payments')->where('id', $row->id)->where('verification_status', 'pending')->update([
                    'verification_status' => 'rejected', 'verification_source' => 'daraja_stk_query',
                    'exception_reason' => mb_substr('Safaricom reports the payment did not complete: '.($result['ResultDesc'] ?? $code), 0, 255),
                    'next_verification_at' => null, 'updated_at' => now(),
                ]);
            });

            return;
        }
        $this->retry($row, 'Safaricom returned an inconclusive result.');
    }

    private function verifyPaybill(object $row): void
    {
        $mode = (string) config('services.mpesa.c2b_verification');
        if ($mode === 'pull_api') {
            $this->verifyWithPull($row);

            return;
        }
        if ($mode !== 'transaction_status') {
            DB::table('saf_payments')->where('id', $row->id)->update([
                'exception_reason' => 'Automatic Paybill verification is not configured. Verify against the merchant statement.',
                'next_verification_at' => null, 'updated_at' => now(),
            ]);

            return;
        }
        // One outstanding Transaction Status request at a time; re-ask if no result arrived in 10 minutes.
        if ($row->verification_request_id && $row->next_verification_at && Carbon::parse($row->next_verification_at)->isFuture()) {
            return;
        }
        if ((int) $row->verification_attempts >= self::MAX_ATTEMPTS) {
            $this->reconciler->exception($row->id, 'Safaricom did not confirm this transaction after '.self::MAX_ATTEMPTS.' checks.');

            return;
        }
        $originator = (string) Str::uuid();
        try {
            $response = $this->daraja->transactionStatus((string) $row->mpesa_receipt_number, $originator);
        } catch (Throwable) {
            $this->retry($row, 'Safaricom verification unavailable; will retry.');

            return;
        }
        if ((string) ($response['ResponseCode'] ?? '') !== '0' || empty($response['ConversationID'])) {
            $this->retry($row, 'Safaricom did not accept the verification request.');

            return;
        }
        DB::table('saf_payments')->where('id', $row->id)->where('verification_status', 'pending')->update([
            'verification_request_id' => $response['OriginatorConversationID'] ?? $originator,
            'verification_conversation_id' => mb_substr((string) $response['ConversationID'], 0, 100),
            'verification_attempts' => (int) $row->verification_attempts + 1,
            'next_verification_at' => now()->addMinutes(10), 'exception_reason' => null, 'updated_at' => now(),
        ]);
    }

    /**
     * Safaricom's Transaction Status result. Accepted only for a request we made (both correlation IDs),
     * from an allow-listed IP when one is configured, and only if every value matches.
     */
    public function applyTransactionStatusResult(array $result, ?string $ip): ?int
    {
        $allowed = (array) config('services.mpesa.callback_ips');
        if ($allowed && ! in_array($ip, $allowed, true)) return null;
        $originator = $result['OriginatorConversationID'] ?? null;
        $conversation = $result['ConversationID'] ?? null;
        if (! is_string($originator) || ! is_string($conversation) || $originator === '' || $conversation === '') return null;
        $row = DB::table('saf_payments')->where('verification_request_id', $originator)->where('verification_conversation_id', $conversation)
            ->where('verification_status', 'pending')->first();
        if (! $row) return null;

        $parameters = [];
        foreach (($result['ResultParameters']['ResultParameter'] ?? []) as $parameter) {
            if (is_array($parameter) && isset($parameter['Key'])) $parameters[$parameter['Key']] = $parameter['Value'] ?? null;
        }
        $evidence = ['transaction_status' => SafPaymentLedger::minimize([...$result, ...$parameters, 'ResultParameters' => null])];
        if ((string) ($result['ResultCode'] ?? '') !== '0') {
            $this->reconciler->exception($row->id, mb_substr('Safaricom could not confirm the transaction: '.($result['ResultDesc'] ?? 'unknown result'), 0, 255));

            return (int) $row->id;
        }
        $shortcode = PlatformPaymentSettlementService::expectedShortcode($row->environment);
        // A code typed in by a customer or operator has no amount of its own: Safaricom's amount is the amount.
        $claimOnly = (float) $row->amount <= 0 && $this->claim($row) !== null;
        $mismatch = match (true) {
            strtoupper((string) ($parameters['ReceiptNo'] ?? '')) !== (string) $row->mpesa_receipt_number => 'receipt',
            strcasecmp((string) ($parameters['TransactionStatus'] ?? ''), 'Completed') !== 0 => 'status',
            ! $claimOnly && abs((float) ($parameters['Amount'] ?? -1) - (float) $row->amount) > 0.005 => 'amount',
            $claimOnly && (float) ($parameters['Amount'] ?? 0) <= 0 => 'amount',
            ! str_starts_with(trim((string) ($parameters['CreditPartyName'] ?? '')), $shortcode) => 'paybill',
            default => null,
        };
        if ($mismatch) {
            $this->appendEvidence($row, $evidence);
            $this->reconciler->exception($row->id, "Safaricom's record does not match the notification ({$mismatch}). Investigate before crediting.");

            return (int) $row->id;
        }
        $finalised = app(SafPaymentLedger::class)->mpesaTime($parameters['FinalisedTime'] ?? null);
        if ($claimOnly) {
            DB::table('saf_payments')->where('id', $row->id)->update(['amount' => round((float) $parameters['Amount'], 2)]);
        }
        $this->markVerified($row, 'daraja_transaction_status', $conversation, $evidence, $finalised);
        $this->afterVerified((int) $row->id);

        return (int) $row->id;
    }

    private function verifyWithPull(object $row): void
    {
        $date = $row->transaction_date ? Carbon::parse($row->transaction_date) : Carbon::parse($row->created_at);
        try {
            $transactions = $this->daraja->pullTransactions($date->copy()->subMinutes(30), $date->copy()->addMinutes(30));
        } catch (Throwable) {
            $this->retry($row, 'Safaricom Pull API unavailable; will retry.');

            return;
        }
        $match = collect($transactions)->first(fn ($t) => strtoupper((string) ($t['transactionId'] ?? '')) === (string) $row->mpesa_receipt_number);
        if (! $match) {
            $this->retry($row, 'Transaction not yet listed by Safaricom.');

            return;
        }
        $claimOnly = (float) $row->amount <= 0 && $this->claim($row) !== null;
        if ((! $claimOnly && abs((float) ($match['amount'] ?? -1) - (float) $row->amount) > 0.005) || trim((string) ($match['billreference'] ?? '')) !== (string) $row->account_number) {
            $this->reconciler->exception($row->id, "Safaricom's record does not match (amount or account number). Investigate before crediting.");

            return;
        }
        if ($claimOnly) {
            DB::table('saf_payments')->where('id', $row->id)->update(['amount' => round((float) $match['amount'], 2)]);
        }
        // Safaricom's own record carries the account number, so a claimed code is fully confirmed here.
        $this->markVerified($row, 'daraja_pull_api', (string) $match['transactionId'], ['pull_api' => SafPaymentLedger::minimize($match), 'account_confirmed_by' => 'safaricom']);
    }

    /**
     * Allocates a newly verified payment, except a code a customer typed in when Safaricom has not told us which
     * account it was paid to: that goes to the exception queue so the platform team confirms the invoice.
     */
    private function afterVerified(int $id): void
    {
        $row = DB::table('saf_payments')->where('id', $id)->first();
        $claim = $this->claim($row);
        $payload = json_decode($row->provider_payload ?? '{}', true) ?: [];
        if ($claim && ($claim['source'] ?? null) === 'customer' && ! isset($payload['c2b_confirmation']) && ($payload['account_confirmed_by'] ?? null) !== 'safaricom') {
            $shop = isset($claim['invoice_id']) ? DB::table('platform_billing_invoices as i')->join('bookshops as b', 'b.id', '=', 'i.bookshop_id')->where('i.id', $claim['invoice_id'])->value('b.name') : null;
            $this->reconciler->exception($id, mb_substr('Confirmed by Safaricom. '.($shop ?? 'A bookshop').' says this payment is for invoice account '.($claim['account'] ?? '?').'; check and assign it.', 0, 255));

            return;
        }
        $this->reconciler->process($id);
    }

    private function claim(?object $row): ?array
    {
        $payload = json_decode($row?->provider_payload ?? '{}', true) ?: [];

        return is_array($payload['claim'] ?? null) ? $payload['claim'] : null;
    }

    /**
     * Finds the M-Pesa confirmation code of a verified STK payment in Safaricom's transaction list (Pull API):
     * same account reference and amount, within 30 minutes. Only an unambiguous match is used.
     */
    public function lookupStkReceipt(int $id): ?string
    {
        $row = DB::table('saf_payments')->where('id', $id)->first();
        if (! $row || $row->mpesa_receipt_number || $row->payment_channel !== 'stk' || config('services.mpesa.c2b_verification') !== 'pull_api') return null;
        $date = Carbon::parse($row->transaction_date ?? $row->created_at);
        try {
            $transactions = $this->daraja->pullTransactions($date->copy()->subMinutes(30), $date->copy()->addMinutes(30));
        } catch (Throwable) {
            return null;
        }
        $matches = collect($transactions)->filter(fn ($t) => trim((string) ($t['billreference'] ?? '')) === (string) $row->account_number
            && abs((float) ($t['amount'] ?? -1) - (float) $row->amount) < 0.005 && SafPaymentLedger::normalizeCode($t['transactionId'] ?? null)
            && ! DB::table('saf_payments')->where('environment', $row->environment)->where('mpesa_receipt_number', strtoupper((string) $t['transactionId']))->exists())->values();
        if ($matches->count() !== 1) return null;
        $code = strtoupper((string) $matches[0]['transactionId']);

        return app(SafPaymentLedger::class)->attachReceipt($id, $code) ? $code : null;
    }

    private function markVerified(object $row, string $source, string $reference, array $evidence, ?Carbon $date = null): void
    {
        $payload = json_decode($row->provider_payload ?? '{}', true) ?: [];
        DB::table('saf_payments')->where('id', $row->id)->where('verification_status', 'pending')->update([
            'verification_status' => 'verified', 'verification_source' => $source, 'verification_reference' => mb_substr($reference, 0, 255),
            'verified_at' => now(), 'next_verification_at' => null, 'exception_reason' => null,
            'transaction_date' => $date ?? $row->transaction_date,
            'provider_payload' => json_encode([...$payload, ...$evidence]), 'updated_at' => now(),
        ]);
    }

    private function appendEvidence(object $row, array $evidence): void
    {
        $payload = json_decode($row->provider_payload ?? '{}', true) ?: [];
        DB::table('saf_payments')->where('id', $row->id)->update(['provider_payload' => json_encode([...$payload, ...$evidence])]);
    }

    private function retry(object $row, string $reason): void
    {
        $attempts = (int) $row->verification_attempts + 1;
        if ($attempts >= self::MAX_ATTEMPTS) {
            DB::table('saf_payments')->where('id', $row->id)->update(['verification_attempts' => $attempts]);
            $this->reconciler->exception($row->id, 'Not verified after '.self::MAX_ATTEMPTS.' checks: '.$reason);

            return;
        }
        // 1, 2, 4, 8 ... minutes, capped at an hour.
        DB::table('saf_payments')->where('id', $row->id)->where('verification_status', 'pending')->update([
            'verification_attempts' => $attempts, 'next_verification_at' => now()->addMinutes(min(60, 2 ** ($attempts - 1))),
            'exception_reason' => mb_substr($reason, 0, 255), 'updated_at' => now(),
        ]);
    }
}
