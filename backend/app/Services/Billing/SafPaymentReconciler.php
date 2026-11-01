<?php

namespace App\Services\Billing;

use App\Models\AuditLog;
use App\Models\User;
use App\Services\PlatformPaymentSettlementService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Allocates verified saf_payments to invoices: matches the account number, checks environment,
 * shortcode and amount, credits the invoice (partial and overpayments included), activates or renews
 * the subscription and notifies the customer. Rows that cannot be matched go to the exception queue
 * (status "unmatched") with a reason. Safe to run twice or concurrently for the same row.
 */
class SafPaymentReconciler
{
    public function __construct(
        private readonly PlatformPaymentSettlementService $settlement,
        private readonly PaymentConfirmationNotifier $notifier,
    ) {}

    /** Returns the row's final status. Only "verified" rows are allocated. */
    public function process(int $id, ?string $accountOverride = null, ?User $actor = null, ?string $note = null): string
    {
        try {
            $status = DB::transaction(function () use ($id, $accountOverride, $actor, $note) {
                $row = DB::table('saf_payments')->where('id', $id)->lockForUpdate()->first();
                if (! $row) return 'missing';
                if ($row->verification_status === 'reconciled' || $row->verification_status === 'rejected' || $row->verification_status === 'pending') {
                    return $row->verification_status;
                }
                // An operator may re-run an unmatched, already-verified row (e.g. after correcting the account).
                if ($row->verification_status === 'unmatched' && ! ($actor && $row->verified_at)) {
                    return 'unmatched';
                }

                $problem = $this->eligibility($row);
                if ($problem) {
                    $this->exception($id, $problem);

                    return 'unmatched';
                }
                $account = $accountOverride ?? self::normalizeAccount((string) $row->account_number);
                if (! preg_match('/^[0-9]{6}$/', $account)) {
                    $this->exception($id, 'The account number is not a six-digit invoice account.');

                    return 'unmatched';
                }
                if ($row->stk_attempt_id) {
                    $attempt = DB::table('platform_billing_payments')->where('id', $row->stk_attempt_id)->lockForUpdate()->first();
                    $attemptInvoice = $attempt ? DB::table('platform_billing_invoices')->where('id', $attempt->platform_billing_invoice_id)->value('account_number') : null;
                    if (! $attempt || ($accountOverride === null && $attemptInvoice !== $account)) {
                        $this->exception($id, 'The STK request does not belong to this invoice.');

                        return 'unmatched';
                    }
                    if ($attempt->status === 'reconciled') {
                        // Already credited through another path (e.g. a statement attestation).
                        DB::table('saf_payments')->where('id', $id)->update(['verification_status' => 'reconciled', 'reconciled_at' => now(), 'updated_at' => now()]);

                        return 'reconciled';
                    }
                }

                $credit = $this->settlement->credit(
                    $row->mpesa_receipt_number, $account, round((float) $row->amount, 2),
                    $row->transaction_date ? Carbon::parse($row->transaction_date) : now(), $row->payment_channel, $row->environment,
                    ['saf_payment_id' => $row->id, 'verification_source' => $row->verification_source, 'verification_reference' => $row->verification_reference, 'environment' => $row->environment],
                    $actor, $actor ? 'billing.payment_allocated_manually' : 'billing.payment_reconciled',
                    $actor ? 'Allocated a provider-verified payment to an invoice after review' : 'Automatically reconciled a provider-verified M-Pesa payment',
                );
                $invoice = $credit['invoice'];
                DB::table('saf_payments')->where('id', $id)->update([
                    'invoice_id' => $invoice->id, 'bookshop_id' => $invoice->bookshop_id, 'account_number' => $account,
                    'platform_billing_payment_id' => $credit['payment_id'],
                    'allocated_amount' => $credit['duplicate'] ? $row->allocated_amount : $credit['allocated'],
                    'excess_amount' => $credit['duplicate'] ? $row->excess_amount : $credit['excess'],
                    'verification_status' => 'reconciled', 'reconciled_at' => now(), 'exception_reason' => null,
                    'resolved_by' => $actor?->id ?? $row->resolved_by, 'resolution_note' => $note ?? $row->resolution_note, 'updated_at' => now(),
                ]);
                if ($row->stk_attempt_id) {
                    DB::table('platform_billing_payments')->where('id', $row->stk_attempt_id)->update(['status' => 'reconciled', 'updated_at' => now()]);
                }
                if ($actor && $accountOverride !== null && $accountOverride !== $row->account_number) {
                    AuditLog::record('billing.payment_account_corrected', 'Allocated a verified payment to a different invoice account', null,
                        ['saf_payment_id' => $id, 'from_account' => $row->account_number, 'to_account' => $accountOverride, 'note' => $note], $actor, $invoice->bookshop_id);
                }

                return 'reconciled';
            }, 3);
        } catch (ValidationException $exception) {
            $this->exception($id, collect($exception->errors())->flatten()->first() ?: 'Payment could not be allocated.');

            return 'unmatched';
        }

        if ($status === 'reconciled') {
            $this->notifier->send($id);
        }

        return $status;
    }

    /** Why a verified row must not be credited automatically, or null when it may be. */
    private function eligibility(object $row): ?string
    {
        $environment = (string) config('services.mpesa.environment');
        if (! in_array($row->environment, ['sandbox', 'production'], true)) {
            return 'Payment has no trusted environment provenance.';
        }
        if ($row->environment !== $environment) {
            return "A {$row->environment} payment cannot be credited on this {$environment} installation.";
        }
        if ($row->environment === 'sandbox' && app()->environment('production')) {
            return 'Sandbox payments are never credited on a production server.';
        }
        if ((string) $row->shortcode !== PlatformPaymentSettlementService::expectedShortcode($row->environment)) {
            return 'Payment was not made to the platform Paybill '.PlatformPaymentSettlementService::expectedShortcode($row->environment).'.';
        }
        if (! $row->verified_at || ! $row->verification_source) {
            return 'Payment has not been verified by an authorized source.';
        }
        if ((float) $row->amount <= 0) {
            return 'Invalid payment amount.';
        }

        return null;
    }

    public function exception(int $id, string $reason): void
    {
        DB::table('saf_payments')->where('id', $id)->whereNotIn('verification_status', ['reconciled'])->update([
            'verification_status' => 'unmatched', 'exception_reason' => mb_substr($reason, 0, 255), 'next_verification_at' => null, 'updated_at' => now(),
        ]);
    }

    /** Customers often type the account as "100 000", "#100000" or "100-000": keep only the six digits. */
    public static function normalizeAccount(string $account): string
    {
        $clean = preg_replace('/[\s\-#.]+/', '', $account);

        return preg_match('/^[0-9]{6}$/', $clean) ? $clean : trim($account);
    }
}
