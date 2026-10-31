<?php

namespace App\Services\Purchasing;

use Illuminate\Support\Facades\DB;

/**
 * Purchasing figures for the dashboard and reports. Purchase orders are commitments, not expenses
 * or payments, so nothing here feeds the finance figures.
 */
class PurchaseOrderReportService
{
    public function __construct(private readonly ReorderSuggestionService $reorder) {}

    public function summary(int $bookshopId, array $branchIds): array
    {
        $counts = DB::table('purchase_orders')->where('bookshop_id', $bookshopId)->whereIn('branch_id', $branchIds ?: [0])
            ->groupBy('status')->selectRaw('status, COUNT(*) as total')->pluck('total', 'status');
        $open = $this->openLines($bookshopId, $branchIds);
        $today = now()->toDateString();

        return [
            'below_reorder_level' => $this->reorder->lowStockCount($bookshopId, $branchIds),
            'drafts' => (int) ($counts['draft'] ?? 0),
            'awaiting_approval' => (int) ($counts['pending_approval'] ?? 0),
            'approved' => (int) ($counts['approved'] ?? 0),
            'confirmed' => (int) ($counts['confirmed'] ?? 0),
            'sent' => (int) ($counts['sent'] ?? 0),
            'awaiting_delivery' => (int) ($counts['confirmed'] ?? 0) + (int) ($counts['sent'] ?? 0),
            'partially_received' => (int) ($counts['partially_received'] ?? 0),
            'completed' => (int) ($counts['completed'] ?? 0),
            'cancelled' => (int) ($counts['cancelled'] ?? 0),
            'outstanding_value' => round($open->sum('outstanding_value'), 2),
            'outstanding_quantity' => (int) $open->sum('outstanding'),
            'overdue' => DB::table('purchase_orders')->where('bookshop_id', $bookshopId)->whereIn('branch_id', $branchIds ?: [0])
                ->whereIn('status', PurchaseOrderService::RECEIVABLE)->whereNotNull('expected_date')->where('expected_date', '<', $today)->count(),
            'email_failed' => DB::table('purchase_orders')->where('bookshop_id', $bookshopId)->whereIn('branch_id', $branchIds ?: [0])
                ->whereIn('status', PurchaseOrderService::RECEIVABLE)->where('email_status', 'failed')->count(),
            'currency' => DB::table('business_profiles')->where('bookshop_id', $bookshopId)->value('currency') ?? DB::table('bookshops')->where('id', $bookshopId)->value('currency') ?? 'KES',
        ];
    }

    public function report(int $bookshopId, array $branchIds, ?string $from, ?string $to): array
    {
        $orders = DB::table('purchase_orders as po')->join('suppliers as s', 's.id', '=', 'po.supplier_id')
            ->where('po.bookshop_id', $bookshopId)->whereIn('po.branch_id', $branchIds ?: [0])
            ->whereNotIn('po.status', ['draft', 'pending_approval', 'approved'])
            ->when($from, fn ($q) => $q->where('po.order_date', '>=', $from))
            ->when($to, fn ($q) => $q->where('po.order_date', '<=', $to))
            ->get(['po.id', 'po.lpo_number', 'po.status', 'po.supplier_id', 's.name as supplier', 'po.total', 'po.order_date', 'po.expected_date', 'po.confirmed_at', 'po.currency']);
        $ids = $orders->pluck('id')->all() ?: [0];
        $items = DB::table('purchase_order_items')->whereIn('purchase_order_id', $ids)->get()->groupBy('purchase_order_id');
        $firstReceipt = DB::table('goods_receipts')->whereIn('purchase_order_id', $ids)
            ->groupBy('purchase_order_id')->selectRaw('purchase_order_id, MIN(COALESCE(received_on, created_at)) as first_received')->pluck('first_received', 'purchase_order_id');

        $bySupplier = [];
        foreach ($orders as $order) {
            $row = &$bySupplier[$order->supplier_id];
            $row ??= ['supplier_id' => (int) $order->supplier_id, 'supplier' => $order->supplier, 'orders' => 0, 'value' => 0.0, 'ordered_quantity' => 0, 'received_quantity' => 0, 'cancelled_quantity' => 0, 'outstanding_quantity' => 0, 'deliveries' => 0, 'on_time' => 0, 'lead_days_total' => 0];
            $row['orders']++;
            if ($order->status !== 'cancelled') $row['value'] += (float) $order->total;
            foreach ($items[$order->id] ?? [] as $item) {
                $row['ordered_quantity'] += (int) $item->quantity;
                $row['received_quantity'] += (int) $item->received_quantity;
                $row['cancelled_quantity'] += (int) $item->cancelled_quantity;
                $row['outstanding_quantity'] += max(0, (int) $item->quantity - (int) $item->received_quantity - (int) $item->cancelled_quantity);
            }
            if (isset($firstReceipt[$order->id])) {
                $received = substr((string) $firstReceipt[$order->id], 0, 10);
                $row['deliveries']++;
                if ($order->expected_date === null || $received <= $order->expected_date) $row['on_time']++;
                $start = substr((string) ($order->confirmed_at ?? $order->order_date), 0, 10);
                $row['lead_days_total'] += max(0, (int) round((strtotime($received) - strtotime($start)) / 86400));
            }
            unset($row);
        }
        $bySupplier = collect($bySupplier)->map(fn ($row) => [
            ...array_diff_key($row, ['lead_days_total' => true]),
            'value' => round($row['value'], 2),
            'fill_rate' => $row['ordered_quantity'] > 0 ? round($row['received_quantity'] / $row['ordered_quantity'] * 100, 1) : null,
            'on_time_rate' => $row['deliveries'] > 0 ? round($row['on_time'] / $row['deliveries'] * 100, 1) : null,
            'average_lead_days' => $row['deliveries'] > 0 ? round($row['lead_days_total'] / $row['deliveries'], 1) : null,
        ])->sortByDesc('value')->values();

        $today = now()->toDateString();
        $overdue = $orders->filter(fn ($o) => in_array($o->status, PurchaseOrderService::RECEIVABLE, true) && $o->expected_date && $o->expected_date < $today)
            ->map(fn ($o) => ['id' => (int) $o->id, 'lpo_number' => $o->lpo_number, 'supplier' => $o->supplier, 'status' => $o->status, 'expected_date' => $o->expected_date, 'days_late' => (int) round((strtotime($today) - strtotime($o->expected_date)) / 86400)])
            ->sortByDesc('days_late')->values();

        return [
            'totals' => [
                'orders' => $orders->where('status', '!=', 'cancelled')->count(),
                'purchase_value' => round($orders->where('status', '!=', 'cancelled')->sum(fn ($o) => (float) $o->total), 2),
                'ordered_quantity' => $bySupplier->sum('ordered_quantity'),
                'received_quantity' => $bySupplier->sum('received_quantity'),
                'outstanding_quantity' => $bySupplier->sum('outstanding_quantity'),
                'outstanding_value' => round($this->openLines($bookshopId, $branchIds)->sum('outstanding_value'), 2),
                'below_reorder_level' => $this->reorder->lowStockCount($bookshopId, $branchIds),
            ],
            'by_supplier' => $bySupplier,
            'overdue' => $overdue,
            'price_changes' => $this->priceChanges($bookshopId, $branchIds, $from, $to),
        ];
    }

