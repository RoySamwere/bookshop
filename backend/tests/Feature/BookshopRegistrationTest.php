<?php

namespace Tests\Feature;

use App\Models\Bookshop;
use App\Models\BookshopSubscription;
use App\Models\Branch;
use App\Models\PlatformSetting;
use App\Models\User;
use App\Support\FrontendUrl;
use App\Support\Roles;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class BookshopRegistrationTest extends TestCase
{
    use RefreshDatabase;

    private const PASSWORD = 'Strong-pass1';

    private function payload(array $overrides = []): array
    {
        return [
            'owner_name' => '  Wanjiru   Kamau ', 'email' => ' Wanjiru@Example.TEST ', 'phone' => '+254 712 000 111',
            'password' => self::PASSWORD, 'password_confirmation' => self::PASSWORD,
            'bookshop_name' => 'Kamau Readers', 'business_phone' => '+254 20 111 2222', 'business_location' => 'Nakuru',
            'country' => 'Kenya', 'currency' => 'kes', 'terms' => true,
            ...$overrides,
        ];
    }

    public function test_a_new_bookshop_owner_registers_their_bookshop_branch_and_trial(): void
    {
        Notification::fake();
        $this->travelTo(now()->startOfMinute());

        $this->postJson('/api/v1/auth/register/bookshop', $this->payload())->assertCreated()
            ->assertJsonPath('data.email', 'wanjiru@example.test')
            ->assertJsonPath('data.verification_email_sent', true)
            ->assertJsonPath('data.next', '/onboarding/verify-email')
            ->assertJsonPath('data.bookshop.status', Bookshop::STATUS_PENDING);

        $owner = User::where('email', 'wanjiru@example.test')->firstOrFail();
        $bookshop = Bookshop::firstOrFail();
        $this->assertSame('Wanjiru Kamau', $owner->name);
        $this->assertSame(Roles::BOOKSHOP_OWNER, $owner->role);
        $this->assertNull($owner->email_verified_at);
        $this->assertSame($bookshop->id, $owner->bookshop_id);
        $this->assertSame($owner->id, $bookshop->owner_user_id);
        $this->assertSame('kamau-readers', $bookshop->slug);
        $this->assertSame('KES', $bookshop->currency);
        $this->assertNotNull($bookshop->registered_at);

        // Exactly one bookshop and one main branch, owned by the new owner.
        $this->assertSame(1, Bookshop::count());
        $branches = Branch::withoutGlobalScope('bookshop')->get();
        $this->assertCount(1, $branches);
        $this->assertTrue($branches[0]->is_main);
        $this->assertSame($bookshop->id, $branches[0]->bookshop_id);
        $this->assertSame([$branches[0]->id], $owner->branchIds());

        $subscription = $bookshop->subscription;
        $this->assertSame(BookshopSubscription::TRIALING, $subscription->status);
        $this->assertTrue($subscription->trial_ends_at->equalTo(now()->addDays(14)));
        $this->assertDatabaseHas('subscription_events', ['bookshop_id' => $bookshop->id, 'event' => 'trial_started', 'to_status' => 'trialing']);
        $this->assertDatabaseHas('audit_logs', ['action' => 'bookshop.registered', 'bookshop_id' => $bookshop->id, 'user_id' => $owner->id]);
        $this->assertDatabaseHas('business_profiles', ['bookshop_id' => $bookshop->id, 'name' => 'Kamau Readers']);
        Notification::assertSentTo($owner, VerifyEmail::class);
    }

    public function test_trial_length_comes_from_configuration(): void
    {
        Notification::fake();
        config(['subscriptions.trial_days' => 30]);
        $this->travelTo(now()->startOfMinute());

        $this->postJson('/api/auth/register/bookshop', $this->payload())->assertCreated();

        $this->assertTrue(Bookshop::firstOrFail()->subscription->trial_ends_at->equalTo(now()->addDays(30)));
    }

    public static function privilegeFields(): array
    {
        return [
            'platform owner role' => [['role' => Roles::PLATFORM_OWNER]],
            'platform admin role' => [['role' => Roles::PLATFORM_ADMIN]],
            'existing bookshop' => [['bookshop_id' => 1]],
            'status' => [['status' => 'active']],
            'permissions' => [['permissions' => ['platform.access']]],
            'activation' => [['is_active' => true]],
        ];
    }

    #[DataProvider('privilegeFields')]
    public function test_public_registration_can_never_grant_platform_privileges(array $extra): void
    {
        $this->postJson('/api/auth/register/bookshop', $this->payload($extra))->assertUnprocessable();

        $this->assertSame(0, User::count());
        $this->assertSame(0, Bookshop::count());
    }

    public function test_duplicate_or_invalid_registrations_fail_without_leaving_partial_records(): void
    {
        Notification::fake();
        User::factory()->create(['email' => 'wanjiru@example.test']);
        $existingUsers = User::count();
        $existingBookshops = Bookshop::count();

        $this->postJson('/api/auth/register/bookshop', $this->payload())->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->postJson('/api/auth/register/bookshop', $this->payload(['email' => 'new@example.test', 'currency' => 'SHILLINGS', 'bookshop_name' => '', 'terms' => false, 'password_confirmation' => 'nope']))
            ->assertUnprocessable()->assertJsonValidationErrors(['currency', 'bookshop_name', 'terms', 'password']);
        $this->postJson('/api/auth/register/bookshop', [])->assertUnprocessable()
            ->assertJsonValidationErrors(['owner_name', 'email', 'phone', 'password', 'bookshop_name', 'business_phone', 'business_location', 'country', 'currency', 'terms']);

        $this->assertSame($existingUsers, User::count());
        $this->assertSame($existingBookshops, Bookshop::count());
        $this->assertSame(0, BookshopSubscription::count());
    }

    public function test_two_bookshops_with_the_same_name_get_distinct_slugs(): void
    {
        Notification::fake();
        $this->postJson('/api/auth/register/bookshop', $this->payload())->assertCreated();
        $this->postJson('/api/auth/register/bookshop', $this->payload(['email' => 'second@example.test']))->assertCreated();

        $this->assertSame(2, Bookshop::distinct()->count('slug'));
    }

    public function test_registration_can_be_paused_by_the_platform(): void
    {
        PlatformSetting::create(['key' => 'bookshop_registration_open', 'value' => false]);

        $this->postJson('/api/auth/register/bookshop', $this->payload())->assertForbidden();
        $this->assertSame(0, User::count());
    }

    public function test_email_verification_activates_the_bookshop(): void
    {
        Notification::fake();
        $this->postJson('/api/auth/register/bookshop', $this->payload())->assertCreated();
        $owner = User::where('email', 'wanjiru@example.test')->firstOrFail();

        parse_str(parse_url(FrontendUrl::verification($owner), PHP_URL_QUERY), $query);
        $this->getJson("/api/auth/email/verify/{$query['id']}/{$query['hash']}?expires={$query['expires']}&signature={$query['signature']}")
            ->assertOk()->assertJsonPath('status', 'verified')->assertJsonPath('next', '/onboarding/setup');

        $this->assertTrue($owner->fresh()->hasVerifiedEmail());
        $bookshop = $owner->bookshop()->first();
        $this->assertSame(Bookshop::STATUS_ACTIVE, $bookshop->status);
        $this->assertNotNull($bookshop->verified_at);
        $this->assertDatabaseHas('audit_logs', ['action' => 'bookshop.activated', 'bookshop_id' => $bookshop->id]);
    }

    public function test_unverified_owners_only_reach_onboarding(): void
    {
        Notification::fake();
        $this->postJson('/api/auth/register/bookshop', $this->payload())->assertCreated();
        $owner = User::where('email', 'wanjiru@example.test')->firstOrFail();
        $branch = $owner->branchIds()[0];
        $this->actingAs($owner, 'sanctum');

        $this->getJson('/api/auth/me')->assertOk()->assertJsonPath('data.account_type', 'bookshop')
            ->assertJsonPath('data.email_verified', false)->assertJsonPath('data.bookshop.status', Bookshop::STATUS_PENDING)
            ->assertJsonPath('data.bookshop.subscription.status', 'trialing');
        $this->getJson('/api/bookshop')->assertOk()->assertJsonPath('data.onboarding.email_verified', false)
            ->assertJsonPath('data.counts.branches', 1);
        $this->patchJson('/api/bookshop', ['location' => 'Nakuru CBD'])->assertOk();

        $this->getJson('/api/pos/branches')->assertForbidden()->assertJsonPath('code', 'email_unverified');
        $this->postJson('/api/pos/checkout', ['idempotency_key' => 'x', 'branch_id' => $branch, 'items' => [], 'payment_method' => 'cash', 'amount_received' => 0])
            ->assertForbidden();
        $this->postJson('/api/inventory/adjust', ['book_id' => 1, 'branch_id' => $branch, 'quantity_change' => 5, 'notes' => 'x'])->assertForbidden();
        $this->getJson('/api/books')->assertForbidden();
        $this->postJson('/api/staff-invitations', [])->assertForbidden();

        // A fresh verification link can be requested while signed in.
        $this->postJson('/api/auth/email/verification-notification')->assertOk();
    }
}
