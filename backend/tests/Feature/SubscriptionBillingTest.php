<?php

namespace Tests\Feature;

use App\Models\Bookshop;
use App\Models\BookshopSubscription;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Services\PlatformBillingInvoiceService;
use App\Services\PlatformPaymentSettlementService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Validation\ValidationException;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class SubscriptionBillingTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;

    private User $operator;

    private BookshopSubscription $subscription;

    private SubscriptionPlan $plan;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now()->startOfSecond());
        config(['services.mpesa.environment' => 'production', 'services.mpesa.shortcode' => '153283',
            'services.mpesa.consumer_key' => 'test-key', 'services.mpesa.consumer_secret' => 'test-secret',
            'services.mpesa.passkey' => 'test-passkey', 'services.mpesa.callback_url' => 'https://merchant.example.test/api/billing/mpesa/stk/callback']);
        Http::preventStrayRequests();
        $shop = Bookshop::factory()->create();
        $this->owner = User::factory()->forBookshop($shop)->create(['role' => 'bookshop_owner']);
        $shop->forceFill(['owner_user_id' => $this->owner->id])->save();
        $this->operator = User::factory()->create(['role' => 'platform_owner']);
        $this->plan = SubscriptionPlan::create(['code' => 'paid', 'name' => 'Paid', 'price' => 1000, 'currency' => 'KES', 'billing_interval' => 'monthly', 'is_active' => true]);
        $this->subscription = new BookshopSubscription(['subscription_plan_id' => $this->plan->id, 'status' => 'active',
            'current_period_starts_at' => now()->subMonth(), 'current_period_ends_at' => now()->addDays(10)]);
        $this->subscription->bookshop_id = $shop->id;
        $this->subscription->save();
    }

    private function invoice(): object
    {
        return app(PlatformBillingInvoiceService::class)->create($this->owner->bookshop_id, $this->plan);
    }

    private function settle(object $invoice, string $receipt, float $amount): object
    {
        return app(PlatformPaymentSettlementService::class)->settle($receipt, $invoice->account_number,
            config('services.mpesa.shortcode'), $amount, now(), 'paybill', [
                'environment' => $invoice->environment, 'verified_by' => $this->operator->id, 'statement_reference' => 'merchant-statement-1',
            ]);
    }

    private function evidence(string $receipt = 'TESTRECEIPT1', int $amount = 1000): array
    {
        return ['verified_receipt' => $receipt, 'verified_amount' => $amount, 'verified_at' => now()->toIso8601String(),
            'verified_shortcode' => config('services.mpesa.shortcode'), 'statement_reference' => 'statement-row-1', 'statement_verified' => true];
    }

    private function gateway(string $code = '0', string $queryCheckout = 'checkout-1'): void
    {
        Http::fake([
            '*/oauth/*' => Http::response(['access_token' => 'fake-token']),
            '*/mpesa/stkpush/v1/processrequest' => Http::response(['ResponseCode' => '0', 'CheckoutRequestID' => 'checkout-1', 'MerchantRequestID' => 'merchant-1']),
            '*/mpesa/stkpushquery/v1/query' => Http::response(['ResponseCode' => '0', 'ResultCode' => $code, 'CheckoutRequestID' => $queryCheckout]),
        ]);
    }

    public function test_invoice_creation_is_idempotent_and_globally_unique(): void
    {
        $a = $this->invoice();
        $this->assertMatchesRegularExpression('/^[0-9]{6}$/', $a->account_number);
        $this->assertSame($a->id, $this->invoice()->id);
        $this->settle($a, 'UNIQUEPAY1', 1000);
        $b = $this->invoice();
        $this->assertNotSame($a->account_number, $b->account_number);
        $this->assertSame(1, $a->billing_months);
    }

    public static function periods(): array
    {
        return [['monthly', 1], ['quarterly', 3], ['annual', 12]];
    }

    #[DataProvider('periods')]
    public function test_partial_payment_and_early_renewal_preserve_existing_access(string $interval, int $months): void
    {
        $this->plan->update(['billing_interval' => $interval]);
        $invoice = $this->invoice();
        $expiry = $this->subscription->current_period_ends_at->copy();
        $start = $this->subscription->current_period_starts_at->copy();
        $this->assertSame('partially_paid', $this->settle($invoice, 'PARTIALPAY1', 400)->status);
        $this->assertTrue($this->subscription->fresh()->current_period_ends_at->equalTo($expiry));
        // Changing a plan after invoicing cannot alter the purchased duration.
        $this->plan->update(['billing_interval' => 'monthly']);
        $this->assertSame('paid', $this->settle($invoice, 'PARTIALPAY2', 600)->status);
        $this->assertTrue($this->subscription->fresh()->current_period_ends_at->equalTo($expiry->addMonthsNoOverflow($months)));
        $this->assertTrue($this->subscription->fresh()->current_period_starts_at->equalTo($start));
        $this->settle($invoice, 'PARTIALPAY2', 600);
        $this->assertDatabaseCount('subscription_events', 1);
    }

    public function test_expired_renewal_starts_now_and_month_end_does_not_overflow(): void
    {
        $this->travelTo(Carbon::parse('2027-01-31 12:00:00'));
        $this->subscription->update(['current_period_ends_at' => now()->subDays(3), 'status' => 'expired']);
        $this->settle($this->invoice(), 'EXPIREDPAY1', 1000);
        $this->assertSame('2027-02-28', $this->subscription->fresh()->current_period_ends_at->toDateString());
        $this->assertSame('active', $this->subscription->fresh()->status);
    }

    public function test_overpayments_including_late_payments_are_recorded_without_extra_access(): void
    {
        $invoice = $this->invoice();
        $this->settle($invoice, 'OVERPAY001', 1300);
        $expiry = $this->subscription->fresh()->current_period_ends_at;
        $this->settle($invoice, 'OVERPAY002', 200);
        $this->settle($invoice, 'OVERPAY002', 200);
        $this->assertSame(500.0, (float) DB::table('platform_payment_reconciliation_items')->where('source', 'overpayment')->sum('amount'));
        $this->assertTrue($this->subscription->fresh()->current_period_ends_at->equalTo($expiry));
        $this->assertDatabaseCount('subscription_events', 1);
    }

    public function test_receipt_cannot_be_reused_for_another_invoice(): void
    {
        $a = $this->invoice();
        $this->settle($a, 'REUSEDPAY1', 1000);
        $b = $this->invoice();
        $this->expectException(ValidationException::class);
        $this->settle($b, 'REUSEDPAY1', 1000);
    }

    public function test_unverified_service_call_cannot_settle(): void
    {
        $invoice = $this->invoice();
        $this->expectException(ValidationException::class);
        app(PlatformPaymentSettlementService::class)->settle('UNTRUSTED1', $invoice->account_number, '153283', 1000, now(), 'paybill');
    }

    public function test_unsigned_callbacks_and_failed_query_never_credit_funds(): void
    {
        $invoice = $this->invoice();
        $this->gateway('1032');
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/billing/invoices/{$invoice->id}/stk", ['phone' => '254712345678', 'amount' => 1000])->assertAccepted();
        $attempt = DB::table('platform_billing_payments')->first();
        $this->postJson('/api/billing/mpesa/stk/callback', ['Body' => ['stkCallback' => ['CheckoutRequestID' => 'checkout-1', 'ResultCode' => 0,
            'CallbackMetadata' => ['Item' => [['Name' => 'Amount', 'Value' => 100000]]]]]])->assertOk();
        $this->assertDatabaseHas('platform_billing_payments', ['id' => $attempt->id, 'status' => 'pending']);
        $this->actingAs($this->operator, 'sanctum')->postJson("/api/platform/billing/stk-attempts/{$attempt->id}/confirm", $this->evidence())->assertUnprocessable();
        $this->assertDatabaseHas('platform_billing_invoices', ['id' => $invoice->id, 'status' => 'pending']);
        $this->assertDatabaseCount('subscription_events', 0);
    }

    public function test_sandbox_full_stk_workflow_is_reconciled_but_never_activates_subscription(): void
    {
        config(['services.mpesa.environment' => 'sandbox', 'services.mpesa.shortcode' => '174379']);
        $this->gateway();
        $this->subscription->update(['status' => 'expired', 'current_period_ends_at' => now()->subDay()]);
        $invoice = $this->invoice();
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/billing/invoices/{$invoice->id}/stk", ['phone' => '254712345678', 'amount' => 1000])->assertAccepted();
        $this->postJson('/api/billing/mpesa/stk/callback', ['Body' => ['stkCallback' => ['CheckoutRequestID' => 'checkout-1', 'ResultCode' => 0]]])->assertOk();
        $attempt = DB::table('platform_billing_payments')->first();
        $this->travel(3)->minutes();
        $this->artisan('billing:reconcile-stk')->assertSuccessful();
        $this->assertDatabaseHas('platform_billing_payments', ['id' => $attempt->id, 'status' => 'awaiting_verification']);
        $this->actingAs($this->operator, 'sanctum')->postJson("/api/platform/billing/stk-attempts/{$attempt->id}/confirm", $this->evidence())->assertOk()->assertJsonPath('invoice_status', 'paid');
        $this->assertSame('expired', $this->subscription->fresh()->status);
        $this->assertDatabaseCount('subscription_events', 0);
        Http::assertSent(fn ($r) => str_contains($r->url(), 'sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest') && $r['AccountReference'] === $invoice->account_number && $r['Amount'] === 1000);
        $this->assertDatabaseHas('platform_billing_payments', ['status' => 'confirmed', 'environment' => 'sandbox']);
    }

    public function test_production_stk_requires_statement_attestation_and_is_idempotent(): void
    {
        $this->gateway();
        $invoice = $this->invoice();
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/billing/invoices/{$invoice->id}/stk", ['phone' => '254712345678', 'amount' => 1000])->assertAccepted();
        $attempt = DB::table('platform_billing_payments')->first();
        $url = "/api/platform/billing/stk-attempts/{$attempt->id}/confirm";
        $this->actingAs($this->operator, 'sanctum')->postJson($url, [...$this->evidence(), 'statement_verified' => false])->assertUnprocessable();
        $this->postJson($url, [...$this->evidence(), 'verified_amount' => 999])->assertUnprocessable();
        $this->postJson($url, [...$this->evidence(), 'verified_shortcode' => '174379'])->assertUnprocessable();
        $this->postJson($url, $this->evidence())->assertOk();
        $this->postJson($url, $this->evidence())->assertOk();
        $this->assertDatabaseCount('subscription_events', 1);
    }

    public function test_c2b_statement_values_must_match_and_tenant_cannot_reconcile(): void
    {
        $invoice = $this->invoice();
        $this->postJson('/api/billing/mpesa/c2b/confirmation', ['TransID' => 'C2BRECEIPT1', 'BillRefNumber' => $invoice->account_number,
            'BusinessShortCode' => '153283', 'TransAmount' => '1000.00'])->assertOk();
        $item = DB::table('platform_payment_reconciliation_items')->first();
        $payload = [...$this->evidence('C2BRECEIPT1'), 'verified_account' => $invoice->account_number];
        $url = "/api/platform/billing/reconciliation/{$item->id}/confirm";
        $this->actingAs($this->owner, 'sanctum')->postJson($url, $payload)->assertForbidden();
        $this->assertDatabaseCount('subscription_events', 0);
        $this->actingAs($this->operator, 'sanctum')->postJson($url, [...$payload, 'verified_account' => '999999'])->assertUnprocessable();
        $this->postJson($url, $payload)->assertOk();
        $this->postJson($url, $payload)->assertOk();
        $this->assertDatabaseCount('subscription_events', 1);
    }

    public function test_sandbox_payment_cannot_cross_to_production_invoice_or_installation(): void
    {
        $invoice = $this->invoice();
        config(['services.mpesa.environment' => 'sandbox', 'services.mpesa.shortcode' => '174379']);
        $this->expectException(ValidationException::class);
        app(PlatformPaymentSettlementService::class)->settle('SANDBOXPAY1', $invoice->account_number, '174379', 1000, now(), 'stk',
            ['environment' => 'sandbox', 'verified_by' => $this->operator->id, 'statement_reference' => 'sandbox']);
    }

    public function test_tenant_isolation_and_staff_restrictions(): void
    {
        $invoice = $this->invoice();
        $other = User::factory()->forBookshop(Bookshop::factory()->create())->create(['role' => 'bookshop_owner']);
        $this->actingAs($other, 'sanctum')->getJson("/api/billing/invoices/{$invoice->id}")->assertNotFound();
        $this->postJson("/api/billing/invoices/{$invoice->id}/stk", ['phone' => '254712345678', 'amount' => 1000])->assertNotFound();
        $this->getJson('/api/billing')->assertOk()->assertJsonPath('invoices.total', 0);
        $this->getJson('/api/platform/billing/invoices')->assertForbidden();
        $staff = User::factory()->forBookshop($this->owner->bookshop_id)->create(['role' => 'cashier']);
        $this->actingAs($staff, 'sanctum')->postJson('/api/billing/invoices', ['plan_id' => $this->plan->id])->assertForbidden();
        Http::assertNothingSent();
    }

    public function test_stk_rejects_overbalance_and_duplicate_pending_requests(): void
    {
        $invoice = $this->invoice();
        $this->gateway();
        $this->actingAs($this->owner, 'sanctum');
        $url = "/api/billing/invoices/{$invoice->id}/stk";
        $this->postJson($url, ['phone' => '254712345678', 'amount' => 1001])->assertUnprocessable();
        $this->postJson($url, ['phone' => '254712345678', 'amount' => 400])->assertAccepted();
        $this->postJson($url, ['phone' => '254712345678', 'amount' => 400])->assertUnprocessable();
        $this->assertDatabaseCount('platform_billing_payments', 1);
    }

    public function test_renewal_scheduler_is_repeatable(): void
    {
        $this->subscription->update(['current_period_ends_at' => now()->addDays(5)]);
        $this->artisan('billing:generate-renewals')->assertSuccessful();
        $this->artisan('billing:generate-renewals')->assertSuccessful();
        $this->assertDatabaseCount('platform_billing_invoices', 1);
    }

    public function test_sandbox_settlement_is_rejected_on_a_production_installation(): void
    {
        config(['services.mpesa.environment' => 'sandbox', 'services.mpesa.shortcode' => '174379']);
        $invoice = $this->invoice();
        $this->app->instance('env', 'production');
        try {
            $this->actingAs($this->operator, 'sanctum')->postJson('/api/platform/billing/statement-payments', [
                ...$this->evidence(), 'verified_account' => $invoice->account_number,
            ])->assertUnprocessable();
            $this->assertDatabaseHas('platform_billing_invoices', ['id' => $invoice->id, 'status' => 'pending']);
        } finally {
            $this->app->instance('env', 'testing');
        }
    }

    public function test_unknown_provider_outcome_blocks_duplicate_prompt_until_operator_checks_statement(): void
    {
        $invoice = $this->invoice();
        Http::fake(fn () => throw new ConnectionException('timeout'));
        $this->actingAs($this->owner, 'sanctum');
        $url = "/api/billing/invoices/{$invoice->id}/stk";
        $this->postJson($url, ['phone' => '254712345678', 'amount' => 1000])->assertStatus(502);
        $this->postJson($url, ['phone' => '254712345678', 'amount' => 1000])->assertUnprocessable();
        $attempt = DB::table('platform_billing_payments')->first();
        $this->assertSame('unknown', $attempt->status);
        $release = "/api/platform/billing/stk-attempts/{$attempt->id}/resolve-unknown";
        $this->postJson($release, ['statement_reference' => 'statement', 'no_payment_verified' => true])->assertForbidden();
        $this->actingAs($this->operator, 'sanctum')->postJson($release, ['statement_reference' => 'statement', 'no_payment_verified' => false])->assertUnprocessable();
        $this->postJson($release, ['statement_reference' => 'statement', 'no_payment_verified' => true])->assertOk();
        $this->assertDatabaseHas('platform_billing_payments', ['id' => $attempt->id, 'status' => 'failed']);
        $this->assertDatabaseCount('subscription_events', 0);
    }

    public function test_missing_callback_can_be_recovered_only_by_independent_statement(): void
    {
        $invoice = $this->invoice();
        $payload = [...$this->evidence('STATEMENT1'), 'verified_account' => $invoice->account_number];
        $this->actingAs($this->owner, 'sanctum')->postJson('/api/platform/billing/statement-payments', $payload)->assertForbidden();
        $this->actingAs($this->operator, 'sanctum')->postJson('/api/platform/billing/statement-payments', $payload)->assertOk();
        $this->postJson('/api/platform/billing/statement-payments', $payload)->assertOk();
        $this->assertDatabaseCount('subscription_events', 1);
        $this->assertDatabaseCount('platform_payment_reconciliation_items', 1);
    }

    public function test_malformed_callback_and_forged_failure_do_not_change_state(): void
    {
        $invoice = $this->invoice();
        $this->gateway();
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/billing/invoices/{$invoice->id}/stk", ['phone' => '254712345678', 'amount' => 1000])->assertAccepted();
        $this->postJson('/api/billing/mpesa/stk/callback', ['Body' => ['stkCallback' => ['CheckoutRequestID' => ['malformed']]]])->assertOk();
        $this->postJson('/api/billing/mpesa/stk/callback', ['Body' => ['stkCallback' => ['CheckoutRequestID' => 'checkout-1', 'ResultCode' => 1032]]])->assertOk();
        $this->postJson('/api/billing/mpesa/c2b/confirmation', ['TransID' => 'BADVALUE1', 'TransAmount' => -1])->assertOk();
        $this->assertDatabaseHas('platform_billing_payments', ['checkout_request_id' => 'checkout-1', 'status' => 'pending']);
        $this->assertDatabaseCount('platform_payment_reconciliation_items', 0);
    }

    public function test_paid_plan_creation_requires_platform_permission_and_validates_period(): void
    {
        $body = ['name' => 'Quarterly', 'code' => 'quarterly', 'price' => 2500, 'billing_interval' => 'quarterly'];
        $this->actingAs($this->owner, 'sanctum')->postJson('/api/platform/billing/plans', $body)->assertForbidden();
        $this->actingAs($this->operator, 'sanctum')->postJson('/api/platform/billing/plans', [...$body, 'billing_interval' => 'daily'])->assertUnprocessable();
        $this->postJson('/api/platform/billing/plans', $body)->assertCreated()->assertJsonPath('data.currency', 'KES');
        $this->assertDatabaseHas('audit_logs', ['action' => 'billing.plan_created']);
        $this->actingAs($this->owner, 'sanctum')->postJson('/api/billing/invoices', ['plan_id' => $this->plan->id])->assertCreated();
    }

    public function test_billing_remains_accessible_after_subscription_expiry(): void
    {
        $this->subscription->update(['current_period_ends_at' => now()->subSecond()]);
        $this->actingAs($this->owner, 'sanctum')->getJson('/api/books')->assertForbidden()->assertJsonPath('code', 'subscription_expired');
        $this->getJson('/api/billing')->assertOk();
        $this->artisan('billing:expire-subscriptions')->assertSuccessful();
        $this->artisan('billing:expire-subscriptions')->assertSuccessful();
        $this->assertSame('expired', $this->subscription->fresh()->status);
        $this->assertDatabaseCount('subscription_events', 1);
        $this->settle($this->invoice(), 'RECOVERPAY1', 1000);
        $this->getJson('/api/books')->assertOk();
    }

    public function test_query_success_without_statement_does_not_settle(): void
    {
        $invoice = $this->invoice();
        $this->gateway();
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/billing/invoices/{$invoice->id}/stk", ['phone' => '254712345678', 'amount' => 1000])->assertAccepted();
        $this->travel(3)->minutes();
        $this->artisan('billing:reconcile-stk')->assertSuccessful();
        $this->assertDatabaseHas('platform_billing_invoices', ['id' => $invoice->id, 'status' => 'pending']);
        $this->assertDatabaseCount('subscription_events', 0);
        $this->assertDatabaseMissing('platform_billing_payments', ['status' => 'confirmed']);
    }

    public function test_platform_admin_can_view_billing_but_cannot_settle_or_add_plans(): void
    {
        $invoice = $this->invoice();
        $admin = User::factory()->create(['role' => 'platform_admin']);
        $this->actingAs($admin, 'sanctum')->getJson('/api/platform/billing/invoices')->assertOk()->assertJsonPath('data.0.id', $invoice->id);
        $this->getJson('/api/platform/billing/stk-attempts')->assertOk();
        $this->getJson('/api/platform/billing/reconciliation')->assertOk();
        $this->postJson('/api/platform/billing/statement-payments', [...$this->evidence(), 'verified_account' => $invoice->account_number])->assertForbidden();
        $this->postJson('/api/platform/billing/plans', ['code' => 'untrusted', 'name' => 'Untrusted', 'price' => 1, 'billing_interval' => 'monthly'])->assertForbidden();
    }

    public function test_remaining_trial_is_preserved_when_buying_a_subscription(): void
    {
        $this->subscription->update(['status' => 'trialing', 'trial_ends_at' => now()->addDays(14), 'current_period_ends_at' => null]);
        $invoice = $this->invoice();
        $this->settle($invoice, 'TRIALPAY01', 1000);
        $this->assertTrue($this->subscription->fresh()->current_period_ends_at->equalTo(now()->addDays(14)->addMonthNoOverflow()));
    }

    public function test_a_success_response_for_a_different_checkout_cannot_settle(): void
    {
        $this->gateway('0', 'another-checkout');
        $invoice = $this->invoice();
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/billing/invoices/{$invoice->id}/stk", ['phone' => '254712345678', 'amount' => 1000])->assertAccepted();
        $attempt = DB::table('platform_billing_payments')->first();
        $this->actingAs($this->operator, 'sanctum')->postJson("/api/platform/billing/stk-attempts/{$attempt->id}/confirm", $this->evidence())->assertUnprocessable();
        $this->assertDatabaseCount('subscription_events', 0);
    }

    public function test_legacy_provenance_cannot_be_silently_settled(): void
    {
        $invoice = $this->invoice();
        DB::table('platform_billing_invoices')->where('id', $invoice->id)->update(['environment' => 'legacy']);
        $this->actingAs($this->operator, 'sanctum')->postJson('/api/platform/billing/statement-payments', [...$this->evidence(), 'verified_account' => $invoice->account_number])->assertUnprocessable();
        $this->assertDatabaseCount('subscription_events', 0);
    }

    public function test_exhausted_six_digit_accounts_fail_without_reusing_an_account(): void
    {
        DB::table('platform_billing_sequences')->where('id', 1)->update(['next_account' => 999999]);
        $invoice = $this->invoice();
        $this->assertSame('999999', $invoice->account_number);
        $this->settle($invoice, 'LASTACCPAY', 1000);
        $this->expectException(ValidationException::class);
        $this->invoice();
    }

    public function test_gateway_errors_never_return_credentials_to_the_browser(): void
    {
        $invoice = $this->invoice();
        Http::fake(fn () => throw new \RuntimeException('private-consumer-secret private-passkey'));
        $response = $this->actingAs($this->owner, 'sanctum')->postJson("/api/billing/invoices/{$invoice->id}/stk", ['phone' => '254712345678', 'amount' => 1000])->assertStatus(502);
        $this->assertStringNotContainsString('private-consumer-secret', $response->getContent());
        $this->assertStringNotContainsString('private-passkey', $response->getContent());
    }

    public function test_settlement_refuses_a_tenant_as_the_statement_verifier(): void
    {
        $invoice = $this->invoice();
        $this->expectException(ValidationException::class);
        app(PlatformPaymentSettlementService::class)->settle('TENANTPAY1', $invoice->account_number, '153283', 1000, now(), 'paybill',
            ['environment' => 'production', 'verified_by' => $this->owner->id, 'statement_reference' => 'untrusted']);
    }

    public function test_overpayment_refund_review_is_audited_and_never_changes_access(): void
    {
        $invoice = $this->invoice();
        $this->settle($invoice, 'REFUNDPAY1', 1300);
        $expiry = $this->subscription->fresh()->current_period_ends_at;
        $item = DB::table('platform_payment_reconciliation_items')->where('source', 'overpayment')->first();
        $url = "/api/platform/billing/reconciliation/{$item->id}/resolve-overpayment";
        $body = ['refund_reference' => 'merchant-refund-row-1', 'refund_verified' => true];
        $this->actingAs($this->owner, 'sanctum')->postJson($url, $body)->assertForbidden();
        $this->actingAs($this->operator, 'sanctum')->postJson($url, [...$body, 'refund_verified' => false])->assertUnprocessable();
        $this->postJson($url, $body)->assertOk();
        $this->postJson($url, $body)->assertOk();
        $row = DB::table('platform_payment_reconciliation_items')->where('id', $item->id)->first();
        $this->assertSame('resolved', $row->status);
        $this->assertSame($this->operator->id, json_decode($row->payload, true)['resolved_by']);
        $this->assertTrue($this->subscription->fresh()->current_period_ends_at->equalTo($expiry));
        $this->assertDatabaseCount('subscription_events', 1);
    }

    public function test_payment_does_not_approve_or_unsuspend_a_bookshop(): void
    {
        $shop = Bookshop::findOrFail($this->owner->bookshop_id);
        $shop->forceFill(['status' => Bookshop::STATUS_SUSPENDED, 'suspended_at' => now()])->save();
        $this->settle($this->invoice(), 'SUSPENDPAY1', 1000);
        $this->assertSame(Bookshop::STATUS_SUSPENDED, $shop->fresh()->status);
        $this->actingAs($this->owner, 'sanctum')->getJson('/api/books')->assertForbidden()->assertJsonPath('code', 'bookshop_suspended');
    }

    public function test_sandbox_instructions_never_show_live_paybill(): void
    {
        config(['services.mpesa.environment' => 'sandbox', 'services.mpesa.shortcode' => '174379']);
        $invoice = $this->invoice();
        $this->actingAs($this->owner, 'sanctum')->getJson('/api/billing')->assertOk()->assertJsonPath('paybill', '174379')->assertJsonPath('test_mode', true);
        $this->getJson("/api/billing/invoices/{$invoice->id}")->assertOk()->assertJsonPath('paybill', '174379')->assertJsonPath('environment', 'sandbox')->assertJsonPath('can_pay', true);
        config(['services.mpesa.environment' => 'production', 'services.mpesa.shortcode' => '153283']);
        $this->getJson("/api/billing/invoices/{$invoice->id}")->assertOk()->assertJsonPath('can_pay', false);
    }

    public function test_plan_edits_do_not_reprice_or_extend_issued_invoices(): void
    {
        $invoice = $this->invoice();
        $this->actingAs($this->operator, 'sanctum')->patchJson("/api/platform/billing/plans/{$this->plan->id}", ['price' => 9000, 'billing_interval' => 'annual'])->assertOk();
        $row = DB::table('platform_billing_invoices')->where('id', $invoice->id)->first();
        $this->assertSame(1000.0, (float) $row->amount);
        $this->assertSame(1, (int) $row->billing_months);
        $this->settle($invoice, 'EDITEDPAY1', 1000);
        $this->assertTrue($this->subscription->fresh()->current_period_ends_at->equalTo(now()->addDays(10)->addMonthNoOverflow()));
        $this->actingAs($this->owner, 'sanctum')->patchJson("/api/platform/billing/plans/{$this->plan->id}", ['price' => 1])->assertForbidden();
    }

    public function test_platform_ledger_exposes_audit_evidence_only_to_platform_roles(): void
    {
        $invoice = $this->invoice();
        $this->settle($invoice, 'AUDITPAY01', 1000);
        $this->actingAs($this->owner, 'sanctum')->getJson('/api/platform/billing/payments')->assertForbidden();
        $this->actingAs($this->operator, 'sanctum')->getJson('/api/platform/billing/payments?environment=production')
            ->assertOk()->assertJsonPath('data.0.statement_reference', 'merchant-statement-1')->assertJsonPath('data.0.verified_by', $this->operator->id);
        $this->getJson('/api/platform/billing/payments?environment=sandbox')->assertOk()->assertJsonPath('total', 0);
        $this->getJson('/api/platform/audit-logs')->assertOk()->assertJsonFragment(['action' => 'billing.payment_verified']);
        $this->getJson('/api/platform/billing/subscriptions')->assertOk()->assertJsonPath('data.0.bookshop_id', $this->owner->bookshop_id);
    }

    public function test_subscription_expiry_filters_and_remaining_days(): void
    {
        $this->subscription->update(['current_period_ends_at' => now()->addDays(3)]);
        $this->actingAs($this->operator, 'sanctum')->getJson('/api/platform/billing/subscriptions?state=upcoming')->assertOk()->assertJsonPath('total', 1)->assertJsonPath('data.0.days_remaining', 3);
        $this->getJson('/api/platform/billing/subscriptions?state=expired')->assertOk()->assertJsonPath('total', 0);
        $this->subscription->update(['status' => 'expired', 'current_period_ends_at' => now()->subDay()]);
        $this->getJson('/api/platform/billing/subscriptions?state=expired')->assertOk()->assertJsonPath('total', 1);
    }

    public static function terminalOutcomes(): array
    {
        return [['1032', 'cancelled'], ['1037', 'timed_out'], ['2001', 'failed']];
    }

    #[DataProvider('terminalOutcomes')]
    public function test_provider_verified_terminal_outcomes_allow_retry_without_credit(string $code, string $status): void
    {
        $invoice = $this->invoice();
        $this->gateway($code);
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/billing/invoices/{$invoice->id}/stk", ['phone' => '254712345678', 'amount' => 1000])->assertAccepted();
        $this->travel(3)->minutes();
        $this->artisan('billing:reconcile-stk')->assertSuccessful();
        $this->assertDatabaseHas('platform_billing_payments', ['checkout_request_id' => 'checkout-1', 'status' => $status]);
        $this->assertDatabaseCount('subscription_events', 0);
    }

    public function test_sandbox_cli_requires_explicit_confirmation_and_never_exposes_oauth_token(): void
    {
        $this->artisan('billing:sandbox-check')->assertFailed();
        Http::assertNothingSent();
        config(['services.mpesa.environment' => 'sandbox', 'services.mpesa.shortcode' => '174379']);
        $this->gateway();
        $code = Artisan::call('billing:sandbox-check', ['--staging-confirmed' => true]);
        $this->assertSame(0, $code);
        $output = Artisan::output();
        $this->assertStringContainsString('OAuth succeeded', $output);
        $this->assertStringNotContainsString('fake-token', $output);
        $this->assertDatabaseCount('subscription_events', 0);
    }
    public function test_pending_payment_preflight_blocks_unresolved_transactions_without_mutation(): void
    {
        $invoice = $this->invoice(); $this->gateway();
        $this->artisan('billing:pending-payments', ['--environment' => 'production'])->assertSuccessful();
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/billing/invoices/{$invoice->id}/stk", ['phone' => '254712345678', 'amount' => 1000])->assertAccepted();
        $this->artisan('billing:pending-payments', ['--environment' => 'production'])->assertFailed();
        $this->assertDatabaseHas('platform_billing_payments', ['status' => 'pending']);
        $this->assertDatabaseCount('subscription_events', 0);
    }

}
