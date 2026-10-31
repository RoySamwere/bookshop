<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Services\Purchasing\PurchaseOrderMailService;
use App\Services\Purchasing\PurchaseOrderPdfService;
use App\Services\Purchasing\PurchaseOrderReceivingService;
use App\Services\Purchasing\PurchaseOrderReportService;
use App\Services\Purchasing\PurchaseOrderService;
use App\Services\Purchasing\PurchasingSettings;
use App\Services\Purchasing\ReorderSuggestionService;
use App\Support\Tenancy\Tenant;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Local Purchase Orders, reorder suggestions and receiving. The bookshop always comes from the
 * authenticated tenant and orders are limited to the branches the user works in.
 */
class PurchaseOrderController extends Controller
{
    /** History tabs and the statuses each one shows. */
    private const TABS = [
        'drafts' => ['draft'],
        'pending' => ['pending_approval', 'approved'],
        'sent' => ['confirmed', 'sent'],
        'partial' => ['partially_received'],
        'completed' => ['completed'],
        'cancelled' => ['cancelled'],
    ];

    public function __construct(private readonly PurchaseOrderService $orders) {}

    public function index(Request $request): JsonResponse
    {
        $data = $request->validate([
            'tab' => ['nullable', Rule::in(array_keys(self::TABS))],
            'status' => ['nullable', Rule::in(PurchaseOrderService::STATUSES)],
            'search' => ['nullable', 'string', 'max:120'],
            'supplier_id' => ['nullable', 'integer'],
            'branch_id' => ['nullable', 'integer'],
            'created_by' => ['nullable', 'integer'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date'],
            'overdue' => ['nullable', 'boolean'],
            'per_page' => ['nullable', 'integer', 'min:5', 'max:100'],
        ]);
        $search = trim($data['search'] ?? '');
        $page = $this->orders->query(Tenant::requireId(), $this->branches($request))
            ->when($data['tab'] ?? null, fn ($q, $tab) => $q->whereIn('status', self::TABS[$tab]))
            ->when($data['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
            ->when($data['supplier_id'] ?? null, fn ($q, $id) => $q->where('supplier_id', $id))
            ->when($data['branch_id'] ?? null, fn ($q, $id) => $q->where('branch_id', $id))
            ->when($data['created_by'] ?? null, fn ($q, $id) => $q->where('created_by', $id))
            ->when($data['from'] ?? null, fn ($q, $from) => $q->whereRaw('COALESCE(order_date, DATE(created_at)) >= ?', [$from]))
            ->when($data['to'] ?? null, fn ($q, $to) => $q->whereRaw('COALESCE(order_date, DATE(created_at)) <= ?', [$to]))
            ->when($request->boolean('overdue'), fn ($q) => $q->whereIn('status', PurchaseOrderService::RECEIVABLE)->where('expected_date', '<', now()->toDateString()))
            ->when($search !== '', fn ($q) => $q->where(fn ($w) => $w
                ->where('lpo_number', 'like', "%$search%")
                ->orWhereIn('supplier_id', DB::table('suppliers')->where('bookshop_id', Tenant::requireId())->where('name', 'like', "%$search%")->select('id'))
                ->orWhereIn('id', DB::table('purchase_order_items')->where(fn ($i) => $i->where('description', 'like', "%$search%")->orWhere('sku', 'like', "%$search%")->orWhere('isbn', 'like', "%$search%"))->select('purchase_order_id'))
            ))
            ->orderByDesc('updated_at')->orderByDesc('id')
            ->paginate($data['per_page'] ?? 20);

        $rows = collect($page->items());
        $suppliers = DB::table('suppliers')->whereIn('id', $rows->pluck('supplier_id')->all() ?: [0])->get(['id', 'name', 'email'])->keyBy('id');
        $branches = DB::table('branches')->whereIn('id', $rows->pluck('branch_id')->all() ?: [0])->pluck('name', 'id');
        $users = DB::table('users')->whereIn('id', $rows->pluck('created_by')->filter()->all() ?: [0])->pluck('name', 'id');
        $lines = DB::table('purchase_order_items')->whereIn('purchase_order_id', $rows->pluck('id')->all() ?: [0])
            ->groupBy('purchase_order_id')->selectRaw('purchase_order_id, COUNT(*) as lines, SUM(quantity) as ordered, SUM(received_quantity) as received, SUM(cancelled_quantity) as cancelled')
            ->get()->keyBy('purchase_order_id');
        $settings = PurchasingSettings::for(Tenant::requireId());
        $page->setCollection($rows->map(fn ($order) => [
            ...$this->orders->summarize($order),
            'supplier' => ['id' => (int) $order->supplier_id, 'name' => $suppliers[$order->supplier_id]->name ?? null, 'email' => $suppliers[$order->supplier_id]->email ?? null],
            'branch' => ['id' => (int) $order->branch_id, 'name' => $branches[$order->branch_id] ?? null],
            'created_by_name' => $users[$order->created_by] ?? null,
            'line_count' => (int) ($lines[$order->id]->lines ?? 0),
            'ordered_quantity' => (int) ($lines[$order->id]->ordered ?? 0),
            'received_quantity' => (int) ($lines[$order->id]->received ?? 0),
            'outstanding_quantity' => max(0, (int) ($lines[$order->id]->ordered ?? 0) - (int) ($lines[$order->id]->received ?? 0) - (int) ($lines[$order->id]->cancelled ?? 0)),
            'actions' => $this->orders->allowedActions($order, $request->user(), $settings),
        ]));

        return response()->json($page);
    }

    public function summary(Request $request, PurchaseOrderReportService $reports): JsonResponse
    {
        return response()->json(['data' => $reports->summary(Tenant::requireId(), $this->branches($request))]);
    }

    public function reports(Request $request, PurchaseOrderReportService $reports): JsonResponse
    {
        $data = $request->validate(['from' => ['nullable', 'date'], 'to' => ['nullable', 'date', 'after_or_equal:from']]);

        return response()->json(['data' => $reports->report(Tenant::requireId(), $this->branches($request), $data['from'] ?? null, $data['to'] ?? null)]);
    }

    public function suggestions(Request $request, ReorderSuggestionService $reorder): JsonResponse
    {
        $data = $request->validate(['branch_id' => ['nullable', 'integer'], 'search' => ['nullable', 'string', 'max:120'], 'supplier_id' => ['nullable', 'integer']]);
        $branchId = $this->branch($request, $data['branch_id'] ?? null);

        return response()->json(['data' => $reorder->suggestions(Tenant::requireId(), $branchId, $data), 'branch_id' => $branchId]);
    }

    public function catalogue(Request $request, ReorderSuggestionService $reorder): JsonResponse
    {
        $data = $request->validate(['branch_id' => ['nullable', 'integer'], 'search' => ['required', 'string', 'min:1', 'max:120']]);

        return response()->json(['data' => $reorder->catalogue(Tenant::requireId(), $this->branch($request, $data['branch_id'] ?? null), $data['search'])]);
    }

    public function priceHistory(int $book, ReorderSuggestionService $reorder): JsonResponse
    {
        abort_unless(DB::table('books')->where('bookshop_id', Tenant::requireId())->where('id', $book)->exists(), 404);

        return response()->json(['data' => $reorder->priceHistory(Tenant::requireId(), $book)]);
    }

    public function settings(): JsonResponse
    {
        return response()->json(['data' => PurchasingSettings::for(Tenant::requireId())]);
    }

    public function updateSettings(Request $request): JsonResponse
    {
        $data = $request->validate([
            'approval_required' => ['sometimes', 'boolean'],
            'default_reorder_level' => ['sometimes', 'integer', 'min:0', 'max:100000'],
            'default_target_stock' => ['sometimes', 'integer', 'min:0', 'max:1000000'],
            'default_payment_terms' => ['sometimes', 'nullable', 'string', 'max:120'],
            'default_delivery_location' => ['sometimes', 'nullable', 'string', 'max:255'],
        ]);
        $settings = PurchasingSettings::update(Tenant::requireId(), $data);
        AuditLog::record('purchasing.settings_updated', 'Updated purchasing settings', null, $data);

        return response()->json(['data' => $settings]);
    }

    public function updateReorderSettings(Request $request, int $book): JsonResponse
    {
        $bookshopId = Tenant::requireId();
        abort_unless(DB::table('books')->where('bookshop_id', $bookshopId)->where('id', $book)->exists(), 404);
        $data = $request->validate([
            'reorder_level' => ['nullable', 'integer', 'min:0', 'max:100000'],
            'target_stock' => ['nullable', 'integer', 'min:0', 'max:1000000'],
            'preferred_supplier_id' => ['nullable', 'integer', Tenant::exists('suppliers')],
            'minimum_order_quantity' => ['nullable', 'integer', 'min:1', 'max:1000000'],
            'pack_size' => ['nullable', 'integer', 'min:1', 'max:100000'],
        ]);
        DB::table('product_reorder_settings')->updateOrInsert(
            ['bookshop_id' => $bookshopId, 'book_id' => $book],
            [...$data, 'updated_at' => now(), 'created_at' => DB::table('product_reorder_settings')->where('bookshop_id', $bookshopId)->where('book_id', $book)->value('created_at') ?? now()],
        );

        return response()->json(['data' => DB::table('product_reorder_settings')->where('bookshop_id', $bookshopId)->where('book_id', $book)->first()]);
    }

    public function generate(Request $request): JsonResponse
    {
        $data = $request->validate([
            'branch_id' => ['required', 'integer'],
            'allow_outstanding' => ['nullable', 'boolean'],
            'items' => ['required', 'array', 'min:1', 'max:500'],
            'items.*.book_id' => ['required', 'integer'],
            'items.*.supplier_id' => ['required', 'integer', Tenant::exists('suppliers')],
            'items.*.quantity' => ['required', 'integer', 'min:0', 'max:1000000'],
            'items.*.unit_cost' => ['required', 'numeric', 'min:0', 'max:9999999999'],
            'items.*.product_unit_id' => ['nullable', 'integer'],
        ]);
        $branchId = $this->branch($request, $data['branch_id']);
        $ids = $this->orders->generateDrafts(Tenant::requireId(), $request->user(), $branchId, $data['items'], $request->boolean('allow_outstanding'));

        return response()->json(['data' => ['ids' => $ids], 'message' => count($ids) === 1 ? 'Draft order created.' : count($ids).' draft orders created, one per supplier.'], 201);
    }

    public function show(Request $request, int $order): JsonResponse
    {
        return response()->json(['data' => $this->orders->detail(Tenant::requireId(), $this->branches($request), $order, $request->user())]);
    }

    public function store(Request $request): JsonResponse
    {
        $data = $request->validate($this->orderRules());
        $this->branch($request, $data['branch_id']);
        $id = $this->orders->createDraft(Tenant::requireId(), $request->user(), $data);

        return response()->json(['data' => $this->orders->detail(Tenant::requireId(), $this->branches($request), $id, $request->user())], 201);
    }

    public function update(Request $request, int $order): JsonResponse
    {
        $data = $request->validate($this->orderRules(true));
        $this->orders->updateDraft(Tenant::requireId(), $this->branches($request), $order, $request->user(), $data);

        return $this->show($request, $order);
    }

    public function destroy(Request $request, int $order): JsonResponse
    {
        $this->orders->deleteDraft(Tenant::requireId(), $this->branches($request), $order, $request->user());

        return response()->json(['message' => 'Draft deleted.']);
    }

    public function submit(Request $request, int $order): JsonResponse
    {
        $this->orders->submit(Tenant::requireId(), $this->branches($request), $order, $request->user());

        return $this->show($request, $order);
    }

    public function approve(Request $request, int $order): JsonResponse
    {
        $this->orders->approve(Tenant::requireId(), $this->branches($request), $order, $request->user());

        return $this->show($request, $order);
    }

    public function reject(Request $request, int $order): JsonResponse
    {
        $this->orders->find($order, Tenant::requireId(), $this->branches($request));
        $data = $request->validate(['reason' => ['required', 'string', 'max:500']]);
        $this->orders->reject(Tenant::requireId(), $this->branches($request), $order, $request->user(), $data['reason']);

        return $this->show($request, $order);
    }

    public function confirm(Request $request, int $order, PurchaseOrderMailService $mail): JsonResponse
    {
        $data = $request->validate(['acknowledge_outstanding' => ['nullable', 'boolean'], 'send_email' => ['nullable', 'boolean']]);
        $bookshopId = Tenant::requireId();
        $this->orders->confirm($bookshopId, $this->branches($request), $order, $request->user(), (bool) ($data['acknowledge_outstanding'] ?? false));
        $message = 'Order confirmed.';
        if ($request->boolean('send_email')) {
            try {
                $mail->queue($bookshopId, $this->branches($request), $order, $request->user());
                $message = 'Order confirmed and queued for sending to the supplier.';
            } catch (ValidationException $exception) {
                // The order stays confirmed; the email problem is reported so staff can fix it or send manually.
                $message = 'Order confirmed, but not emailed: '.collect($exception->errors())->flatten()->first();
            }
        }

        return response()->json(['data' => $this->orders->detail($bookshopId, $this->branches($request), $order, $request->user()), 'message' => $message]);
    }

    public function send(Request $request, int $order, PurchaseOrderMailService $mail): JsonResponse
    {
        $mail->queue(Tenant::requireId(), $this->branches($request), $order, $request->user(), $request->boolean('resend'));

        return response()->json(['data' => $this->orders->detail(Tenant::requireId(), $this->branches($request), $order, $request->user()), 'message' => 'Queued for sending to the supplier.']);
    }

    public function markSent(Request $request, int $order): JsonResponse
    {
        $this->orders->find($order, Tenant::requireId(), $this->branches($request));
        $data = $request->validate(['notes' => ['nullable', 'string', 'max:500']]);
        $this->orders->markSentManually(Tenant::requireId(), $this->branches($request), $order, $request->user(), $data['notes'] ?? null);

        return $this->show($request, $order);
    }

    public function amend(Request $request, int $order): JsonResponse
    {
        $this->orders->find($order, Tenant::requireId(), $this->branches($request));
        $data = $request->validate([
            'reason' => ['required', 'string', 'max:500'],
            'expected_date' => ['nullable', 'date'],
            'delivery_location' => ['nullable', 'string', 'max:255'],
            'payment_terms' => ['nullable', 'string', 'max:120'],
            'internal_notes' => ['nullable', 'string', 'max:2000'],
            'supplier_notes' => ['nullable', 'string', 'max:2000'],
            'tax_rate' => ['sometimes', 'numeric', 'min:0', 'max:100'],
            'prices_include_tax' => ['sometimes', 'boolean'],
            'items' => ['sometimes', 'array', 'min:1', 'max:500'],
            'items.*.id' => ['nullable', 'integer'],
            'items.*.book_id' => ['required_without:items.*.id', 'nullable', 'integer'],
            'items.*.product_unit_id' => ['nullable', 'integer'],
            'items.*.quantity' => ['required_with:items', 'integer', 'min:1', 'max:1000000'],
            'items.*.unit_cost' => ['required_with:items', 'numeric', 'min:0', 'max:9999999999'],
            'items.*.discount' => ['nullable', 'numeric', 'min:0', 'max:9999999999'],
        ]);
        $reason = $data['reason'];
        unset($data['reason']);
        $this->orders->amend(Tenant::requireId(), $this->branches($request), $order, $request->user(), $data, $reason);

        return $this->show($request, $order);
    }

    public function cancel(Request $request, int $order): JsonResponse
    {
        $current = $this->orders->find($order, Tenant::requireId(), $this->branches($request));
        $data = $request->validate(['reason' => ['required', 'string', 'max:500']]);
        if (! in_array($current->status, ['draft', 'pending_approval'], true) && ! $request->user()->hasPermission('purchases.confirm')) {
            return response()->json(['message' => 'You do not have permission to cancel confirmed orders.'], 403);
        }
        $this->orders->cancel(Tenant::requireId(), $this->branches($request), $order, $request->user(), $data['reason']);

        return $this->show($request, $order);
    }

    public function receive(Request $request, int $order, PurchaseOrderReceivingService $receiving): JsonResponse
    {
        $this->orders->find($order, Tenant::requireId(), $this->branches($request));
        $data = $request->validate([
            'reference' => ['nullable', 'string', 'max:100'],
            'delivery_note_number' => ['nullable', 'string', 'max:120'],
            'received_on' => ['nullable', 'date', 'before_or_equal:today'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'submission_key' => ['nullable', 'string', 'max:64'],
            'items' => ['required', 'array', 'min:1'],
            'items.*.purchase_order_item_id' => ['required', 'integer'],
            'items.*.quantity' => ['required', 'integer', 'min:0', 'max:1000000'],
            'items.*.damaged_quantity' => ['nullable', 'integer', 'min:0', 'max:1000000'],
            'items.*.notes' => ['nullable', 'string', 'max:500'],
        ]);
        $result = $receiving->receive(Tenant::requireId(), $this->branches($request), $order, $request->user(), $data);

        return response()->json([
            'data' => $this->orders->detail(Tenant::requireId(), $this->branches($request), $order, $request->user()),
            'receipt_id' => $result['receipt_id'], 'duplicate' => $result['duplicate'], 'status' => $result['status'],
            'message' => $result['duplicate'] ? 'This delivery was already recorded.' : ($result['status'] === 'completed' ? 'All goods received. Order completed.' : 'Delivery recorded. Some items are still outstanding.'),
        ], $result['duplicate'] ? 200 : 201);
    }

    public function pdf(Request $request, int $order, PurchaseOrderPdfService $pdf): Response
    {
        $current = $this->orders->find($order, Tenant::requireId(), $this->branches($request));
        abort_if($current->lpo_number === null, 422, 'Confirm the order to generate its LPO document.');
        $filename = $current->lpo_number.'.pdf';

        return response($pdf->contents(Tenant::requireId(), $order), 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => ($request->boolean('inline') ? 'inline' : 'attachment')."; filename=\"$filename\"",
            'Cache-Control' => 'private, no-store',
        ]);
    }

    private function orderRules(bool $updating = false): array
    {
        $required = $updating ? 'sometimes' : 'required';

        return [
            'supplier_id' => [$required, 'integer', Tenant::exists('suppliers')],
            'branch_id' => [$required, 'integer', Tenant::exists('branches')],
            'order_date' => ['nullable', 'date'],
            'expected_date' => ['nullable', 'date'],
            'delivery_location' => ['nullable', 'string', 'max:255'],
            'payment_terms' => ['nullable', 'string', 'max:120'],
            'internal_notes' => ['nullable', 'string', 'max:2000'],
            'supplier_notes' => ['nullable', 'string', 'max:2000'],
            'tax_rate' => ['sometimes', 'numeric', 'min:0', 'max:100'],
            'prices_include_tax' => ['sometimes', 'boolean'],
            'items' => [$updating ? 'sometimes' : 'required', 'array', 'min:1', 'max:500'],
            'items.*.book_id' => ['required', 'integer', Tenant::exists('books')],
            'items.*.product_unit_id' => ['nullable', 'integer'],
            'items.*.quantity' => ['required', 'integer', 'min:1', 'max:1000000'],
            'items.*.unit_cost' => ['required', 'numeric', 'min:0', 'max:9999999999'],
            'items.*.discount' => ['nullable', 'numeric', 'min:0', 'max:9999999999'],
        ];
    }

    private function branches(Request $request): array
    {
        return $request->user()->branchIds();
    }

    /** A branch the user works in: the one asked for, or their first branch. */
    private function branch(Request $request, mixed $branchId): int
    {
        $branches = $this->branches($request);
        if ($branchId === null || $branchId === '') {
            abort_if(! $branches, 422, 'You are not assigned to a branch.');

            return $branches[0];
        }
        if (! in_array((int) $branchId, $branches, true)) {
            throw ValidationException::withMessages(['branch_id' => 'You do not work in that branch.']);
        }

        return (int) $branchId;
    }
}
