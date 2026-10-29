<?php

namespace Tests\Feature;

use App\Models\Bookshop;
use App\Models\Branch;
use App\Models\User;
use App\Services\RestoreOriginalBookshop;
use App\Support\Roles;
use App\Support\Tenancy\Tenant;
use Database\Seeders\BusinessFoundationSeeder;
use Database\Seeders\SystemOwnerSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class BookshopManagementTest extends TestCase
{
    use RefreshDatabase;

    private function original(): User
    {
        $owner = User::factory()->create(['role' => Roles::PLATFORM_OWNER]);
        config(['platform.legacy_owner_email' => $owner->email]);

        return $owner;
    }

    private function grant(User $owner): Bookshop
    {
        app(RestoreOriginalBookshop::class)->run(null, true, true);

        return Bookshop::findOrFail(DB::table('platform_bookshop_management')->where('user_id', $owner->id)->value('bookshop_id'));
    }

    private function login(User $owner): void
    {
        $this->withHeader('Origin', 'http://localhost:5173');
        $this->postJson('/api/v1/auth/login', ['email' => $owner->email, 'password' => 'password'])->assertOk();
    }

    public function test_explicit_entry_refresh_inventory_pos_and_return_to_platform(): void
    {
        $owner = $this->original();
        $shop = $this->grant($owner);
        $branch = $shop->branches()->first();
        $book = DB::table('books')->insertGetId(['bookshop_id' => $shop->id, 'sku' => 'ORIG-1', 'title' => 'Original book', 'selling_price' => 100]);
        $supplier = DB::table('suppliers')->insertGetId(['bookshop_id' => $shop->id, 'name' => 'Original supplier']);
        $other = Bookshop::factory()->create();
        $otherBranch = Branch::factory()->create(['bookshop_id' => $other->id]);
        $foreignBook = DB::table('books')->insertGetId(['bookshop_id' => $other->id, 'sku' => 'PRIVATE', 'title' => 'Private book', 'selling_price' => 5]);
        $this->login($owner);
        $this->getJson('/api/v1/books')->assertForbidden();
        $this->getJson('/api/v1/platform/managed-bookshops')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $shop->id);
        $this->postJson("/api/v1/platform/management/{$other->id}/enter")->assertForbidden();
        $this->postJson("/api/v1/platform/management/{$shop->id}/enter")->assertOk()->assertJsonPath('data.next', '/dashboard');
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.role', 'platform_owner')
            ->assertJsonPath('data.management_context.bookshop_id', $shop->id)->assertJsonPath('data.bookshop.is_owner', true);
        $this->getJson('/api/v1/dashboard')->assertOk();
        $this->getJson("/api/v1/books?bookshop_id={$other->id}")->assertOk()->assertJsonFragment(['title' => 'Original book'])->assertJsonMissing(['title' => 'Private book']);
        $this->postJson('/api/v1/inventory/receive', ['book_id' => $book, 'branch_id' => $branch->id, 'supplier_id' => $supplier, 'quantity' => 5])->assertSuccessful();
        $this->getJson('/api/v1/inventory')->assertOk()->assertJsonFragment(['title' => 'Original book']);
        $this->patchJson("/api/v1/branches/{$branch->id}", ['name' => 'Managed main shop'])->assertOk();
        $this->patchJson("/api/v1/branches/{$otherBranch->id}", ['name' => 'Stolen'])->assertNotFound();
        $sale = ['idempotency_key' => 'managed-sale-1', 'branch_id' => $branch->id, 'items' => [['book_id' => $book, 'quantity' => 1]], 'payment_method' => 'cash', 'amount_received' => 100];
        $this->postJson('/api/v1/pos/checkout', $sale)->assertCreated();
        $this->postJson('/api/v1/pos/checkout', $sale)->assertOk();
        $this->assertDatabaseHas('inventory_balances', ['book_id' => $book, 'quantity' => 4, 'bookshop_id' => $shop->id]);
        $this->assertDatabaseCount('pos_sales', 1);
        $this->getJson('/api/v1/pos/sales')->assertOk();
        $this->postJson('/api/v1/inventory/receive', ['book_id' => $foreignBook, 'branch_id' => $branch->id, 'supplier_id' => $supplier, 'quantity' => 1])->assertUnprocessable();
        $this->getJson("/api/v1/pos/products?branch_id={$otherBranch->id}")->assertUnprocessable();
        $this->postJson('/api/v1/users', ['name' => 'Original staff', 'email' => 'staff@original.test', 'password' => 'Strong-pass1!', 'password_confirmation' => 'Strong-pass1!', 'role' => Roles::CASHIER, 'branch_ids' => [$branch->id]])->assertCreated();
        $this->assertDatabaseHas('users', ['email' => 'staff@original.test', 'bookshop_id' => $shop->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'platform.management_entered', 'user_id' => $owner->id, 'bookshop_id' => $shop->id]);
        $this->assertSame($shop->id, DB::table('audit_logs')->where('action', 'user.created')->first() ? json_decode(DB::table('audit_logs')->where('action', 'user.created')->value('metadata'), true)['platform_management']['bookshop_id'] : null);
        $this->assertNull(Tenant::id());
        $this->postJson('/api/v1/platform/management/leave')->assertOk();
        $this->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.management_context', null)->assertJsonPath('data.bookshop', null);
        $this->getJson('/api/v1/books')->assertForbidden();
        $this->assertNull($owner->fresh()->bookshop_id);
        $this->assertSame(Roles::PLATFORM_OWNER, $owner->fresh()->role);
        $this->postJson('/api/v1/auth/login', ['email' => $owner->email, 'password' => 'password'])->assertOk()->assertJsonPath('data.user.management_context', null);
    }

    public function test_revocation_suspension_role_changes_and_forged_context_fail_closed(): void
    {
        $owner = $this->original();
        $shop = $this->grant($owner);
        $this->login($owner);
        $this->postJson("/api/v1/platform/management/{$shop->id}/enter")->assertOk();
        DB::table('platform_bookshop_management')->update(['revoked_at' => now()]);
        $this->getJson('/api/v1/books')->assertForbidden();
        $this->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.management_context', null);
        DB::table('platform_bookshop_management')->update(['revoked_at' => null]);
        $shop->forceFill(['status' => Bookshop::STATUS_SUSPENDED])->save();
        $this->postJson("/api/v1/platform/management/{$shop->id}/enter")->assertForbidden();
        $shop->forceFill(['status' => Bookshop::STATUS_ACTIVE])->save();
        $this->postJson("/api/v1/platform/management/{$shop->id}/enter")->assertOk();
        $shop->forceFill(['status' => Bookshop::STATUS_SUSPENDED])->save();
        $this->getJson('/api/v1/books')->assertForbidden();
        $shop->forceFill(['status' => Bookshop::STATUS_ACTIVE])->save();
        $owner->forceFill(['role' => Roles::PLATFORM_ADMIN])->save();
        $this->app['auth']->forgetGuards();
        $this->postJson("/api/v1/platform/management/{$shop->id}/enter")->assertForbidden();
        $this->withSession(['platform_management_bookshop' => $shop->id])->getJson('/api/v1/books')->assertForbidden();
        $this->getJson('/api/v1/platform/managed-bookshops')->assertForbidden();
    }

    public function test_tenant_owner_cannot_switch_and_bearer_token_cannot_enter_management(): void
    {
        $platform = $this->original();
        $shop = $this->grant($platform);
        $tenant = User::factory()->create(['role' => Roles::BOOKSHOP_OWNER]);
        $this->actingAs($tenant, 'sanctum')->withSession(['platform_management_bookshop' => $shop->id]);
        $this->getJson('/api/v1/platform/managed-bookshops')->assertForbidden();
        $this->postJson("/api/v1/platform/management/{$shop->id}/enter")->assertForbidden();
        $this->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.bookshop_id', $tenant->bookshop_id)->assertJsonPath('data.management_context', null);
        $this->app['auth']->forgetGuards();
        $this->withToken($platform->createToken('test')->plainTextToken)->postJson("/api/platform/management/{$shop->id}/enter")->assertForbidden();
    }

    #[DataProvider('platformRoles')]
    public function test_platform_admins_create_shops_without_tenant_access_or_session_switch(string $role): void
    {
        $admin = User::factory()->create(['role' => $role]);
        $this->login($admin);
        $payload = ['owner_name' => 'New Owner', 'email' => 'new@shop.test', 'phone' => '+254712345678', 'password' => 'Strong-pass1!', 'password_confirmation' => 'Strong-pass1!', 'bookshop_name' => 'New Books', 'business_phone' => '+254712345678', 'business_location' => 'Nairobi', 'country' => 'Kenya', 'currency' => 'KES', 'terms' => true];
        $id = $this->postJson('/api/v1/platform/bookshops', $payload)->assertCreated()->json('data.id');
        $this->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.id', $admin->id)->assertJsonPath('data.account_type', 'platform');
        $this->assertDatabaseHas('users', ['email' => 'new@shop.test', 'role' => Roles::BOOKSHOP_OWNER, 'bookshop_id' => $id]);
        $this->assertDatabaseCount('platform_bookshop_management', 0);
        $this->getJson("/api/v1/books?bookshop_id={$id}")->assertForbidden();
        $this->postJson("/api/v1/platform/management/{$id}/enter")->assertForbidden();
        $this->postJson('/api/v1/platform/bookshops', [...$payload, 'email' => 'attack@shop.test', 'role' => Roles::PLATFORM_OWNER])->assertUnprocessable();
    }

    public static function platformRoles(): array
    {
        return [[Roles::PLATFORM_OWNER], [Roles::PLATFORM_ADMIN]];
    }

    public function test_legacy_adoption_preserves_ids_credentials_stock_sales_and_is_idempotent(): void
    {
        $owner = User::factory()->create(['role' => Roles::SYSTEM_OWNER, 'bookshop_id' => null]);
        config(['platform.legacy_owner_email' => $owner->email]);
        $credentials = $owner->fresh()->only(['id', 'email', 'password', 'email_verified_at', 'remember_token']);
        $this->seed(BusinessFoundationSeeder::class);
        $branchId = DB::table('branches')->value('id');
        $book = DB::table('books')->insertGetId(['sku' => 'LEGACY', 'title' => 'Legacy book', 'selling_price' => 100, 'created_at' => now()->subYear()]);
        DB::table('inventory_balances')->insert(['book_id' => $book, 'branch_id' => $branchId, 'quantity' => 7]);
        $sale = DB::table('pos_sales')->insertGetId(['idempotency_key' => 'old-sale', 'branch_id' => $branchId, 'cashier_id' => $owner->id, 'subtotal' => 100, 'total' => 100, 'payment_method' => 'cash', 'amount_received' => 100, 'created_at' => now()->subYear()]);
        DB::table('pos_sale_items')->insert(['sale_id' => $sale, 'book_id' => $book, 'title' => 'Legacy book', 'sku' => 'LEGACY', 'quantity' => 1, 'unit_price' => 100, 'line_total' => 100]);
        $snapshot = [];
        foreach (['branches', 'business_profiles', 'tax_rates', 'books', 'inventory_balances', 'pos_sales', 'pos_sale_items'] as $table) {
            $snapshot[$table] = DB::table($table)->orderBy('id')->get()->map(fn ($row) => (array) $row)->all();
        }
        $this->artisan('platform:restore-original-bookshop')->assertSuccessful();
        $this->assertDatabaseCount('bookshops', 0);
        $this->artisan('platform:restore-original-bookshop', ['--apply' => true])->assertFailed();
        $this->artisan('platform:restore-original-bookshop', ['--apply' => true, '--confirm-legacy-ownership' => true])->assertSuccessful();
        $this->artisan('platform:restore-original-bookshop', ['--apply' => true])->assertSuccessful();
        $shop = Bookshop::sole();
        foreach ($snapshot as $table => $rows) {
            $this->assertSame(array_map(fn ($row) => array_key_exists('bookshop_id', $row) ? [...$row, 'bookshop_id' => $shop->id] : $row, $rows), DB::table($table)->orderBy('id')->get()->map(fn ($row) => (array) $row)->all());
        }
        $this->assertEquals($credentials, $owner->fresh()->only(array_keys($credentials)));
        $this->assertDatabaseCount('platform_bookshop_management', 1);
        $this->assertDatabaseHas('pos_sales', ['id' => $sale, 'cashier_id' => $owner->id]);
        $this->assertSame(1, DB::table('audit_logs')->where('action', 'platform.original_bookshop_restored')->count());
        $this->seed(SystemOwnerSeeder::class);
        $this->assertDatabaseCount('platform_bookshop_management', 1);
        $this->login($owner->fresh());
        $this->postJson("/api/v1/platform/management/{$shop->id}/enter")->assertOk();
        $this->getJson("/api/v1/pos/sales/{$sale}")->assertOk()->assertJsonPath('items.0.title', 'Legacy book');
    }

    public function test_ambiguous_profiles_and_cross_tenant_legacy_links_leave_all_data_unchanged(): void
    {
        $owner = $this->original();
        $profile = ['name' => 'Hekima Bookshop'];
        DB::table('business_profiles')->insert([$profile, ['name' => 'Another business']]);
        $this->artisan('platform:restore-original-bookshop', ['--apply' => true, '--confirm-legacy-ownership' => true])->assertFailed();
        $this->assertDatabaseCount('bookshops', 0);
        DB::table('business_profiles')->where('name', 'Another business')->delete();
        $foreignShop = Bookshop::factory()->create();
        $branch = Branch::factory()->create(['bookshop_id' => $foreignShop->id]);
        $book = DB::table('books')->insertGetId(['sku' => 'UNCERTAIN', 'title' => 'Unassigned stock', 'selling_price' => 10]);
        DB::table('inventory_balances')->insert(['book_id' => $book, 'branch_id' => $branch->id, 'quantity' => 5]);
        $this->artisan('platform:restore-original-bookshop', ['--apply' => true, '--confirm-legacy-ownership' => true])->assertFailed();
        $this->assertDatabaseHas('books', ['id' => $book, 'bookshop_id' => null]);
        $this->assertDatabaseCount('platform_bookshop_management', 0);
        $this->assertNull($owner->fresh()->bookshop_id);
    }

    public function test_existing_owned_bookshop_can_be_authorized_but_unrelated_or_ambiguous_data_cannot(): void
    {
        $owner = $this->original();
        $foreign = Bookshop::factory()->create();
        $this->artisan('platform:restore-original-bookshop', ['--bookshop' => $foreign->id, '--apply' => true])->assertFailed();
        $shop = Bookshop::factory()->create(['owner_user_id' => $owner->id]);
        $this->artisan('platform:restore-original-bookshop', ['--bookshop' => $shop->id, '--apply' => true])->assertSuccessful();
        $this->assertDatabaseHas('platform_bookshop_management', ['bookshop_id' => $shop->id, 'user_id' => $owner->id]);
        DB::table('platform_bookshop_management')->update(['revoked_at' => now()]);
        $this->artisan('platform:restore-original-bookshop', ['--apply' => true])->assertFailed();
    }

    public function test_existing_original_requires_explicit_target_to_adopt_legacy_rows(): void
    {
        $owner = $this->original();
        $shop = Bookshop::factory()->create(['owner_user_id' => $owner->id]);
        $book = DB::table('books')->insertGetId(['sku' => 'UNASSIGNED', 'title' => 'Original legacy book', 'selling_price' => 10]);
        $this->artisan('platform:restore-original-bookshop', ['--apply' => true, '--confirm-legacy-ownership' => true])->assertFailed();
        $this->artisan('platform:restore-original-bookshop', ['--bookshop' => $shop->id])->assertSuccessful();
        $this->assertDatabaseHas('books', ['id' => $book, 'bookshop_id' => null]);
        $this->artisan('platform:restore-original-bookshop', ['--bookshop' => $shop->id, '--apply' => true, '--confirm-legacy-ownership' => true])->assertSuccessful();
        $this->assertDatabaseHas('books', ['id' => $book, 'bookshop_id' => $shop->id]);
    }

    public function test_duplicate_legacy_codes_are_refused_even_when_the_database_allows_null_tenant_uniques(): void
    {
        $this->original();
        DB::table('books')->insert([
            ['sku' => 'DUPLICATE', 'title' => 'First', 'selling_price' => 10],
            ['sku' => 'DUPLICATE', 'title' => 'Second', 'selling_price' => 10],
        ]);
        $this->artisan('platform:restore-original-bookshop', ['--apply' => true, '--confirm-legacy-ownership' => true])->assertFailed();
        $this->assertDatabaseCount('bookshops', 0);
        $this->assertDatabaseCount('books', 2);
    }
}
