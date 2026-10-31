<?php

namespace App\Services\Purchasing;

use App\Models\AuditLog;
use App\Models\User;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * The Local Purchase Order workflow. Everything is scoped to one bookshop (the authenticated tenant)
 * and to the branches the user works in. Status changes run in transactions with the order row locked,
 * so two people acting on the same order cannot both succeed.
 *
 *   draft -> [pending_approval -> approved] -> confirmed -> sent -> partially_received -> completed
 *   any open state -> cancelled (receiving-started orders cancel only their outstanding quantity)
 *
 * Order status is separate from email delivery (email_status); confirming or emailing never changes stock.
 */
class PurchaseOrderService
{
    public const STATUSES = ['draft', 'pending_approval', 'approved', 'confirmed', 'sent', 'partially_received', 'completed', 'cancelled'];
    public const EDITABLE = ['draft'];
    public const AMENDABLE = ['confirmed', 'sent', 'partially_received'];
    public const RECEIVABLE = ['confirmed', 'sent', 'partially_received'];

    public function __construct(
        private readonly PurchaseOrderNumberService $numbers,
        private readonly ReorderSuggestionService $reorder,
        private readonly PurchaseOrderPdfService $pdf,
    ) {}

    public function query(int $bookshopId, array $branchIds): Builder
    {
        return DB::table('purchase_orders')->where('bookshop_id', $bookshopId)->whereIn('branch_id', $branchIds ?: [0]);
    }

    /** Loads an order the user may see, optionally locked for update; 404 for anything else. */
    public function find(int $id, int $bookshopId, array $branchIds, bool $lock = false): object
    {
        $query = $this->query($bookshopId, $branchIds)->where('id', $id);
        $order = ($lock ? $query->lockForUpdate() : $query)->first();
        if (! $order) throw new HttpException(404, 'Purchase order not found.');

        return $order;
    }

    // ---------------------------------------------------------------- drafts

    public function createDraft(int $bookshopId, User $user, array $data): int
    {
        return DB::transaction(function () use ($bookshopId, $user, $data) {
            $this->assertOwned($bookshopId, 'suppliers', $data['supplier_id'], 'supplier_id');
            $this->assertOwned($bookshopId, 'branches', $data['branch_id'], 'branch_id');
            $defaults = $this->defaults($bookshopId, (int) $data['supplier_id']);
            $id = DB::table('purchase_orders')->insertGetId([
                'bookshop_id' => $bookshopId,
                'supplier_id' => $data['supplier_id'],
                'branch_id' => $data['branch_id'],
                'created_by' => $user->id,
                'status' => 'draft',
                'order_date' => $data['order_date'] ?? now()->toDateString(),
                'expected_date' => $data['expected_date'] ?? $defaults['expected_date'],
                'delivery_location' => $data['delivery_location'] ?? $defaults['delivery_location'],
                'payment_terms' => $data['payment_terms'] ?? $defaults['payment_terms'],
                'internal_notes' => $data['internal_notes'] ?? null,
                'supplier_notes' => $data['supplier_notes'] ?? null,
                'currency' => $defaults['currency'],
                'tax_rate' => $data['tax_rate'] ?? $defaults['tax_rate'],
                'prices_include_tax' => $data['prices_include_tax'] ?? $defaults['prices_include_tax'],
                'email_status' => 'not_sent',
                'created_at' => now(), 'updated_at' => now(),
            ]);
            $this->replaceItems($bookshopId, $id, $data['items'] ?? []);
            $this->recalculate($id);
            $this->event($bookshopId, $id, $user, 'created', null, 'draft', $data['event_notes'] ?? null);

            return $id;
        });
    }

