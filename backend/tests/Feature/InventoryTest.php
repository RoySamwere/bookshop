<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\User;
use App\Support\Roles;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class InventoryTest extends TestCase
{
    use RefreshDatabase;

    private function book(array $attributes = []): int
    {
        return DB::table('books')->insertGetId(array_merge([
            'bookshop_id' => $this->tenantId(), 'title' => 'Learning Mathematics', 'sku' => 'MATH-1', 'selling_price' => 500,
            'reorder_level' => 5, 'created_at' => now(), 'updated_at' => now(),
        ], $attributes));
    }

    /** Stock receipts must name an active supplier. */
    private function supplier(): int
    {
        return DB::table('suppliers')->insertGetId(['bookshop_id' => $this->tenantId(), 'name' => 'Longhorn Publishers', 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
    }

    /** New products must belong to a subcategory. */
    private function subcategory(): int
    {
        $category = DB::table('product_categories')->insertGetId(['name' => 'Textbooks', 'created_at' => now(), 'updated_at' => now()]);

        return DB::table('product_subcategories')->insertGetId(['product_category_id' => $category, 'name' => 'Secondary', 'created_at' => now(), 'updated_at' => now()]);
    }

    public function test_inventory_accepts_the_default_thirty_item_page_size(): void
    {
        $branch = Branch::factory()->create();
        $this->actingAs(User::factory()->inBranches($branch)->create(['role' => Roles::INVENTORY_OFFICER]), 'sanctum');
        for ($index = 1; $index <= 35; $index++) {
            $book = $this->book(['sku' => 'PAGE-'.$index]);
            DB::table('inventory_balances')->insert(['bookshop_id' => $this->tenantId(), 'book_id' => $book, 'branch_id' => $branch->id, 'quantity' => 1, 'reserved' => 0, 'created_at' => now(), 'updated_at' => now()]);
        }

        $this->getJson('/api/inventory?page=1&per_page=30')->assertOk()->assertJsonCount(30, 'data')
            ->assertJsonPath('per_page', 30)->assertJsonPath('total', 35)->assertJsonPath('last_page', 2);
        $this->getJson('/api/inventory?page=2&per_page=30')->assertOk()->assertJsonCount(5, 'data');
        $this->getJson('/api/inventory?per_page=')->assertOk()->assertJsonPath('per_page', 30);
    }

    public function test_a_missing_product_can_be_created_then_received_in_the_same_workflow(): void
    {
        $branch = Branch::factory()->create();
        $user = User::factory()->inBranches($branch)->create(['role' => Roles::INVENTORY_OFFICER]);
        $this->actingAs($user, 'sanctum');
        $this->getJson('/api/books?search=New%20Science%20Book&active_only=1')->assertOk()->assertJsonCount(0, 'data');

        $payload = ['title' => 'New Science Book', 'sku' => 'SCI-NEW', 'isbn' => null, 'cost_price' => 350, 'selling_price' => 500, 'reorder_level' => 10, 'product_subcategory_id' => $this->subcategory()];
        $book = $this->postJson('/api/books', $payload)->assertCreated()->assertJsonPath('title', 'New Science Book')->json('id');
        $this->assertDatabaseCount('inventory_balances', 0);
        $this->postJson('/api/books', $payload)->assertUnprocessable()->assertJsonValidationErrors('sku');
        $this->postJson('/api/inventory/receive', ['book_id' => $book, 'branch_id' => $branch->id, 'quantity' => 25, 'supplier_id' => $this->supplier()])
            ->assertCreated()->assertJsonPath('quantity', 25);
        $this->getJson('/api/books?search=New%20Science%20Book&active_only=1')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $book);
        $this->assertDatabaseHas('inventory_movements', ['book_id' => $book, 'branch_id' => $branch->id, 'type' => 'receipt', 'quantity_change' => 25]);
    }

    public function test_receiving_creates_a_balance_and_adds_to_it_with_a_movement_for_each_receipt(): void
    {
        $branch = Branch::factory()->create();
        $user = User::factory()->inBranches($branch)->create(['role' => Roles::INVENTORY_OFFICER]);
        $book = $this->book();
        $supplier = $this->supplier();
        $this->actingAs($user, 'sanctum');
        $this->getJson('/api/branches?active_only=1')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $branch->id);

        $this->postJson('/api/inventory/receive', [
            'book_id' => $book, 'branch_id' => $branch->id, 'quantity' => 12,
            'reference' => 'DN-001', 'notes' => 'Opening stock', 'supplier_id' => $supplier,
        ])->assertCreated()->assertJsonPath('quantity', 12);
        $this->postJson('/api/inventory/receive', [
            'book_id' => $book, 'branch_id' => $branch->id, 'quantity' => 3, 'supplier_id' => $supplier,
        ])->assertCreated()->assertJsonPath('quantity', 15);

        $this->assertDatabaseCount('inventory_balances', 1);
        $this->assertDatabaseHas('inventory_balances', ['book_id' => $book, 'branch_id' => $branch->id, 'quantity' => 15, 'reserved' => 0]);
        $this->assertDatabaseCount('inventory_movements', 2);
        $this->assertDatabaseHas('inventory_movements', ['book_id' => $book, 'branch_id' => $branch->id, 'user_id' => $user->id, 'type' => 'receipt', 'quantity_change' => 12, 'quantity_after' => 12, 'reference' => 'DN-001', 'notes' => 'Opening stock']);
        $this->getJson('/api/inventory?page=1')->assertOk()->assertJsonPath('data.0.quantity', 15)->assertJsonPath('data.0.title', 'Learning Mathematics');
    }

    public function test_invalid_receipts_cannot_change_stock(): void
    {
        $branch = Branch::factory()->create();
        $book = $this->book();
        $this->actingAs(User::factory()->create(['role' => Roles::SYSTEM_OWNER]), 'sanctum');
        foreach ([0, -1, 1.5, 2147483648] as $quantity) {
            $this->postJson('/api/inventory/receive', ['book_id' => $book, 'branch_id' => $branch->id, 'quantity' => $quantity])
                ->assertUnprocessable()->assertJsonValidationErrors('quantity');
        }
        DB::table('books')->where('id', $book)->update(['is_active' => false]);
        $this->postJson('/api/inventory/receive', ['book_id' => $book, 'branch_id' => $branch->id, 'quantity' => 1])
            ->assertUnprocessable()->assertJsonValidationErrors('book_id');
        DB::table('books')->where('id', $book)->update(['is_active' => true]);
        $branch->update(['is_active' => false]);
        $this->postJson('/api/inventory/receive', ['book_id' => $book, 'branch_id' => $branch->id, 'quantity' => 1])
            ->assertUnprocessable()->assertJsonValidationErrors('branch_id');
        $this->assertDatabaseCount('inventory_balances', 0);
        $this->assertDatabaseCount('inventory_movements', 0);
    }

    public function test_receiving_requires_permission_and_access_to_the_branch(): void
    {
        $branch = Branch::factory()->create();
        $other = Branch::factory()->create();
        $payload = ['book_id' => $this->book(), 'branch_id' => $other->id, 'quantity' => 10, 'supplier_id' => $this->supplier()];
        $this->postJson('/api/inventory/receive', $payload)->assertUnauthorized();
        $this->actingAs(User::factory()->inBranches($branch)->create(['role' => Roles::INVENTORY_OFFICER]), 'sanctum')
            ->postJson('/api/inventory/receive', $payload)->assertForbidden();
        $this->actingAs(User::factory()->inBranches($other)->create(['role' => Roles::CASHIER]), 'sanctum')
            ->postJson('/api/inventory/receive', $payload)->assertForbidden();
        $this->assertDatabaseCount('inventory_movements', 0);
    }

    public function test_stock_filters_and_totals_respect_branch_access_and_reserved_units(): void
    {
        $branch = Branch::factory()->create();
        $other = Branch::factory()->create();
        $book = $this->book();
        $second = $this->book(['title' => 'English', 'sku' => 'ENG-1']);
        foreach ([[$book, $branch->id, 10, 6], [$second, $branch->id, 0, 0], [$book, $other->id, 200, 0]] as [$id, $branchId, $quantity, $reserved]) {
            DB::table('inventory_balances')->insert(['bookshop_id' => $this->tenantId(), 'book_id' => $id, 'branch_id' => $branchId, 'quantity' => $quantity, 'reserved' => $reserved, 'created_at' => now(), 'updated_at' => now()]);
        }
        $this->actingAs(User::factory()->inBranches($branch)->create(['role' => Roles::INVENTORY_OFFICER]), 'sanctum');
        $response = $this->getJson('/api/inventory')->assertOk()->assertJsonCount(2, 'data');
        $this->assertEquals(10, $response->json('summary.units'));
        $this->assertEquals(5000, $response->json('summary.value'));
        $this->assertEquals(1, $response->json('summary.low'));
        $this->assertEquals(1, $response->json('summary.out_of_stock'));
        $this->getJson('/api/inventory?status=low')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.book_id', $book);
        $this->getJson('/api/inventory?status=out')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.book_id', $second);
        $this->getJson('/api/inventory?search=MATH-1')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/inventory?branch_id='.$other->id)->assertOk()->assertJsonCount(0, 'data');
    }
}
