<?php

namespace App\Services\Purchasing;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Works out what to reorder for one branch from the stock the Inventory module already keeps
 * (available = quantity - reserved, the same figure the POS and stock pages use).
 *
 *   low stock        : available < reorder level
 *   suggested amount : target stock - available - quantity already on order, never below zero,
 *                      then raised to the minimum order quantity and rounded up to whole packs.
 */
class ReorderSuggestionService
{
    /** Orders whose remaining quantity is already on its way (or committed) and must not be ordered again. */
    public const OUTSTANDING_STATUSES = ['pending_approval', 'approved', 'confirmed', 'sent', 'partially_received'];

    /** Low-stock products that still need ordering after counting what is already on order. */
    public function suggestions(int $bookshopId, int $branchId, array $filters = []): Collection
    {
        return $this->products($bookshopId, $branchId, $filters)
            ->filter(fn (array $row) => $row['is_low_stock'] && $row['suggested_quantity'] > 0)
            ->values();
    }

    /** Products below their reorder level, whether or not they are already covered by open orders. */
    public function lowStockCount(int $bookshopId, array $branchIds): int
    {
        $count = 0;
        foreach ($branchIds as $branchId) {
            $count += $this->products($bookshopId, $branchId)->where('is_low_stock', true)->count();
        }

        return $count;
    }

    /** Catalogue search used when adding products to an order by hand. */
    public function catalogue(int $bookshopId, int $branchId, string $search, int $limit = 20): Collection
    {
        return $this->products($bookshopId, $branchId, ['search' => $search, 'limit' => $limit, 'all' => true]);
    }