    public function updateDraft(int $bookshopId, array $branchIds, int $id, User $user, array $data): void
    {
        DB::transaction(function () use ($bookshopId, $branchIds, $id, $user, $data) {
            $order = $this->find($id, $bookshopId, $branchIds, true);
            $this->assertStatus($order, self::EDITABLE, 'Only draft orders can be edited. Use Amend for confirmed orders.');
            if (isset($data['supplier_id'])) $this->assertOwned($bookshopId, 'suppliers', $data['supplier_id'], 'supplier_id');
            if (isset($data['branch_id'])) {
                $this->assertOwned($bookshopId, 'branches', $data['branch_id'], 'branch_id');
                if (! in_array((int) $data['branch_id'], $branchIds, true)) throw ValidationException::withMessages(['branch_id' => 'You do not work in that branch.']);
            }
            $fields = array_intersect_key($data, array_flip(['supplier_id', 'branch_id', 'order_date', 'expected_date', 'delivery_location', 'payment_terms', 'internal_notes', 'supplier_notes', 'tax_rate', 'prices_include_tax']));
            DB::table('purchase_orders')->where('id', $id)->update([...$fields, 'rejection_reason' => null, 'updated_at' => now()]);
            if (array_key_exists('items', $data)) $this->replaceItems($bookshopId, $id, $data['items']);
            $this->recalculate($id);
            $this->event($bookshopId, $id, $user, 'updated', 'draft', 'draft');
        });
    }

    public function deleteDraft(int $bookshopId, array $branchIds, int $id, User $user): void
    {
        DB::transaction(function () use ($bookshopId, $branchIds, $id, $user) {
            $order = $this->find($id, $bookshopId, $branchIds, true);
            if ($order->status !== 'draft' || $order->lpo_number !== null) {
                throw ValidationException::withMessages(['status' => 'Only unnumbered drafts can be deleted. Cancel confirmed orders instead.']);
            }
            DB::table('purchase_orders')->where('id', $id)->delete();
            AuditLog::record('purchase_order.draft_deleted', "Deleted draft purchase order #{$id}", null, ['purchase_order_id' => $id], $user, $bookshopId);
        });
    }

    /**
     * Turns reviewed reorder lines into one draft per supplier.
     * Lines for products already on order are refused unless the user explicitly confirms the extra order.
     *
     * @return int[] ids of the drafts created
     */
    public function generateDrafts(int $bookshopId, User $user, int $branchId, array $lines, bool $allowOutstanding): array
    {
        $this->assertOwned($bookshopId, 'branches', $branchId, 'branch_id');
        $lines = array_values(array_filter($lines, fn ($line) => (int) ($line['quantity'] ?? 0) > 0));
        if (! $lines) throw ValidationException::withMessages(['items' => 'Add at least one product with a quantity.']);
        foreach ($lines as $index => $line) {
            if (empty($line['supplier_id'])) throw ValidationException::withMessages(["items.$index.supplier_id" => 'Choose a supplier for every product.']);
        }
        if (! $allowOutstanding) $this->assertNotAlreadyOnOrder($bookshopId, $branchId, $lines);

        return DB::transaction(function () use ($bookshopId, $user, $branchId, $lines) {
            $ids = [];
            foreach (collect($lines)->groupBy('supplier_id') as $supplierId => $supplierLines) {
                $ids[] = $this->createDraft($bookshopId, $user, [
                    'supplier_id' => (int) $supplierId, 'branch_id' => $branchId,
                    'items' => $supplierLines->all(), 'event_notes' => 'Generated from reorder suggestions',
                ]);
            }

            return $ids;
        });
    }

    // ---------------------------------------------------------------- workflow

    public function submit(int $bookshopId, array $branchIds, int $id, User $user): void
    {
        $this->transition($bookshopId, $branchIds, $id, $user, ['draft'], 'pending_approval', 'submitted', function ($order) use ($user) {
            $this->assertHasItems($order->id);

            return ['submitted_by' => $user->id, 'submitted_at' => now(), 'rejection_reason' => null];
        });
    }

    public function approve(int $bookshopId, array $branchIds, int $id, User $user): void
    {
        // Draft is accepted too, so the older "approve" endpoint keeps working.
        $this->transition($bookshopId, $branchIds, $id, $user, ['pending_approval', 'draft'], 'approved', 'approved', function ($order) use ($user) {
            $this->assertHasItems($order->id);

            return ['approved_by' => $user->id, 'approved_at' => now(), 'rejection_reason' => null];
        });
    }

