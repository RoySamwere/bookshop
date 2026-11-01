<?php

namespace App\Http\Controllers\Platform;

use App\Http\Controllers\Controller;
use App\Jobs\VerifySafPayment;
use App\Models\AuditLog;
use App\Services\Billing\SafPaymentReconciler;
use Illuminate\Database\Query\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Platform "Bills": every M-Pesa transaction in saf_payments, with summary cards, filters, details,
 * export and exception handling. Viewing needs platform.settings.view; changing anything needs
 * platform.settings.manage. Tenant accounts never reach these routes.
 */
class BillsController extends Controller
{
    public const STATUSES = ['pending', 'verified', 'reconciled', 'unmatched', 'rejected'];

    public function index(Request $request)
    {
        $filters = $this->filters($request);
        $page = $this->query($filters)->orderByDesc(DB::raw('COALESCE(s.transaction_date, s.created_at)'))->orderByDesc('s.id')
            ->paginate((int) ($filters['per_page'] ?? 25));
        $page->through(fn ($row) => $this->present($row));

        return response()->json([...$page->toArray(), 'summary' => $this->summary($filters['environment'] ?? null)]);
    }

    /** Up to 5,000 rows for CSV/Excel export, with the same filters as the list. */
    public function export(Request $request)
    {
        $filters = $this->filters($request);
        $rows = $this->query($filters)->orderByDesc(DB::raw('COALESCE(s.transaction_date, s.created_at)'))->orderByDesc('s.id')->limit(5000)->get()
            ->map(fn ($row) => $this->present($row));
        AuditLog::record('billing.bills_exported', 'Exported M-Pesa bills', null, ['filters' => $filters, 'rows' => $rows->count()]);

        return response()->json(['data' => $rows, 'truncated' => $rows->count() === 5000]);
    }

    public function show(int $payment)
    {
        $row = $this->query([])->where('s.id', $payment)->first();
        abort_unless($row, 404);
        $invoice = $row->invoice_id ? DB::table('platform_billing_invoices')->where('id', $row->invoice_id)->first() : null;
        $paid = $invoice ? (float) DB::table('platform_billing_payments')->where('platform_billing_invoice_id', $invoice->id)->where('status', 'confirmed')->sum('amount') : null;
        $candidates = $row->verification_status === 'unmatched'
            ? DB::table('platform_billing_invoices as i')->join('bookshops as b', 'b.id', '=', 'i.bookshop_id')
                ->where('i.environment', $row->environment)->whereIn('i.status', ['pending', 'partially_paid'])
                ->orderByRaw('CASE WHEN i.amount = ? THEN 0 ELSE 1 END', [$row->amount])->orderByDesc('i.id')->limit(20)
                ->get(['i.id', 'i.account_number', 'i.amount', 'i.status', 'b.name as bookshop'])
            : collect();

        return response()->json(['data' => [
            ...$this->present($row),
            'provider_payload' => json_decode($row->provider_payload ?? '{}', true) ?: new \stdClass,
            'verification_request_id' => $row->verification_request_id ? '…'.substr($row->verification_request_id, -6) : null,
            'invoice' => $invoice ? ['id' => $invoice->id, 'account_number' => $invoice->account_number, 'amount' => (float) $invoice->amount,
                'status' => $invoice->status, 'paid' => $paid, 'balance' => max(0, round((float) $invoice->amount - $paid, 2)),
                'period_starts_at' => $invoice->period_starts_at, 'period_ends_at' => $invoice->period_ends_at] : null,
            'candidate_invoices' => $candidates,
            'history' => DB::table('audit_logs')->where(fn ($q) => $q->where('metadata', 'like', '%"saf_payment_id":'.$row->id.',%')->orWhere('metadata', 'like', '%"saf_payment_id":'.$row->id.'}%'))->orderByDesc('id')->limit(20)
                ->get(['id', 'action', 'description', 'created_at', 'user_id']),
        ]]);
    }

    /** Ask Safaricom again (pending, or an unmatched row that was never verified). */
    public function retry(Request $request, int $payment)
    {
        $row = DB::table('saf_payments')->where('id', $payment)->first();
        abort_unless($row, 404);
        if (! in_array($row->verification_status, ['pending', 'unmatched'], true)) {
            throw ValidationException::withMessages(['payment' => 'Only pending or unmatched payments can be checked again.']);
        }
        DB::table('saf_payments')->where('id', $payment)->update([
            'verification_status' => $row->verified_at ? 'verified' : 'pending', 'verification_attempts' => 0,
            'verification_request_id' => null, 'verification_conversation_id' => null,
            'next_verification_at' => now(), 'exception_reason' => null, 'updated_at' => now(),
        ]);
        AuditLog::record('billing.payment_recheck', 'Requested automatic re-verification of an M-Pesa payment', null, ['saf_payment_id' => $payment]);
        VerifySafPayment::dispatch($payment);

        return $this->show($payment);
    }

