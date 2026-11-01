<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\User;
use App\Services\Billing\SafPaymentLedger;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Credits money to a subscription invoice. Two callers only:
 *  - SafPaymentReconciler, after Safaricom itself has verified the transaction (automatic path), and
 *  - settle(), an authorized platform operator's attestation from the merchant statement (exception path).
 * Never call from a user-submitted receipt, an STK initiation or an unverified callback.
 */
class PlatformPaymentSettlementService
{
    public const PRODUCTION_PAYBILL = '152451';

    public static function expectedShortcode(string $environment): string
    {
        return $environment === 'sandbox' ? (string) config('services.mpesa.shortcode') : self::PRODUCTION_PAYBILL;
    }

    /** Operator attestation from an independently obtained merchant statement (exception handling). */
    public function settle(string $receipt, string $account, string $shortcode, float $amount, \DateTimeInterface $paidAt, string $channel, array $providerPayload = []): object
    {
        if (! in_array($channel, ['stk', 'paybill'], true) || ! preg_match('/^[0-9]{6}$/', $account)) {
            throw ValidationException::withMessages(['payment' => 'Invalid payment reference.']);
        }
        if ($shortcode !== self::expectedShortcode((string) ($providerPayload['environment'] ?? 'production'))) {
            throw ValidationException::withMessages(['payment' => 'Payment was not made to the platform Paybill.']);
        }
        if (! preg_match('/^[A-Z0-9]{6,30}$/', $receipt)) {
            throw ValidationException::withMessages(['payment' => 'Missing verified M-Pesa receipt.']);
        }

        $environment = $providerPayload['environment'] ?? null;
        if (! in_array($environment, ['sandbox', 'production'], true)
            || empty($providerPayload['statement_reference']) || empty($providerPayload['verified_by'])
            || ($environment === 'sandbox' && app()->environment('production'))) {
            throw ValidationException::withMessages(['payment' => 'Trusted statement verification and payment provenance are required.']);
        }
        $verifier = User::find($providerPayload['verified_by']);
        if (! $verifier?->is_active || ! $verifier->isPlatformUser() || ! $verifier->hasPermission('platform.settings.manage')
            || $environment !== config('services.mpesa.environment')) {
            throw ValidationException::withMessages(['payment' => 'An active authorized platform verifier is required.']);
        }
        if (! is_finite($amount) || $amount <= 0 || round($amount, 2) !== $amount || $paidAt > now()) {
            throw ValidationException::withMessages(['payment' => 'Invalid amount or future payment date.']);
        }

        return DB::transaction(function () use ($receipt, $account, $shortcode, $amount, $paidAt, $channel, $providerPayload, $environment, $verifier) {
            $result = $this->credit($receipt, $account, $amount, $paidAt, $channel, $environment, $providerPayload, $verifier,
                'billing.payment_verified', 'Independently verified merchant payment');
            // Every credit appears in the saf_payments ledger, including operator-attested ones.
            app(SafPaymentLedger::class)->recordAttested($result, [
                'receipt' => $receipt, 'account' => $account, 'shortcode' => $shortcode, 'amount' => $amount,
                'paid_at' => $paidAt, 'channel' => $channel, 'environment' => $environment,
                'statement_reference' => (string) $providerPayload['statement_reference'], 'verified_by' => $verifier->id,
                'stk_attempt_id' => $providerPayload['stk_attempt_id'] ?? null,
            ]);

            return $result['invoice'];
        }, 3);
    }

