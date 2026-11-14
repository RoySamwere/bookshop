<?php

namespace Tests\Feature;

use App\Models\Bookshop;
use App\Models\BookshopSubscription;
use App\Models\Branch;
use App\Models\SubscriptionPlan;
use App\Models\SubscriptionTrialExtension;
use App\Models\User;
use App\Services\SubscriptionService;
use App\Support\Roles;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use LogicException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class TrialExtensionTest extends TestCase
{
    use RefreshDatabase;

    private User $platformOwner;
    private Bookshop $bookshop;
    private BookshopSubscription $subscription;
    private User $systemOwner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now()->startOfSecond());
        $this->platformOwner = User::factory()->create(['role' => Roles::PLATFORM_OWNER, 'name' => 'Platform Boss']);
        [$this->bookshop, $this->systemOwner] = $this->shop('Trial Books', Roles::SYSTEM_OWNER);
        $this->subscription = $this->bookshop->subscription()->firstOrFail();
    }

    /** @return array{0: Bookshop, 1: User} */
    private function shop(string $name, string $role = Roles::BOOKSHOP_OWNER): array
    {
        $shop = Bookshop::factory()->create(['name' => $name]);
        app(SubscriptionService::class)->startTrial($shop);
        $branch = Branch::factory()->main()->create(['bookshop_id' => $shop->id]);
        $owner = User::factory()->forBookshop($shop)->inBranches($branch)->create(['role' => $role]);
        $shop->forceFill(['owner_user_id' => $owner->id])->save();

        return [$shop, $owner];
    }

    private function extend(array $overrides = [], ?Bookshop $shop = null, ?BookshopSubscription $subscription = null)
    {
        $subscription ??= $this->subscription->fresh();

        return $this->postJson('/api/platform/bookshops/'.($shop ?? $this->bookshop)->id.'/trial-extensions', [
            'days' => 10, 'reason' => 'Onboarding delayed', 'idempotency_key' => 'key-'.uniqid(),
            'expected_trial_ends_at' => $subscription->trial_ends_at?->toIso8601String(), ...$overrides,
        ]);
    }

    public function test_platform_owner_extends_an_active_trial_from_its_current_expiry(): void
    {
        $this->actingAs($this->platformOwner, 'sanctum');
        $previous = $this->subscription->trial_ends_at->copy();
        $planId = $this->subscription->subscription_plan_id;

        $this->extend(['days' => 10])->assertCreated()
            ->assertJsonPath('duplicate', false)
            ->assertJsonPath('data.days_granted', 10)
            ->assertJsonPath('data.reactivated', false)
            ->assertJsonPath('data.previous_trial_ends_at', $previous->toIso8601String())
            ->assertJsonPath('data.new_trial_ends_at', $previous->copy()->addDays(10)->toIso8601String())
            ->assertJsonPath('subscription.trial_state', 'active')
            ->assertJsonPath('subscription.remaining_trial_days', 24);

        $fresh = $this->subscription->fresh();
        $this->assertTrue($fresh->trial_ends_at->equalTo($previous->copy()->addDays(10)));
        $this->assertSame(BookshopSubscription::TRIALING, $fresh->status);
        $this->assertSame($planId, $fresh->subscription_plan_id);
        $this->assertTrue($fresh->trial_starts_at->equalTo($this->subscription->trial_starts_at));
        $this->assertNull($fresh->current_period_ends_at);
    }

    public function test_platform_owner_reactivates_an_expired_trial_from_today(): void
    {
        $this->travel(20)->days();
        Artisan::call('billing:expire-subscriptions');
        $this->assertSame(BookshopSubscription::EXPIRED, $this->subscription->fresh()->status);
        $this->actingAs($this->systemOwner, 'sanctum');
        $this->getJson('/api/dashboard')->assertForbidden()->assertJsonPath('code', 'subscription_expired');

        $this->actingAs($this->platformOwner, 'sanctum');
        $this->extend(['days' => 7])->assertCreated()->assertJsonPath('data.reactivated', true)
            ->assertJsonPath('data.previous_status', 'expired')
            ->assertJsonPath('data.new_trial_ends_at', now()->addDays(7)->toIso8601String())
            ->assertJsonPath('subscription.status', 'trialing');

        $fresh = $this->subscription->fresh();
        $this->assertSame(BookshopSubscription::TRIALING, $fresh->status);
        $this->assertTrue($fresh->trial_ends_at->equalTo(now()->addDays(7)));
        $this->assertDatabaseHas('subscription_events', ['bookshop_subscription_id' => $fresh->id, 'event' => 'trial_extended', 'actor_id' => $this->platformOwner->id]);

        // The expiry job must not undo the reactivation.
        Artisan::call('billing:expire-subscriptions');
        $this->assertSame(BookshopSubscription::TRIALING, $this->subscription->fresh()->status);
    }

    public function test_trial_still_marked_trialing_after_its_end_restarts_from_today(): void
    {
        $this->travel(15)->days(); // Elapsed, but the expiry job has not run yet.
        $this->actingAs($this->platformOwner, 'sanctum');
        $this->extend(['days' => 3])->assertCreated()->assertJsonPath('data.reactivated', true);
        $this->assertTrue($this->subscription->fresh()->trial_ends_at->equalTo(now()->addDays(3)));
    }

    public function test_system_owner_and_platform_admin_are_denied(): void
    {
        $before = $this->subscription->trial_ends_at;
        $admin = User::factory()->create(['role' => Roles::PLATFORM_ADMIN]);
        foreach ([$this->systemOwner, $admin] as $user) {
            $this->actingAs($user, 'sanctum');
            $this->extend()->assertForbidden();
            $this->getJson('/api/platform/trial-extensions')->assertForbidden();
            $this->getJson('/api/platform/trial-extensions/subscriptions')->assertForbidden();
        }
        $this->assertTrue($this->subscription->fresh()->trial_ends_at->equalTo($before));
        $this->assertSame(0, SubscriptionTrialExtension::count());
        $this->assertNotContains('platform.subscriptions.extend_trial', $admin->permissions());
    }

    public function test_guests_are_rejected(): void
    {
        $this->extend()->assertUnauthorized();
    }

    public static function invalidDays(): array
    {
        return ['zero' => [0], 'negative' => [-3], 'decimal' => [2.5], 'decimal string' => ['2.5'],
            'text' => ['ten'], 'empty' => [''], 'null' => [null], 'over maximum' => [91], 'array' => [[5]]];
    }

    #[DataProvider('invalidDays')]
    public function test_invalid_extension_values_are_rejected(mixed $days): void
    {
        $this->actingAs($this->platformOwner, 'sanctum');
        $before = $this->subscription->trial_ends_at;
        $this->extend(['days' => $days])->assertUnprocessable()->assertJsonValidationErrors('days');
        $this->assertTrue($this->subscription->fresh()->trial_ends_at->equalTo($before));
        $this->assertSame(0, SubscriptionTrialExtension::count());
    }

    public function test_a_json_decimal_with_zero_fraction_is_rejected(): void
    {
        $this->actingAs($this->platformOwner, 'sanctum');
        $body = '{"days":5.0,"idempotency_key":"raw-decimal-1","expected_trial_ends_at":"'.$this->subscription->trial_ends_at->toIso8601String().'"}';
        $this->call('POST', "/api/platform/bookshops/{$this->bookshop->id}/trial-extensions", [], [], [],
            ['CONTENT_TYPE' => 'application/json', 'HTTP_ACCEPT' => 'application/json'], $body)
            ->assertUnprocessable()->assertJsonValidationErrors('days');
        $this->assertSame(0, SubscriptionTrialExtension::count());
    }

    public function test_maximum_is_configurable_and_other_fields_are_validated(): void
    {
        config(['subscriptions.max_trial_extension_days' => 5]);
        $this->actingAs($this->platformOwner, 'sanctum');
        $this->extend(['days' => 6])->assertUnprocessable()->assertJsonValidationErrors('days');
        $this->extend(['reason' => str_repeat('x', 501)])->assertUnprocessable()->assertJsonValidationErrors('reason');
        $this->extend(['idempotency_key' => 'bad key!'])->assertUnprocessable()->assertJsonValidationErrors('idempotency_key');
        $this->extend(['days' => 5])->assertCreated();
        $this->getJson('/api/platform/trial-extensions/subscriptions')->assertOk()->assertJsonPath('max_days', 5);
    }

    public function test_paid_subscriptions_are_not_altered(): void
    {
        $plan = SubscriptionPlan::create(['code' => 'paid', 'name' => 'Paid', 'price' => 1000, 'currency' => 'KES', 'billing_interval' => 'monthly', 'is_active' => true]);
        $this->subscription->forceFill(['status' => 'active', 'subscription_plan_id' => $plan->id,
            'current_period_starts_at' => now(), 'current_period_ends_at' => now()->addMonth()])->save();
        $snapshot = $this->subscription->fresh()->getAttributes();
        $this->actingAs($this->platformOwner, 'sanctum');

        $this->extend()->assertUnprocessable()->assertJsonValidationErrors('subscription');
        $this->assertEquals($snapshot, $this->subscription->fresh()->getAttributes());

        // An expired subscription that was once paid is still a paid subscription, not a trial.
        $this->subscription->forceFill(['status' => 'expired', 'current_period_ends_at' => now()->subDay()])->save();
        $this->extend()->assertUnprocessable()->assertJsonValidationErrors('subscription');

        // Even without a paid period on the subscription, a paid invoice blocks the extension.
        $this->subscription->forceFill(['current_period_ends_at' => null, 'current_period_starts_at' => null])->save();
        DB::table('platform_billing_invoices')->insert(['bookshop_id' => $this->bookshop->id, 'subscription_plan_id' => $plan->id,
            'account_number' => '100001', 'amount' => 1000, 'currency' => 'KES', 'environment' => 'production', 'billing_months' => 1,
            'status' => 'paid', 'period_starts_at' => now(), 'period_ends_at' => now()->addMonth(), 'created_at' => now(), 'updated_at' => now()]);
        $invoices = DB::table('platform_billing_invoices')->get();
        $this->extend()->assertUnprocessable()->assertJsonValidationErrors('subscription');
        $this->assertEquals($invoices, DB::table('platform_billing_invoices')->get());
        $this->assertSame(0, SubscriptionTrialExtension::count());

        $row = collect($this->getJson('/api/platform/trial-extensions/subscriptions')->assertOk()->json('data'))->firstWhere('bookshop_id', $this->bookshop->id);
        $this->assertFalse($row['eligible']);
        $this->assertSame('not_trial', $row['trial_state']);
    }

    public function test_extension_does_not_touch_invoices_or_payments(): void
    {
        $plan = SubscriptionPlan::create(['code' => 'paid', 'name' => 'Paid', 'price' => 1000, 'currency' => 'KES', 'billing_interval' => 'monthly', 'is_active' => true]);
        DB::table('platform_billing_invoices')->insert(['bookshop_id' => $this->bookshop->id, 'subscription_plan_id' => $plan->id,
            'account_number' => '100002', 'amount' => 1000, 'currency' => 'KES', 'environment' => 'production', 'billing_months' => 1,
            'status' => 'pending', 'period_starts_at' => now(), 'period_ends_at' => now()->addMonth(), 'created_at' => now(), 'updated_at' => now()]);
        $invoices = DB::table('platform_billing_invoices')->get();
        $payments = DB::table('platform_billing_payments')->count();
        $this->actingAs($this->platformOwner, 'sanctum');

        $this->extend()->assertCreated();
        $this->assertEquals($invoices, DB::table('platform_billing_invoices')->get());
        $this->assertSame($payments, DB::table('platform_billing_payments')->count());
        $this->assertSame(1, BookshopSubscription::where('bookshop_id', $this->bookshop->id)->count());
    }

    public function test_audit_history_is_recorded_and_listed(): void
    {
        $this->actingAs($this->platformOwner, 'sanctum');
        $previous = $this->subscription->trial_ends_at;
        $id = $this->extend(['days' => 4, 'reason' => '  Needs more setup time  '])->assertCreated()->json('data.id');

        $this->assertDatabaseHas('subscription_trial_extensions', [
            'id' => $id, 'bookshop_id' => $this->bookshop->id, 'bookshop_subscription_id' => $this->subscription->id,
            'days_granted' => 4, 'extended_by' => $this->platformOwner->id, 'extended_by_name' => 'Platform Boss',
            'reason' => 'Needs more setup time', 'previous_status' => 'trialing',
        ]);
        $record = SubscriptionTrialExtension::findOrFail($id);
        $this->assertTrue($record->previous_trial_ends_at->equalTo($previous));
        $this->assertTrue($record->new_trial_ends_at->equalTo($previous->copy()->addDays(4)));
        $this->assertNotNull($record->created_at);
        $this->assertDatabaseHas('audit_logs', ['action' => 'billing.trial_extended', 'bookshop_id' => $this->bookshop->id, 'user_id' => $this->platformOwner->id]);

        $this->getJson('/api/platform/trial-extensions?bookshop_id='.$this->bookshop->id)->assertOk()
            ->assertJsonPath('data.0.id', $id)->assertJsonPath('data.0.bookshop_name', 'Trial Books')
            ->assertJsonPath('data.0.reason', 'Needs more setup time')->assertJsonPath('data.0.extended_by_name', 'Platform Boss');
        $this->getJson('/api/platform/audit-logs')->assertOk()->assertJsonFragment(['action' => 'billing.trial_extended']);
    }

    public function test_history_cannot_be_edited_or_deleted(): void
    {
        $this->actingAs($this->platformOwner, 'sanctum');
        $id = $this->extend()->assertCreated()->json('data.id');
        $record = SubscriptionTrialExtension::findOrFail($id);

        // No route exists to change or remove history, for any account.
        $this->patchJson("/api/platform/trial-extensions/{$id}", ['days_granted' => 99])->assertNotFound();
        $this->deleteJson("/api/platform/trial-extensions/{$id}")->assertNotFound();
        $this->actingAs($this->systemOwner, 'sanctum');
        $this->deleteJson("/api/platform/trial-extensions/{$id}")->assertNotFound();

        try {
            $record->update(['days_granted' => 99]);
            $this->fail('Trial extension history was edited.');
        } catch (LogicException) {
        }
        try {
            $record->delete();
            $this->fail('Trial extension history was deleted.');
        } catch (LogicException) {
        }
        $this->assertSame(10, SubscriptionTrialExtension::findOrFail($id)->days_granted);
    }

    public function test_duplicate_submissions_do_not_grant_additional_days(): void
    {
        $this->actingAs($this->platformOwner, 'sanctum');
        $expected = $this->subscription->trial_ends_at->copy()->addDays(10);
        $payload = ['days' => 10, 'idempotency_key' => 'repeat-key-123', 'expected_trial_ends_at' => $this->subscription->trial_ends_at->toIso8601String()];

        $first = $this->extend($payload)->assertCreated();
        $this->extend($payload)->assertOk()->assertJsonPath('duplicate', true)->assertJsonPath('data.id', $first->json('data.id'));

        $this->assertSame(1, SubscriptionTrialExtension::count());
        $this->assertTrue($this->subscription->fresh()->trial_ends_at->equalTo($expected));
        $this->assertSame(1, DB::table('subscription_events')->where('event', 'trial_extended')->count());
    }

    public function test_a_stale_expiry_is_rejected_instead_of_stacking_days(): void
    {
        $this->actingAs($this->platformOwner, 'sanctum');
        $opened = $this->subscription->trial_ends_at->toIso8601String();
        $this->extend(['expected_trial_ends_at' => $opened])->assertCreated();
        $after = $this->subscription->fresh()->trial_ends_at;

        // A second operator tab submits with the expiry it saw before the first extension landed.
        $this->extend(['expected_trial_ends_at' => $opened])->assertStatus(409);
        $this->assertTrue($this->subscription->fresh()->trial_ends_at->equalTo($after));
        $this->assertSame(1, SubscriptionTrialExtension::count());
    }

    public function test_extension_is_isolated_to_the_target_bookshop(): void
    {
        [$other] = $this->shop('Other Books');
        $otherSubscription = $other->subscription()->firstOrFail();
        $otherBefore = $otherSubscription->getAttributes();
        $this->actingAs($this->platformOwner, 'sanctum');

        $this->extend()->assertCreated();
        $this->assertEquals($otherBefore, $otherSubscription->fresh()->getAttributes());

        // A submission key cannot be replayed against a different bookshop.
        $this->extend(['idempotency_key' => 'shared-key-1'])->assertCreated();
        $this->extend(['idempotency_key' => 'shared-key-1'], $other, $otherSubscription)->assertUnprocessable()->assertJsonValidationErrors('idempotency_key');
        $this->assertEquals($otherBefore, $otherSubscription->fresh()->getAttributes());

        // Unknown bookshop ids are not found, and a bookshop without a subscription cannot be extended.
        $this->postJson('/api/platform/bookshops/999999/trial-extensions', ['days' => 1, 'idempotency_key' => 'missing-shop', 'expected_trial_ends_at' => null])->assertNotFound();
        $legacy = Bookshop::factory()->create();
        $this->postJson("/api/platform/bookshops/{$legacy->id}/trial-extensions", ['days' => 1, 'idempotency_key' => 'legacy-shop', 'expected_trial_ends_at' => null])
            ->assertUnprocessable()->assertJsonValidationErrors('subscription');

        // The system owner's own view of their bookshop only reflects their own subscription.
        $this->actingAs($this->systemOwner, 'sanctum');
        $this->getJson('/api/platform/trial-extensions?bookshop_id='.$other->id)->assertForbidden();
    }

    public function test_bookshop_dashboard_reflects_the_new_expiry_and_remaining_days(): void
    {
        $this->actingAs($this->systemOwner, 'sanctum');
        $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('data.bookshop.subscription.trial_days_left', 14);

        $this->actingAs($this->platformOwner, 'sanctum');
        $this->extend(['days' => 6])->assertCreated();

        $this->actingAs($this->systemOwner, 'sanctum');
        $expiry = $this->subscription->trial_ends_at->copy()->addDays(6)->toIso8601String();
        $this->getJson('/api/auth/me')->assertOk()
            ->assertJsonPath('data.bookshop.subscription.status', 'trialing')
            ->assertJsonPath('data.bookshop.subscription.trial_days_left', 20)
            ->assertJsonPath('data.bookshop.subscription.days_remaining', 20)
            ->assertJsonPath('data.bookshop.subscription.trial_ends_at', $expiry);
        $this->getJson('/api/bookshop')->assertOk()->assertJsonPath('data.subscription.trial_ends_at', $expiry);

        // On day 16 the original trial would have ended; the extended one keeps the workspace open.
        $this->travel(16)->days();
        Artisan::call('billing:expire-subscriptions');
        $this->getJson('/api/dashboard')->assertOk();
        $this->getJson('/api/auth/me')->assertJsonPath('data.bookshop.subscription.trial_days_left', 4);
    }

    public function test_subscription_list_reports_trial_status_and_filters(): void
    {
        [$expiredShop] = $this->shop('Lapsed Books');
        $expiredShop->subscription->forceFill(['status' => 'expired', 'trial_ends_at' => now()->subDays(2)])->save();
        $this->actingAs($this->platformOwner, 'sanctum');

        $rows = collect($this->getJson('/api/platform/trial-extensions/subscriptions')->assertOk()->json('data'))->keyBy('bookshop_name');
        $this->assertSame('active', $rows['Trial Books']['trial_state']);
        $this->assertSame(14, $rows['Trial Books']['remaining_trial_days']);
        $this->assertTrue($rows['Trial Books']['eligible']);
        $this->assertNotNull($rows['Trial Books']['trial_starts_at']);
        $this->assertSame('expired', $rows['Lapsed Books']['trial_state']);
        $this->assertSame(0, $rows['Lapsed Books']['remaining_trial_days']);
        $this->assertTrue($rows['Lapsed Books']['eligible']);

        $this->getJson('/api/platform/trial-extensions/subscriptions?state=expired')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.bookshop_name', 'Lapsed Books');
        $this->getJson('/api/platform/trial-extensions/subscriptions?state=active')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.bookshop_name', 'Trial Books');
        $this->getJson('/api/platform/trial-extensions/subscriptions?search=Lapsed')->assertOk()->assertJsonCount(1, 'data');
    }
}
