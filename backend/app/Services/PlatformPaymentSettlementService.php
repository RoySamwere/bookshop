<?php

namespace App\Services;

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
        if (!in_array($channel, ['stk', 'paybill'], true) || !preg_match('/^[0-9]{6}$/', $account)) {
            throw ValidationException::withMessages(['payment' => 'Invalid payment reference.']);
        }
        if ($shortcode !== (string) config('services.mpesa.platform_paybill')) {
            throw ValidationException::withMessages(['payment' => 'Payment was not made to the platform Paybill.']);
        }
        if ($receipt === '') {
            throw ValidationException::withMessages(['payment' => 'Missing verified M-Pesa receipt.']);
        }

        return DB::transaction(function () use ($receipt, $account, $amount, $paidAt, $channel, $providerPayload) {
            $invoice = DB::table('platform_billing_invoices')->where('account_number', $account)->lockForUpdate()->first();
            if (!$invoice) {
                throw ValidationException::withMessages(['payment' => 'No invoice matches this account number.']);
            }
            $existing = DB::table('platform_billing_payments')->where('mpesa_receipt', $receipt)->first();
            if ($existing) {
                if ((int) $existing->platform_billing_invoice_id !== (int) $invoice->id) {
                    throw ValidationException::withMessages(['payment' => 'Receipt is already allocated to another invoice.']);
                }
                return $invoice; // Duplicate callback: no additional subscription days.
            }
            if ($invoice->status === 'paid') {
                throw ValidationException::withMessages(['payment' => 'Invoice already paid; reconcile as overpayment.']);
            }
            if ($amount <= 0) {
                throw ValidationException::withMessages(['payment' => 'Payment must be positive.']);
            }
            $alreadyPaid = (float) DB::table('platform_billing_payments')
                ->where('platform_billing_invoice_id', $invoice->id)
                ->where('status', 'confirmed')->sum('amount');
            $totalPaid = round($alreadyPaid + $amount, 2);
            // Overpayments are recorded for reconciliation; never grant extra subscription periods.
            $fullyPaid = $totalPaid + 0.005 >= (float) $invoice->amount;
            $excess = round(max(0, $totalPaid - (float) $invoice->amount), 2);
            $subscription = DB::table('bookshop_subscriptions')->where('bookshop_id', $invoice->bookshop_id)->lockForUpdate()->first();
            if (!$subscription) {
                throw ValidationException::withMessages(['payment' => 'Bookshop subscription missing.']);
            }
            $paid = \Illuminate\Support\Carbon::instance(\DateTime::createFromInterface($paidAt));
            $plan = DB::table('subscription_plans')->where('id', $invoice->subscription_plan_id)->first();
            $months = match ($plan?->billing_interval) {
                'monthly' => 1, 'quarterly' => 3, 'annual', 'annually', 'yearly' => 12,
                default => throw ValidationException::withMessages(['plan' => 'Unsupported billing interval.']),
            };
            $currentExpiry = $subscription->current_period_ends_at
                ? \Illuminate\Support\Carbon::parse($subscription->current_period_ends_at) : null;
            $start = $currentExpiry && $currentExpiry->greaterThan($paid) ? $currentExpiry : $paid;
            $end = $start->copy()->addMonthsNoOverflow($months);
            // Keep historical STK attempts; a statement-confirmed payment has its own
            // unique receipt and cannot be counted twice.
            DB::table('platform_billing_payments')->insert([
                'platform_billing_invoice_id' => $invoice->id,
                'channel' => $channel,
                'status' => 'confirmed',
                'mpesa_receipt' => $receipt,
                'amount' => $amount,
                'provider_response' => json_encode($providerPayload),
                'confirmed_at' => $paid,
                'created_at' => now(), 'updated_at' => now(),
            ]);
            if ($excess > 0) {
                DB::table('platform_payment_reconciliation_items')->insert([
                    'source' => 'overpayment',
                    'provider_transaction_id' => $receipt,
                    'account_number' => $account,
                    'destination_shortcode' => (string) config('services.mpesa.platform_paybill'),
                    'amount' => $excess,
                    'status' => 'requires_review',
                    'payload' => json_encode(['invoice_id' => $invoice->id, 'receipt' => $receipt,
                        'total_paid' => $totalPaid, 'invoice_amount' => $invoice->amount]),
                    'created_at' => now(), 'updated_at' => now(),
                ]);
            }
            if (!$fullyPaid) {
                DB::table('platform_billing_invoices')->where('id', $invoice->id)->update([
                    'status' => 'partially_paid', 'updated_at' => now(),
                ]);
                return DB::table('platform_billing_invoices')->where('id', $invoice->id)->first();
            }
            DB::table('platform_billing_invoices')->where('id', $invoice->id)->update([
                'status' => 'paid', 'paid_at' => $paid, 'period_starts_at' => $start,
                'period_ends_at' => $end, 'updated_at' => now(),
            ]);
            DB::table('bookshop_subscriptions')->where('id', $subscription->id)->update([
                'subscription_plan_id' => $invoice->subscription_plan_id,
                'status' => 'active', 'current_period_starts_at' => $start,
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
        });
    }
}
