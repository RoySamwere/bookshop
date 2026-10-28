<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BusinessProfile;
use App\Models\TaxRate;
use App\Models\User;
use App\Support\Roles;
use Database\Seeders\BusinessFoundationSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class BusinessFoundationTest extends TestCase
{
    use RefreshDatabase;

    public function test_seeder_creates_defaults_once_and_assigns_unbranched_staff(): void
    {
        $admin = User::factory()->create(['role' => Roles::ADMIN]);
        $customer = User::factory()->create(['role' => Roles::CUSTOMER]);

        $this->seed(BusinessFoundationSeeder::class);
        BusinessProfile::current()->update(['name' => 'Renamed Shop']);
        $this->seed(BusinessFoundationSeeder::class);

        $this->assertSame(1, BusinessProfile::count());
        $this->assertSame('Renamed Shop', BusinessProfile::current()->name);
        $this->assertSame('KES', BusinessProfile::current()->currency);
        $this->assertSame(1, Branch::where('is_main', true)->count());
        $this->assertSame('16.00', TaxRate::where('is_default', true)->value('rate'));
        $this->assertSame(['MAIN'], $admin->branches()->pluck('code')->all());
        $this->assertSame(0, $customer->branches()->count());
    }

    public function test_workspace_users_can_read_business_settings_but_only_the_owner_can_change_them(): void
    {
        $this->seed(BusinessFoundationSeeder::class);
        $main = Branch::where('is_main', true)->first();
        $cashier = User::factory()->inBranches($main)->create(['role' => Roles::CASHIER]);
        $admin = User::factory()->inBranches($main)->create(['role' => Roles::ADMIN]);
        $owner = User::factory()->create(['role' => Roles::SYSTEM_OWNER]);

        $this->actingAs($cashier, 'sanctum')->getJson('/api/business')->assertOk()
            ->assertJsonPath('data.currency', 'KES')->assertJsonPath('data.default_tax.code', 'VAT16');
        $this->putJson('/api/business', ['name' => 'Hijack'])->assertForbidden();
        $this->actingAs($admin, 'sanctum')->putJson('/api/business', ['name' => 'Hijack'])->assertForbidden();

        $this->actingAs($owner, 'sanctum')->putJson('/api/business', [
            'name' => 'Nifunze Bookshop Ltd', 'kra_pin' => 'p051234567x', 'receipt_prefix' => 'nfz', 'low_stock_threshold' => 5,
        ])->assertOk()->assertJsonPath('data.kra_pin', 'P051234567X')->assertJsonPath('data.receipt_prefix', 'NFZ');
        $this->putJson('/api/business', ['kra_pin' => '123', 'timezone' => 'Mars/Base'])
            ->assertUnprocessable()->assertJsonValidationErrors(['kra_pin', 'timezone']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'business.updated', 'user_id' => $owner->id]);
    }

    public function test_owner_manages_branches_and_the_main_branch_stays_active(): void
    {
        $this->seed(BusinessFoundationSeeder::class);
        $owner = User::factory()->create(['role' => Roles::SYSTEM_OWNER]);
        $main = Branch::where('is_main', true)->first();
        $this->actingAs($owner, 'sanctum');

        $id = $this->postJson('/api/branches', ['name' => 'Westlands', 'code' => 'west-01', 'city' => 'Nairobi'])
            ->assertCreated()->assertJsonPath('data.code', 'WEST-01')->json('data.id');
        $this->postJson('/api/branches', ['name' => 'Duplicate', 'code' => 'WEST-01'])->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->patchJson("/api/branches/{$id}", ['is_active' => false])->assertOk()->assertJsonPath('data.is_active', false);
        $this->patchJson("/api/branches/{$main->id}", ['is_active' => false])->assertStatus(422);

        $this->getJson('/api/branches')->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('data.0.is_main', true);
        $this->getJson('/api/branches?active_only=1')->assertOk()->assertJsonCount(1, 'data');
        $this->assertDatabaseHas('audit_logs', ['action' => 'branch.created', 'subject_id' => $id]);
    }

    public function test_non_owners_only_see_their_branches_and_cannot_manage_them(): void
    {
        $main = Branch::factory()->main()->create();
        Branch::factory()->create();
        $manager = User::factory()->inBranches($main)->create(['role' => Roles::STORE_MANAGER]);
        $this->actingAs($manager, 'sanctum');

        $this->getJson('/api/branches')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $main->id);
        $this->postJson('/api/branches', ['name' => 'Nope', 'code' => 'NOPE'])->assertForbidden();
        $this->patchJson("/api/branches/{$main->id}", ['name' => 'Nope'])->assertForbidden();
    }

    public function test_tax_rates_keep_a_single_active_default(): void
    {
        $this->seed(BusinessFoundationSeeder::class);
        $this->actingAs(User::factory()->create(['role' => Roles::SYSTEM_OWNER]), 'sanctum');
        $vat = TaxRate::where('code', 'VAT16')->first();

        $this->patchJson("/api/tax-rates/{$vat->id}", ['is_active' => false])->assertStatus(422);
        $this->deleteJson("/api/tax-rates/{$vat->id}")->assertStatus(422);

        $id = $this->postJson('/api/tax-rates', ['name' => 'VAT 8%', 'code' => 'vat8', 'rate' => 8, 'is_default' => true])
            ->assertCreated()->assertJsonPath('data.code', 'VAT8')->json('data.id');
        $this->assertSame([$id], TaxRate::where('is_default', true)->pluck('id')->all());

        $this->postJson('/api/tax-rates', ['name' => 'Bad', 'code' => 'BAD', 'rate' => 120])->assertUnprocessable()->assertJsonValidationErrors('rate');
        $this->deleteJson("/api/tax-rates/{$vat->id}")->assertOk();
    }
}