    public function reject(int $bookshopId, array $branchIds, int $id, User $user, string $reason): void
    {
        $this->transition($bookshopId, $branchIds, $id, $user, ['pending_approval', 'approved'], 'draft', 'rejected',
            fn () => ['rejection_reason' => $reason, 'approved_by' => null, 'approved_at' => null], $reason);
    }

    /** Confirms the order: issues its LPO number, freezes totals and stores the PDF. Stock does not change. */
    public function confirm(int $bookshopId, array $branchIds, int $id, User $user, bool $acknowledgeOutstanding = false): object
    {
        $settings = PurchasingSettings::for($bookshopId);
        $allowed = $settings['approval_required'] ? ['approved'] : ['draft', 'approved'];

        DB::transaction(function () use ($bookshopId, $branchIds, $id, $user, $allowed, $acknowledgeOutstanding, $settings) {
            $order = $this->find($id, $bookshopId, $branchIds, true);
            if ($order->status === 'draft' && $settings['approval_required']) {
                throw ValidationException::withMessages(['status' => 'This bookshop requires approval before an order can be confirmed. Submit it for approval first.']);
            }
            $this->assertStatus($order, $allowed, 'This order cannot be confirmed from its current status.');
            $this->assertHasItems($id);
            $supplier = DB::table('suppliers')->where('bookshop_id', $bookshopId)->where('id', $order->supplier_id)->first();
            if (! $supplier || ! $supplier->is_active) throw ValidationException::withMessages(['supplier_id' => 'The supplier is inactive. Choose an active supplier.']);
            if (! $acknowledgeOutstanding) {
                $items = DB::table('purchase_order_items')->where('purchase_order_id', $id)->get();
                $this->assertNotAlreadyOnOrder($bookshopId, (int) $order->branch_id, $items->map(fn ($i) => ['book_id' => $i->book_id])->all(), $id);
            }
            $this->recalculate($id);
            $number = $order->lpo_number ?? $this->numbers->next($bookshopId);
            DB::table('purchase_orders')->where('id', $id)->update([
                'lpo_number' => $number, 'status' => 'confirmed', 'confirmed_by' => $user->id, 'confirmed_at' => now(),
                'order_date' => $order->order_date ?? now()->toDateString(), 'updated_at' => now(),
            ]);
            $this->event($bookshopId, $id, $user, 'confirmed', $order->status, 'confirmed', "Issued $number", $this->snapshot($id));
            AuditLog::record('purchase_order.confirmed', "Confirmed purchase order $number", null, ['purchase_order_id' => $id, 'lpo_number' => $number], $user, $bookshopId);
        });
        $this->pdf->store($bookshopId, $id);

        return $this->find($id, $bookshopId, $branchIds);
    }

