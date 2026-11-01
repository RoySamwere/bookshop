<?php

namespace App\Services\Billing;

use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * "Update payments": walks every saf_payments row for this environment, using the M-Pesa confirmation code
 * (mpesa_receipt_number) as the key, and brings it up to date:
 *  - pending rows are checked with Safaricom now (unless a Safaricom answer is already on its way),
 *  - verified rows are applied to their invoice,
 *  - STK rows still missing their code are looked up,
 *  - applied rows have their code copied onto the invoice payment record and their bookshop/invoice links filled.
 * Nothing is credited without Safaricom's confirmation; running it twice changes nothing more.
 */
class SafPaymentSync
{
    public function __construct(private readonly SafPaymentVerifier $verifier) {}

    public function run(?string $environment = null, int $limit = 500): array
    {
        $environment ??= (string) config('services.mpesa.environment');
        $result = ['checked' => 0, 'applied' => 0, 'still_pending' => 0, 'needs_review' => 0, 'codes_filled' => 0, 'links_repaired' => 0];

        $rows = DB::table('saf_payments')->where('environment', $environment)->whereIn('verification_status', ['pending', 'verified'])
            ->orderBy('id')->limit($limit)->get();
        foreach ($rows as $row) {
            $awaitingAnswer = $row->verification_request_id && $row->next_verification_at && Carbon::parse($row->next_verification_at)->isFuture();
            if ($row->verification_status === 'pending' && ! $awaitingAnswer) {
                DB::table('saf_payments')->where('id', $row->id)->where('verification_status', 'pending')->update(['next_verification_at' => now()]);
            }
            try {
                $status = $this->verifier->handle((int) $row->id);
            } catch (Throwable $exception) {
                report($exception);
                $status = 'pending';
            }
            $result['checked']++;
            match ($status) {
                'reconciled' => $result['applied']++,
                'unmatched' => $result['needs_review']++,
                'pending', 'verified' => $result['still_pending']++,
                default => null,
            };
        }

        foreach (DB::table('saf_payments')->where('environment', $environment)->where('payment_channel', 'stk')->whereNull('mpesa_receipt_number')
            ->whereIn('verification_status', ['verified', 'reconciled'])->orderByDesc('id')->limit(50)->pluck('id') as $id) {
            if ($this->verifier->lookupStkReceipt((int) $id)) $result['codes_filled']++;
        }

        // Applied rows: the invoice payment record carries the same code, and the row points at its invoice.
        foreach (DB::table('saf_payments as s')->join('platform_billing_payments as p', 'p.id', '=', 's.platform_billing_payment_id')
            ->where('s.environment', $environment)->where('s.verification_status', 'reconciled')->whereNotNull('s.mpesa_receipt_number')
            ->where(fn ($q) => $q->whereNull('p.mpesa_receipt')->orWhereNull('s.invoice_id')->orWhereNull('s.bookshop_id'))
            ->select('s.id', 's.mpesa_receipt_number', 's.invoice_id', 's.bookshop_id', 'p.id as payment_id', 'p.mpesa_receipt', 'p.platform_billing_invoice_id')->limit($limit)->get() as $row) {
            if (! $row->mpesa_receipt && ! DB::table('platform_billing_payments')->where('mpesa_receipt', $row->mpesa_receipt_number)->exists()) {
                DB::table('platform_billing_payments')->where('id', $row->payment_id)->update(['mpesa_receipt' => $row->mpesa_receipt_number, 'updated_at' => now()]);
                $result['codes_filled']++;
            }
            if (! $row->invoice_id || ! $row->bookshop_id) {
                $invoice = DB::table('platform_billing_invoices')->where('id', $row->platform_billing_invoice_id)->first();
                DB::table('saf_payments')->where('id', $row->id)->update(['invoice_id' => $invoice->id, 'bookshop_id' => $invoice->bookshop_id, 'updated_at' => now()]);
                $result['links_repaired']++;
            }
        }

        return $result;
    }
}