    /**
     * Allocate a provider-verified payment that could not be matched (for example the customer typed the
     * wrong account number) to the correct invoice. The money itself must already be verified by Safaricom.
     */
    public function assign(Request $request, int $payment, SafPaymentReconciler $reconciler)
    {
        $data = $request->validate(['account_number' => ['required', 'regex:/^[0-9]{6}$/'], 'note' => 'required|string|max:500']);
        $row = DB::table('saf_payments')->where('id', $payment)->first();
        abort_unless($row, 404);
        if ($row->verification_status !== 'unmatched' || ! $row->verified_at) {
            throw ValidationException::withMessages(['payment' => 'Only provider-verified payments in the exception queue can be assigned. Re-check unverified payments first.']);
        }
        $status = $reconciler->process($payment, $data['account_number'], $request->user(), $data['note']);
        if ($status !== 'reconciled') {
            throw ValidationException::withMessages(['payment' => DB::table('saf_payments')->where('id', $payment)->value('exception_reason') ?? 'Payment could not be assigned.']);
        }

        return $this->show($payment);
    }

    /** Close an exception without crediting anything (duplicate, fraud, refunded outside the system). */
    public function reject(Request $request, int $payment)
    {
        $data = $request->validate(['reason' => 'required|string|max:500']);

        return DB::transaction(function () use ($request, $payment, $data) {
            $row = DB::table('saf_payments')->where('id', $payment)->lockForUpdate()->first();
            abort_unless($row, 404);
            if (! in_array($row->verification_status, ['pending', 'unmatched'], true)) {
                throw ValidationException::withMessages(['payment' => 'Credited or already closed payments cannot be rejected.']);
            }
            DB::table('saf_payments')->where('id', $payment)->update([
                'verification_status' => 'rejected', 'resolved_by' => $request->user()->id, 'resolution_note' => $data['reason'],
                'next_verification_at' => null, 'updated_at' => now(),
            ]);
            AuditLog::record('billing.payment_rejected', 'Closed an M-Pesa payment without credit', null, ['saf_payment_id' => $payment, 'reason' => $data['reason']], $request->user(), $row->bookshop_id);

            return $this->show($payment);
        });
    }

    /** Summary cards for the current filter environment (defaults to the server's payment environment). */
    public function summary(?string $environment = null): array
    {
        $environment ??= (string) config('services.mpesa.environment');
        $base = fn () => DB::table('saf_payments')->where('environment', $environment);
        $today = now('Africa/Nairobi')->startOfDay()->setTimezone(config('app.timezone'));
        $collected = fn ($q) => $q->where('verification_status', 'reconciled');
        $open = DB::table('platform_billing_invoices as i')->where('i.environment', $environment)->whereIn('i.status', ['pending', 'partially_paid'])
            ->select('i.amount')->selectSub(DB::table('platform_billing_payments as p')->selectRaw('COALESCE(SUM(p.amount),0)')
                ->whereColumn('p.platform_billing_invoice_id', 'i.id')->where('p.status', 'confirmed'), 'paid')->get();
        $outstanding = (object) ['invoices' => $open->count(), 'balance' => $open->sum(fn ($i) => max(0, (float) $i->amount - (float) $i->paid))];

        return [
            'environment' => $environment,
            'paybill' => \App\Services\PlatformPaymentSettlementService::expectedShortcode($environment),
            'verified_collections' => round((float) $collected($base())->sum('amount'), 2),
            'verified_count' => $collected($base())->count(),
            'today_collections' => round((float) $collected($base())->where(DB::raw('COALESCE(transaction_date, created_at)'), '>=', $today)->sum('amount'), 2),
            'today_count' => $collected($base())->where(DB::raw('COALESCE(transaction_date, created_at)'), '>=', $today)->count(),
            'pending_count' => $base()->whereIn('verification_status', ['pending', 'verified'])->count(),
            'pending_amount' => round((float) $base()->whereIn('verification_status', ['pending', 'verified'])->sum('amount'), 2),
            'unmatched_count' => $base()->where('verification_status', 'unmatched')->count(),
            'unmatched_amount' => round((float) $base()->where('verification_status', 'unmatched')->sum('amount'), 2),
            'excess_amount' => round((float) $collected($base())->sum('excess_amount'), 2),
            'outstanding_invoices' => (int) ($outstanding->invoices ?? 0),
            'outstanding_balance' => round(max(0, (float) ($outstanding->balance ?? 0)), 2),
        ];
    }

