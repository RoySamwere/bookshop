<?php

namespace App\Services\Purchasing;

use App\Models\AuditLog;
use App\Models\User;
use App\Services\InventoryService;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Receives goods against an LPO. Stock goes up only here, through the existing InventoryService,
 * so balances, movement history and supplier links stay in one place. Packs are converted to base
 * units (3 cartons x 20 = 60 pieces). A repeated submission with the same key returns the first
 * receipt instead of adding stock twice.
 */
class PurchaseOrderReceivingService
{
    public function __construct(private readonly PurchaseOrderService $orders, private readonly InventoryService $inventory) {}

    /**
     * @param array{reference?:string|null, delivery_note_number?:string|null, received_on?:string|null, notes?:string|null, submission_key?:string|null, items: array<int, array{purchase_order_item_id:int, quantity:int, damaged_quantity?:int, notes?:string|null}>} $data
     * @return array{receipt_id:int, duplicate:bool, status:string}
     */
    public function receive(int $bookshopId, array $branchIds, int $orderId, User $user, array $data): array
    {
        $key = $data['submission_key'] ?? null;
        if ($key) {
            $existing = DB::table('goods_receipts')->where('bookshop_id', $bookshopId)->where('submission_key', $key)->first();
            if ($existing) {
                if ((int) $existing->purchase_order_id !== $orderId) throw ValidationException::withMessages(['submission_key' => 'This submission belongs to another order.']);

                return ['receipt_id' => (int) $existing->id, 'duplicate' => true, 'status' => (string) DB::table('purchase_orders')->where('id', $orderId)->value('status')];
            }
        }

        try {
            return $this->post($bookshopId, $branchIds, $orderId, $user, $data, $key);
        } catch (UniqueConstraintViolationException $exception) {
            // The same submission arrived twice at once; the first one won and holds the stock change.
            $existing = $key ? DB::table('goods_receipts')->where('bookshop_id', $bookshopId)->where('submission_key', $key)->first() : null;
            if (! $existing) throw $exception;

            return ['receipt_id' => (int) $existing->id, 'duplicate' => true, 'status' => (string) DB::table('purchase_orders')->where('id', $orderId)->value('status')];
        }
    }

    private function post(int $bookshopId, array $branchIds, int $orderId, User $user, array $data, ?string $key): array
    {
        return DB::transaction(function () use ($bookshopId, $branchIds, $orderId, $user, $data, $key) {
            $order = $this->orders->find($orderId, $bookshopId, $branchIds, true);
            $legacyApproved = $order->status === 'approved' && $order->lpo_number === null;
            if (! in_array($order->status, PurchaseOrderService::RECEIVABLE, true) && ! $legacyApproved) {
                throw ValidationException::withMessages(['status' => $order->status === 'completed' ? 'This order is already fully received.' : 'Confirm the order before receiving goods against it.']);
            }
            $lines = array_values(array_filter($data['items'], fn ($line) => (int) ($line['quantity'] ?? 0) > 0 || (int) ($line['damaged_quantity'] ?? 0) > 0));
            if (! array_filter($lines, fn ($line) => (int) ($line['quantity'] ?? 0) > 0)) {
                throw ValidationException::withMessages(['items' => 'Enter the quantity received for at least one product.']);
            }

            $reference = trim((string) ($data['reference'] ?? '')) ?: $this->reference($bookshopId, $order);
            if (DB::table('goods_receipts')->where('bookshop_id', $bookshopId)->where('reference', $reference)->exists()) {
                throw ValidationException::withMessages(['reference' => 'This receipt reference has already been used.']);
            }
            $receiptId = DB::table('goods_receipts')->insertGetId([
                'bookshop_id' => $bookshopId, 'purchase_order_id' => $orderId, 'received_by' => $user->id, 'reference' => $reference,
                'delivery_note_number' => $data['delivery_note_number'] ?? null, 'received_on' => $data['received_on'] ?? now()->toDateString(),
                'notes' => $data['notes'] ?? null, 'submission_key' => $key, 'created_at' => now(), 'updated_at' => now(),
            ]);

            $received = 0;
            foreach ($lines as $index => $line) {
                $item = DB::table('purchase_order_items')->where('purchase_order_id', $orderId)->where('id', $line['purchase_order_item_id'])->lockForUpdate()->first();
                if (! $item) throw ValidationException::withMessages(["items.$index.purchase_order_item_id" => 'That line does not belong to this order.']);
                $quantity = (int) ($line['quantity'] ?? 0);
                $outstanding = (int) $item->quantity - (int) $item->received_quantity - (int) $item->cancelled_quantity;
                if ($quantity > $outstanding) {
                    throw ValidationException::withMessages(["items.$index.quantity" => "Only $outstanding of {$item->description} are outstanding."]);
                }
                DB::table('goods_receipt_items')->insert([
                    'goods_receipt_id' => $receiptId, 'purchase_order_item_id' => $item->id, 'quantity' => $quantity,
                    'damaged_quantity' => (int) ($line['damaged_quantity'] ?? 0), 'notes' => $line['notes'] ?? null,
                    'created_at' => now(), 'updated_at' => now(),
                ]);
                if ($quantity === 0) continue;
                DB::table('purchase_order_items')->where('id', $item->id)->update(['received_quantity' => (int) $item->received_quantity + $quantity, 'updated_at' => now()]);
                $perPack = max(1, (int) $item->units_per_package);
                $this->inventory->change(
                    (int) $item->book_id, (int) $order->branch_id, $quantity * $perPack, 'goods_received', $user->id, $reference,
                    trim('LPO '.($order->lpo_number ?? "#$orderId").($data['delivery_note_number'] ?? null ? ' / DN '.$data['delivery_note_number'] : '')),
                    $item->product_unit_id ? (int) $item->product_unit_id : null, $perPack > 1 ? $quantity : null, $perPack > 1 ? $perPack : null, (int) $order->supplier_id,
                );
                $received += $quantity;
            }

            $remaining = (int) DB::table('purchase_order_items')->where('purchase_order_id', $orderId)
                ->selectRaw('COALESCE(SUM(quantity - received_quantity - cancelled_quantity),0) as remaining')->value('remaining');
            $status = $remaining > 0 ? 'partially_received' : 'completed';
            DB::table('purchase_orders')->where('id', $orderId)->update(['status' => $status, 'completed_at' => $status === 'completed' ? now() : null, 'updated_at' => now()]);
            $this->orders->event($bookshopId, $orderId, $user, 'goods_received', $order->status, $status, "$received received on $reference".(! empty($data['notes']) ? ' - '.$data['notes'] : ''));
            AuditLog::record('purchase_order.goods_received', 'Received goods for '.($order->lpo_number ?? "purchase order #$orderId"), null, ['purchase_order_id' => $orderId, 'goods_receipt_id' => $receiptId, 'quantity' => $received], $user, $bookshopId);

            return ['receipt_id' => $receiptId, 'duplicate' => false, 'status' => $status];
        });
    }

    private function reference(int $bookshopId, object $order): string
    {
        $base = 'GRN-'.($order->lpo_number ? substr($order->lpo_number, 4) : $order->id);
        $count = DB::table('goods_receipts')->where('bookshop_id', $bookshopId)->where('purchase_order_id', $order->id)->count();

        do {
            $reference = $base.'-'.(++$count);
        } while (DB::table('goods_receipts')->where('bookshop_id', $bookshopId)->where('reference', $reference)->exists());

        return $reference;
    }
}