    /** Only products actually assigned to this shop branch's inventory, including zero balances.\n     * The global/catalogue-only products must never be treated as low-stock shop items.\n     */
    public function products(int $bookshopId, int $branchId, array $filters = []): Collection
    {
        $settings = PurchasingSettings::for($bookshopId);
        $search = trim((string) ($filters['search'] ?? ''));
        $query = DB::table('books as b')
            ->join('inventory_balances as i', fn ($join) => $join->on('i.book_id', '=', 'b.id')->where('i.branch_id', '=', $branchId)->where('i.bookshop_id', '=', $bookshopId))
            ->leftJoin('product_reorder_settings as r', fn ($join) => $join->on('r.book_id', '=', 'b.id')->where('r.bookshop_id', '=', $bookshopId))
            ->where('b.bookshop_id', $bookshopId)
            ->where('b.is_active', true)
            ->when($search !== '', fn ($q) => $q->where(fn ($w) => $w->where('b.title', 'like', "%$search%")->orWhere('b.sku', 'like', "%$search%")->orWhere('b.isbn', 'like', "%$search%")))
            ->when(! empty($filters['book_ids']), fn ($q) => $q->whereIn('b.id', $filters['book_ids']))
            ->orderBy('b.title')
            ->when(! empty($filters['limit']), fn ($q) => $q->limit((int) $filters['limit']))
            ->select([
                'b.id', 'b.title', 'b.sku', 'b.isbn', 'b.cost_price', 'b.reorder_level as book_reorder_level',
                DB::raw('COALESCE(i.quantity,0) as quantity'), DB::raw('COALESCE(i.reserved,0) as reserved'),
                'r.reorder_level', 'r.target_stock', 'r.preferred_supplier_id', 'r.minimum_order_quantity', 'r.pack_size',
            ]);
        $books = $query->get();
        if ($books->isEmpty()) return collect();

        $ids = $books->pluck('id')->all();
        $onOrder = $this->outstandingByBook($bookshopId, $branchId, $ids);
        $inDraft = $this->draftQuantities($bookshopId, $branchId, $ids);
        $lastPurchase = $this->lastPurchases($bookshopId, $ids);
        $supplierIds = array_filter([...$books->pluck('preferred_supplier_id')->all(), ...array_column($lastPurchase, 'supplier_id')]);
        $suppliers = DB::table('suppliers')->where('bookshop_id', $bookshopId)->whereIn('id', $supplierIds ?: [0])->get(['id', 'name', 'email', 'is_active'])->keyBy('id');
        $units = DB::table('product_units')->where('bookshop_id', $bookshopId)->whereIn('book_id', $ids)->orderBy('pieces_per_unit')->get(['id', 'book_id', 'name', 'pieces_per_unit'])->groupBy('book_id');

        $rows = $books->map(function ($book) use ($settings, $onOrder, $inDraft, $lastPurchase, $suppliers, $units, $branchId) {
            $available = max(0, (int) $book->quantity - (int) $book->reserved);
            $reorderLevel = $book->reorder_level !== null ? (int) $book->reorder_level
                : ((int) $book->book_reorder_level > 0 ? (int) $book->book_reorder_level : $settings['default_reorder_level']);
            $target = $book->target_stock !== null ? (int) $book->target_stock : max($settings['default_target_stock'], $reorderLevel);
            $outstanding = $onOrder[$book->id] ?? 0;
            $last = $lastPurchase[$book->id] ?? null;
            $supplierId = $book->preferred_supplier_id ?? ($last['supplier_id'] ?? null);
            $supplier = $supplierId ? $suppliers->get($supplierId) : null;

            return [
                'book_id' => (int) $book->id,
                'title' => $book->title,
                'sku' => $book->sku,
                'isbn' => $book->isbn,
                'branch_id' => $branchId,
                'current_stock' => (int) $book->quantity,
                'reserved' => (int) $book->reserved,
                'available' => $available,
                'reorder_level' => $reorderLevel,
                'target_stock' => $target,
                'outstanding_quantity' => $outstanding,
                'draft_quantity' => $inDraft[$book->id] ?? 0,
                'minimum_order_quantity' => $book->minimum_order_quantity !== null ? (int) $book->minimum_order_quantity : null,
                'pack_size' => $book->pack_size !== null ? (int) $book->pack_size : null,
                'is_low_stock' => $available < $reorderLevel,
                'suggested_quantity' => $this->suggestedQuantity($available, $target, $outstanding, $book->minimum_order_quantity, $book->pack_size),
                'preferred_supplier' => $supplier ? ['id' => (int) $supplier->id, 'name' => $supplier->name, 'email' => $supplier->email, 'is_active' => (bool) $supplier->is_active] : null,
                'last_unit_cost' => $last ? $last['unit_cost'] : null,
                'last_purchase_date' => $last['date'] ?? null,
                'default_unit_cost' => $last ? $last['unit_cost'] : round((float) $book->cost_price, 2),
                'units' => ($units[$book->id] ?? collect())->map(fn ($unit) => ['id' => (int) $unit->id, 'name' => $unit->name, 'pieces_per_unit' => (int) $unit->pieces_per_unit])->values(),
            ];
        });

        if (! empty($filters['supplier_id'])) {
            $rows = $rows->filter(fn ($row) => ($row['preferred_supplier']['id'] ?? null) === (int) $filters['supplier_id']);
        }

        return $rows->values();
    }

    public function suggestedQuantity(int $available, int $target, int $outstanding, ?int $minimum = null, ?int $packSize = null): int
    {
        $needed = max(0, $target - $available - $outstanding);
        if ($needed === 0) return 0;
        if ($minimum) $needed = max($needed, $minimum);
        if ($packSize && $packSize > 1) $needed = (int) (ceil($needed / $packSize) * $packSize);

        return $needed;
    }

    /** Base units still to arrive per product on open orders for a branch. */
    public function outstandingByBook(int $bookshopId, int $branchId, array $bookIds, ?int $exceptOrderId = null): array
    {
        return $this->openQuantities($bookshopId, $branchId, $bookIds, self::OUTSTANDING_STATUSES, $exceptOrderId);
    }

