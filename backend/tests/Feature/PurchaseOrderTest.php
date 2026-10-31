<?php

namespace Tests\Feature;

use App\Mail\PurchaseOrderIssued;
use App\Models\Bookshop;
use App\Models\Branch;
use App\Models\User;
use App\Services\Purchasing\PurchaseOrderNumberService;
use App\Services\Purchasing\ReorderSuggestionService;
use App\Support\Roles;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/** Local Purchase Orders: reorder suggestions, workflow, numbering, PDF, email, receiving and isolation. */
class PurchaseOrderTest extends TestCase
{
    use RefreshDatabase;

    private array $shop;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        $this->shop = $this->bookshop('Kisumu Readers', 'KR');
    }

    private function bookshop(string $name, string $prefix): array
    {
        $bookshop = Bookshop::factory()->create(['name' => $name, 'business_email' => strtolower($prefix).'@shop.test', 'phone' => '0700 000 111']);
        $branch = Branch::factory()->main()->create(['bookshop_id' => $bookshop->id, 'code' => 'MAIN', 'name' => "$name Main"]);
        $owner = User::factory()->forBookshop($bookshop)->inBranches($branch)->create(['role' => Roles::BOOKSHOP_OWNER, 'name' => "$prefix Owner"]);
        $cashier = User::factory()->forBookshop($bookshop)->inBranches($branch)->create(['role' => Roles::CASHIER]);
        $officer = User::factory()->forBookshop($bookshop)->inBranches($branch)->create(['role' => Roles::INVENTORY_OFFICER]);
        $supplier = $this->supplier($bookshop->id, "$prefix Publishers", 'orders@'.strtolower($prefix).'-publishers.test');
        $supplier2 = $this->supplier($bookshop->id, "$prefix Stationers", 'sales@'.strtolower($prefix).'-stationers.test');
        $low = $this->book($bookshop->id, $branch->id, "$prefix Mathematics Grade 4", "$prefix-MATH4", 3, 250);
        $fine = $this->book($bookshop->id, $branch->id, "$prefix Atlas", "$prefix-ATLAS", 40, 900);
        $pens = $this->book($bookshop->id, $branch->id, "$prefix Blue Pens", "$prefix-PEN", 1, 20);

        return compact('bookshop', 'branch', 'owner', 'cashier', 'officer', 'supplier', 'supplier2', 'low', 'fine', 'pens');
    }

    private function supplier(int $bookshopId, string $name, ?string $email): int
    {
        return DB::table('suppliers')->insertGetId(['bookshop_id' => $bookshopId, 'name' => $name, 'email' => $email, 'contact_person' => 'Jane Wanjiru', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
    }

    private function book(int $bookshopId, int $branchId, string $title, string $sku, int $stock, float $cost): int
    {
        $id = DB::table('books')->insertGetId(['bookshop_id' => $bookshopId, 'title' => $title, 'sku' => $sku, 'isbn' => '978'.random_int(1000000000, 9999999999), 'cost_price' => $cost, 'selling_price' => $cost * 1.4, 'reorder_level' => 0, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('inventory_balances')->insert(['bookshop_id' => $bookshopId, 'book_id' => $id, 'branch_id' => $branchId, 'quantity' => $stock, 'reserved' => 0, 'created_at' => now(), 'updated_at' => now()]);

        return $id;
    }

    private function stock(int $bookId): int
    {
        return (int) DB::table('inventory_balances')->where('book_id', $bookId)->where('branch_id', $this->shop['branch']->id)->value('quantity');
    }

    private function draft(array $items = null, ?int $supplier = null): int
    {
        $this->actingAs($this->shop['owner'], 'sanctum');
        $response = $this->postJson('/api/v1/purchase-orders', [
            'supplier_id' => $supplier ?? $this->shop['supplier'], 'branch_id' => $this->shop['branch']->id, 'expected_date' => now()->addDays(7)->toDateString(),
            'items' => $items ?? [['book_id' => $this->shop['low'], 'quantity' => 20, 'unit_cost' => 250]],
        ])->assertCreated();

        return $response->json('data.id');
    }

    private function confirmed(array $items = null): int
    {
        $id = $this->draft($items);
        $this->postJson("/api/v1/purchase-orders/$id/confirm")->assertOk();

        return $id;
    }

    // 1. Reorder suggestions are calculated correctly.
    public function test_reorder_suggestions_follow_the_threshold_target_and_outstanding_formula(): void
    {
        $service = app(ReorderSuggestionService::class);
        $this->assertSame(17, $service->suggestedQuantity(3, 30, 10));
        $this->assertSame(0, $service->suggestedQuantity(25, 30, 10));
        $this->assertSame(20, $service->suggestedQuantity(3, 30, 10, null, 10), 'Rounded up to whole packs of 10.');
        $this->assertSame(50, $service->suggestedQuantity(3, 30, 10, 50), 'Raised to the minimum order quantity.');

        $this->actingAs($this->shop['owner'], 'sanctum');
        $rows = collect($this->getJson('/api/v1/purchase-orders/suggestions')->assertOk()->json('data'))->keyBy('book_id');
        $this->assertTrue($rows->has($this->shop['low']));
        $this->assertTrue($rows->has($this->shop['pens']));
        $this->assertFalse($rows->has($this->shop['fine']), 'A product above its reorder level is not suggested.');
        $this->assertSame(27, $rows[$this->shop['low']]['suggested_quantity'], 'Default target 30 minus 3 available.');
        $this->assertSame(5, $rows[$this->shop['low']]['reorder_level'], 'Default reorder level is 5.');

        // Per-product settings override the bookshop defaults.
        $this->putJson("/api/v1/purchase-orders/reorder-settings/{$this->shop['low']}", ['reorder_level' => 5, 'target_stock' => 30, 'pack_size' => 10, 'preferred_supplier_id' => $this->shop['supplier2']])->assertOk();
        $row = collect($this->getJson('/api/v1/purchase-orders/suggestions')->json('data'))->firstWhere('book_id', $this->shop['low']);
        $this->assertSame(30, $row['suggested_quantity']);
        $this->assertSame($this->shop['supplier2'], $row['preferred_supplier']['id']);
    }

    // 2. Items with outstanding orders are not suggested again.
    public function test_quantities_already_on_order_reduce_or_remove_suggestions(): void
    {
        $this->confirmed([['book_id' => $this->shop['low'], 'quantity' => 10, 'unit_cost' => 250]]);
        $row = collect($this->getJson('/api/v1/purchase-orders/suggestions')->json('data'))->firstWhere('book_id', $this->shop['low']);
        $this->assertSame(17, $row['suggested_quantity'], '30 target - 3 available - 10 on order.');
        $this->assertSame(10, $row['outstanding_quantity']);

        $this->confirmed([['book_id' => $this->shop['pens'], 'quantity' => 29, 'unit_cost' => 20]]);
        $this->assertNull(collect($this->getJson('/api/v1/purchase-orders/suggestions')->json('data'))->firstWhere('book_id', $this->shop['pens']));
    }

    // 3. Users can manually add products, and 4. different suppliers get separate LPOs.
    public function test_reviewed_lines_become_one_draft_per_supplier_including_manual_products(): void
    {
        $this->actingAs($this->shop['owner'], 'sanctum');
        $found = $this->getJson('/api/v1/purchase-orders/catalogue?search=Atlas')->assertOk()->json('data');
        $this->assertSame($this->shop['fine'], $found[0]['book_id'], 'Products above reorder level can still be found and added by hand.');

        $ids = $this->postJson('/api/v1/purchase-orders/generate', ['branch_id' => $this->shop['branch']->id, 'items' => [
            ['book_id' => $this->shop['low'], 'supplier_id' => $this->shop['supplier'], 'quantity' => 27, 'unit_cost' => 250],
            ['book_id' => $this->shop['fine'], 'supplier_id' => $this->shop['supplier'], 'quantity' => 5, 'unit_cost' => 900],
            ['book_id' => $this->shop['pens'], 'supplier_id' => $this->shop['supplier2'], 'quantity' => 29, 'unit_cost' => 20],
        ]])->assertCreated()->json('data.ids');

        $this->assertCount(2, $ids);
        $orders = DB::table('purchase_orders')->whereIn('id', $ids)->get()->keyBy('supplier_id');
        $this->assertSame('draft', $orders[$this->shop['supplier']]->status);
        $this->assertSame(2, DB::table('purchase_order_items')->where('purchase_order_id', $orders[$this->shop['supplier']]->id)->count());
        $this->assertSame(1, DB::table('purchase_order_items')->where('purchase_order_id', $orders[$this->shop['supplier2']]->id)->count());
        $this->assertEquals(11250.0, (float) $orders[$this->shop['supplier']]->subtotal);
    }

    public function test_ordering_a_product_already_on_order_needs_explicit_confirmation(): void
    {
        $this->confirmed();
        $payload = ['branch_id' => $this->shop['branch']->id, 'items' => [['book_id' => $this->shop['low'], 'supplier_id' => $this->shop['supplier'], 'quantity' => 5, 'unit_cost' => 250]]];
        $this->postJson('/api/v1/purchase-orders/generate', $payload)->assertUnprocessable()->assertJsonValidationErrors('outstanding');
        $this->postJson('/api/v1/purchase-orders/generate', [...$payload, 'allow_outstanding' => true])->assertCreated();
    }

    // 5. Confirmed LPOs receive unique numbers, also under concurrent issuing.
    public function test_confirmed_orders_get_sequential_unique_numbers_per_bookshop(): void
    {
        $first = $this->confirmed();
        $second = $this->confirmed([['book_id' => $this->shop['pens'], 'quantity' => 5, 'unit_cost' => 20]]);
        $year = now()->year;
        $this->assertSame("LPO-$year-000001", DB::table('purchase_orders')->where('id', $first)->value('lpo_number'));
        $this->assertSame("LPO-$year-000002", DB::table('purchase_orders')->where('id', $second)->value('lpo_number'));

        $numbers = app(PurchaseOrderNumberService::class);
        $issued = collect(range(1, 25))->map(fn () => $numbers->next($this->shop['bookshop']->id));
        $this->assertSame(25, $issued->unique()->count());
        $this->assertSame("LPO-$year-000027", $issued->last());

        // Another bookshop has its own sequence.
        $other = $this->bookshop('Nakuru Books', 'NB');
        $this->assertSame("LPO-$year-000001", $numbers->next($other['bookshop']->id));

        // Confirming twice does not issue a second number.
        $this->postJson("/api/v1/purchase-orders/$first/confirm")->assertUnprocessable();
        $this->assertSame("LPO-$year-000001", DB::table('purchase_orders')->where('id', $first)->value('lpo_number'));
    }

    // 6. PDFs contain the correct bookshop and supplier information.
    public function test_the_lpo_pdf_carries_bookshop_supplier_items_and_nifunze_footer(): void
    {
        $id = $this->confirmed();
        $order = DB::table('purchase_orders')->find($id);
        Storage::disk('local')->assertExists($order->pdf_path);

        $response = $this->get("/api/v1/purchase-orders/$id/pdf")->assertOk()->assertHeader('Content-Type', 'application/pdf');
        $pdf = $response->getContent();
        $this->assertStringStartsWith('%PDF-', $pdf);
        foreach (['Kisumu Readers', 'KR Publishers', $order->lpo_number, 'KR Mathematics Grade 4', 'KR-MATH4', 'LOCAL PURCHASE ORDER', 'Generated using Nifunze Bookshop', 'KR Owner'] as $text) {
            $this->assertStringContainsString($text, $pdf, "PDF is missing: $text");
        }
        $this->assertStringNotContainsString('Nakuru', $pdf);

        // Drafts have no LPO document yet.
        $draft = $this->draft();
        $this->get("/api/v1/purchase-orders/$draft/pdf")->assertStatus(422);
    }

    // 7. Successful emails update delivery status (and confirming never changes stock).
    public function test_sending_emails_the_supplier_and_marks_the_order_sent(): void
    {
        Mail::fake();
        $before = $this->stock($this->shop['low']);
        $id = $this->draft();
        $this->postJson("/api/v1/purchase-orders/$id/confirm", ['send_email' => true])->assertOk()->assertJsonPath('data.status', 'sent');
        $this->assertSame($before, $this->stock($this->shop['low']), 'Confirming and emailing never change stock.');

        $order = DB::table('purchase_orders')->find($id);
        $this->assertSame('sent', $order->email_status);
        $this->assertSame('email', $order->delivery_method);
        $this->assertNotNull($order->email_sent_at);
        Mail::assertSent(PurchaseOrderIssued::class, function (PurchaseOrderIssued $mail) use ($order) {
            return $mail->hasTo('orders@kr-publishers.test')
                && $mail->envelope()->subject === "New Purchase Order {$order->lpo_number} from Kisumu Readers via Nifunze Bookshop"
                && count($mail->attachments()) === 1
                && str_contains($mail->render(), 'Generated via Nifunze Bookshop');
        });

        // A second plain send is refused; an explicit resend is allowed and reuses the LPO number.
        $this->postJson("/api/v1/purchase-orders/$id/send")->assertUnprocessable();
        $this->postJson("/api/v1/purchase-orders/$id/send", ['resend' => true])->assertOk();
        Mail::assertSentCount(2);
        $this->assertSame($order->lpo_number, DB::table('purchase_orders')->where('id', $id)->value('lpo_number'));
        $this->assertSame(2, DB::table('purchase_order_email_attempts')->where('purchase_order_id', $id)->where('status', 'sent')->count());
    }

    // 8. Failed emails can be retried without creating another LPO.
    public function test_failed_emails_are_recorded_and_can_be_retried(): void
    {
        $id = $this->confirmed();
        $number = DB::table('purchase_orders')->where('id', $id)->value('lpo_number');
        Mail::shouldReceive('to')->once()->andThrow(new RuntimeException('Connection to SMTP server refused'));
        $this->postJson("/api/v1/purchase-orders/$id/send")->assertOk()->assertJsonPath('data.email_status', 'failed')->assertJsonPath('data.status', 'confirmed');
        $this->assertSame('Connection to SMTP server refused', DB::table('purchase_order_email_attempts')->where('purchase_order_id', $id)->value('error'));

        // The mail server is back.
        app()->forgetInstance('mail.manager');
        Mail::clearResolvedInstances();
        Mail::fake();
        $this->postJson("/api/v1/purchase-orders/$id/send")->assertOk()->assertJsonPath('data.email_status', 'sent')->assertJsonPath('data.status', 'sent');
        $this->assertSame(1, DB::table('purchase_orders')->where('bookshop_id', $this->shop['bookshop']->id)->whereNotNull('lpo_number')->count());
        $this->assertSame($number, DB::table('purchase_orders')->where('id', $id)->value('lpo_number'));
        $this->assertSame(['failed', 'sent'], DB::table('purchase_order_email_attempts')->where('purchase_order_id', $id)->orderBy('id')->pluck('status')->all());
    }

    public function test_suppliers_without_email_can_be_marked_sent_manually(): void
    {
        $id = $this->draft(null, $this->supplier($this->shop['bookshop']->id, 'Walk-in Wholesaler', null));
        $this->postJson("/api/v1/purchase-orders/$id/confirm", ['send_email' => true])->assertOk()->assertJsonPath('data.status', 'confirmed');
        $this->postJson("/api/v1/purchase-orders/$id/send")->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->postJson("/api/v1/purchase-orders/$id/mark-sent")->assertOk()->assertJsonPath('data.status', 'sent')->assertJsonPath('data.delivery_method', 'manual');
    }

    // 9. Partial receiving, 10. repeated submissions and 11. full receiving.
    public function test_receiving_in_parts_converts_packs_and_never_double_counts(): void
    {
        $carton = DB::table('product_units')->insertGetId(['bookshop_id' => $this->shop['bookshop']->id, 'book_id' => $this->shop['pens'], 'name' => 'Carton', 'pieces_per_unit' => 50, 'created_at' => now(), 'updated_at' => now()]);
        $id = $this->confirmed([
            ['book_id' => $this->shop['low'], 'quantity' => 20, 'unit_cost' => 250],
            ['book_id' => $this->shop['pens'], 'quantity' => 2, 'unit_cost' => 900, 'product_unit_id' => $carton],
        ]);
        $items = DB::table('purchase_order_items')->where('purchase_order_id', $id)->orderBy('position')->pluck('id')->all();
        $key = (string) Str::uuid();
        $payload = ['submission_key' => $key, 'delivery_note_number' => 'DN-554', 'items' => [
            ['purchase_order_item_id' => $items[0], 'quantity' => 12, 'damaged_quantity' => 1, 'notes' => 'One cover torn'],
            ['purchase_order_item_id' => $items[1], 'quantity' => 1],
        ]];

        $this->postJson("/api/v1/purchase-orders/$id/receive", $payload)->assertCreated()->assertJsonPath('status', 'partially_received');
        $this->assertSame(15, $this->stock($this->shop['low']));
        $this->assertSame(51, $this->stock($this->shop['pens']), 'One carton of 50 pieces added to 1 in stock.');
        $movement = DB::table('inventory_movements')->where('book_id', $this->shop['pens'])->where('type', 'goods_received')->first();
        $this->assertSame($this->shop['supplier'], (int) $movement->supplier_id);
        $this->assertSame(50, (int) $movement->units_per_package);

        // The same submission again (double click, retry) changes nothing.
        $this->postJson("/api/v1/purchase-orders/$id/receive", $payload)->assertOk()->assertJsonPath('duplicate', true);
        $this->assertSame(15, $this->stock($this->shop['low']));
        $this->assertSame(1, DB::table('goods_receipts')->where('purchase_order_id', $id)->count());

        // More than outstanding is refused.
        $this->postJson("/api/v1/purchase-orders/$id/receive", ['items' => [['purchase_order_item_id' => $items[0], 'quantity' => 9]]])->assertUnprocessable();

        $this->postJson("/api/v1/purchase-orders/$id/receive", ['submission_key' => (string) Str::uuid(), 'items' => [
            ['purchase_order_item_id' => $items[0], 'quantity' => 8], ['purchase_order_item_id' => $items[1], 'quantity' => 1],
        ]])->assertCreated()->assertJsonPath('status', 'completed');
        $this->assertSame(23, $this->stock($this->shop['low']));
        $this->assertSame(101, $this->stock($this->shop['pens']));
        $this->assertSame('completed', DB::table('purchase_orders')->where('id', $id)->value('status'));
        $this->postJson("/api/v1/purchase-orders/$id/receive", ['items' => [['purchase_order_item_id' => $items[0], 'quantity' => 1]]])->assertUnprocessable();

        $detail = $this->getJson("/api/v1/purchase-orders/$id")->assertOk()->json('data');
        $this->assertCount(2, $detail['receipts']);
        $this->assertSame('DN-554', $detail['receipts'][1]['delivery_note_number']);
    }

    public function test_cancelling_after_partial_delivery_closes_only_the_outstanding_quantity(): void
    {
        $id = $this->confirmed();
        $item = DB::table('purchase_order_items')->where('purchase_order_id', $id)->value('id');
        $this->postJson("/api/v1/purchase-orders/$id/receive", ['items' => [['purchase_order_item_id' => $item, 'quantity' => 5]]])->assertCreated();
        $this->postJson("/api/v1/purchase-orders/$id/cancel", ['reason' => 'Supplier out of stock'])->assertOk()->assertJsonPath('data.status', 'completed');
        $this->assertSame(15, (int) DB::table('purchase_order_items')->where('id', $item)->value('cancelled_quantity'));
        $this->assertSame(8, $this->stock($this->shop['low']));
        $this->deleteJson("/api/v1/purchase-orders/$id")->assertUnprocessable();
        $this->assertDatabaseHas('purchase_orders', ['id' => $id]);
    }

    public function test_approval_workflow_and_amendments_are_recorded(): void
    {
        $this->actingAs($this->shop['owner'], 'sanctum');
        $this->putJson('/api/v1/purchase-orders/settings', ['approval_required' => true])->assertOk()->assertJsonPath('data.approval_required', true);
        $id = $this->draft();
        $this->postJson("/api/v1/purchase-orders/$id/confirm")->assertUnprocessable();
        $this->postJson("/api/v1/purchase-orders/$id/submit")->assertOk()->assertJsonPath('data.status', 'pending_approval');
        $this->postJson("/api/v1/purchase-orders/$id/reject", ['reason' => 'Check the price'])->assertOk()->assertJsonPath('data.status', 'draft')->assertJsonPath('data.rejection_reason', 'Check the price');
        $this->postJson("/api/v1/purchase-orders/$id/submit")->assertOk();
        $this->postJson("/api/v1/purchase-orders/$id/approve")->assertOk()->assertJsonPath('data.status', 'approved');
        $this->postJson("/api/v1/purchase-orders/$id/confirm")->assertOk()->assertJsonPath('data.status', 'confirmed');

        $item = DB::table('purchase_order_items')->where('purchase_order_id', $id)->value('id');
        $this->postJson("/api/v1/purchase-orders/$id/amend", ['reason' => 'Supplier price increase', 'items' => [['id' => $item, 'quantity' => 20, 'unit_cost' => 275]]])
            ->assertOk()->assertJsonPath('data.version', 2)->assertJsonPath('data.subtotal', 5500);
        $event = DB::table('purchase_order_events')->where('purchase_order_id', $id)->where('action', 'amended')->first();
        $this->assertSame('Supplier price increase', $event->notes);
        $this->assertEquals(250, json_decode($event->snapshot, true)['items'][0]['unit_cost']);
        $this->assertStringEndsWith('-v2.pdf', DB::table('purchase_orders')->where('id', $id)->value('pdf_path'));
        $this->assertSame(['created', 'submitted', 'rejected', 'submitted', 'approved', 'confirmed', 'amended'], DB::table('purchase_order_events')->where('purchase_order_id', $id)->orderBy('id')->pluck('action')->all());
    }

    // 12. One bookshop cannot access another bookshop's orders.
    public function test_purchase_orders_are_isolated_between_bookshops(): void
    {
        $other = $this->bookshop('Nakuru Books', 'NB');
        $theirs = $this->confirmed();
        $this->actingAs($other['owner'], 'sanctum');

        $this->getJson('/api/v1/purchase-orders')->assertOk()->assertJsonPath('total', 0);
        foreach (['get' => "/api/v1/purchase-orders/$theirs", 'pdf' => "/api/v1/purchase-orders/$theirs/pdf"] as $url) $this->getJson($url)->assertNotFound();
        foreach (['send', 'receive', 'cancel', 'approve', 'confirm', 'amend', 'mark-sent'] as $action) {
            $this->postJson("/api/v1/purchase-orders/$theirs/$action", ['reason' => 'x', 'items' => [['purchase_order_item_id' => 1, 'quantity' => 1]]])->assertStatus(404);
        }
        // Their supplier, product and branch cannot be used in our order.
        $this->postJson('/api/v1/purchase-orders', ['supplier_id' => $this->shop['supplier'], 'branch_id' => $other['branch']->id, 'items' => [['book_id' => $other['low'], 'quantity' => 1, 'unit_cost' => 1]]])->assertUnprocessable()->assertJsonValidationErrors('supplier_id');
        $this->postJson('/api/v1/purchase-orders', ['supplier_id' => $other['supplier'], 'branch_id' => $other['branch']->id, 'items' => [['book_id' => $this->shop['low'], 'quantity' => 1, 'unit_cost' => 1]]])->assertUnprocessable()->assertJsonValidationErrors('items.0.book_id');
        $this->postJson('/api/v1/purchase-orders', ['supplier_id' => $other['supplier'], 'branch_id' => $this->shop['branch']->id, 'items' => [['book_id' => $other['low'], 'quantity' => 1, 'unit_cost' => 1]]])->assertUnprocessable()->assertJsonValidationErrors('branch_id');
        $this->assertNotContains($this->shop['low'], collect($this->getJson('/api/v1/purchase-orders/suggestions')->json('data'))->pluck('book_id'));
        $this->assertSame(0, $this->getJson('/api/v1/purchase-orders/summary')->json('data.sent') + $this->getJson('/api/v1/purchase-orders/summary')->json('data.confirmed'));
    }

    // 13. Unauthorized users cannot approve or confirm LPOs.
    public function test_permissions_gate_viewing_creating_approving_and_confirming(): void
    {
        $id = $this->draft();
        $this->actingAs($this->shop['cashier'], 'sanctum');
        $this->getJson('/api/v1/purchase-orders')->assertForbidden();
        $this->postJson("/api/v1/purchase-orders/$id/confirm")->assertForbidden();

        $this->actingAs($this->shop['officer'], 'sanctum');
        $this->getJson("/api/v1/purchase-orders/$id")->assertOk()->assertJsonPath('data.actions.confirm', false)->assertJsonPath('data.actions.edit', true);
        $this->postJson("/api/v1/purchase-orders/$id/submit")->assertOk();
        $this->postJson("/api/v1/purchase-orders/$id/approve")->assertForbidden();
        $this->postJson("/api/v1/purchase-orders/$id/confirm")->assertForbidden();
        $this->postJson("/api/v1/purchase-orders/$id/send")->assertForbidden();
        $this->assertNull(DB::table('purchase_orders')->where('id', $id)->value('lpo_number'));
    }

    public function test_dashboard_and_reports_summarise_purchasing(): void
    {
        $id = $this->confirmed();
        $this->draft([['book_id' => $this->shop['pens'], 'quantity' => 5, 'unit_cost' => 20]]);
        DB::table('purchase_orders')->where('id', $id)->update(['expected_date' => now()->subDays(3)->toDateString()]);

        $summary = $this->getJson('/api/v1/purchase-orders/summary')->assertOk()->json('data');
        $this->assertSame(1, $summary['drafts']);
        $this->assertSame(1, $summary['awaiting_delivery']);
        $this->assertSame(1, $summary['overdue']);
        $this->assertEquals(5000, $summary['outstanding_value']);
        $this->assertSame(2, $summary['below_reorder_level']);

        $report = $this->getJson('/api/v1/purchase-orders/reports')->assertOk()->json('data');
        $this->assertSame('KR Publishers', $report['by_supplier'][0]['supplier']);
        $this->assertSame(20, $report['by_supplier'][0]['outstanding_quantity']);
        $this->assertSame(3, $report['overdue'][0]['days_late']);

        $tab = $this->getJson('/api/v1/purchase-orders?tab=drafts')->assertOk();
        $this->assertSame(1, $tab->json('total'));
        $this->assertSame(1, $this->getJson('/api/v1/purchase-orders?search=Mathematics')->json('total'));
    }

    // 14. Existing modules keep working: old purchase-order payloads and supplier editing.
    public function test_existing_purchase_order_payloads_still_work(): void
    {
        $this->actingAs($this->shop['owner'], 'sanctum');
        $legacy = DB::table('purchase_orders')->insertGetId(['bookshop_id' => $this->shop['bookshop']->id, 'supplier_id' => $this->shop['supplier'], 'branch_id' => $this->shop['branch']->id, 'status' => 'approved', 'created_at' => now(), 'updated_at' => now()]);
        $item = DB::table('purchase_order_items')->insertGetId(['purchase_order_id' => $legacy, 'book_id' => $this->shop['low'], 'quantity' => 4, 'received_quantity' => 0, 'unit_cost' => 250, 'created_at' => now(), 'updated_at' => now()]);
        $this->postJson("/api/purchase-orders/$legacy/receive", ['reference' => 'GRN-OLD-1', 'items' => [['purchase_order_item_id' => $item, 'quantity' => 4]]])->assertCreated();
        $this->assertSame(7, $this->stock($this->shop['low']));

        $this->putJson("/api/v1/suppliers/{$this->shop['supplier']}", ['name' => 'KR Publishers Ltd', 'email' => 'lpo@kr.test', 'payment_terms' => '30 days', 'lead_time_days' => 5])->assertOk()->assertJsonPath('payment_terms', '30 days');
        $id = $this->draft();
        $this->assertSame('30 days', DB::table('purchase_orders')->where('id', $id)->value('payment_terms'));
        $this->assertSame(now()->addDays(7)->toDateString(), DB::table('purchase_orders')->where('id', $id)->value('expected_date'));
    }
}