    /** Changes a confirmed order. The previous version is kept in the event history and a new PDF is stored. */
    public function amend(int $bookshopId, array $branchIds, int $id, User $user, array $data, string $reason): void
    {
        DB::transaction(function () use ($bookshopId, $branchIds, $id, $user, $data, $reason) {
            $order = $this->find($id, $bookshopId, $branchIds, true);
            $this->assertStatus($order, self::AMENDABLE, 'Only confirmed orders that are not complete can be amended.');
            $before = $this->snapshot($id);
            $fields = array_intersect_key($data, array_flip(['expected_date', 'delivery_location', 'payment_terms', 'internal_notes', 'supplier_notes', 'tax_rate', 'prices_include_tax']));

            if (array_key_exists('items', $data)) {
                $existing = DB::table('purchase_order_items')->where('purchase_order_id', $id)->get()->keyBy('id');
                $kept = [];
                foreach ($data['items'] as $index => $line) {
                    if (! empty($line['id'])) {
                        $item = $existing->get((int) $line['id']);
                        if (! $item) throw ValidationException::withMessages(["items.$index.id" => 'That line does not belong to this order.']);
                        $floor = (int) $item->received_quantity + (int) $item->cancelled_quantity;
                        if ((int) $line['quantity'] < $floor) throw ValidationException::withMessages(["items.$index.quantity" => "Cannot go below the $floor already received or cancelled."]);
                        DB::table('purchase_order_items')->where('id', $item->id)->update([
                            'quantity' => (int) $line['quantity'], 'unit_cost' => round((float) $line['unit_cost'], 2),
                            'discount' => round((float) ($line['discount'] ?? 0), 2), 'position' => $index, 'updated_at' => now(),
                        ]);
                        $kept[] = $item->id;
                    } else {
                        $kept[] = $this->insertItem($bookshopId, $id, $line, $index);
                    }
                }
                foreach ($existing as $item) {
                    if (in_array($item->id, $kept, true)) continue;
                    if ((int) $item->received_quantity > 0) throw ValidationException::withMessages(['items' => "{$item->description} has deliveries and cannot be removed."]);
                    DB::table('purchase_order_items')->where('id', $item->id)->delete();
                }
                $this->assertHasItems($id);
            }

            DB::table('purchase_orders')->where('id', $id)->update([...$fields, 'version' => (int) $order->version + 1, 'updated_at' => now()]);
            $this->recalculate($id);
            $this->event($bookshopId, $id, $user, 'amended', $order->status, $order->status, $reason, $before, (int) $order->version);
            AuditLog::record('purchase_order.amended', "Amended purchase order {$order->lpo_number}", null, ['purchase_order_id' => $id, 'reason' => $reason, 'previous_version' => (int) $order->version], $user, $bookshopId);
        });
        $this->pdf->store($bookshopId, $id);
    }

    /** Cancels an order; once goods have arrived only the outstanding quantity is cancelled. */
    public function cancel(int $bookshopId, array $branchIds, int $id, User $user, string $reason): void
    {
        DB::transaction(function () use ($bookshopId, $branchIds, $id, $user, $reason) {
            $order = $this->find($id, $bookshopId, $branchIds, true);
            $this->assertStatus($order, ['draft', 'pending_approval', 'approved', 'confirmed', 'sent', 'partially_received'], 'This order is already closed.');
            $received = (int) DB::table('purchase_order_items')->where('purchase_order_id', $id)->sum('received_quantity');
            DB::table('purchase_order_items')->where('purchase_order_id', $id)->update([
                'cancelled_quantity' => DB::raw('quantity - received_quantity'), 'updated_at' => now(),
            ]);
            $to = $received > 0 ? 'completed' : 'cancelled';
            DB::table('purchase_orders')->where('id', $id)->update([
                'status' => $to, 'cancellation_reason' => $reason, 'cancelled_by' => $user->id, 'cancelled_at' => now(),
                'completed_at' => $to === 'completed' ? now() : null, 'updated_at' => now(),
            ]);
            $this->event($bookshopId, $id, $user, $received > 0 ? 'outstanding_cancelled' : 'cancelled', $order->status, $to, $reason);
            AuditLog::record('purchase_order.cancelled', 'Cancelled purchase order '.($order->lpo_number ?? "#$id"), null, ['purchase_order_id' => $id, 'reason' => $reason, 'outstanding_only' => $received > 0], $user, $bookshopId);
        });
    }

    /** For suppliers without email: the order was printed or handed over another way. */
    public function markSentManually(int $bookshopId, array $branchIds, int $id, User $user, ?string $notes): void
    {
        $this->transition($bookshopId, $branchIds, $id, $user, ['confirmed'], 'sent', 'sent_manually',
            fn () => ['delivery_method' => 'manual'], $notes ?: 'Delivered to supplier outside email (printed, hand-delivered or shared manually).');
    }

    // ---------------------------------------------------------------- reading

