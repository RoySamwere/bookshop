<?php

namespace Tests\Feature;

use App\Models\Bookshop;
use App\Models\BookshopSubscription;
use App\Models\Branch;
use App\Models\User;
use App\Services\SubscriptionService;
use App\Support\Roles;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class PlatformAdministrationTest extends TestCase
{
    use RefreshDatabase;

    private User $platformOwner;
    private User $platformAdmin;
    private Bookshop $bookshop;
    private User $owner;
    private Branch $branch;

    protected function setUp(): void
    {
        parent::setUp();
        $this->platformOwner = User::factory()->create(['role' => Roles::PLATFORM_OWNER]);
        $this->platformAdmin = User::factory()->create(['role' => Roles::PLATFORM_ADMIN]);
        $this->bookshop = Bookshop::factory()->create(['name' => 'Gamma Books']);
        app(SubscriptionService::class)->startTrial($this->bookshop);
        $this->branch = Branch::factory()->main()->create(['bookshop_id' => $this->bookshop->id]);
        $this->owner = User::factory()->forBookshop($this->bookshop)->inBranches($this->branch)->create(['role' => Roles::BOOKSHOP_OWNER]);
        $this->bookshop->forceFill(['owner_user_id' => $this->owner->id])->save();
    }

    public function test_bookshop_accounts_cannot_reach_platform_administration(): void
    {
        foreach ([$this->owner, User::factory()->create(['role' => Roles::SYSTEM_OWNER]), User::factory()->create(['role' => Roles::CUSTOMER])] as $user) {
            $this->actingAs($user, 'sanctum');
            $this->getJson('/api/platform/overview')->assertForbidden();
            $this->getJson('/api/platform/bookshops')->assertForbidden();
            $this->postJson("/api/platform/bookshops/{$this->bookshop->id}/suspend", ['reason' => 'x'])->assertForbidden();
            $this->getJson('/api/v1/platform/users')->assertForbidden();
        }
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/platform/overview')->assertUnauthorized();
    }

    public function test_platform_owner_sees_tenant_metadata_but_never_business_records(): void
    {
        DB::table('books')->insert(['bookshop_id' => $this->bookshop->id, 'title' => 'Private catalogue item', 'sku' => 'P-1', 'selling_price' => 9]);
        $this->actingAs($this->platformOwner, 'sanctum');

        $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('data.account_type', 'platform')->assertJsonPath('data.bookshop', null);
        $this->getJson('/api/platform/overview')->assertOk()->assertJsonPath('data.bookshops.active', 1)->assertJsonPath('data.subscriptions.trialing', 1);
        $this->getJson('/api/platform/bookshops?search=gamma')->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.owner.email', $this->owner->email)->assertJsonPath('data.0.branches_count', 1)
            ->assertJsonPath('data.0.subscription.status', 'trialing');
        $this->getJson("/api/platform/bookshops/{$this->bookshop->id}")->assertOk()->assertJsonMissing(['title' => 'Private catalogue item']);

        // Tenant business endpoints stay closed to platform staff.
        $this->getJson('/api/books')->assertForbidden();
        $this->getJson('/api/pos/sales')->assertForbidden();
        $this->getJson('/api/dashboard')->assertForbidden();
        $this->getJson('/api/bookshop')->assertForbidden();
    }

    public function test_suspension_blocks_operations_without_touching_records_and_is_audited(): void
    {
        $book = DB::table('books')->insertGetId(['bookshop_id' => $this->bookshop->id, 'title' => 'Atlas', 'sku' => 'A-1', 'selling_price' => 9]);
        $this->actingAs($this->platformOwner, 'sanctum');

        $this->postJson("/api/platform/bookshops/{$this->bookshop->id}/suspend", [])->assertUnprocessable()->assertJsonValidationErrors('reason');
        $this->postJson("/api/platform/bookshops/{$this->bookshop->id}/suspend", ['reason' => 'Unpaid invoices'])->assertOk()
            ->assertJsonPath('data.status', Bookshop::STATUS_SUSPENDED);
        $this->assertDatabaseHas('audit_logs', ['action' => 'platform.bookshop_suspended', 'bookshop_id' => $this->bookshop->id, 'user_id' => $this->platformOwner->id]);
        $this->assertSame(BookshopSubscription::SUSPENDED, $this->bookshop->subscription()->first()->status);

        $this->actingAs($this->owner, 'sanctum');
        $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('data.bookshop.status', 'suspended')
            ->assertJsonPath('data.bookshop.suspension_reason', 'Unpaid invoices');
        $this->getJson("/api/pos/products?branch_id={$this->branch->id}")->assertForbidden()->assertJsonPath('code', 'bookshop_suspended');
        $this->getJson('/api/bookshop')->assertForbidden()->assertJsonPath('code', 'bookshop_suspended');
        $this->postJson('/api/branches', ['name' => 'New', 'code' => 'NEW'])->assertForbidden();
        $this->assertDatabaseHas('books', ['id' => $book, 'title' => 'Atlas']);

        $this->actingAs($this->platformOwner, 'sanctum')->postJson("/api/platform/bookshops/{$this->bookshop->id}/reactivate", ['note' => 'Paid'])->assertOk()
            ->assertJsonPath('data.status', Bookshop::STATUS_ACTIVE);
        $this->assertSame(BookshopSubscription::TRIALING, $this->bookshop->subscription()->first()->status);
        $this->assertDatabaseHas('audit_logs', ['action' => 'platform.bookshop_reactivated', 'bookshop_id' => $this->bookshop->id]);
        $this->actingAs($this->owner, 'sanctum')->getJson("/api/pos/products?branch_id={$this->branch->id}")->assertOk();
    }

    public function test_platform_administrators_have_restricted_delegated_permissions(): void
    {
        $this->actingAs($this->platformAdmin, 'sanctum');

        $this->getJson('/api/platform/overview')->assertOk();
        $this->getJson('/api/platform/bookshops')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson("/api/platform/bookshops/{$this->bookshop->id}")->assertOk();
        $this->getJson('/api/platform/users')->assertOk();
        $this->getJson('/api/platform/audit-logs')->assertOk();
        $this->getJson('/api/platform/settings')->assertOk();

        $this->postJson("/api/platform/bookshops/{$this->bookshop->id}/suspend", ['reason' => 'No'])->assertForbidden();
        $this->putJson('/api/platform/settings', ['bookshop_registration_open' => false])->assertForbidden();
        $this->postJson('/api/platform/users', ['name' => 'Boss', 'email' => 'boss@example.test', 'password' => 'Strong-pass1', 'password_confirmation' => 'Strong-pass1', 'role' => Roles::PLATFORM_OWNER])->assertForbidden();
        $this->patchJson("/api/platform/users/{$this->platformOwner->id}/status", ['is_active' => false])->assertForbidden();
        $this->getJson('/api/books')->assertForbidden();
        $this->assertSame(Bookshop::STATUS_ACTIVE, $this->bookshop->fresh()->status);
        $this->assertSame(1, User::where('role', Roles::PLATFORM_OWNER)->count());
    }

    public function test_no_one_can_create_or_promote_a_platform_owner_through_the_api(): void
    {
        $this->actingAs($this->platformOwner, 'sanctum');
        $payload = ['name' => 'Second', 'email' => 'second@example.test', 'password' => 'Strong-pass1', 'password_confirmation' => 'Strong-pass1'];

        $this->postJson('/api/platform/users', [...$payload, 'role' => Roles::PLATFORM_OWNER])->assertUnprocessable()->assertJsonValidationErrors('role');
        $this->postJson('/api/platform/users', [...$payload, 'role' => Roles::BOOKSHOP_OWNER])->assertUnprocessable()->assertJsonValidationErrors('role');
        $this->postJson('/api/platform/users', [...$payload, 'role' => Roles::PLATFORM_ADMIN, 'bookshop_id' => $this->bookshop->id])->assertUnprocessable();
        $id = $this->postJson('/api/platform/users', [...$payload, 'role' => Roles::PLATFORM_ADMIN])->assertCreated()->json('data.id');
        $this->assertNull(User::find($id)->bookshop_id);
        $this->patchJson("/api/platform/users/{$this->platformOwner->id}/status", ['is_active' => false])->assertStatus(422);
        $this->patchJson("/api/platform/users/{$this->owner->id}/status", ['is_active' => false])->assertNotFound();
        $this->patchJson("/api/platform/users/{$id}/status", ['is_active' => false])->assertOk();

        // Bookshop owners cannot assign platform roles to their staff either.
        $this->actingAs($this->owner, 'sanctum')->postJson('/api/users', [...$payload, 'email' => 'third@example.test', 'role' => Roles::PLATFORM_ADMIN])
            ->assertUnprocessable()->assertJsonValidationErrors('role');
        $this->assertSame(1, User::where('role', Roles::PLATFORM_OWNER)->count());
    }

    public function test_platform_settings_and_audit_history(): void
    {
        $this->actingAs($this->platformOwner, 'sanctum');

        $this->putJson('/api/platform/settings', ['trial_days' => 21, 'support_email' => 'help@example.test', 'unknown' => 'ignored'])->assertOk()
            ->assertJsonPath('data.trial_days', 21)->assertJsonPath('data.support_email', 'help@example.test');
        $this->assertSame(21, app(SubscriptionService::class)->trialDays());
        $this->getJson('/api/platform/audit-logs')->assertOk()->assertJsonPath('data.0.action', 'platform.settings_updated');
        $this->getJson('/api/platform/plans')->assertOk()->assertJsonPath('data.0.code', 'starter');
    }

    public function test_platform_owner_command_creates_the_only_platform_owner(): void
    {
        putenv('PLATFORM_OWNER_EMAIL=root@platform.test');
        putenv('PLATFORM_OWNER_PASSWORD=short');
        $this->artisan('platform:owner')->assertFailed();
        putenv('PLATFORM_OWNER_PASSWORD=A-very-long-pass-123');
        $this->artisan('platform:owner')->assertSuccessful();
        putenv("PLATFORM_OWNER_EMAIL={$this->owner->email}");
        $this->artisan('platform:owner')->assertFailed();
        putenv('PLATFORM_OWNER_EMAIL');
        putenv('PLATFORM_OWNER_PASSWORD');

        $root = User::where('email', 'root@platform.test')->firstOrFail();
        $this->assertSame(Roles::PLATFORM_OWNER, $root->role);
        $this->assertNull($root->bookshop_id);
        $this->assertSame(Roles::BOOKSHOP_OWNER, $this->owner->fresh()->role);
    }
}