    public function draftQuantities(int $bookshopId, int $branchId, array $bookIds, ?int $exceptOrderId = null): array
    {
        return $this->openQuantities($bookshopId, $branchId, $bookIds, ['draft'], $exceptOrderId);
    }

    private function openQuantities(int $bookshopId, int $branchId, array $bookIds, array $statuses, ?int $exceptOrderId): array
    {
        if (! $bookIds) return [];

        return DB::table('purchase_order_items as poi')
            ->join('purchase_orders as po', 'po.id', '=', 'poi.purchase_order_id')
            ->where('po.bookshop_id', $bookshopId)
            ->where('po.branch_id', $branchId)
            ->whereIn('po.status', $statuses)
            ->whereIn('poi.book_id', $bookIds)
            ->when($exceptOrderId, fn ($q) => $q->where('po.id', '!=', $exceptOrderId))
            ->groupBy('poi.book_id')
            ->selectRaw('poi.book_id, SUM((poi.quantity - poi.received_quantity - poi.cancelled_quantity) * poi.units_per_package) as outstanding')
            ->pluck('outstanding', 'poi.book_id')
            ->map(fn ($value) => max(0, (int) $value))
            ->all();
    }

    /** Latest confirmed purchase price per base unit, its date and supplier, per product. */
    public function lastPurchases(int $bookshopId, array $bookIds): array
    {
        if (! $bookIds) return [];
        $rows = DB::table('purchase_order_items as poi')
            ->join('purchase_orders as po', 'po.id', '=', 'poi.purchase_order_id')
            ->where('po.bookshop_id', $bookshopId)
            ->whereIn('poi.book_id', $bookIds)
            ->whereNotIn('po.status', ['draft', 'pending_approval', 'cancelled'])
            ->orderByDesc(DB::raw('COALESCE(po.confirmed_at, po.created_at)'))
            ->orderByDesc('poi.id')
            ->get(['poi.book_id', 'poi.unit_cost', 'poi.units_per_package', 'po.supplier_id', 'po.confirmed_at', 'po.created_at']);
        $result = [];
        foreach ($rows as $row) {
            if (isset($result[$row->book_id])) continue;
            $result[$row->book_id] = [
                'unit_cost' => round((float) $row->unit_cost / max(1, (int) $row->units_per_package), 2),
                'supplier_id' => (int) $row->supplier_id,
                'date' => substr((string) ($row->confirmed_at ?? $row->created_at), 0, 10),
            ];
        }

        return $result;
    }

    /** Recent purchase prices for one product, newest first, for the "previous costs" view. */
    public function priceHistory(int $bookshopId, int $bookId, int $limit = 10): Collection
    {
        return DB::table('purchase_order_items as poi')
            ->join('purchase_orders as po', 'po.id', '=', 'poi.purchase_order_id')
            ->join('suppliers as s', 's.id', '=', 'po.supplier_id')
            ->where('po.bookshop_id', $bookshopId)
            ->where('poi.book_id', $bookId)
            ->whereNotIn('po.status', ['draft', 'pending_approval', 'cancelled'])
            ->orderByDesc(DB::raw('COALESCE(po.confirmed_at, po.created_at)'))
            ->limit($limit)
            ->get(['po.id as purchase_order_id', 'po.lpo_number', 's.name as supplier', 'poi.unit_cost', 'poi.units_per_package', 'poi.unit_label', 'poi.quantity', DB::raw('COALESCE(po.confirmed_at, po.created_at) as date')])
            ->map(fn ($row) => [
                'purchase_order_id' => (int) $row->purchase_order_id, 'lpo_number' => $row->lpo_number, 'supplier' => $row->supplier,
                'unit_cost' => round((float) $row->unit_cost, 2), 'unit_label' => $row->unit_label, 'units_per_package' => (int) $row->units_per_package,
                'cost_per_piece' => round((float) $row->unit_cost / max(1, (int) $row->units_per_package), 2),
                'quantity' => (int) $row->quantity, 'date' => substr((string) $row->date, 0, 10),
            ]);
    }
}