    public function detail(int $bookshopId, array $branchIds, int $id, User $user): array
    {
        $order = $this->find($id, $bookshopId, $branchIds);
        $items = DB::table('purchase_order_items as poi')->leftJoin('books as b', 'b.id', '=', 'poi.book_id')
            ->where('poi.purchase_order_id', $id)->orderBy('poi.position')->orderBy('poi.id')
            ->get(['poi.*', 'b.title as book_title', 'b.sku as book_sku', 'b.isbn as book_isbn']);
        $supplier = DB::table('suppliers')->where('id', $order->supplier_id)->first(['id', 'name', 'contact_person', 'email', 'phone', 'address', 'payment_terms', 'lead_time_days', 'is_active']);
        $names = DB::table('users')->whereIn('id', array_filter([$order->created_by, $order->submitted_by, $order->approved_by, $order->confirmed_by, $order->cancelled_by]))->pluck('name', 'id');
        $receipts = DB::table('goods_receipts as gr')->leftJoin('users as u', 'u.id', '=', 'gr.received_by')
            ->where('gr.purchase_order_id', $id)->orderByDesc('gr.id')
            ->get(['gr.id', 'gr.reference', 'gr.delivery_note_number', 'gr.received_on', 'gr.notes', 'gr.created_at', 'u.name as received_by']);
        $receiptItems = DB::table('goods_receipt_items')->whereIn('goods_receipt_id', $receipts->pluck('id')->all() ?: [0])->get()->groupBy('goods_receipt_id');

        return [
            ...$this->summarize($order),
            'supplier' => $supplier,
            'branch' => DB::table('branches')->where('id', $order->branch_id)->first(['id', 'name', 'code']),
            'people' => [
                'created_by' => $names[$order->created_by] ?? null, 'submitted_by' => $names[$order->submitted_by] ?? null,
                'approved_by' => $names[$order->approved_by] ?? null, 'confirmed_by' => $names[$order->confirmed_by] ?? null,
                'cancelled_by' => $names[$order->cancelled_by] ?? null,
            ],
            'items' => $items->map(fn ($item) => [
                'id' => (int) $item->id, 'book_id' => (int) $item->book_id,
                'description' => $item->description ?? $item->book_title, 'sku' => $item->sku ?? $item->book_sku, 'isbn' => $item->isbn ?? $item->book_isbn,
                'product_unit_id' => $item->product_unit_id ? (int) $item->product_unit_id : null, 'unit_label' => $item->unit_label, 'units_per_package' => (int) $item->units_per_package,
                'quantity' => (int) $item->quantity, 'received_quantity' => (int) $item->received_quantity, 'cancelled_quantity' => (int) $item->cancelled_quantity,
                'outstanding_quantity' => max(0, (int) $item->quantity - (int) $item->received_quantity - (int) $item->cancelled_quantity),
                'unit_cost' => round((float) $item->unit_cost, 2), 'discount' => round((float) $item->discount, 2), 'line_total' => round((float) $item->line_total, 2),
            ])->values(),
            'receipts' => $receipts->map(fn ($receipt) => [
                'id' => (int) $receipt->id, 'reference' => $receipt->reference, 'delivery_note_number' => $receipt->delivery_note_number,
                'received_on' => $receipt->received_on, 'notes' => $receipt->notes, 'created_at' => $receipt->created_at, 'received_by' => $receipt->received_by,
                'items' => ($receiptItems[$receipt->id] ?? collect())->map(fn ($line) => [
                    'purchase_order_item_id' => (int) $line->purchase_order_item_id, 'quantity' => (int) $line->quantity,
                    'damaged_quantity' => (int) $line->damaged_quantity, 'notes' => $line->notes,
                ])->values(),
            ])->values(),
            'events' => DB::table('purchase_order_events as e')->leftJoin('users as u', 'u.id', '=', 'e.user_id')->where('e.purchase_order_id', $id)
                ->orderByDesc('e.id')->get(['e.id', 'e.action', 'e.from_status', 'e.to_status', 'e.version', 'e.notes', 'e.created_at', 'u.name as user', DB::raw('CASE WHEN e.snapshot IS NULL THEN 0 ELSE 1 END as has_snapshot')]),
            'email_attempts' => DB::table('purchase_order_email_attempts as a')->leftJoin('users as u', 'u.id', '=', 'a.requested_by')->where('a.purchase_order_id', $id)
                ->orderByDesc('a.id')->get(['a.id', 'a.recipient', 'a.status', 'a.error', 'a.attempted_at', 'a.sent_at', 'a.created_at', 'u.name as requested_by']),
            'actions' => $this->allowedActions($order, $user, PurchasingSettings::for($bookshopId)),
        ];
    }

