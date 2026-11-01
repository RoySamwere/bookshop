<?php

namespace App\Services;

use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Called ONLY after a trusted provider confirmation or independently verified
 * reconciliation. Never call from a user-submitted receipt or STK initiation.
 */
class PlatformPaymentSettlementService
{
    public function settle(string $receipt, string $account, string $shortcode, float $amount, \DateTimeInterface $paidAt, string $channel, array $providerPayload = []): object
    {
        if (! in_array($channel, ['stk', 'paybill'], true) || ! preg_match('/^[0-9]{6}$/', $account)) {
            throw ValidationException::withMessages(['payment' => 'Invalid payment reference.']);
        }
        if ($shortcode !== (($providerPayload['environment'] ?? null) === 'sandbox' ? (string) config('services.mpesa.shortcode') : '153283')) {
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

        return DB::transaction(function () use ($receipt, $account, $amount, $paidAt, $channel, $providerPayload, $environment) {
            $invoice = DB::table('platform_billing_invoices')->where('account_number', $account)->lockForUpdate()->first();
            if (! $invoice) {
                throw ValidationException::withMessages(['payment' => 'No invoice matches this account number.']);
            }
            if ($invoice->environment !== $environment) {
                throw ValidationException::withMessages(['payment' => 'Payment and invoice environments differ.']);
            }
            $existing = DB::table('platform_billing_payments')->where('mpesa_receipt', $receipt)->first();
            if ($existing) {
                if ((int) $existing->platform_billing_invoice_id !== (int) $invoice->id || (float) $existing->amount !== $amount || $existing->environment !== $environment) {
                    throw ValidationException::withMessages(['payment' => 'Receipt is already allocated to another invoice.']);
                }

                return $invoice; // Duplicate callback: no additional subscription days.
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
            // Keep historical STK attempts; a statement-confirmed payment has its own
            // unique receipt and cannot be counted twice.
            DB::table('platform_billing_payments')->insert([
                'platform_billing_invoice_id' => $invoice->id,
                'channel' => $channel,
                'status' => 'confirmed', 'environment' => $environment,
                'mpesa_receipt' => $receipt,
                'amount' => $amount,
                'provider_response' => json_encode($providerPayload),
                'confirmed_at' => $paid,
                'created_at' => now(), 'updated_at' => now(),
            ]);
            if ($excess > 0) {
                DB::table('platform_payment_reconciliation_items')->insert([
                    'source' => 'overpayment', 'environment' => $environment,
                    'provider_transaction_id' => $receipt,
                    'account_number' => $account,
                    'destination_shortcode' => $environment === 'production' ? '153283' : (string) config('services.mpesa.shortcode'),
                    'amount' => $excess,
                    'status' => 'requires_review',
                    'payload' => json_encode(['invoice_id' => $invoice->id, 'receipt' => $receipt,
                        'total_paid' => $totalPaid, 'invoice_amount' => $invoice->amount]),
                    'created_at' => now(), 'updated_at' => now(),
                ]);
            }
            if ($wasPaid) {
                return $invoice;
            } // Late funds are recorded as excess, without extending access again.
            if (! $fullyPaid) {
                DB::table('platform_billing_invoices')->where('id', $invoice->id)->update([
                    'status' => 'partially_paid', 'updated_at' => now(),
                ]);

                return DB::table('platform_billing_invoices')->where('id', $invoice->id)->first();
            }
            DB::table('platform_billing_invoices')->where('id', $invoice->id)->update([
                'status' => 'paid', 'paid_at' => $paid, 'period_starts_at' => $start,
                'period_ends_at' => $end, 'updated_at' => now(),
            ]);
            if ($environment === 'sandbox') {
                return DB::table('platform_billing_invoices')->where('id', $invoice->id)->first();
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

            return DB::table('platform_billing_invoices')->where('id', $invoice->id)->first();
        }, 3);
    }
}
