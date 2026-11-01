<?php

namespace App\Http\Controllers;

use App\Jobs\VerifySafPayment;
use App\Services\Billing\SafPaymentLedger;
use App\Services\Billing\SafPaymentVerifier;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/**
 * Safaricom notifications. They are unsigned, so they only ever *record* a transaction as pending and
 * trigger verification; credit happens after Safaricom confirms it through an authenticated query
 * (see SafPaymentVerifier). Every endpoint answers "accepted" so Safaricom does not retry forever.
 */
class DarajaCallbackController extends Controller
{
    public function stk(Request $request, SafPaymentLedger $ledger)
    {
        $callback = $request->input('Body.stkCallback');
        if (is_array($callback) && is_string($callback['CheckoutRequestID'] ?? null) && strlen(json_encode($callback)) <= 16384) {
            $attempt = DB::table('platform_billing_payments')->where('checkout_request_id', $callback['CheckoutRequestID'])
                ->where('channel', 'stk')->first();
            // Late notifications still count: a payment Safaricom first called failed or timed out may complete afterwards.
            if ($attempt && in_array($attempt->status, ['pending', 'awaiting_verification', 'failed', 'cancelled', 'timed_out', 'reconciled'], true)) {
                DB::table('platform_billing_payments')->where('id', $attempt->id)->update([
                    'callback_payload' => json_encode(SafPaymentLedger::minimize($callback)), 'updated_at' => now(),
                ]);
                // Success and failure alike are checked with Safaricom; the callback itself decides nothing.
                $id = DB::transaction(fn () => $ledger->recordStk($attempt, $callback));
                if ($id) VerifySafPayment::dispatch($id);
            }
        }

        return response()->json(['ResultCode' => 0, 'ResultDesc' => 'Received']);
    }

    public function c2b(Request $request, SafPaymentLedger $ledger)
    {
        $data = Validator::make($request->only(['TransID', 'BillRefNumber', 'BusinessShortCode', 'TransAmount', 'TransTime', 'MSISDN', 'TransactionType']), [
            'TransID' => ['required', 'regex:/^[A-Z0-9]{6,30}$/'], 'BillRefNumber' => 'required|string|max:40',
            'BusinessShortCode' => 'required|string|max:20', 'TransAmount' => 'required|numeric|gt:0|max:9999999999.99|decimal:0,2',
            'TransTime' => 'nullable|string|max:20', 'MSISDN' => 'nullable|string|max:80', 'TransactionType' => 'nullable|string|max:40',
        ]);
        $environment = (string) config('services.mpesa.environment');
        if (! $data->fails() && in_array($environment, ['sandbox', 'production'], true)) {
            $id = DB::transaction(fn () => $ledger->recordC2b($data->validated(), $environment));
            if ($id) VerifySafPayment::dispatch($id);
        }

        return response()->json(['ResultCode' => 0, 'ResultDesc' => 'Accepted']);
    }

    /** Paybill validation: accept everything; unmatched payments are handled in the exception queue, never lost. */
    public function c2bValidation()
    {
        return response()->json(['ResultCode' => 0, 'ResultDesc' => 'Accepted']);
    }

    public function transactionStatusResult(Request $request, SafPaymentVerifier $verifier)
    {
        $result = $request->input('Result');
        if (is_array($result) && strlen(json_encode($result)) <= 16384) {
            $verifier->applyTransactionStatusResult($result, $request->ip());
        }

        return response()->json(['ResultCode' => 0, 'ResultDesc' => 'Received']);
    }

    /** Safaricom queue timeout: the scheduler asks again later. */
    public function transactionStatusTimeout(Request $request)
    {
        $result = $request->input('Result') ?? $request->all();
        $originator = is_array($result) ? ($result['OriginatorConversationID'] ?? null) : null;
        if (is_string($originator) && $originator !== '') {
            DB::table('saf_payments')->where('verification_request_id', $originator)->where('verification_status', 'pending')
                ->update(['next_verification_at' => now(), 'updated_at' => now()]);
        }

        return response()->json(['ResultCode' => 0, 'ResultDesc' => 'Received']);
    }
}
