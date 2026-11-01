<?php

namespace App\Console\Commands;

use App\Services\Billing\BillingHealth;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class DiagnoseBilling extends Command
{
    protected $signature = 'billing:diagnose';

    protected $description = 'Explain why M-Pesa payments are or are not confirmed automatically (no secrets shown)';

    public function handle(BillingHealth $health): int
    {
        foreach ($health->checks() as $check) {
            $this->line(($check['ok'] ? '<info>OK</info>   ' : '<error>FIX</error>  ').$check['title'].': '.$check['detail']);
            if ($check['fix']) $this->line('       → '.$check['fix']);
        }
        $this->newLine();
        $this->line('Latest payments in saf_payments:');
        $this->table(['id', 'date', 'channel', 'account', 'code', 'amount', 'status', 'reason'], DB::table('saf_payments')->orderByDesc('id')->limit(10)->get()
            ->map(fn ($r) => [$r->id, $r->transaction_date, $r->payment_channel, $r->account_number, $r->mpesa_receipt_number ?? '—', $r->amount, $r->verification_status, mb_substr((string) $r->exception_reason, 0, 60)])->all());

        return self::SUCCESS;
    }
}
