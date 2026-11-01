<?php

namespace App\Http\Controllers\Platform;

use App\Http\Controllers\Controller;
use App\Services\PlatformPaymentSettlementService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class PaymentReconciliationController extends Controller
{
    public function index(Request $request)
    {
        $items = DB::table('platform_payment_reconciliation_items')->orderByDesc('id')->paginate(30);
        return response()->json($items);
    }

    /**
     * Operator reconciles a transaction against a trusted Safaricom statement.
     * This is not a customer receipt-submission endpoint.
     */
    public function confirm(Request $request, int $item, PlatformPaymentSettlementService $settlement)
    {
        $data = $request->validate([
            'verified_receipt' => 'required|string|max:100',
            'verified_amount' => 'required|numeric|gt:0',
            'verified_account' => ['required', 'regex:/^[0-9]{6}$/'],
            'verified_shortcode' => 'required|string|max:20',
            'verified_at' => 'required|date',
            'statement_reference' => 'required|string|max:255',
        ]);
        $record = DB::table('platform_payment_reconciliation_items')->where('id', $item)->first();
        abort_unless($record, 404);
        if ($record->status === 'settled') {
            return response()->json(['message' => 'Already settled']);
        }
        if ($record->source !== 'c2b') {
            throw ValidationException::withMessages(['payment' => 'Only manual Paybill statement items can be reconciled here.']);
        }
        if ($data['verified_receipt'] !== $record->provider_transaction_id ||
            $data['verified_account'] !== $record->account_number ||
            abs((float) $data['verified_amount'] - (float) $record->amount) > 0.005 ||
            $data['verified_shortcode'] !== $record->destination_shortcode) {
            throw ValidationException::withMessages(['payment' => 'Statement values do not match the captured transaction.']);
        }
        $invoice = $settlement->settle(
            $data['verified_receipt'], $data['verified_account'], $data['verified_shortcode'],
            (float) $data['verified_amount'], new \DateTimeImmutable($data['verified_at']),
            'paybill', ['reconciliation_item' => $item, 'statement_reference' => $data['statement_reference'],
                'verified_by' => $request->user()->id]
        );
        DB::table('platform_payment_reconciliation_items')->where('id', $item)->where('status', 'awaiting_verification')->update([
            'status' => 'settled', 'updated_at' => now(),
        ]);
        return response()->json(['message' => 'Payment reconciled', 'invoice_id' => $invoice->id,
            'invoice_status' => $invoice->status]);
    }
}
