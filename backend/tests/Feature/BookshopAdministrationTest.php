<?php

namespace Tests\Feature;

use App\Models\Bookshop;
use App\Models\Branch;
use App\Models\CommunicationLog;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Services\SubscriptionService;
use App\Support\Roles;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class BookshopAdministrationTest extends TestCase
{
    use RefreshDatabase;

    private User $platformOwner;
    private Bookshop $shop;
    private User $owner;
    private User $cashier;
    private SubscriptionPlan $plan;

    protected function setUp(): void
    {
        parent::setUp();
        config(['mail.default' => 'array', 'services.mpesa.environment' => 'production', 'services.mpesa.shortcode' => '152451']);
        $this->platformOwner = User::factory()->create(['role' => Roles::PLATFORM_OWNER]);
        $this->shop = Bookshop::factory()->create(['name' => 'Kisumu Readers']);
        app(SubscriptionService::class)->startTrial($this->shop);
        $branch = Branch::factory()->main()->create(['bookshop_id' => $this->shop->id]);
        $this->owner = User::factory()->forBookshop($this->shop)->inBranches($branch)->create(['role' => Roles::BOOKSHOP_OWNER]);
        $this->shop->forceFill(['owner_user_id' => $this->owner->id])->save();
        $this->cashier = User::factory()->forBookshop($this->shop)->inBranches($branch)->create(['role' => Roles::CASHIER]);
        $this->plan = SubscriptionPlan::create(['code' => 'monthly', 'name' => 'Monthly', 'price' => 1500, 'currency' => 'KES', 'billing_interval' => 'monthly', 'is_active' => true]);
    }

    public function test_platform_staff_see_the_bookshops_users_without_business_data(): void
    {
        User::factory()->forBookshop($this->shop)->create(['role' => Roles::CUSTOMER]);
        $this->actingAs(User::factory()->create(['role' => Roles::PLATFORM_ADMIN]), 'sanctum');
        $rows = $this->getJson("/api/platform/bookshops/{$this->shop->id}/users")->assertOk()->json('data');
        $this->assertCount(2, $rows, 'Customers are not listed.');
        $this->assertTrue($rows[0]['is_owner']);
        $this->assertArrayNotHasKey('password', $rows[0]);
    }

    public function test_the_platform_owner_can_deactivate_and_reactivate_staff_but_not_the_owner(): void
    {
        $this->cashier->createToken('device');
        $this->actingAs($this->platformOwner, 'sanctum');
        $this->patchJson("/api/platform/bookshops/{$this->shop->id}/users/{$this->cashier->id}/status", ['is_active' => false])->assertOk()->assertJsonPath('data.is_active', false);
        $this->assertSame(0, $this->cashier->tokens()->count(), 'Deactivation signs the user out.');
        $this->assertDatabaseHas('audit_logs', ['action' => 'platform.bookshop_user_deactivated', 'bookshop_id' => $this->shop->id]);
        $this->patchJson("/api/platform/bookshops/{$this->shop->id}/users/{$this->cashier->id}/status", ['is_active' => true])->assertOk();
        $this->patchJson("/api/platform/bookshops/{$this->shop->id}/users/{$this->owner->id}/status", ['is_active' => false])->assertStatus(422);
    }

    public function test_user_ids_from_another_bookshop_cannot_be_changed(): void
    {
        $other = Bookshop::factory()->create();
        $stranger = User::factory()->forBookshop($other)->create(['role' => Roles::CASHIER]);
        $this->actingAs($this->platformOwner, 'sanctum');
        $this->patchJson("/api/platform/bookshops/{$this->shop->id}/users/{$stranger->id}/status", ['is_active' => false])->assertNotFound();
        $this->patchJson("/api/platform/bookshops/{$this->shop->id}/users/{$this->platformOwner->id}/status", ['is_active' => false])->assertNotFound();
        $this->assertTrue($stranger->fresh()->is_active);
    }

    public function test_plan_change_applies_to_future_renewals_and_notifies_the_owner(): void
    {
        $subscription = $this->shop->subscription()->first();
        $trialEnds = $subscription->trial_ends_at;
        $this->actingAs($this->platformOwner, 'sanctum');
        $this->postJson("/api/platform/bookshops/{$this->shop->id}/subscription/plan", ['plan_id' => $this->plan->id])->assertOk()->assertJsonPath('data.plan.name', 'Monthly');

        $fresh = $subscription->fresh();
        $this->assertSame($this->plan->id, $fresh->subscription_plan_id);
        $this->assertSame('trialing', $fresh->status);
        $this->assertTrue($fresh->trial_ends_at->equalTo($trialEnds));
        $this->assertDatabaseHas('subscription_events', ['bookshop_subscription_id' => $fresh->id, 'event' => 'plan_changed']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'billing.plan_changed']);
        $this->assertSame([$this->owner->email], CommunicationLog::where('event', 'subscription_updated')->pluck('recipient_email')->all());
        $this->postJson("/api/platform/bookshops/{$this->shop->id}/subscription/plan", ['plan_id' => $this->plan->id])->assertStatus(422);
    }

    public function test_renewal_invoice_is_issued_once_and_announced_once(): void
    {
        $this->actingAs($this->platformOwner, 'sanctum');
        $account = $this->postJson("/api/platform/bookshops/{$this->shop->id}/subscription/renewal-invoice", ['plan_id' => $this->plan->id])->assertCreated()->json('data.account_number');
        $this->postJson("/api/platform/bookshops/{$this->shop->id}/subscription/renewal-invoice", ['plan_id' => $this->plan->id])->assertOk()->assertJsonPath('data.account_number', $account);
        $this->assertSame(1, DB::table('platform_billing_invoices')->where('bookshop_id', $this->shop->id)->count());
        $this->assertSame(1, CommunicationLog::where('event', 'payment_due')->count());
        $this->getJson("/api/platform/billing/invoices?bookshop_id={$this->shop->id}")->assertOk()->assertJsonPath('total', 1);
    }

    public function test_administration_changes_are_platform_owner_only(): void
    {
        $admin = User::factory()->create(['role' => Roles::PLATFORM_ADMIN]);
        foreach ([$admin, $this->owner] as $user) {
            $this->actingAs($user, 'sanctum');
            $this->patchJson("/api/platform/bookshops/{$this->shop->id}/users/{$this->cashier->id}/status", ['is_active' => false])->assertForbidden();
            $this->postJson("/api/platform/bookshops/{$this->shop->id}/subscription/plan", ['plan_id' => $this->plan->id])->assertForbidden();
            $this->postJson("/api/platform/bookshops/{$this->shop->id}/subscription/renewal-invoice", [])->assertForbidden();
        }
        $this->assertTrue($this->cashier->fresh()->is_active);
    }
}
