<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Bookshop;
use App\Models\Branch;
use App\Models\PlanFeature;
use App\Models\User;
use App\Notifications\StaffInvitation;
use App\Services\SubscriptionService;
use App\Support\Roles;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/**
 * Two independent bookshops with the same kinds of records. Every test signs in to bookshop A and
 * substitutes bookshop B's ids into otherwise valid requests.
 */
class TenantIsolationTest extends TestCase
{
    use RefreshDatabase;

    /** @var array<string, mixed> */
    private array $a;
    /** @var array<string, mixed> */
    private array $b;

    protected function setUp(): void
    {
        parent::setUp();
        $this->a = $this->tenant('Alpha Books', 'ALPHA');
        $this->b = $this->tenant('Beta Books', 'BETA');
    }

    /** A complete bookshop: owner, cashier, branch, product with stock, supplier, sale and purchase order. */
    private function tenant(string $name, string $prefix): array
    {
        $bookshop = Bookshop::factory()->create(['name' => $name]);
        $branch = Branch::factory()->main()->create(['bookshop_id' => $bookshop->id, 'code' => 'MAIN', 'name' => "{$name} Main"]);
        $owner = User::factory()->forBookshop($bookshop)->inBranches($branch)->create(['role' => Roles::BOOKSHOP_OWNER]);
        $cashier = User::factory()->forBookshop($bookshop)->inBranches($branch)->create(['role' => Roles::CASHIER]);
        // The same SKU in both bookshops: codes are unique per bookshop, not globally.
        $book = DB::table('books')->insertGetId(['bookshop_id' => $bookshop->id, 'title' => "{$prefix} Atlas", 'sku' => 'ATLAS-1', 'selling_price' => 500, 'reorder_level' => 2, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('inventory_balances')->insert(['bookshop_id' => $bookshop->id, 'book_id' => $book, 'branch_id' => $branch->id, 'quantity' => 10, 'reserved' => 0, 'created_at' => now(), 'updated_at' => now()]);
        $supplier = DB::table('suppliers')->insertGetId(['bookshop_id' => $bookshop->id, 'name' => "{$prefix} Supplies", 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        $sale = DB::table('pos_sales')->insertGetId(['bookshop_id' => $bookshop->id, 'idempotency_key' => 'shared-key', 'receipt_number' => "{$prefix}-0001", 'branch_id' => $branch->id, 'cashier_id' => $cashier->id, 'subtotal' => 500, 'total' => 500, 'payment_method' => 'cash', 'amount_received' => 500, 'status' => 'completed', 'created_at' => now(), 'updated_at' => now()]);
        DB::table('pos_sale_items')->insert(['sale_id' => $sale, 'book_id' => $book, 'title' => "{$prefix} Atlas", 'sku' => 'ATLAS-1', 'quantity' => 1, 'unit_price' => 500, 'line_total' => 500, 'created_at' => now(), 'updated_at' => now()]);
        $order = DB::table('purchase_orders')->insertGetId(['bookshop_id' => $bookshop->id, 'supplier_id' => $supplier, 'branch_id' => $branch->id, 'status' => 'approved', 'created_at' => now(), 'updated_at' => now()]);
        $orderItem = DB::table('purchase_order_items')->insertGetId(['purchase_order_id' => $order, 'book_id' => $book, 'quantity' => 5, 'received_quantity' => 0, 'unit_cost' => 300, 'created_at' => now(), 'updated_at' => now()]);
        $unit = DB::table('product_units')->insertGetId(['bookshop_id' => $bookshop->id, 'book_id' => $book, 'name' => 'Carton', 'pieces_per_unit' => 10, 'created_at' => now(), 'updated_at' => now()]);

        return compact('bookshop', 'branch', 'owner', 'cashier', 'book', 'supplier', 'sale', 'order', 'orderItem', 'unit');
    }

    private function stockOf(array $tenant): int
    {
        return (int) DB::table('inventory_balances')->where('book_id', $tenant['book'])->where('branch_id', $tenant['branch']->id)->value('quantity');
    }

    public function test_bookshop_a_cannot_read_bookshop_b_products(): void
    {
        $this->actingAs($this->a['owner'], 'sanctum');

        $this->getJson('/api/books')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.title', 'ALPHA Atlas');
        $this->getJson('/api/books?search=BETA')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson("/api/pos/products?branch_id={$this->a['branch']->id}")->assertOk()->assertJsonCount(1, 'data');
        $this->getJson("/api/books/{$this->b['book']}/units")->assertNotFound();
        $this->patchJson("/api/books/{$this->b['book']}", ['title' => 'Hijacked'])->assertNotFound();
        $this->postJson("/api/books/{$this->b['book']}/units", ['name' => 'Box', 'pieces_per_unit' => 5])->assertNotFound();
        $this->deleteJson("/api/books/{$this->b['book']}/units/{$this->b['unit']}")->assertNotFound();
        $this->postJson('/api/books-import', ['rows' => [['id' => $this->b['book'], 'title' => 'Hijacked', 'sku' => 'X', 'cost_price' => 1, 'selling_price' => 1, 'reorder_level' => 0, 'is_active' => true]]])
            ->assertUnprocessable()->assertJsonValidationErrors('rows.0.id');
        $this->getJson('/api/suppliers')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.name', 'ALPHA Supplies');

        $csv = $this->get('/api/books-export')->assertOk()->streamedContent();
        $this->assertStringContainsString('ALPHA Atlas', $csv);
        $this->assertStringNotContainsString('BETA Atlas', $csv);
        $this->assertSame('BETA Atlas', DB::table('books')->where('id', $this->b['book'])->value('title'));
    }

    public function test_bookshop_a_cannot_modify_bookshop_b_stock(): void
    {
        $this->actingAs($this->a['owner'], 'sanctum');
        $a = $this->a;
        $b = $this->b;

        // B's product into A's branch, A's product into B's branch, B's supplier and packaging.
        $this->postJson('/api/inventory/receive', ['book_id' => $b['book'], 'branch_id' => $a['branch']->id, 'quantity' => 5, 'supplier_id' => $a['supplier']])->assertUnprocessable()->assertJsonValidationErrors('book_id');
        $this->postJson('/api/inventory/receive', ['book_id' => $a['book'], 'branch_id' => $b['branch']->id, 'quantity' => 5, 'supplier_id' => $a['supplier']])->assertUnprocessable()->assertJsonValidationErrors('branch_id');
        $this->postJson('/api/inventory/receive', ['book_id' => $a['book'], 'branch_id' => $a['branch']->id, 'quantity' => 5, 'supplier_id' => $b['supplier']])->assertUnprocessable()->assertJsonValidationErrors('supplier_id');
        $this->postJson('/api/inventory/receive', ['book_id' => $a['book'], 'branch_id' => $a['branch']->id, 'quantity' => 1, 'supplier_id' => $a['supplier'], 'product_unit_id' => $b['unit']])->assertUnprocessable()->assertJsonValidationErrors('product_unit_id');
        $this->postJson('/api/inventory/adjust', ['book_id' => $b['book'], 'branch_id' => $b['branch']->id, 'quantity_change' => -10, 'notes' => 'wipe'])->assertUnprocessable();
        $this->postJson('/api/inventory/transfer', ['book_id' => $b['book'], 'from_branch_id' => $b['branch']->id, 'to_branch_id' => $a['branch']->id, 'quantity' => 5])->assertUnprocessable();
        $this->postJson('/api/inventory/bulk-receive', ['branch_id' => $b['branch']->id, 'supplier_id' => $b['supplier'], 'rows' => [['title' => 'X', 'sku' => 'ATLAS-1', 'product_subcategory_id' => 1, 'cost_price' => 1, 'selling_price' => 1, 'quantity' => 5]]])->assertUnprocessable();
        $this->postJson('/api/pos/checkout', ['idempotency_key' => 'k1', 'branch_id' => $a['branch']->id, 'items' => [['book_id' => $b['book'], 'quantity' => 1]], 'payment_method' => 'cash', 'amount_received' => 500])
            ->assertUnprocessable()->assertJsonValidationErrors('items.0.book_id');
        $this->postJson("/api/purchase-orders/{$b['order']}/receive", ['reference' => 'GRN-1', 'items' => [['purchase_order_item_id' => $b['orderItem'], 'quantity' => 5]]])->assertNotFound();
        $this->postJson("/api/purchase-orders/{$b['order']}/approve")->assertNotFound();

        $this->assertSame(10, $this->stockOf($b));
        $this->assertSame(10, $this->stockOf($a));
        $this->assertSame(0, DB::table('inventory_movements')->count());

        // The same request with A's own ids still works, and the movement is stamped with A.
        $this->postJson('/api/inventory/receive', ['book_id' => $a['book'], 'branch_id' => $a['branch']->id, 'quantity' => 5, 'supplier_id' => $a['supplier']])->assertCreated()->assertJsonPath('quantity', 15);
        $this->assertDatabaseHas('inventory_movements', ['book_id' => $a['book'], 'bookshop_id' => $a['bookshop']->id]);
    }

    public function test_the_inventory_service_rejects_mixed_bookshop_ids_even_without_controller_checks(): void
    {
        $this->actingAs($this->a['owner'], 'sanctum');

        $this->expectException(\Illuminate\Validation\ValidationException::class);
        app(\App\Services\InventoryService::class)->change($this->b['book'], $this->a['branch']->id, 1, 'receipt');
    }

    public function test_bookshop_a_cannot_access_bookshop_b_sales_or_reports(): void
    {
        $this->actingAs($this->a['owner'], 'sanctum');

        $this->getJson('/api/pos/sales')->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.receipt_number', 'ALPHA-0001');
        $this->getJson("/api/pos/sales/{$this->b['sale']}")->assertNotFound();
        $this->getJson("/api/pos/sales?branch_id={$this->b['branch']->id}")->assertUnprocessable();
        $this->getJson('/api/dashboard')->assertOk()->assertJsonPath('data.summary.transactions', 1)->assertJsonCount(1, 'data.branches');
        $this->getJson("/api/dashboard?branch_id={$this->b['branch']->id}")->assertUnprocessable();
        $this->getJson('/api/inventory')->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.title', 'ALPHA Atlas');
        $this->getJson('/api/inventory/movements')->assertOk()->assertJsonCount(0, 'data');
        $this->getJson('/api/purchase-orders')->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.id', $this->a['order']);
        $this->getJson("/api/purchase-orders/{$this->b['order']}")->assertNotFound();

        // Idempotency keys are per bookshop: B's identical key neither replays B's receipt nor blocks A.
        $this->actingAs($this->a['cashier'], 'sanctum')->postJson('/api/pos/checkout', ['idempotency_key' => 'shared-key', 'branch_id' => $this->a['branch']->id, 'items' => [['book_id' => $this->a['book'], 'quantity' => 1]], 'payment_method' => 'cash', 'amount_received' => 500])
            ->assertOk()->assertJsonPath('sale.id', $this->a['sale']);
    }

    public function test_settings_branches_and_audit_logs_are_per_bookshop(): void
    {
        AuditLog::create(['bookshop_id' => $this->b['bookshop']->id, 'action' => 'secret.b', 'description' => 'Beta internal note']);
        $this->actingAs($this->a['owner'], 'sanctum');

        $this->getJson('/api/branches')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $this->a['branch']->id);
        $this->patchJson("/api/branches/{$this->b['branch']->id}", ['name' => 'Hijacked'])->assertNotFound();
        // Branch codes only need to be unique inside one bookshop.
        $this->postJson('/api/branches', ['name' => 'Second', 'code' => 'MAIN'])->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->postJson('/api/branches', ['name' => 'Second', 'code' => 'BETA-ONLY'])->assertCreated()->assertJsonPath('data.is_main', false);
        $this->putJson('/api/business', ['name' => 'Alpha Renamed'])->assertOk();
        $this->getJson('/api/audit-logs')->assertOk()->assertJsonMissing(['description' => 'Beta internal note']);
        $this->getJson('/api/bookshop/activity')->assertOk()->assertJsonMissing(['description' => 'Beta internal note']);

        $this->actingAs($this->b['owner'], 'sanctum');
        $this->getJson('/api/business')->assertOk()->assertJsonPath('data.name', 'Beta Books');
        $this->getJson('/api/bookshop')->assertOk()->assertJsonPath('data.name', 'Beta Books')->assertJsonPath('data.counts.branches', 1);
        $this->assertSame('Beta Books Main', Branch::find($this->b['branch']->id)->name);
    }

    public function test_bookshop_a_cannot_assign_bookshop_b_branches_or_manage_its_staff(): void
    {
        Notification::fake();
        $this->actingAs($this->a['owner'], 'sanctum');
        $b = $this->b;
        $staff = ['name' => 'New Cashier', 'email' => 'new@example.test', 'password' => 'Strong-pass1', 'password_confirmation' => 'Strong-pass1', 'role' => Roles::CASHIER];

        $this->postJson('/api/users', [...$staff, 'branch_ids' => [$b['branch']->id]])->assertUnprocessable()->assertJsonValidationErrors('branch_ids.0');
        $this->postJson('/api/staff-invitations', ['name' => 'Invitee', 'email' => 'invitee@example.test', 'role' => Roles::CASHIER, 'branch_ids' => [$b['branch']->id]])
            ->assertUnprocessable()->assertJsonValidationErrors('branch_ids.0');
        $this->patchJson("/api/users/{$this->a['cashier']->id}", ['branch_ids' => [$b['branch']->id]])->assertUnprocessable();
        $this->getJson('/api/users')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $this->a['cashier']->id);
        $this->getJson("/api/users/{$b['cashier']->id}")->assertNotFound();
        $this->patchJson("/api/users/{$b['cashier']->id}", ['name' => 'Hijacked'])->assertForbidden();
        $this->patchJson("/api/users/{$b['cashier']->id}/status", ['is_active' => false])->assertForbidden();
        $this->deleteJson("/api/users/{$b['cashier']->id}")->assertForbidden();
        $this->postJson("/api/staff-invitations/{$b['cashier']->id}/resend")->assertNotFound();

        $this->assertSame([$b['branch']->id], $b['cashier']->fresh()->branchIds());
        $this->assertTrue($b['cashier']->fresh()->is_active);

        // A created account always joins the creator's bookshop, whatever the payload says.
        $id = $this->postJson('/api/users', [...$staff, 'branch_ids' => [$this->a['branch']->id], 'bookshop_id' => $b['bookshop']->id])->assertCreated()->json('data.id');
        $this->assertSame($this->a['bookshop']->id, User::find($id)->bookshop_id);
    }

    public function test_a_cashier_cannot_grant_themselves_owner_permissions(): void
    {
        $cashier = $this->a['cashier'];
        $this->actingAs($cashier, 'sanctum');

        $this->patchJson('/api/auth/profile', ['name' => 'Still Cashier', 'role' => Roles::BOOKSHOP_OWNER, 'bookshop_id' => $this->b['bookshop']->id])->assertOk();
        $this->patchJson("/api/users/{$cashier->id}", ['role' => Roles::BOOKSHOP_OWNER])->assertForbidden();
        $this->postJson('/api/users', ['name' => 'X', 'email' => 'x@example.test', 'password' => 'Strong-pass1', 'password_confirmation' => 'Strong-pass1', 'role' => Roles::BOOKSHOP_OWNER])->assertForbidden();
        $this->putJson('/api/business', ['name' => 'Mine now'])->assertForbidden();
        $this->patchJson('/api/bookshop', ['name' => 'Mine now'])->assertForbidden();

        $cashier->refresh();
        $this->assertSame(Roles::CASHIER, $cashier->role);
        $this->assertSame($this->a['bookshop']->id, $cashier->bookshop_id);

        // Even an administrator cannot hand out the owner role.
        $admin = User::factory()->forBookshop($this->a['bookshop'])->inBranches($this->a['branch'])->create(['role' => Roles::ADMIN]);
        $this->actingAs($admin, 'sanctum')->patchJson("/api/users/{$cashier->id}", ['role' => Roles::BOOKSHOP_OWNER])->assertUnprocessable()->assertJsonValidationErrors('role');
        $this->actingAs($this->a['owner'], 'sanctum')->patchJson("/api/users/{$cashier->id}", ['role' => Roles::PLATFORM_OWNER])->assertUnprocessable()->assertJsonValidationErrors('role');
    }

    public function test_invited_employees_join_only_the_inviting_bookshop(): void
    {
        Notification::fake();
        $this->actingAs($this->a['owner'], 'sanctum');

        $this->postJson('/api/staff-invitations', ['name' => 'Invitee', 'email' => 'Invitee@Example.test', 'role' => Roles::BOOKSHOP_OWNER, 'branch_ids' => [$this->a['branch']->id]])
            ->assertUnprocessable()->assertJsonValidationErrors('role');
        $this->postJson('/api/staff-invitations', ['name' => 'Invitee', 'email' => 'Invitee@Example.test', 'role' => Roles::CASHIER, 'branch_ids' => [$this->a['branch']->id]])
            ->assertCreated()->assertJsonPath('data.role', Roles::CASHIER)->assertJsonPath('data.email_verified', false);

        $invitee = User::where('email', 'invitee@example.test')->firstOrFail();
        $this->assertSame($this->a['bookshop']->id, $invitee->bookshop_id);
        $token = null;
        Notification::assertSentTo($invitee, StaffInvitation::class, function (StaffInvitation $notification) use ($invitee, &$token) {
            parse_str(parse_url($notification->toMail($invitee)->actionUrl, PHP_URL_QUERY), $query);
            $token = $query['token'];

            return true;
        });

        // Until the invitation is accepted the account cannot sign in with any password we know.
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/auth/invitations/accept', ['token' => 'wrong', 'email' => $invitee->email, 'password' => 'Strong-pass1', 'password_confirmation' => 'Strong-pass1'])->assertUnprocessable();
        $this->postJson('/api/auth/invitations/accept', ['token' => $token, 'email' => $invitee->email, 'password' => 'Strong-pass1', 'password_confirmation' => 'Strong-pass1'])->assertOk();
        $this->assertTrue($invitee->fresh()->hasVerifiedEmail());
        $this->postJson('/api/auth/invitations/accept', ['token' => $token, 'email' => $invitee->email, 'password' => 'Strong-pass2!', 'password_confirmation' => 'Strong-pass2!'])->assertUnprocessable();

        $login = $this->postJson('/api/auth/login', ['email' => $invitee->email, 'password' => 'Strong-pass1'])->assertOk()->json('data.token');
        $this->withToken($login)->getJson("/api/pos/products?branch_id={$this->a['branch']->id}")->assertOk()->assertJsonPath('data.0.title', 'ALPHA Atlas');
    }

    public function test_plan_limits_are_enforced_through_the_entitlement_service(): void
    {
        $subscription = app(SubscriptionService::class)->startTrial($this->a['bookshop']);
        PlanFeature::where('subscription_plan_id', $subscription->subscription_plan_id)->where('feature', 'branches.max')->update(['limit' => 1]);
        $this->actingAs($this->a['owner'], 'sanctum');

        $this->postJson('/api/branches', ['name' => 'Second', 'code' => 'TWO'])->assertUnprocessable()->assertJsonValidationErrors('name');
        $this->getJson('/api/bookshop')->assertOk()->assertJsonPath('data.entitlements.branches_limit', 1)->assertJsonPath('data.entitlements.can_add_branch', false);
        // Bookshop B is on no limited plan and is unaffected.
        $this->actingAs($this->b['owner'], 'sanctum')->postJson('/api/branches', ['name' => 'Second', 'code' => 'TWO'])->assertCreated();
    }

    public function test_accounts_without_a_bookshop_cannot_open_any_workspace(): void
    {
        $legacy = User::factory()->create(['role' => Roles::ADMIN, 'bookshop_id' => null]);
        $this->actingAs($legacy, 'sanctum')->getJson('/api/books')->assertForbidden()->assertJsonPath('code', 'no_bookshop');
        $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('data.bookshop', null);
    }
}
