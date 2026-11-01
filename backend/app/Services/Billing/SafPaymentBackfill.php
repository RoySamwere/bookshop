<?php

namespace App\Services\Billing;

use App\Services\PlatformPaymentSettlementService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Copies existing payment history into saf_payments, keeping the original verification outcome.
 * Nothing in the old tables is changed or deleted. Safe to run more than once.
 *
 *  confirmed payments        -> reconciled (credited, statement-attested history)
 *  pending / awaiting STK    -> pending   (still to be verified; production ones are verified automatically)
 *  unknown STK outcome       -> unmatched (needs an operator to check the statement)
 *  failed / cancelled / timed out -> rejected
 *  Paybill (C2B) notifications awaiting verification -> pending
 */
class SafPaymentBackfill
{
    public function run(): array
    {
        if (! Schema::hasTable('platform_billing_payments')) return ['copied' => 0];
        $copied = 0;
        $invoices = DB::table('platform_billing_invoices')->get()->keyBy('id');

        foreach (DB::table('platform_billing_payments')->orderBy('id')->get() as $payment) {
            if (DB::table('saf_payments')->where('platform_billing_payment_id', $payment->id)->orWhere('stk_attempt_id', $payment->id)->exists()) continue;
            $invoice = $invoices[$payment->platform_billing_invoice_id] ?? null;
            $evidence = json_decode($payment->provider_response ?? '{}', true) ?: [];
            $shortcode = in_array($payment->environment, ['production', 'sandbox'], true)
                ? PlatformPaymentSettlementService::expectedShortcode($payment->environment) : null;
            $base = [
                'bookshop_id' => $invoice?->bookshop_id, 'invoice_id' => $invoice?->id, 'account_number' => $invoice?->account_number,
                'phone_number' => SafPaymentLedger::phone($payment->phone), 'amount' => $payment->amount,
                'transaction_date' => $payment->confirmed_at ?? $payment->created_at, 'shortcode' => $shortcode,
                'payment_channel' => $payment->channel === 'stk' ? 'stk' : 'paybill', 'environment' => $payment->environment ?: 'legacy',
                'provider_payload' => json_encode(['migrated_from' => 'platform_billing_payments', 'original_status' => $payment->status]),
                'created_at' => $payment->created_at, 'updated_at' => now(),
            ];
            $row = match ($payment->status) {
                'confirmed' => [
                    'platform_billing_payment_id' => $payment->id, 'mpesa_receipt_number' => $payment->mpesa_receipt,
                    'provider_transaction_id' => $payment->mpesa_receipt ?? 'legacy-payment-'.$payment->id,
                    'allocated_amount' => $payment->amount, 'verification_status' => 'reconciled',
                    'verification_source' => isset($evidence['statement_reference']) ? 'statement_attestation' : 'legacy_record',
                    'verification_reference' => isset($evidence['statement_reference']) ? mb_substr((string) $evidence['statement_reference'], 0, 255) : null,
                    'resolved_by' => isset($evidence['verified_by']) && DB::table('users')->where('id', $evidence['verified_by'])->exists() ? $evidence['verified_by'] : null,
                    'verified_at' => $payment->confirmed_at, 'reconciled_at' => $payment->confirmed_at,
                    // Historical payments were confirmed before this ledger existed; do not re-send confirmations.
                    'confirmation_sent_at' => $payment->confirmed_at ?? $payment->updated_at,
                ],
                'pending', 'awaiting_verification' => $payment->checkout_request_id ? [
                    'stk_attempt_id' => $payment->id, 'provider_transaction_id' => $payment->checkout_request_id,
                    'verification_status' => 'pending', 'next_verification_at' => now(),
                ] : null,
                'unknown' => [
                    'stk_attempt_id' => $payment->id, 'provider_transaction_id' => 'unknown-attempt-'.$payment->id,
                    'verification_status' => 'unmatched', 'exception_reason' => 'STK outcome unknown. Check the merchant statement.',
                ],
                'failed', 'cancelled', 'timed_out' => $payment->checkout_request_id ? [
                    'stk_attempt_id' => $payment->id, 'provider_transaction_id' => $payment->checkout_request_id,
                    'verification_status' => 'rejected', 'exception_reason' => 'Safaricom reported the request as '.str_replace('_', ' ', $payment->status).'.',
                ] : null,
                default => null, // 'reconciled' STK attempts are represented by their confirmed payment row.
            };
            if ($row === null) continue;
            $copied += DB::table('saf_payments')->insertOrIgnore([...$base, ...$row]);
        }

        // Excess recorded for review stays visible on the credited row.
        foreach (DB::table('platform_payment_reconciliation_items')->where('source', 'overpayment')->get() as $item) {
            DB::table('saf_payments')->where('mpesa_receipt_number', $item->provider_transaction_id)->where('environment', $item->environment)
                ->where('excess_amount', 0)->update(['excess_amount' => $item->amount, 'allocated_amount' => DB::raw('amount - '.(float) $item->amount)]);
        }

        // Paybill notifications that were waiting for an operator.
        foreach (DB::table('platform_payment_reconciliation_items')->where('source', 'c2b')->whereIn('status', ['awaiting_verification', 'requires_review'])->get() as $item) {
            $payload = json_decode($item->payload ?? '{}', true) ?: [];
            $copied += DB::table('saf_payments')->insertOrIgnore([
                'account_number' => $item->account_number, 'mpesa_receipt_number' => $item->provider_transaction_id,
                'amount' => $item->amount ?? 0, 'transaction_date' => $item->created_at, 'shortcode' => $item->destination_shortcode,
                'payment_channel' => 'paybill', 'environment' => $item->environment ?: 'legacy',
                'verification_status' => 'pending', 'provider_transaction_id' => $item->provider_transaction_id,
                'provider_payload' => json_encode(['migrated_from' => 'platform_payment_reconciliation_items', 'original_status' => $item->status, 'c2b_confirmation' => SafPaymentLedger::minimize($payload)]),
                'next_verification_at' => now(), 'created_at' => $item->created_at, 'updated_at' => now(),
            ]);
        }

        return ['copied' => $copied];
    }
}