    /** Outstanding quantity and value per open order line (net of line discounts). */
    private function openLines(int $bookshopId, array $branchIds)
    {
        return DB::table('purchase_order_items as poi')->join('purchase_orders as po', 'po.id', '=', 'poi.purchase_order_id')
            ->where('po.bookshop_id', $bookshopId)->whereIn('po.branch_id', $branchIds ?: [0])
            ->whereIn('po.status', PurchaseOrderService::RECEIVABLE)
            ->get(['poi.quantity', 'poi.received_quantity', 'poi.cancelled_quantity', 'poi.line_total'])
            ->map(function ($line) {
                $outstanding = max(0, (int) $line->quantity - (int) $line->received_quantity - (int) $line->cancelled_quantity);

                return ['outstanding' => $outstanding, 'outstanding_value' => (int) $line->quantity > 0 ? (float) $line->line_total / (int) $line->quantity * $outstanding : 0];
            });
    }

    /** Products whose most recent purchase price per piece differs from the one before it. */
    private function priceChanges(int $bookshopId, array $branchIds, ?string $from, ?string $to): array
    {
        $rows = DB::table('purchase_order_items as poi')->join('purchase_orders as po', 'po.id', '=', 'poi.purchase_order_id')
            ->join('suppliers as s', 's.id', '=', 'po.supplier_id')
            ->where('po.bookshop_id', $bookshopId)->whereIn('po.branch_id', $branchIds ?: [0])
            ->whereNotIn('po.status', ['draft', 'pending_approval', 'approved', 'cancelled'])
            ->when($to, fn ($q) => $q->where('po.order_date', '<=', $to))
            ->orderBy('poi.book_id')->orderByDesc(DB::raw('COALESCE(po.confirmed_at, po.created_at)'))->orderByDesc('poi.id')
            ->get(['poi.book_id', 'poi.description', 'poi.sku', 'poi.unit_cost', 'poi.units_per_package', 'po.order_date', 's.name as supplier']);
        $changes = [];
        foreach ($rows->groupBy('book_id') as $lines) {
            $latest = $lines[0];
            if ($from && $latest->order_date < $from) continue;
            $latestCost = (float) $latest->unit_cost / max(1, (int) $latest->units_per_package);
            $previous = $lines->first(fn ($line) => abs((float) $line->unit_cost / max(1, (int) $line->units_per_package) - $latestCost) >= 0.01);
            if (! $previous) continue;
            $previousCost = (float) $previous->unit_cost / max(1, (int) $previous->units_per_package);
            $changes[] = [
                'book_id' => (int) $latest->book_id, 'title' => $latest->description, 'sku' => $latest->sku,
                'previous_cost' => round($previousCost, 2), 'latest_cost' => round($latestCost, 2),
                'change_percent' => $previousCost > 0 ? round(($latestCost - $previousCost) / $previousCost * 100, 1) : null,
                'supplier' => $latest->supplier, 'date' => $latest->order_date,
            ];
        }
        usort($changes, fn ($a, $b) => abs($b['change_percent'] ?? 0) <=> abs($a['change_percent'] ?? 0));

        return array_slice($changes, 0, 50);
    }
}