    /** The order's list-row fields with numbers cast to numbers. */
    public function summarize(object $order): array
    {
        return [
            'id' => (int) $order->id, 'lpo_number' => $order->lpo_number, 'status' => $order->status,
            'supplier_id' => (int) $order->supplier_id, 'branch_id' => (int) $order->branch_id,
            'order_date' => $order->order_date, 'expected_date' => $order->expected_date,
            'delivery_location' => $order->delivery_location, 'payment_terms' => $order->payment_terms,
            'internal_notes' => $order->internal_notes, 'supplier_notes' => $order->supplier_notes,
            'currency' => $order->currency, 'tax_rate' => (float) $order->tax_rate, 'prices_include_tax' => (bool) $order->prices_include_tax,
            'subtotal' => round((float) $order->subtotal, 2), 'discount_total' => round((float) $order->discount_total, 2),
            'tax_total' => round((float) $order->tax_total, 2), 'total' => round((float) $order->total, 2),
            'version' => (int) $order->version, 'rejection_reason' => $order->rejection_reason, 'cancellation_reason' => $order->cancellation_reason,
            'delivery_method' => $order->delivery_method, 'email_status' => $order->email_status,
            'email_last_attempt_at' => $order->email_last_attempt_at, 'email_sent_at' => $order->email_sent_at,
            'has_pdf' => $order->lpo_number !== null,
            'is_overdue' => in_array($order->status, self::RECEIVABLE, true) && $order->expected_date !== null && $order->expected_date < now()->toDateString(),
            'submitted_at' => $order->submitted_at, 'approved_at' => $order->approved_at, 'confirmed_at' => $order->confirmed_at,
            'cancelled_at' => $order->cancelled_at, 'completed_at' => $order->completed_at,
            'created_at' => $order->created_at, 'updated_at' => $order->updated_at,
        ];
    }

    public function allowedActions(object $order, User $user, array $settings): array
    {
        $manage = $user->hasPermission('purchases.manage');
        $approve = $user->hasPermission('purchases.approve');
        $confirm = $user->hasPermission('purchases.confirm');
        $status = $order->status;
        $numbered = $order->lpo_number !== null;

        return [
            'edit' => $manage && $status === 'draft',
            'delete' => $manage && $status === 'draft' && ! $numbered,
            'submit' => $manage && $status === 'draft',
            'approve' => $approve && $status === 'pending_approval',
            'reject' => $approve && in_array($status, ['pending_approval', 'approved'], true),
            'confirm' => $confirm && ($status === 'approved' || ($status === 'draft' && ! $settings['approval_required'])),
            'amend' => $confirm && in_array($status, self::AMENDABLE, true),
            'send_email' => $confirm && in_array($status, self::RECEIVABLE, true),
            'mark_sent' => $confirm && $status === 'confirmed',
            'download_pdf' => $numbered,
            'receive' => $manage && in_array($status, self::RECEIVABLE, true),
            'cancel' => $manage && in_array($status, ['draft', 'pending_approval', 'approved', 'confirmed', 'sent', 'partially_received'], true)
                && ($status === 'draft' || $status === 'pending_approval' || $confirm),
        ];
    }

    public function snapshot(int $id): array
    {
        $order = (array) DB::table('purchase_orders')->where('id', $id)->first();
        $items = DB::table('purchase_order_items')->where('purchase_order_id', $id)->orderBy('position')->orderBy('id')->get()->map(fn ($i) => (array) $i)->all();

        return ['order' => $order, 'items' => $items];
    }

