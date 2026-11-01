<?php

namespace App\Services\Billing;

use App\Models\User;
use App\Notifications\SubscriptionPaymentConfirmed;
use App\Support\SafeMail;
use Illuminate\Support\Facades\DB;

/** Tells the bookshop owner a payment was applied. Sent once per ledger row, even if called repeatedly. */
class PaymentConfirmationNotifier
{
    public function send(int $safPaymentId): void
    {
        // Claim the row first so concurrent workers never send twice.
        $claimed = DB::table('saf_payments')->where('id', $safPaymentId)->where('verification_status', 'reconciled')
            ->whereNull('confirmation_sent_at')->update(['confirmation_sent_at' => now()]);
        if (! $claimed) return;

        $row = DB::table('saf_payments')->where('id', $safPaymentId)->first();
        $invoice = DB::table('platform_billing_invoices')->where('id', $row->invoice_id)->first();
        $bookshop = DB::table('bookshops')->where('id', $row->bookshop_id)->first();
        if (! $invoice || ! $bookshop || $row->environment === 'sandbox' && app()->environment('production')) return;
        $owner = User::find($bookshop->owner_user_id)
            ?? User::where('bookshop_id', $bookshop->id)->whereIn('role', ['bookshop_owner', 'system_owner'])->orderBy('id')->first();
        if (! $owner) return;

        $paid = (float) DB::table('platform_billing_payments')->where('platform_billing_invoice_id', $invoice->id)->where('status', 'confirmed')->sum('amount');
        $access = DB::table('bookshop_subscriptions')->where('bookshop_id', $bookshop->id)->value('current_period_ends_at');
        $details = [
            'receipt' => $row->mpesa_receipt_number ?? 'STK payment',
            'amount' => number_format((float) $row->amount, 2),
            'account_number' => $invoice->account_number,
            'bookshop' => $bookshop->name,
            'invoice_status' => $invoice->status,
            'balance' => number_format(max(0, (float) $invoice->amount - $paid), 2),
            'access_until' => $access ? date('j M Y', strtotime($access)) : '—',
        ];
        // The in-app notice always lands; email is best effort so an SMTP problem never blocks payment processing.
        $owner->notify(new SubscriptionPaymentConfirmed($details, false));
        SafeMail::send(fn () => $owner->notifyNow(new SubscriptionPaymentConfirmed($details, true), ['mail']));
    }
}