    /**
     * Allocates verified funds to the invoice with this account number. Must run inside a transaction.
     * Idempotent per receipt: a receipt already credited to the same invoice is a no-op.
     *
     * @return array{invoice: object, payment_id: ?int, allocated: float, excess: float, duplicate: bool}
     */
    public function credit(?string $receipt, string $account, float $amount, \DateTimeInterface $paidAt, string $channel, string $environment, array $evidence, ?User $actor, string $auditAction, string $auditDescription): array
    {
        $invoice = DB::table('platform_billing_invoices')->where('account_number', $account)->lockForUpdate()->first();
        if (! $invoice) {
            throw ValidationException::withMessages(['payment' => 'No invoice matches this account number.']);
        }
        if ($invoice->environment !== $environment) {
            throw ValidationException::withMessages(['payment' => 'Payment and invoice environments differ.']);
        }
        if ($receipt !== null) {
            $existing = DB::table('platform_billing_payments')->where('mpesa_receipt', $receipt)->first();
            if ($existing) {
                if ((int) $existing->platform_billing_invoice_id !== (int) $invoice->id || (float) $existing->amount !== $amount || $existing->environment !== $environment) {
                    throw ValidationException::withMessages(['payment' => 'Receipt is already allocated to another invoice.']);
                }

                return ['invoice' => $invoice, 'payment_id' => (int) $existing->id, 'allocated' => 0.0, 'excess' => 0.0, 'duplicate' => true];
            }
        }
        if (! in_array($invoice->status, ['pending', 'partially_paid', 'paid'], true)) {
            throw ValidationException::withMessages(['payment' => 'Invoice is not payable.']);
        }
        $wasPaid = $invoice->status === 'paid';
        $alreadyPaid = (float) DB::table('platform_billing_payments')
            ->where('platform_billing_invoice_id', $invoice->id)
            ->where('status', 'confirmed')->sum('amount');
        $totalPaid = round($alreadyPaid + $amount, 2);
        // Overpayments are recorded for reconciliation; never grant extra subscription periods.
        $fullyPaid = $totalPaid + 0.005 >= (float) $invoice->amount;
        $excess = round(max(0, $totalPaid - (float) $invoice->amount) - max(0, $alreadyPaid - (float) $invoice->amount), 2);
        $subscription = DB::table('bookshop_subscriptions')->where('bookshop_id', $invoice->bookshop_id)->lockForUpdate()->first();
        if (! $subscription) {
            throw ValidationException::withMessages(['payment' => 'Bookshop subscription missing.']);
        }
        $paid = Carbon::instance(\DateTime::createFromInterface($paidAt));
        $months = (int) $invoice->billing_months;
        if (! in_array($months, [1, 3, 12], true)) {
            throw ValidationException::withMessages(['plan' => 'Invoice billing period is invalid.']);
        }
        $start = now();
        foreach ([$subscription->current_period_ends_at, $subscription->trial_ends_at] as $expiry) {
            if ($expiry && Carbon::parse($expiry)->greaterThan($start)) {
                $start = Carbon::parse($expiry);
            }
        }
        $end = $start->copy()->addMonthsNoOverflow($months);
        $paymentId = DB::table('platform_billing_payments')->insertGetId([
            'platform_billing_invoice_id' => $invoice->id,
            'channel' => $channel,
            'status' => 'confirmed', 'environment' => $environment,
            'mpesa_receipt' => $receipt,
            'amount' => $amount,
            'provider_response' => json_encode($evidence),
            'confirmed_at' => $paid,
            'created_at' => now(), 'updated_at' => now(),
        ]);
        AuditLog::record($auditAction, $auditDescription, null,
            ['invoice_id' => $invoice->id, 'receipt' => $receipt, 'amount' => $amount, 'environment' => $environment,
                'verification' => array_intersect_key($evidence, array_flip(['statement_reference', 'verification_source', 'verification_reference', 'saf_payment_id']))],
            $actor, $invoice->bookshop_id);
        if ($excess > 0) {
            DB::table('platform_payment_reconciliation_items')->insert([
                'source' => 'overpayment', 'environment' => $environment,
                'provider_transaction_id' => $receipt ?? 'saf-'.($evidence['saf_payment_id'] ?? $paymentId),
                'account_number' => $account,
                'destination_shortcode' => self::expectedShortcode($environment),
                'amount' => $excess,
                'status' => 'requires_review',
                'payload' => json_encode(['invoice_id' => $invoice->id, 'receipt' => $receipt,
                    'total_paid' => $totalPaid, 'invoice_amount' => $invoice->amount]),
                'created_at' => now(), 'updated_at' => now(),
            ]);
        }
        $result = fn () => ['invoice' => DB::table('platform_billing_invoices')->where('id', $invoice->id)->first(), 'payment_id' => $paymentId,
            'allocated' => round($amount - $excess, 2), 'excess' => $excess, 'duplicate' => false];
        if ($wasPaid) {
            return $result(); // Late funds are recorded as excess, without extending access again.
        }
        if (! $fullyPaid) {
            DB::table('platform_billing_invoices')->where('id', $invoice->id)->update(['status' => 'partially_paid', 'updated_at' => now()]);

            return $result();
        }
        DB::table('platform_billing_invoices')->where('id', $invoice->id)->update([
            'status' => 'paid', 'paid_at' => $paid, 'period_starts_at' => $start,
            'period_ends_at' => $end, 'updated_at' => now(),
        ]);
        if ($environment === 'sandbox') {
            return $result(); // Sandbox money never activates or extends access.
        }
        DB::table('bookshop_subscriptions')->where('id', $subscription->id)->update([
            'subscription_plan_id' => $invoice->subscription_plan_id,
            'status' => 'active', 'cancelled_at' => null,
            'current_period_starts_at' => $subscription->current_period_ends_at && Carbon::parse($subscription->current_period_ends_at)->isFuture()
                ? $subscription->current_period_starts_at : $start,
            'current_period_ends_at' => $end, 'grace_ends_at' => null, 'updated_at' => now(),
        ]);
        DB::table('subscription_events')->insert([
            'bookshop_id' => $invoice->bookshop_id,
            'bookshop_subscription_id' => $subscription->id,
            'subscription_plan_id' => $invoice->subscription_plan_id,
            'event' => 'payment_confirmed',
            'from_status' => $subscription->status,
            'to_status' => 'active',
            'note' => 'Verified full payment for invoice #'.$invoice->id,
            'created_at' => now(),
        ]);

        return $result();
    }
}
