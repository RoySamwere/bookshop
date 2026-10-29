<?php

namespace Tests\Feature;

use App\Models\Bookshop;
use App\Models\User;
use App\Support\Roles;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** The single-shop installation's records (bookshop_id NULL) move into one named bookshop, never by guesswork. */
class LegacyAdoptionTest extends TestCase
{
    use RefreshDatabase;

    private User $systemOwner;
    private User $cashier;
    private User $customer;
    private int $branch;
    private int $book;

    protected function setUp(): void
    {
        parent::setUp();
        $legacy = ['bookshop_id' => null];
        DB::table('business_profiles')->insert(['name' => 'Hekima Bookshop', 'country' => 'Kenya', 'currency' => 'KES', 'created_at' => now(), 'updated_at' => now()]);
        $this->branch = DB::table('branches')->insertGetId(['name' => 'Main Shop', 'code' => 'MAIN', 'is_main' => true, 'is_active' => true, 'created_at' => now(), 'updated_at' => now()]);
        $this->systemOwner = User::factory()->create(['role' => Roles::SYSTEM_OWNER, 'email' => 'roy@bookshop.test', ...$legacy]);
        $this->cashier = User::factory()->create(['role' => Roles::CASHIER, ...$legacy]);
        $this->customer = User::factory()->create(['role' => Roles::CUSTOMER, ...$legacy]);
        DB::table('branch_user')->insert([['branch_id' => $this->branch, 'user_id' => $this->systemOwner->id], ['branch_id' => $this->branch, 'user_id' => $this->cashier->id]]);
        $this->book = DB::table('books')->insertGetId(['title' => 'Atlas', 'sku' => 'A-1', 'selling_price' => 100, 'created_at' => now(), 'updated_at' => now()]);
        DB::table('inventory_balances')->insert(['book_id' => $this->book, 'branch_id' => $this->branch, 'quantity' => 4, 'reserved' => 0]);
        DB::table('pos_sales')->insert(['idempotency_key' => 'legacy-1', 'branch_id' => $this->branch, 'cashier_id' => $this->cashier->id, 'subtotal' => 100, 'total' => 100, 'payment_method' => 'cash', 'amount_received' => 100]);
        DB::table('audit_logs')->insert(['user_id' => $this->cashier->id, 'action' => 'auth.login', 'description' => 'Legacy sign-in', 'created_at' => now()]);
    }

    public function test_legacy_staff_cannot_use_the_workspace_until_their_records_are_adopted(): void
    {
        $this->actingAs($this->systemOwner, 'sanctum')->getJson('/api/books')->assertForbidden()->assertJsonPath('code', 'no_bookshop');
    }

    public function test_the_dry_run_changes_nothing_and_ambiguity_is_refused(): void
    {
        $this->artisan('tenancy:adopt-legacy', ['--owner' => $this->systemOwner->email])->assertSuccessful();
        $this->assertSame(0, Bookshop::count());
        $this->assertNull($this->systemOwner->fresh()->bookshop_id);

        $this->artisan('tenancy:adopt-legacy', ['--apply' => true])->assertFailed();
        $this->artisan('tenancy:adopt-legacy', ['--owner' => $this->cashier->email, '--apply' => true])->assertFailed();
        DB::table('business_profiles')->insert(['name' => 'Another business', 'created_at' => now(), 'updated_at' => now()]);
        $this->artisan('tenancy:adopt-legacy', ['--owner' => $this->systemOwner->email, '--apply' => true])->assertFailed();
        $this->assertSame(0, Bookshop::count());
    }

    public function test_apply_moves_every_legacy_record_into_one_bookshop_and_keeps_owner_access(): void
    {
        $other = Bookshop::factory()->create();
        $otherBook = DB::table('books')->insertGetId(['bookshop_id' => $other->id, 'title' => 'Other', 'sku' => 'A-1', 'selling_price' => 1]);

        $this->artisan('tenancy:adopt-legacy', ['--owner' => $this->systemOwner->email, '--apply' => true])->assertSuccessful();

        $bookshop = Bookshop::where('owner_user_id', $this->systemOwner->id)->firstOrFail();
        $this->assertSame('Hekima Bookshop', $bookshop->name);
        $this->assertSame(Bookshop::STATUS_ACTIVE, $bookshop->status);
        $this->assertSame('active', $bookshop->subscription->status);
        foreach (['business_profiles', 'branches', 'books', 'inventory_balances', 'pos_sales'] as $table) {
            $this->assertSame(0, DB::table($table)->whereNull('bookshop_id')->count(), $table);
        }
        $this->assertSame($bookshop->id, $this->systemOwner->fresh()->bookshop_id);
        $this->assertSame($bookshop->id, $this->cashier->fresh()->bookshop_id);
        $this->assertNull($this->customer->fresh()->bookshop_id, 'plain customers stay platform-level');
        $this->assertSame($bookshop->id, (int) DB::table('audit_logs')->where('description', 'Legacy sign-in')->value('bookshop_id'));
        $this->assertSame($other->id, (int) DB::table('books')->where('id', $otherBook)->value('bookshop_id'));

        // The System Owner keeps full access to their (now isolated) business.
        $this->assertSame(Roles::SYSTEM_OWNER, $this->systemOwner->fresh()->role);
        $this->actingAs($this->systemOwner->fresh(), 'sanctum')->getJson('/api/books')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.title', 'Atlas');
        $this->getJson('/api/pos/sales')->assertOk()->assertJsonPath('total', 1);

        $this->artisan('tenancy:adopt-legacy', ['--owner' => $this->systemOwner->email, '--apply' => true])->assertSuccessful();
        $this->assertSame(2, Bookshop::count(), 'a second run finds nothing left to adopt');
    }
}
