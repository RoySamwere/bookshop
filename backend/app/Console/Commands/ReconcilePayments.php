<?php

namespace App\Console\Commands;

use App\Services\Billing\SafPaymentLedger;
use App\Services\Billing\SafPaymentReconciler;
use App\Services\Billing\SafPaymentVerifier;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * The automatic reconciliation loop (runs every minute):
 *  1. STK requests with no callback after two minutes get a ledger row so they are verified anyway.
 *  2. Pending ledger rows that are due are verified with Safaricom.
 *  3. Verified rows are allocated to invoices.
 */
class ReconcilePayments extends Command
{
    protected $signature = 'billing:reconcile-payments {--limit=100}';

    protected $description = 'Verify received M-Pesa payments with Safaricom and apply them to invoices automatically';

    public function handle(SafPaymentLedger $ledger, SafPaymentVerifier $verifier, SafPaymentReconciler $reconciler): int
    {
        $environment = config('services.mpesa.environment');
        $limit = max(1, (int) $this->option('limit'));
        $attempts = DB::table('platform_billing_payments as p')
            ->leftJoin('saf_payments as s', 's.stk_attempt_id', '=', 'p.id')
            ->whereNull('s.id')->where('p.channel', 'stk')->where('p.environment', $environment)
            ->whereIn('p.status', ['pending', 'awaiting_verification'])->whereNotNull('p.checkout_request_id')
            ->where('p.created_at', '<=', now()->subMinutes(2))->orderBy('p.id')->limit($limit)->select('p.*')->get();
        foreach ($attempts as $attempt) {
            $ledger->recordStk($attempt);
        }

        app(\App\Services\Billing\SafPaymentSync::class)->recoverCodes($environment, 100);

        $due = DB::table('saf_payments')->where('environment', $environment)
            ->where(fn ($q) => $q->where('verification_status', 'verified')
                ->orWhere(fn ($p) => $p->where('verification_status', 'pending')->where('next_verification_at', '<=', now())))
            ->orderBy('id')->limit($limit)->pluck('id');
        $results = [];
        foreach ($due as $id) {
            try {
                $status = $verifier->handle((int) $id);
                $results[$status] = ($results[$status] ?? 0) + 1;
            } catch (Throwable $exception) {
                report($exception);
                $this->warn("Payment {$id} could not be processed; it will be retried.");
            }
        }
        // STK payments verified before their callback arrived: fetch the SMS confirmation code from Safaricom.
        if (config('services.mpesa.c2b_verification') === 'pull_api') {
            $missing = DB::table('saf_payments')->where('environment', $environment)->where('payment_channel', 'stk')->whereNull('mpesa_receipt_number')
                ->whereIn('verification_status', ['verified', 'reconciled'])->where('created_at', '>=', now()->subDays(3))->orderBy('id')->limit(20)->pluck('id');
            foreach ($missing as $id) $verifier->lookupStkReceipt((int) $id);
        }
        $this->line(json_encode(['environment' => $environment, 'processed' => $due->count(), 'results' => $results]));

        return self::SUCCESS;
    }
}
