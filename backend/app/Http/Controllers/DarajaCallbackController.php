<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

class DarajaCallbackController extends Controller
{
    public function stk(Request $request)
    {
        $callback = $request->input('Body.stkCallback');
        // Unsigned notifications never change authoritative payment state, including failures.
        if (is_array($callback) && is_string($callback['CheckoutRequestID'] ?? null) && strlen(json_encode($callback)) <= 16384) {
            DB::table('platform_billing_payments')->where('checkout_request_id', $callback['CheckoutRequestID'])
                ->whereIn('status', ['pending', 'awaiting_verification'])->update([
                    'callback_payload' => json_encode($callback), 'updated_at' => now(),
                ]);
        }

        return response()->json(['ResultCode' => 0, 'ResultDesc' => 'Received']);
    }

    public function c2b(Request $request)
    {
        $data = Validator::make($request->only(['TransID', 'BillRefNumber', 'BusinessShortCode', 'TransAmount']), [
            'TransID' => ['required', 'regex:/^[A-Z0-9]{6,30}$/'], 'BillRefNumber' => ['required', 'regex:/^[0-9]{6}$/'],
            'BusinessShortCode' => 'required|string|max:20', 'TransAmount' => 'required|numeric|gt:0|max:9999999999.99|decimal:0,2',
        ]);
        if (! $data->fails()) {
            $values = $data->validated();
            DB::table('platform_payment_reconciliation_items')->insertOrIgnore([
                'source' => 'c2b', 'environment' => config('services.mpesa.environment'),
                'provider_transaction_id' => $values['TransID'], 'account_number' => $values['BillRefNumber'],
                'destination_shortcode' => $values['BusinessShortCode'], 'amount' => $values['TransAmount'],
                'status' => 'awaiting_verification', 'payload' => json_encode($values), 'created_at' => now(), 'updated_at' => now(),
            ]);
        }

        return response()->json(['ResultCode' => 0, 'ResultDesc' => 'Accepted for reconciliation']);
    }
}
