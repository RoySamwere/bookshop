<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\User;
use App\Support\Roles;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class PosTest extends TestCase
{
    use RefreshDatabase;

    private Branch $branch;
    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->branch = Branch::factory()->create();
        $this->cashier = User::factory()->inBranches($this->branch)->create(['role' => Roles::CASHIER]);
    }

    private function category(string $name): int
    {
        return DB::table('product_categories')->insertGetId(['name' => $name, 'created_at' => now(), 'updated_at' => now()]);
    }

    private function book(array $attributes, int $stock = 0, ?int $categoryId = null): int
    {
        $subcategory = null;
        if ($categoryId) {
            $subcategory = DB::table('product_subcategories')->insertGetId([
                'product_category_id' => $categoryId, 'name' => 'General '.uniqid(), 'created_at' => now(), 'updated_at' => now(),
            ]);
        }
        $id = DB::table('books')->insertGetId(array_merge([
            'bookshop_id' => $this->tenantId(), 'title' => 'Book', 'sku' => uniqid('SKU-'), 'selling_price' => 500, 'reorder_level' => 5,
            'product_subcategory_id' => $subcategory, 'created_at' => now(), 'updated_at' => now(),
        ], $attributes));
        if ($stock) {
            DB::table('inventory_balances')->insert(['bookshop_id' => $this->tenantId(), 'book_id' => $id, 'branch_id' => $this->branch->id, 'quantity' => $stock, 'reserved' => 0, 'created_at' => now(), 'updated_at' => now()]);
        }

        return $id;
    }

    private function checkout(array $overrides = []): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/pos/checkout', array_merge([
            'idempotency_key' => 'sale-'.uniqid(), 'branch_id' => $this->branch->id,
            'items' => [], 'payment_method' => 'cash', 'amount_received' => 0,
        ], $overrides));
    }

    public function test_products_show_branch_stock_and_put_an_exact_barcode_match_first(): void
    {
        $this->book(['title' => 'Atlas for Schools', 'sku' => 'ATL-1', 'isbn' => '9789966000002'], 4);
        $this->book(['title' => 'Zoology Basics', 'sku' => 'ZOO-1', 'isbn' => '9789966000001'], 0);
        $this->actingAs($this->cashier, 'sanctum');

        $this->getJson("/api/pos/products?branch_id={$this->branch->id}")->assertOk()
            ->assertJsonPath('data.0.title', 'Atlas for Schools')->assertJsonPath('data.0.available', 4)
            ->assertJsonPath('data.1.available', 0);
        $this->getJson("/api/pos/products?branch_id={$this->branch->id}&search=9789966000001")->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.sku', 'ZOO-1');
        // A scanned code ranks above titles that merely contain it.
        $this->book(['title' => 'Notes on ATL-1 maps', 'sku' => 'NOTE-1'], 1);
        $this->getJson("/api/pos/products?branch_id={$this->branch->id}&search=ATL-1")->assertOk()
            ->assertJsonPath('data.0.sku', 'ATL-1');
    }

    public function test_products_can_be_filtered_by_category(): void
    {
        $textbooks = $this->category('Textbooks');
        $stationery = $this->category('Stationery');
        $this->book(['title' => 'Grade 7 Science'], 3, $textbooks);
        $this->book(['title' => 'Blue Pen'], 50, $stationery);
        $this->actingAs($this->cashier, 'sanctum');

        $this->getJson("/api/pos/products?branch_id={$this->branch->id}&category_id={$stationery}")->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.title', 'Blue Pen')->assertJsonPath('data.0.category', 'Stationery')
            ->assertJsonPath('data.0.category_id', $stationery);
        $this->getJson("/api/pos/products?branch_id={$this->branch->id}&category_id=9999")->assertUnprocessable();
    }

    public function test_cashiers_only_sell_from_their_branches(): void
    {
        $other = Branch::factory()->create();
        $this->actingAs($this->cashier, 'sanctum');

        $this->getJson('/api/pos/branches')->assertOk()->assertJsonCount(1)->assertJsonPath('0.id', $this->branch->id);
        $this->getJson("/api/pos/products?branch_id={$other->id}")->assertForbidden();
        $book = $this->book(['title' => 'Atlas'], 5);
        $this->checkout(['branch_id' => $other->id, 'items' => [['book_id' => $book, 'quantity' => 1]], 'amount_received' => 500])->assertForbidden();

        $inventoryOfficer = User::factory()->inBranches($this->branch)->create(['role' => Roles::INVENTORY_OFFICER]);
        $this->actingAs($inventoryOfficer, 'sanctum')->getJson('/api/pos/branches')->assertForbidden();
    }

    public function test_cash_sale_records_receipt_change_and_deducts_stock(): void
    {
        $atlas = $this->book(['title' => 'Atlas', 'selling_price' => 850], 5);
        $pen = $this->book(['title' => 'Blue Pen', 'selling_price' => 25], 100);
        $this->actingAs($this->cashier, 'sanctum');

        $response = $this->checkout([
            'items' => [['book_id' => $atlas, 'quantity' => 2], ['book_id' => $pen, 'quantity' => 4]],
            'amount_received' => 2000,
        ])->assertCreated()->assertJsonPath('sale.payment_method', 'cash')->assertJsonCount(2, 'items');

        // MySQL returns decimals as strings and SQLite as numbers; compare the values.
        $this->assertEquals(1800, (float) $response->json('sale.total'));
        $this->assertEquals(200, (float) $response->json('sale.change_due'));

        $this->assertMatchesRegularExpression('/^HK-\d{7}$/', $response->json('sale.receipt_number'));
        $this->assertDatabaseHas('inventory_balances', ['book_id' => $atlas, 'branch_id' => $this->branch->id, 'quantity' => 3]);
        $this->assertDatabaseHas('inventory_balances', ['book_id' => $pen, 'branch_id' => $this->branch->id, 'quantity' => 96]);
        $this->assertDatabaseHas('inventory_movements', ['book_id' => $atlas, 'type' => 'sale', 'quantity_change' => -2, 'reference' => $response->json('sale.receipt_number')]);
    }

    public function test_retrying_the_same_sale_does_not_charge_or_deduct_twice(): void
    {
        $atlas = $this->book(['title' => 'Atlas', 'selling_price' => 850], 5);
        $this->actingAs($this->cashier, 'sanctum');
        $payload = ['idempotency_key' => 'till-1-sale-42', 'items' => [['book_id' => $atlas, 'quantity' => 1]], 'amount_received' => 1000];

        $first = $this->checkout($payload)->assertCreated()->json('sale.receipt_number');
        $second = $this->checkout($payload)->assertOk()->json('sale.receipt_number');

        $this->assertSame($first, $second);
        $this->assertDatabaseCount('pos_sales', 1);
        $this->assertDatabaseHas('inventory_balances', ['book_id' => $atlas, 'quantity' => 4]);
    }

    public function test_payment_rules_are_enforced(): void
    {
        $atlas = $this->book(['title' => 'Atlas', 'selling_price' => 850], 5);
        $items = [['book_id' => $atlas, 'quantity' => 1]];
        $this->actingAs($this->cashier, 'sanctum');

        $this->checkout(['items' => $items, 'amount_received' => 800])->assertUnprocessable()->assertJsonValidationErrors('amount_received');
        $this->checkout(['items' => $items, 'payment_method' => 'mpesa', 'amount_received' => 850])->assertUnprocessable()->assertJsonValidationErrors('payment_reference');
        $this->checkout(['items' => $items, 'payment_method' => 'mpesa', 'payment_reference' => 'SJK7H2M1QX', 'amount_received' => 900])
            ->assertUnprocessable()->assertJsonValidationErrors('amount_received');
        $this->checkout(['items' => $items, 'payment_method' => 'mpesa', 'payment_reference' => 'SJK7H2M1QX', 'amount_received' => 850])
            ->assertCreated()->assertJsonPath('sale.payment_reference', 'SJK7H2M1QX');
        $this->assertEquals(0, (float) DB::table('pos_sales')->value('change_due'));
        $this->assertDatabaseCount('pos_sales', 1);
    }

    public function test_a_shortage_names_the_product_and_rolls_back_the_whole_sale(): void
    {
        $atlas = $this->book(['title' => 'Atlas', 'selling_price' => 850], 5);
        $dictionary = $this->book(['title' => 'Kamusi ya Kiswahili', 'selling_price' => 1200], 1);
        $this->actingAs($this->cashier, 'sanctum');

        $this->checkout([
            'items' => [['book_id' => $atlas, 'quantity' => 2], ['book_id' => $dictionary, 'quantity' => 3]],
            'amount_received' => 6000,
        ])->assertUnprocessable()->assertJsonPath('errors.items.0', 'Not enough stock for "Kamusi ya Kiswahili" at this branch.');

        $this->assertDatabaseCount('pos_sales', 0);
        $this->assertDatabaseHas('inventory_balances', ['book_id' => $atlas, 'quantity' => 5]);
        $this->assertDatabaseHas('inventory_balances', ['book_id' => $dictionary, 'quantity' => 1]);
    }

    public function test_cashiers_can_list_and_reopen_todays_receipts(): void
    {
        $atlas = $this->book(['title' => 'Atlas', 'selling_price' => 850], 5);
        $this->actingAs($this->cashier, 'sanctum');
        $sale = $this->checkout(['items' => [['book_id' => $atlas, 'quantity' => 1]], 'amount_received' => 850])->json('sale.id');

        $this->getJson('/api/pos/sales?date='.now()->toDateString()."&branch_id={$this->branch->id}")->assertOk()
            ->assertJsonPath('total', 1)->assertJsonPath('summary.transactions', 1);
        $this->getJson("/api/pos/sales/{$sale}")->assertOk()->assertJsonPath('items.0.title', 'Atlas');
    }
}
