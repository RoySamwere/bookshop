<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class DarajaCallbackController extends Controller
{
    public function stk(Request $request)
    {
        $callback = $request->input('Body.stkCallback', []);
        $checkout = $callback['CheckoutRequestID'] ?? null;
        if (!$checkout) return response()->json(['ResultCode' => 0, 'ResultDesc' => 'Received']);
        // Safaricom callbacks are not cryptographically signed. Store and reconcile
        // against a server-initiated checkout and independent STK status query before settlement.
        $attempt = DB::table('platform_billing_payments')->where('checkout_request_id', $checkout)->first();
        if (!$attempt) {
            Log::warning('Unmatched Daraja STK callback', ['checkout' => $checkout]);
            return response()->json(['ResultCode' => 0, 'ResultDesc' => 'Received']);
        }
        if ($attempt->status === 'pending') {
            DB::table('platform_billing_payments')->where('id', $attempt->id)->update([
                'status' => ((int) ($callback['ResultCode'] ?? -1) === 0) ? 'awaiting_verification' : 'failed',
                'provider_response' => json_encode($callback), 'updated_at' => now(),
            ]);
        }
        return response()->json(['ResultCode' => 0, 'ResultDesc' => 'Received']);
    }

    public function c2b(Request $request)
    {
        // Do not activate subscriptions directly from unauthenticated HTTP callbacks.
        // Persist for trusted reconciliation against Safaricom/Paybill statement.
        Log::notice('Daraja C2B confirmation received for reconciliation', [
            'transaction_id' => $request->input('TransID'),
            'account' => $request->input('BillRefNumber'),
            'amount' => $request->input('TransAmount'),
        ]);
        return response()->json(['ResultCode' => 0, 'ResultDesc' => 'Accepted for reconciliation']);
    }
}
