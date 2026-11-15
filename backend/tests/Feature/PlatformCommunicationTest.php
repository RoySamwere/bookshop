<?php

namespace Tests\Feature;

use App\Jobs\SendCommunication;
use App\Models\Bookshop;
use App\Models\BookshopSubscription;
use App\Models\Branch;
use App\Models\CommunicationLog;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Notifications\AccountNotification;
use App\Services\Billing\PaymentConfirmationNotifier;
use App\Services\SubscriptionService;
use App\Support\Roles;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

class PlatformCommunicationTest extends TestCase
{
    use RefreshDatabase;

    private User $platformOwner;
    private Bookshop $shop;
    private User $owner;
    private User $cashier;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now()->startOfSecond());
        config(['mail.default' => 'array', 'services.mpesa.environment' => 'production', 'services.mpesa.shortcode' => '152451']);
        $this->platformOwner = User::factory()->create(['role' => Roles::PLATFORM_OWNER]);
        [$this->shop, $this->owner, $this->cashier] = $this->bookshop('Kisumu Readers');
    }

    /** @return array{0: Bookshop, 1: User, 2: User} */
    private function bookshop(string $name, string $status = Bookshop::STATUS_ACTIVE): array
    {
        $shop = Bookshop::factory()->create(['name' => $name, 'status' => $status, 'verified_at' => $status === Bookshop::STATUS_ACTIVE ? now() : null]);
        app(SubscriptionService::class)->startTrial($shop);
        $branch = Branch::factory()->main()->create(['bookshop_id' => $shop->id]);
        $owner = User::factory()->forBookshop($shop)->inBranches($branch)->create(['role' => Roles::BOOKSHOP_OWNER, 'name' => "{$name} Owner"]);
        $shop->forceFill(['owner_user_id' => $owner->id])->save();
        $cashier = User::factory()->forBookshop($shop)->inBranches($branch)->create(['role' => Roles::CASHIER, 'name' => "{$name} Cashier"]);

        return [$shop->fresh(), $owner, $cashier];
    }

    private function logs(string $event): \Illuminate\Support\Collection
    {
        return CommunicationLog::where('event', $event)->get();
    }

    public function test_activation_sends_one_welcome_email_to_the_owner(): void
    {
        [$pending, $pendingOwner] = $this->bookshop('Nyeri Learning', Bookshop::STATUS_PENDING);
        $this->actingAs($this->platformOwner, 'sanctum');
        $this->postJson("/api/platform/bookshops/{$pending->id}/approve")->assertOk();

        $welcome = $this->logs('welcome');
        $this->assertCount(1, $welcome);
        $this->assertSame($pendingOwner->email, $welcome[0]->recipient_email);
        $this->assertSame('sent', $welcome[0]->status);
        $this->assertStringContainsString('Nyeri Learning has been approved', $welcome[0]->body);
        $this->assertStringContainsString('Welcome to', $welcome[0]->subject);
        $this->assertSame(1, $pendingOwner->notifications()->count(), 'An in-app copy lands in the notification panel.');

        // Repeating the same occurrence never sends again.
        app(\App\Services\CommunicationService::class)->notify('welcome', $pending, 'activation');
        $this->assertCount(1, $this->logs('welcome'));
    }

    public function test_suspended_users_can_sign_in_and_see_a_notice_but_cannot_operate(): void
    {
        DB::table('platform_settings')->insert(['key' => 'support_email', 'value' => json_encode('help@hekima.test'), 'created_at' => now(), 'updated_at' => now()]);
        $sale = DB::table('audit_logs')->count();
        $this->actingAs($this->platformOwner, 'sanctum');
        $this->postJson("/api/platform/bookshops/{$this->shop->id}/suspend", ['reason' => 'Billing review'])->assertOk()
            ->assertJsonPath('data.status', 'suspended');

        // Every active staff account is told, politely, with the reason and support contact.
        $suspended = $this->logs('bookshop_suspended');
        $this->assertEqualsCanonicalizing([$this->owner->email, $this->cashier->email], $suspended->pluck('recipient_email')->all());
        $this->assertStringContainsString('Billing review', $suspended[0]->body);
        $this->assertStringContainsString('help@hekima.test', $suspended[0]->body);

        auth()->forgetGuards();
        $this->postJson('/api/auth/login', ['email' => $this->cashier->email, 'password' => 'password'])->assertOk();
        $this->actingAs($this->cashier, 'sanctum');
        $this->getJson('/api/auth/me')->assertOk()
            ->assertJsonPath('data.bookshop.status', 'suspended')
            ->assertJsonPath('data.bookshop.suspension_reason', 'Billing review')
            ->assertJsonPath('data.bookshop.support_email', 'help@hekima.test');
        $this->getJson('/api/dashboard')->assertForbidden()->assertJsonPath('code', 'bookshop_suspended');
        $this->getJson('/api/notifications')->assertOk();
        $this->assertDatabaseHas('users', ['id' => $this->cashier->id, 'is_active' => true]);
        $this->assertGreaterThan($sale, DB::table('audit_logs')->count());

        // Reactivation restores access according to the subscription, and tells everyone once.
        $this->actingAs($this->platformOwner, 'sanctum');
        $this->postJson("/api/platform/bookshops/{$this->shop->id}/reactivate", ['note' => 'Resolved'])->assertOk();
        $this->assertCount(2, $this->logs('bookshop_reactivated'));
        $this->assertSame(BookshopSubscription::TRIALING, $this->shop->subscription()->first()->status);
        $this->actingAs($this->cashier, 'sanctum');
        $this->getJson('/api/auth/me')->assertJsonPath('data.bookshop.support_email', null);
        $this->getJson('/api/dashboard')->assertOk();
    }

    public function test_payment_confirmation_is_only_sent_for_reconciled_payments_and_only_once(): void
    {
        $plan = SubscriptionPlan::create(['code' => 'monthly', 'name' => 'Monthly', 'price' => 1500, 'currency' => 'KES', 'billing_interval' => 'monthly', 'is_active' => true]);
        $invoice = DB::table('platform_billing_invoices')->insertGetId(['bookshop_id' => $this->shop->id, 'subscription_plan_id' => $plan->id, 'account_number' => '100001', 'amount' => 1500,
            'currency' => 'KES', 'environment' => 'production', 'billing_months' => 1, 'status' => 'paid', 'period_starts_at' => now(), 'period_ends_at' => now()->addMonth(), 'created_at' => now(), 'updated_at' => now()]);
        $row = fn (string $status, string $code) => DB::table('saf_payments')->insertGetId(['bookshop_id' => $this->shop->id, 'invoice_id' => $invoice, 'account_number' => '100001', 'mpesa_receipt_number' => $code,
            'amount' => 1500, 'payment_channel' => 'paybill', 'environment' => 'production', 'verification_status' => $status, 'transaction_date' => now(), 'created_at' => now(), 'updated_at' => now()]);
        $pending = $row('pending', 'QK1PENDING');
        $unmatched = $row('unmatched', 'QK1UNMATCH');
        $reconciled = $row('reconciled', 'QK1APPLIED');
        $notifier = app(PaymentConfirmationNotifier::class);

        $notifier->send($pending);
        $notifier->send($unmatched);
        $this->assertCount(0, $this->logs('payment_confirmed'), 'Unverified or unapplied payments never produce a success email.');

        $notifier->send($reconciled);
        $notifier->send($reconciled);
        $sent = $this->logs('payment_confirmed');
        $this->assertCount(1, $sent);
        $this->assertSame($this->owner->email, $sent[0]->recipient_email);
        $this->assertStringContainsString('QK1APPLIED', $sent[0]->body);
    }

    public function test_reminders_are_sent_once_per_end_date_even_when_the_schedule_repeats(): void
    {
        [$farShop] = $this->bookshop('Far Trial Books');
        $farShop->subscription->forceFill(['trial_ends_at' => now()->addDays(10)])->save();
        $this->shop->subscription->forceFill(['trial_ends_at' => now()->addDays(2)])->save();
        [$paidShop, $paidOwner] = $this->bookshop('Paid Pages');
        $paidShop->subscription->forceFill(['status' => 'active', 'current_period_ends_at' => now()->addDays(5)])->save();

        Artisan::call('communications:subscription-reminders');
        Artisan::call('communications:subscription-reminders');
        $this->travel(2)->hours();
        Artisan::call('communications:subscription-reminders');

        $trial = $this->logs('trial_ending');
        $this->assertCount(1, $trial);
        $this->assertSame($this->owner->email, $trial[0]->recipient_email, 'Reminders go to owners, not cashiers.');
        $this->assertStringContainsString('2 day(s) left', $trial[0]->body);
        $this->assertCount(1, $this->logs('renewal_due'));
        $this->assertSame($paidOwner->email, $this->logs('renewal_due')[0]->recipient_email);

        // A new end date (for example after a trial extension) earns exactly one new reminder.
        $this->shop->subscription->forceFill(['trial_ends_at' => now()->addDays(3)])->save();
        Artisan::call('communications:subscription-reminders');
        Artisan::call('communications:subscription-reminders');
        $this->assertCount(2, $this->logs('trial_ending'));
    }

    public function test_expiry_and_renewal_invoices_notify_once(): void
    {
        $plan = SubscriptionPlan::create(['code' => 'monthly', 'name' => 'Monthly', 'price' => 1500, 'currency' => 'KES', 'billing_interval' => 'monthly', 'is_active' => true]);
        $this->shop->subscription->forceFill(['status' => 'active', 'subscription_plan_id' => $plan->id, 'current_period_ends_at' => now()->addDays(3)])->save();
        Artisan::call('billing:generate-renewals');
        Artisan::call('billing:generate-renewals');
        $due = $this->logs('payment_due');
        $this->assertCount(1, $due);
        $this->assertStringContainsString('Paybill 152451', $due[0]->body);

        $this->travel(4)->days();
        Artisan::call('billing:expire-subscriptions');
        Artisan::call('billing:expire-subscriptions');
        $this->assertCount(1, $this->logs('subscription_expired'));
    }

    public function test_announcements_reach_only_the_targeted_bookshops_and_groups(): void
    {
        [$otherShop, $otherOwner, $otherCashier] = $this->bookshop('Mombasa Page Turners');
        [, $thirdOwner] = $this->bookshop('Eldoret Scholars');
        User::factory()->forBookshop($this->shop)->create(['role' => Roles::CASHIER, 'is_active' => false, 'email' => 'inactive@example.test']);
        User::factory()->forBookshop($this->shop)->create(['role' => Roles::CUSTOMER, 'email' => 'customer@example.test']);
        $this->actingAs($this->platformOwner, 'sanctum');

        $this->postJson('/api/platform/communications/announcements/audience', ['audience' => 'selected', 'bookshop_ids' => [$this->shop->id, $otherShop->id], 'recipients' => 'staff'])
            ->assertOk()->assertJsonPath('data.bookshops', 2)->assertJsonPath('data.recipients', 4);

        $payload = ['subject' => 'Maintenance on Sunday', 'body' => "Hello {name},\n\n{bookshop} will be read-only from 2am to 3am.", 'category' => 'maintenance',
            'audience' => 'selected', 'bookshop_ids' => [$this->shop->id, $otherShop->id], 'recipients' => 'staff', 'idempotency_key' => 'announce-key-1'];
        $this->postJson('/api/platform/communications/announcements', $payload)->assertCreated()->assertJsonPath('data.recipient_count', 4);
        $this->postJson('/api/platform/communications/announcements', $payload)->assertOk()->assertJsonPath('duplicate', true);

        $recipients = $this->logs('announcement')->pluck('recipient_email')->all();
        $this->assertEqualsCanonicalizing([$this->owner->email, $this->cashier->email, $otherOwner->email, $otherCashier->email], $recipients);
        $this->assertNotContains($thirdOwner->email, $recipients);
        $this->assertNotContains('inactive@example.test', $recipients);
        $this->assertNotContains('customer@example.test', $recipients);
        $this->assertStringContainsString('Kisumu Readers will be read-only', CommunicationLog::where('recipient_email', $this->owner->email)->value('body'));
        $this->assertDatabaseHas('audit_logs', ['action' => 'platform.announcement_sent']);

        // Owners-only to every bookshop.
        $this->postJson('/api/platform/communications/announcements', [...$payload, 'audience' => 'all', 'bookshop_ids' => [], 'recipients' => 'owners', 'idempotency_key' => 'announce-key-2'])
            ->assertCreated()->assertJsonPath('data.recipient_count', 3);
    }

    public function test_failed_deliveries_are_logged_and_can_be_retried(): void
    {
        config(['mail.default' => 'smtp', 'mail.mailers.smtp.host' => '127.0.0.1', 'mail.mailers.smtp.port' => 9, 'mail.mailers.smtp.timeout' => 1]);
        $this->actingAs($this->platformOwner, 'sanctum');
        $this->postJson('/api/platform/communications/announcements', ['subject' => 'New feature', 'body' => 'Stock taking is here.', 'category' => 'feature',
            'audience' => 'selected', 'bookshop_ids' => [$this->shop->id], 'recipients' => 'owners', 'idempotency_key' => 'announce-fail-1'])->assertCreated();

        $failed = CommunicationLog::sole();
        $this->assertSame('failed', $failed->status);
        $this->assertSame(1, $failed->attempts);
        $this->assertNotEmpty($failed->last_error);
        $this->getJson('/api/platform/communications/summary')->assertOk()->assertJsonPath('data.failed', 1);
        $this->getJson('/api/platform/communications/logs?status=failed')->assertOk()->assertJsonPath('data.0.id', $failed->id);

        config(['mail.default' => 'array']);
        $this->postJson("/api/platform/communications/logs/{$failed->id}/retry")->assertOk();
        $this->assertSame('sent', $failed->fresh()->status);
        $this->assertSame(2, $failed->fresh()->attempts);
        $this->postJson("/api/platform/communications/logs/{$failed->id}/retry")->assertStatus(422);
        $this->assertDatabaseHas('audit_logs', ['action' => 'platform.communication_retried']);
    }

    public function test_the_send_job_never_delivers_a_message_twice(): void
    {
        Notification::fake();
        app(\App\Services\CommunicationService::class)->notify('welcome', $this->shop, 'activation');
        $log = CommunicationLog::sole();
        (new SendCommunication($log->id))->handle();
        (new SendCommunication($log->id))->handle();
        Notification::assertSentOnDemandTimes(\App\Notifications\PlatformMessage::class, 1);
        Notification::assertSentTo($this->owner, AccountNotification::class);
    }

    public function test_templates_can_be_edited_disabled_and_reset(): void
    {
        $this->actingAs($this->platformOwner, 'sanctum');
        $this->getJson('/api/platform/communications/templates')->assertOk()->assertJsonFragment(['key' => 'welcome', 'customized' => false]);
        $this->putJson('/api/platform/communications/templates/welcome', ['subject' => 'Karibu {bookshop}', 'body' => 'Hello {name}, welcome aboard.', 'is_enabled' => true])->assertOk();
        app(\App\Services\CommunicationService::class)->notify('welcome', $this->shop, 'custom');
        $this->assertSame('Karibu Kisumu Readers', CommunicationLog::sole()->subject);

        $this->putJson('/api/platform/communications/templates/welcome', ['subject' => 'Off', 'body' => 'Off', 'is_enabled' => false])->assertOk();
        $this->assertSame(0, app(\App\Services\CommunicationService::class)->notify('welcome', $this->shop, 'while-disabled'));

        $this->deleteJson('/api/platform/communications/templates/welcome')->assertOk()->assertJsonPath('data.customized', false);
        $this->putJson('/api/platform/communications/templates/not_a_template', ['subject' => 'x', 'body' => 'x', 'is_enabled' => true])->assertNotFound();
        $this->putJson('/api/platform/communications/templates/welcome', ['subject' => '', 'body' => 'x', 'is_enabled' => true])->assertUnprocessable();
    }

    public function test_only_the_platform_owner_can_use_communication(): void
    {
        $admin = User::factory()->create(['role' => Roles::PLATFORM_ADMIN]);
        foreach ([$admin, $this->owner] as $user) {
            $this->actingAs($user, 'sanctum');
            $this->getJson('/api/platform/communications/logs')->assertForbidden();
            $this->getJson('/api/platform/communications/templates')->assertForbidden();
            $this->postJson('/api/platform/communications/announcements', ['subject' => 'x', 'body' => 'x', 'category' => 'general', 'audience' => 'all', 'recipients' => 'owners', 'idempotency_key' => 'nope-key-1'])->assertForbidden();
        }
        $this->assertSame(0, CommunicationLog::count());
    }
}