    // ---------------------------------------------------------------- helpers

    /** Recomputes line totals and order totals from the lines. Money is kept to two decimals. */
    public function recalculate(int $id): void
    {
        $order = DB::table('purchase_orders')->where('id', $id)->first();
        $subtotal = 0.0;
        $discounts = 0.0;
        foreach (DB::table('purchase_order_items')->where('purchase_order_id', $id)->get() as $item) {
            $gross = round((int) $item->quantity * (float) $item->unit_cost, 2);
            $discount = min($gross, round((float) $item->discount, 2));
            DB::table('purchase_order_items')->where('id', $item->id)->update(['line_total' => round($gross - $discount, 2)]);
            $subtotal += $gross;
            $discounts += $discount;
        }
        $net = round($subtotal - $discounts, 2);
        $rate = (float) $order->tax_rate;
        if ($order->prices_include_tax) {
            $tax = $rate > 0 ? round($net - $net / (1 + $rate / 100), 2) : 0.0;
            $total = $net;
        } else {
            $tax = round($net * $rate / 100, 2);
            $total = round($net + $tax, 2);
        }
        DB::table('purchase_orders')->where('id', $id)->update([
            'subtotal' => round($subtotal, 2), 'discount_total' => round($discounts, 2), 'tax_total' => $tax, 'total' => $total,
        ]);
    }

    public function event(int $bookshopId, int $orderId, ?User $user, string $action, ?string $from, ?string $to, ?string $notes = null, ?array $snapshot = null, ?int $version = null): void
    {
        DB::table('purchase_order_events')->insert([
            'bookshop_id' => $bookshopId, 'purchase_order_id' => $orderId, 'user_id' => $user?->id, 'action' => $action,
            'from_status' => $from, 'to_status' => $to, 'version' => $version ?? (int) DB::table('purchase_orders')->where('id', $orderId)->value('version'),
            'notes' => $notes, 'snapshot' => $snapshot ? json_encode($snapshot) : null, 'created_at' => now(),
        ]);
    }

    private function transition(int $bookshopId, array $branchIds, int $id, User $user, array $from, string $to, string $action, callable $changes, ?string $notes = null): void
    {
        DB::transaction(function () use ($bookshopId, $branchIds, $id, $user, $from, $to, $action, $changes, $notes) {
            $order = $this->find($id, $bookshopId, $branchIds, true);
            $this->assertStatus($order, $from, 'This action is not available for the order\'s current status.');
            DB::table('purchase_orders')->where('id', $id)->update([...$changes($order), 'status' => $to, 'updated_at' => now()]);
            $this->event($bookshopId, $id, $user, $action, $order->status, $to, $notes);
            AuditLog::record("purchase_order.$action", ucfirst(str_replace('_', ' ', $action)).' purchase order '.($order->lpo_number ?? "#$id"), null, ['purchase_order_id' => $id], $user, $bookshopId);
        });
    }

    private function replaceItems(int $bookshopId, int $orderId, array $lines): void
    {
        DB::table('purchase_order_items')->where('purchase_order_id', $orderId)->delete();
        foreach (array_values($lines) as $index => $line) $this->insertItem($bookshopId, $orderId, $line, $index);
    }