    private function filters(Request $request): array
    {
        return $request->validate([
            'search' => 'nullable|string|max:80',
            'status' => ['nullable', Rule::in(self::STATUSES)],
            'channel' => 'nullable|in:stk,paybill',
            'environment' => 'nullable|in:production,sandbox,legacy',
            'bookshop_id' => 'nullable|integer',
            'from' => 'nullable|date',
            'to' => 'nullable|date|after_or_equal:from',
            'per_page' => 'nullable|integer|min:10|max:100',
        ]);
    }

    private function query(array $filters): Builder
    {
        $search = trim((string) ($filters['search'] ?? ''));

        return DB::table('saf_payments as s')
            // Before allocation, show the bookshop whose invoice carries the account number (display only).
            ->leftJoin('platform_billing_invoices as ai', fn ($join) => $join->on('ai.account_number', '=', 's.account_number')->whereNull('s.bookshop_id'))
            ->leftJoin('bookshops as b', 'b.id', '=', DB::raw('COALESCE(s.bookshop_id, ai.bookshop_id)'))
            ->leftJoin('platform_billing_invoices as i', 'i.id', '=', 's.invoice_id')
            ->leftJoin('users as u', 'u.id', '=', 's.resolved_by')
            ->when($filters['status'] ?? null, fn ($q, $v) => $q->where('s.verification_status', $v))
            ->when($filters['channel'] ?? null, fn ($q, $v) => $q->where('s.payment_channel', $v))
            ->when($filters['environment'] ?? null, fn ($q, $v) => $q->where('s.environment', $v))
            ->when($filters['bookshop_id'] ?? null, fn ($q, $v) => $q->where('s.bookshop_id', $v))
            ->when($filters['from'] ?? null, fn ($q, $v) => $q->where(DB::raw('COALESCE(s.transaction_date, s.created_at)'), '>=', Carbon::parse($v, 'Africa/Nairobi')->startOfDay()->setTimezone(config('app.timezone'))))
            ->when($filters['to'] ?? null, fn ($q, $v) => $q->where(DB::raw('COALESCE(s.transaction_date, s.created_at)'), '<=', Carbon::parse($v, 'Africa/Nairobi')->endOfDay()->setTimezone(config('app.timezone'))))
            ->when($search !== '', fn ($q) => $q->where(fn ($w) => $w
                ->where('s.mpesa_receipt_number', 'like', '%'.strtoupper($search).'%')
                ->orWhere('s.account_number', 'like', "%$search%")
                ->when(strlen(preg_replace('/\D/', '', $search)) >= 3, fn ($p) => $p->orWhere('s.phone_number', 'like', '%'.preg_replace('/\D/', '', $search).'%'))
                ->orWhere('b.name', 'like', "%$search%")))
            ->select('s.*', 'b.name as bookshop_name', 'i.account_number as invoice_account', 'i.status as invoice_status', 'u.name as resolved_by_name');
    }

    private function present(object $row): array
    {
        return [
            'id' => (int) $row->id, 'transaction_date' => $row->transaction_date ?? $row->created_at,
            'bookshop_id' => $row->bookshop_id ? (int) $row->bookshop_id : null, 'bookshop_name' => $row->bookshop_name,
            'invoice_id' => $row->invoice_id ? (int) $row->invoice_id : null, 'invoice_status' => $row->invoice_status,
            'account_number' => $row->account_number, 'mpesa_receipt_number' => $row->mpesa_receipt_number,
            'phone_number' => $row->phone_number, 'amount' => round((float) $row->amount, 2),
            'allocated_amount' => round((float) $row->allocated_amount, 2), 'excess_amount' => round((float) $row->excess_amount, 2),
            'shortcode' => $row->shortcode, 'payment_channel' => $row->payment_channel, 'environment' => $row->environment,
            'status' => $row->verification_status, 'verification_source' => $row->verification_source,
            'verification_reference' => $row->verification_reference, 'verified_at' => $row->verified_at,
            'verification_attempts' => (int) $row->verification_attempts, 'next_verification_at' => $row->next_verification_at,
            'exception_reason' => $row->exception_reason, 'resolution_note' => $row->resolution_note, 'resolved_by' => $row->resolved_by_name,
            'reconciled_at' => $row->reconciled_at, 'confirmation_sent_at' => $row->confirmation_sent_at, 'created_at' => $row->created_at,
        ];
    }
}
