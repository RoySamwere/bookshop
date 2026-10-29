<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Bookshop;
use App\Models\Branch;
use App\Models\User;
use App\Support\Roles;
use App\Support\Tenancy\Tenant;
use Database\Seeders\SystemOwnerSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class LegacyPlatformOwnerUpgradeTest extends TestCase
{
    use RefreshDatabase;

    private function legacy(array $attributes = []): User
    {
        $user = User::factory()->create(['role' => Roles::SYSTEM_OWNER, 'bookshop_id' => null, ...$attributes]);
        config(['platform.legacy_owner_email' => $user->email]);

        return $user;
    }

    public function test_trusted_administrator_upgrades_once_without_changing_credentials_or_other_owners(): void
    {
        $user = $this->legacy();
        $before = $user->fresh()->getAttributes();
        $other = User::factory()->create(['role' => Roles::SYSTEM_OWNER]);
        $this->artisan('platform:upgrade-legacy-owner', ['--dry-run' => true])->assertSuccessful();
        $this->assertSame(Roles::SYSTEM_OWNER, $user->fresh()->role);
        $this->assertDatabaseCount('audit_logs', 0);
        $this->artisan('platform:upgrade-legacy-owner')->assertSuccessful();
        $this->artisan('platform:upgrade-legacy-owner')->assertSuccessful();
        $this->seed(SystemOwnerSeeder::class);
        $after = $user->fresh();
        foreach (['id', 'email', 'name', 'password', 'email_verified_at', 'remember_token', 'is_active'] as $field) {
            $this->assertSame($before[$field], $after->getAttributes()[$field]);
        }
        $this->assertSame(Roles::PLATFORM_OWNER, $after->role);
        $this->assertNull($after->bookshop_id);
        $this->assertSame(Roles::SYSTEM_OWNER, $other->fresh()->role);
        $this->assertDatabaseCount('users', 2);
        $this->assertSame(1, AuditLog::where('action', 'platform.legacy_owner_upgraded')->count());
        $login = $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'password'])->assertOk()
            ->assertJsonPath('data.user.account_type', 'platform')->assertJsonPath('data.user.bookshop_id', null);
        $this->withToken($login->json('data.token'))->getJson('/api/platform/overview')->assertOk();
        $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('data.role', 'platform_owner');
        $this->getJson('/api/books')->assertForbidden();
    }

    public function test_ownership_must_be_transferred_explicitly_and_business_records_survive(): void
    {
        $shop = Bookshop::factory()->create();
        $branch = Branch::factory()->create(['bookshop_id' => $shop->id]);
        $user = $this->legacy(['bookshop_id' => $shop->id]);
        $user->branches()->attach($branch);
        $shop->forceFill(['owner_user_id' => $user->id])->save();
        $replacement = User::factory()->forBookshop($shop)->create(['role' => Roles::BOOKSHOP_OWNER]);
        $bookId = DB::table('books')->insertGetId(['bookshop_id' => $shop->id, 'title' => 'Existing book', 'sku' => 'KEEP', 'selling_price' => 10]);
        $before = DB::table('books')->where('id', $bookId)->first();
        $this->artisan('platform:upgrade-legacy-owner')->assertFailed();
        $this->assertSame(Roles::SYSTEM_OWNER, $user->fresh()->role);
        $this->assertSame($user->id, $shop->fresh()->owner_user_id);
        $this->assertDatabaseHas('branch_user', ['user_id' => $user->id, 'branch_id' => $branch->id]);
        $this->artisan('platform:upgrade-legacy-owner', ['--replacement-owner' => $replacement->id, '--dry-run' => true])->assertSuccessful();
        $this->assertSame($user->id, $shop->fresh()->owner_user_id);
        $this->artisan('platform:upgrade-legacy-owner', ['--replacement-owner' => $replacement->id])->assertSuccessful();
        $this->artisan('platform:upgrade-legacy-owner', ['--replacement-owner' => $replacement->id])->assertSuccessful();
        $this->assertSame($replacement->id, $shop->fresh()->owner_user_id);
        $this->assertSame((array) $before, (array) DB::table('books')->where('id', $bookId)->first());
        $this->assertDatabaseHas('branches', ['id' => $branch->id, 'bookshop_id' => $shop->id]);
        $this->assertDatabaseMissing('branch_user', ['user_id' => $user->id]);
        $this->assertSame(Roles::BOOKSHOP_OWNER, $replacement->fresh()->role);
        $this->actingAs($replacement, 'sanctum')->getJson('/api/books')->assertOk()->assertJsonFragment(['title' => 'Existing book']);
        $this->getJson('/api/platform/overview')->assertForbidden();
        $audit = AuditLog::where('action', 'platform.legacy_owner_upgraded')->sole();
        $this->assertSame($shop->id, $audit->metadata['before']['bookshop_id']);
        $this->assertSame($replacement->id, $audit->metadata['ownership_transfers'][0]['to']);
    }

    public function test_untrusted_missing_or_wrong_role_identity_never_changes_accounts(): void
    {
        $user = $this->legacy();
        foreach ([null, 'invalid', 'missing@example.test'] as $email) {
            config(['platform.legacy_owner_email' => $email]);
            $this->artisan('platform:upgrade-legacy-owner')->assertFailed();
        }
        $customer = User::factory()->create(['role' => Roles::CUSTOMER]);
        config(['platform.legacy_owner_email' => $customer->email]);
        $this->artisan('platform:upgrade-legacy-owner')->assertFailed();
        $this->assertSame(Roles::SYSTEM_OWNER, $user->fresh()->role);
        $this->assertSame(Roles::CUSTOMER, $customer->fresh()->role);
        $this->assertDatabaseCount('audit_logs', 0);
    }

    public function test_administrator_replacement_requires_explicit_promotion_and_is_audited(): void
    {
        $shop = Bookshop::factory()->create();
        $user = $this->legacy(['bookshop_id' => $shop->id]);
        $shop->forceFill(['owner_user_id' => $user->id])->save();
        $admin = User::factory()->forBookshop($shop)->create(['role' => Roles::ADMIN]);
        $credentials = $admin->fresh()->only(['id', 'email', 'password', 'email_verified_at']);
        $this->artisan('platform:upgrade-legacy-owner', ['--promote-replacement-owner' => true])->assertFailed();
        $this->artisan('platform:upgrade-legacy-owner', ['--replacement-owner' => $admin->id])->assertFailed();
        $options = ['--replacement-owner' => $admin->id, '--promote-replacement-owner' => true];
        $this->artisan('platform:upgrade-legacy-owner', [...$options, '--dry-run' => true])->assertSuccessful();
        $this->assertSame(Roles::ADMIN, $admin->fresh()->role);
        $this->assertSame($user->id, $shop->fresh()->owner_user_id);
        $this->assertDatabaseCount('audit_logs', 0);
        $this->artisan('platform:upgrade-legacy-owner', $options)->assertSuccessful();
        $this->artisan('platform:upgrade-legacy-owner', $options)->assertSuccessful();
        $this->assertSame(Roles::PLATFORM_OWNER, $user->fresh()->role);
        $this->assertNull($user->fresh()->bookshop_id);
        $this->assertSame(Roles::BOOKSHOP_OWNER, $admin->fresh()->role);
        $this->assertEquals($credentials, $admin->fresh()->only(array_keys($credentials)));
        $this->assertSame($admin->id, $shop->fresh()->owner_user_id);
        $audit = AuditLog::where('action', 'platform.legacy_owner_upgraded')->sole();
        $this->assertSame([['user_id' => $admin->id, 'from' => Roles::ADMIN, 'to' => Roles::BOOKSHOP_OWNER]], $audit->metadata['owner_promotions']);
    }

    public function test_promotion_cannot_use_other_tenants_inactive_staff_or_non_administrators(): void
    {
        $shop = Bookshop::factory()->create();
        $user = $this->legacy(['bookshop_id' => $shop->id]);
        $shop->forceFill(['owner_user_id' => $user->id])->save();
        $otherShop = Bookshop::factory()->create();
        foreach ([
            User::factory()->forBookshop($otherShop)->create(['role' => Roles::ADMIN]),
            User::factory()->forBookshop($shop)->create(['role' => Roles::ADMIN, 'is_active' => false]),
            User::factory()->forBookshop($shop)->create(['role' => Roles::CASHIER]),
            $user,
        ] as $invalid) {
            $this->artisan('platform:upgrade-legacy-owner', ['--replacement-owner' => $invalid->id, '--promote-replacement-owner' => true])->assertFailed();
        }
        $this->assertSame(Roles::SYSTEM_OWNER, $user->fresh()->role);
        $this->assertSame($user->id, $shop->fresh()->owner_user_id);
        $this->assertDatabaseCount('audit_logs', 0);
    }

    public function test_unadopted_business_records_block_detachment(): void
    {
        $user = $this->legacy();
        DB::table('books')->insert(['title' => 'Legacy stock', 'sku' => 'LEGACY', 'selling_price' => 10]);
        $this->artisan('platform:upgrade-legacy-owner')->assertFailed();
        $this->assertSame(Roles::SYSTEM_OWNER, $user->fresh()->role);
        $this->assertDatabaseHas('books', ['sku' => 'LEGACY', 'bookshop_id' => null]);
        $this->assertDatabaseCount('audit_logs', 0);
    }

    public function test_existing_cookie_session_reads_upgraded_role_without_reauthentication(): void
    {
        $user = $this->legacy();
        $this->withHeader('Origin', 'http://localhost:5173');
        $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])->assertOk();
        $this->artisan('platform:upgrade-legacy-owner')->assertSuccessful();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.account_type', 'platform');
        $this->getJson('/api/v1/platform/overview')->assertOk();
    }

    public function test_new_seeded_owner_is_platform_and_repeated_seeding_preserves_credentials(): void
    {
        config(['platform.legacy_owner_email' => 'original@example.test', 'platform.legacy_owner_password' => 'Long-secret-123!']);
        $this->seed(SystemOwnerSeeder::class);
        $owner = User::sole();
        config(['platform.legacy_owner_password' => 'Different-secret-456!']);
        $this->seed(SystemOwnerSeeder::class);
        $this->assertDatabaseCount('users', 1);
        $this->assertSame($owner->password, $owner->fresh()->password);
        $this->assertSame(Roles::PLATFORM_OWNER, $owner->role);
        $this->assertNull($owner->bookshop_id);
    }

    public function test_platform_role_with_stale_membership_cannot_resolve_private_tenant_data(): void
    {
        $shop = Bookshop::factory()->create();
        $platform = User::factory()->create(['role' => Roles::PLATFORM_OWNER, 'bookshop_id' => $shop->id]);
        $this->actingAs($platform, 'sanctum');
        $this->assertNull(Tenant::id());
        $this->assertFalse(Tenant::scopeValue());
        $this->assertSame([], $platform->branchIds());
        $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('data.bookshop', null)->assertJsonPath('data.branches', []);
        $this->getJson('/api/platform/overview')->assertOk();
        $this->getJson('/api/pos/sales')->assertForbidden();
    }
}
