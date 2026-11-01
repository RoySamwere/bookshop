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
        if (!in_array($channel, ['stk', 'paybill'], true) || !preg_match('/^[0-9]{4}$/', $account)) {
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
            if (abs((float) $invoice->amount - $amount) > 0.005) {
                throw ValidationException::withMessages(['payment' => 'Amount does not match the invoice.']);
            }
            $subscription = DB::table('bookshop_subscriptions')->where('bookshop_id', $invoice->bookshop_id)->lockForUpdate()->first();
            if (!$subscription) {
                throw ValidationException::withMessages(['payment' => 'Bookshop subscription missing.']);
            }
            $paid = \Illuminate\Support\Carbon::instance(\DateTime::createFromInterface($paidAt));
            $end = $paid->copy()->addDays(28);
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
            DB::table('platform_billing_invoices')->where('id', $invoice->id)->update([
                'status' => 'paid', 'paid_at' => $paid, 'period_starts_at' => $paid,
                'period_ends_at' => $end, 'updated_at' => now(),
            ]);
            DB::table('bookshop_subscriptions')->where('id', $subscription->id)->update([
                'subscription_plan_id' => $invoice->subscription_plan_id,
                'status' => 'active', 'current_period_starts_at' => $paid,
                'current_period_ends_at' => $end, 'grace_ends_at' => null, 'updated_at' => now(),
            ]);
            DB::table('subscription_events')->insert([
                'bookshop_id' => $invoice->bookshop_id,
                'bookshop_subscription_id' => $subscription->id,
                'subscription_plan_id' => $invoice->subscription_plan_id,
                'event' => 'payment_confirmed',
                'from_status' => $subscription->status,
                'to_status' => 'active',
                'note' => 'Verified payment for invoice #'.$invoice->id,
                'created_at' => now(),
            ]);
            return DB::table('platform_billing_invoices')->where('id', $invoice->id)->first();
        });
    }
}