    private function insertItem(int $bookshopId, int $orderId, array $line, int $position): int
    {
        $book = DB::table('books')->where('bookshop_id', $bookshopId)->where('id', $line['book_id'] ?? 0)->first(['id', 'title', 'sku', 'isbn', 'base_unit']);
        if (! $book) throw ValidationException::withMessages(["items.$position.book_id" => 'That product is not in your catalogue.']);
        $unit = null;
        if (! empty($line['product_unit_id'])) {
            $unit = DB::table('product_units')->where('bookshop_id', $bookshopId)->where('book_id', $book->id)->where('id', $line['product_unit_id'])->first();
            if (! $unit) throw ValidationException::withMessages(["items.$position.product_unit_id" => 'That packaging does not belong to the product.']);
        }
        $quantity = (int) ($line['quantity'] ?? 0);
        if ($quantity < 1) throw ValidationException::withMessages(["items.$position.quantity" => 'Quantity must be at least 1.']);

        return DB::table('purchase_order_items')->insertGetId([
            'purchase_order_id' => $orderId, 'book_id' => $book->id,
            'description' => $book->title, 'sku' => $book->sku, 'isbn' => $book->isbn,
            'product_unit_id' => $unit?->id, 'unit_label' => $unit?->name ?? ucfirst($book->base_unit ?: 'piece'),
            'units_per_package' => $unit ? max(1, (int) $unit->pieces_per_unit) : 1,
            'quantity' => $quantity, 'received_quantity' => 0, 'cancelled_quantity' => 0,
            'unit_cost' => round(max(0, (float) ($line['unit_cost'] ?? 0)), 2),
            'discount' => round(max(0, (float) ($line['discount'] ?? 0)), 2),
            'line_total' => 0, 'position' => $position,
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    /** @param array<int, array{book_id:int}> $lines */
    private function assertNotAlreadyOnOrder(int $bookshopId, int $branchId, array $lines, ?int $exceptOrderId = null): void
    {
        $bookIds = array_values(array_unique(array_map(fn ($line) => (int) $line['book_id'], $lines)));
        $outstanding = $this->reorder->outstandingByBook($bookshopId, $branchId, $bookIds, $exceptOrderId);
        $outstanding = array_filter($outstanding);
        if (! $outstanding) return;
        $titles = DB::table('books')->whereIn('id', array_keys($outstanding))->pluck('title', 'id');
        $list = collect($outstanding)->map(fn ($qty, $bookId) => "{$titles[$bookId]} ($qty on order)")->implode(', ');
        $exception = ValidationException::withMessages(['outstanding' => "Already on order: $list. Confirm to order more anyway."]);
        throw $exception;
    }

    private function assertStatus(object $order, array $allowed, string $message): void
    {
        if (! in_array($order->status, $allowed, true)) throw ValidationException::withMessages(['status' => $message]);
    }

    private function assertHasItems(int $id): void
    {
        if (! DB::table('purchase_order_items')->where('purchase_order_id', $id)->exists()) {
            throw ValidationException::withMessages(['items' => 'Add at least one product to the order.']);
        }
    }

    private function assertOwned(int $bookshopId, string $table, mixed $id, string $field): void
    {
        if (! DB::table($table)->where('bookshop_id', $bookshopId)->where('id', $id)->exists()) {
            throw ValidationException::withMessages([$field => 'Not found in your bookshop.']);
        }
    }

    private function defaults(int $bookshopId, int $supplierId): array
    {
        $settings = PurchasingSettings::for($bookshopId);
        $supplier = DB::table('suppliers')->where('id', $supplierId)->first(['payment_terms', 'lead_time_days']);
        $profile = DB::table('business_profiles')->where('bookshop_id', $bookshopId)->first(['currency', 'prices_include_tax', 'address', 'city']);
        $bookshop = DB::table('bookshops')->where('id', $bookshopId)->first(['currency', 'location']);
        $tax = DB::table('tax_rates')->where('bookshop_id', $bookshopId)->where('is_active', true)->where('is_default', true)->value('rate');

        return [
            'currency' => $profile->currency ?? $bookshop->currency ?? 'KES',
            'tax_rate' => $tax !== null ? (float) $tax : 0,
            'prices_include_tax' => (bool) ($profile->prices_include_tax ?? false),
            'payment_terms' => $supplier->payment_terms ?? $settings['default_payment_terms'],
            'delivery_location' => $settings['default_delivery_location'] ?? trim(implode(', ', array_filter([$profile->address ?? null, $profile->city ?? $bookshop->location ?? null]))) ?: null,
            'expected_date' => $supplier && $supplier->lead_time_days ? now()->addDays((int) $supplier->lead_time_days)->toDateString() : null,
        ];
    }
}
