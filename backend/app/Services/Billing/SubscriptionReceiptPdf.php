<?php

namespace App\Services\Billing;

use App\Support\Pdf\SimplePdf;
use Illuminate\Support\Facades\DB;

/** A one-page receipt for a credited subscription payment. */
class SubscriptionReceiptPdf
{
    public function render(object $payment): string
    {
        $bookshop = DB::table('bookshops')->where('id', $payment->bookshop_id)->first();
        $invoice = DB::table('platform_billing_invoices')->where('id', $payment->invoice_id)->first();
        $plan = $invoice ? DB::table('subscription_plans')->where('id', $invoice->subscription_plan_id)->value('name') : null;
        $blue = [0.0, 0.443, 0.976];
        $ink = [0.078, 0.129, 0.239];
        $muted = [0.36, 0.41, 0.5];
        $pdf = new SimplePdf('Payment receipt '.($payment->mpesa_receipt_number ?? $payment->id));
        $pdf->rect(0, 0, SimplePdf::WIDTH, 6, $blue);
        $pdf->rect(SimplePdf::WIDTH * 0.72, 0, SimplePdf::WIDTH * 0.28, 6, [0.973, 0.506, 0.729]);
        $pdf->text(40, 50, 'Nifunze Bookshop', 18, true, $ink);
        $pdf->text(40, 66, 'Subscription payment receipt', 10, false, $muted);
        $pdf->text(555, 50, 'PAID', 18, true, [0.02, 0.6, 0.35], 'right');
        $pdf->text(555, 66, 'Receipt #'.str_pad((string) $payment->id, 6, '0', STR_PAD_LEFT), 10, false, $muted, 'right');

        $rows = [
            'Received from' => $bookshop->name ?? '',
            'M-Pesa confirmation code' => $payment->mpesa_receipt_number ?? 'STK payment ('.$payment->payment_channel.')',
            'Payment date' => $payment->transaction_date ? \Illuminate\Support\Carbon::parse($payment->transaction_date, config('app.timezone'))->setTimezone('Africa/Nairobi')->format('j M Y, H:i').' EAT' : '',
            'Paid to' => 'Paybill '.$payment->shortcode,
            'Invoice' => $invoice ? '#'.$invoice->id.' · account '.$invoice->account_number : '',
            'Plan' => $plan ? $plan.($invoice ? ' · '.date('j M Y', strtotime($invoice->period_starts_at)).' – '.date('j M Y', strtotime($invoice->period_ends_at)) : '') : '',
            'Payment method' => $payment->payment_channel === 'stk' ? 'M-Pesa (prompt to phone)' : 'M-Pesa Paybill',
            'Verified by' => match ($payment->verification_source) {
                'daraja_stk_query', 'daraja_transaction_status', 'daraja_pull_api' => 'Safaricom (automatic)',
                'statement_attestation' => 'Merchant statement',
                default => 'Payment records',
            },
        ];
        $y = 110;
        foreach ($rows as $label => $value) {
            $pdf->text(40, $y, $label, 9.5, false, $muted);
            $pdf->text(220, $y, $pdf->fit((string) $value, 335, 10.5, true), 10.5, true, $ink);
            $pdf->line(40, $y + 9, 555, $y + 9);
            $y += 26;
        }
        $y += 10;
        $pdf->rect(300, $y, 255, 30, $blue);
        $pdf->text(312, $y + 19, 'AMOUNT', 10, true, [1, 1, 1]);
        $pdf->text(545, $y + 20, 'KES '.number_format((float) $payment->amount, 2), 13, true, [1, 1, 1], 'right');
        if ((float) $payment->excess_amount > 0) {
            $pdf->text(555, $y + 48, 'Includes KES '.number_format((float) $payment->excess_amount, 2).' over the invoice amount, held for review.', 8.5, false, $muted, 'right');
        }
        $pdf->line(40, SimplePdf::HEIGHT - 44, 555, SimplePdf::HEIGHT - 44);
        $pdf->text(40, SimplePdf::HEIGHT - 30, 'Generated using Nifunze Bookshop', 8, true, $blue);

        return $pdf->output();
    }
}
