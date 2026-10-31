<?php

namespace App\Services\Purchasing;

use App\Jobs\SendPurchaseOrderEmail;
use App\Mail\PurchaseOrderIssued;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Emails confirmed LPOs to suppliers through the configured mailer, on the queue.
 * Each send is an attempt row (queued -> sending -> sent | failed). An order already being sent cannot
 * be queued again, and a retry reuses the same LPO number and stored PDF. A sent email only means the
 * message left the mail server, not that the supplier accepted the order.
 */
class PurchaseOrderMailService
{
    /** Attempts stuck in queued/sending longer than this (a stopped worker) may be retried. */
    private const STALE_MINUTES = 15;

    public function __construct(private readonly PurchaseOrderService $orders, private readonly PurchaseOrderPdfService $pdf) {}

    public function queue(int $bookshopId, array $branchIds, int $id, User $user, bool $resend = false): int
    {
        $attemptId = DB::transaction(function () use ($bookshopId, $branchIds, $id, $user, $resend) {
            $order = $this->orders->find($id, $bookshopId, $branchIds, true);
            if (! in_array($order->status, PurchaseOrderService::RECEIVABLE, true) || $order->lpo_number === null) {
                throw ValidationException::withMessages(['status' => 'Confirm the order before sending it to the supplier.']);
            }
            $email = trim((string) DB::table('suppliers')->where('bookshop_id', $bookshopId)->where('id', $order->supplier_id)->value('email'));
            if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
                throw ValidationException::withMessages(['email' => 'This supplier has no valid email address. Add one on the supplier, or download the PDF and mark the order as sent manually.']);
            }
            $inFlight = in_array($order->email_status, ['queued', 'sending'], true)
                && $order->email_last_attempt_at && now()->subMinutes(self::STALE_MINUTES)->lt($order->email_last_attempt_at);
            if ($inFlight) throw ValidationException::withMessages(['email' => 'This order is already being sent. Wait a moment and refresh.']);
            if ($order->email_status === 'sent' && ! $resend) {
                throw ValidationException::withMessages(['email' => 'This order was already emailed. Choose Resend to send it again.']);
            }
            $attemptId = DB::table('purchase_order_email_attempts')->insertGetId([
                'bookshop_id' => $bookshopId, 'purchase_order_id' => $id, 'requested_by' => $user->id, 'recipient' => $email,
                'status' => 'queued', 'created_at' => now(), 'updated_at' => now(),
            ]);
            DB::table('purchase_orders')->where('id', $id)->update(['email_status' => 'queued', 'email_last_attempt_at' => now(), 'updated_at' => now()]);
            $this->orders->event($bookshopId, $id, $user, $order->email_status === 'not_sent' ? 'email_queued' : 'email_requeued', $order->status, $order->status, "To $email");

            return $attemptId;
        });
        SendPurchaseOrderEmail::dispatch($attemptId)->afterCommit();

        return $attemptId;
    }

    /** Runs inside the queue worker. Safe to call twice: only a queued attempt is sent. */
    public function deliver(int $attemptId): void
    {
        $attempt = DB::transaction(function () use ($attemptId) {
            $attempt = DB::table('purchase_order_email_attempts')->where('id', $attemptId)->lockForUpdate()->first();
            if (! $attempt || $attempt->status !== 'queued') return null;
            DB::table('purchase_order_email_attempts')->where('id', $attemptId)->update(['status' => 'sending', 'attempted_at' => now(), 'updated_at' => now()]);
            DB::table('purchase_orders')->where('id', $attempt->purchase_order_id)->update(['email_status' => 'sending', 'email_last_attempt_at' => now()]);

            return $attempt;
        });
        if (! $attempt) return;

        $bookshopId = (int) $attempt->bookshop_id;
        $orderId = (int) $attempt->purchase_order_id;
        try {
            $order = DB::table('purchase_orders')->where('id', $orderId)->first();
            $supplier = DB::table('suppliers')->where('id', $order->supplier_id)->first();
            $bookshop = DB::table('bookshops')->where('id', $bookshopId)->first();
            $profile = DB::table('business_profiles')->where('bookshop_id', $bookshopId)->first();
            $name = $profile->name ?? $bookshop->name;
            $replyTo = $profile->email ?? $bookshop->business_email ?? null;
            $contact = array_values(array_filter([
                $profile->phone ?? $bookshop->phone ?? null,
                $replyTo,
                trim(implode(', ', array_filter([$profile->address ?? null, $profile->city ?? $bookshop->location ?? null]))) ?: null,
            ]));
            Mail::to($attempt->recipient, $supplier->contact_person ?: $supplier->name)->send(new PurchaseOrderIssued(
                $order->lpo_number, $name, $supplier->contact_person ?: $supplier->name, $contact,
                $this->pdf->contents($bookshopId, $orderId), filter_var($replyTo, FILTER_VALIDATE_EMAIL) ? $replyTo : null,
            ));
        } catch (Throwable $exception) {
            report($exception);
            $this->finish($attempt, false, mb_substr($exception->getMessage(), 0, 1000) ?: 'The mail server rejected the message.');

            return;
        }
        $this->finish($attempt, true);
    }

    private function finish(object $attempt, bool $sent, ?string $error = null): void
    {
        DB::transaction(function () use ($attempt, $sent, $error) {
            $order = DB::table('purchase_orders')->where('id', $attempt->purchase_order_id)->lockForUpdate()->first();
            DB::table('purchase_order_email_attempts')->where('id', $attempt->id)->update([
                'status' => $sent ? 'sent' : 'failed', 'error' => $error, 'sent_at' => $sent ? now() : null, 'updated_at' => now(),
            ]);
            $changes = ['email_status' => $sent ? 'sent' : 'failed', 'updated_at' => now()];
            if ($sent) {
                $changes['email_sent_at'] = now();
                $changes['delivery_method'] = 'email';
                if ($order->status === 'confirmed') $changes['status'] = 'sent';
            }
            DB::table('purchase_orders')->where('id', $order->id)->update($changes);
            $this->orders->event((int) $attempt->bookshop_id, (int) $order->id, null, $sent ? 'email_sent' : 'email_failed', $order->status, $changes['status'] ?? $order->status, $sent ? "Emailed to {$attempt->recipient}" : $error);
        });
    }
}
