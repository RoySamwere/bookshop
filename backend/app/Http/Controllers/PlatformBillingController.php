<?php

namespace App\Http\Controllers;

use App\Services\DarajaStkService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;

class PlatformBillingController extends Controller
{
    public function invoice(Request $request, int $invoice)
    {
        $row = DB::table('platform_billing_invoices')->where('id', $invoice)
            ->where('bookshop_id', $request->user()->bookshop_id)->first();
        abort_unless($row, 404);
        $paid = DB::table('platform_billing_payments')->where('platform_billing_invoice_id', $row->id)
            ->where('status', 'confirmed')->sum('amount');
        return response()->json(['data' => $row, 'paid' => $paid,
            'balance' => max(0, round((float) $row->amount - (float) $paid, 2)),
            'paybill' => config('services.mpesa.platform_paybill')]);
    }

    public function stk(Request $request, int $invoice, DarajaStkService $daraja)
    {
        $data = $request->validate(['phone' => ['required', 'regex:/^2547[0-9]{8}$|^2541[0-9]{8}$/'],
            'amount' => 'required|integer|min:1']);
        $row = DB::table('platform_billing_invoices')->where('id', $invoice)
            ->where('bookshop_id', $request->user()->bookshop_id)->first();
        abort_unless($row && in_array($row->status, ['pending', 'partially_paid']), 404);
        $paid = (float) DB::table('platform_billing_payments')->where('platform_billing_invoice_id', $invoice)
            ->where('status', 'confirmed')->sum('amount');
        $balance = round((float) $row->amount - $paid, 2);
        if ($data['amount'] > $balance) throw ValidationException::withMessages(['amount' => 'Amount exceeds outstanding balance.']);
        $result = $daraja->push($data['phone'], $data['amount'], $row->account_number);
        $checkout = $result['CheckoutRequestID'] ?? null;
        if (($result['ResponseCode'] ?? null) != '0' || !$checkout) {
            return response()->json(['message' => 'M-Pesa did not accept the STK request.', 'provider' => $result], 422);
        }
        DB::table('platform_billing_payments')->insert([
            'platform_billing_invoice_id' => $invoice, 'channel' => 'stk', 'status' => 'pending',
            'checkout_request_id' => $checkout, 'merchant_request_id' => $result['MerchantRequestID'] ?? null,
            'phone' => $data['phone'], 'amount' => $data['amount'],
            'provider_response' => json_encode($result), 'created_at' => now(), 'updated_at' => now(),
        ]);
        return response()->json(['message' => 'STK request sent. Payment is not yet confirmed.', 'checkout_request_id' => $checkout], 202);
    }
}
