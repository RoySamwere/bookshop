<?php

namespace Tests\Feature;

use App\Models\Bookshop;
use App\Models\BookshopSubscription;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Notifications\SubscriptionPaymentConfirmed;
use App\Services\Billing\SafPaymentBackfill;
use App\Services\Billing\SafPaymentReconciler;
use App\Services\Billing\SafPaymentVerifier;
use App\Services\PlatformBillingInvoiceService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as HttpRequest;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/** saf_payments: automatic verification and reconciliation, Bills, My Payments and history migration. */
class SafPaymentsTest extends TestCase
{
    use RefreshDatabase;

    private User $owner;
    private User $operator;
    private BookshopSubscription $subscription;
    private SubscriptionPlan $plan;
    private array $sent = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now()->startOfSecond());
        config(['services.mpesa' => [...config('services.mpesa'),
            'environment' => 'production', 'shortcode' => '152451', 'consumer_key' => 'key', 'consumer_secret' => 'secret', 'passkey' => 'pass',
            'callback_url' => 'https://app.example.test/api/billing/mpesa/stk/callback', 'c2b_verification' => 'transaction_status',
            'initiator_name' => 'api-user', 'security_credential' => 'encrypted-credential',
            'result_url' => 'https://app.example.test/api/billing/mpesa/transaction-status/result',
            'timeout_url' => 'https://app.example.test/api/billing/mpesa/transaction-status/timeout', 'callback_ips' => []]]);
        Http::preventStrayRequests();
        Notification::fake();
        $shop = Bookshop::factory()->create(['name' => 'Kisumu Readers']);
        $this->owner = User::factory()->forBookshop($shop)->create(['role' => 'bookshop_owner']);
        $shop->forceFill(['owner_user_id' => $this->owner->id])->save();
        $this->operator = User::factory()->create(['role' => 'platform_owner']);
        $this->plan = SubscriptionPlan::create(['code' => 'monthly', 'name' => 'Monthly', 'price' => 1000, 'currency' => 'KES', 'billing_interval' => 'monthly', 'is_active' => true]);
        $this->subscription = new BookshopSubscription(['subscription_plan_id' => $this->plan->id, 'status' => 'expired',
            'current_period_starts_at' => now()->subMonths(2), 'current_period_ends_at' => now()->subDay()]);
        $this->subscription->bookshop_id = $shop->id;
        $this->subscription->save();
    }

    private function invoice(?User $owner = null): object
    {
        return app(PlatformBillingInvoiceService::class)->create(($owner ?? $this->owner)->bookshop_id, $this->plan);
    }

    /** Safaricom: OAuth, and a Transaction Status request that echoes our correlation ID. */
    private function safaricom(): void
    {
        $this->sent = [];
        Http::fake([
            '*/oauth/*' => Http::response(['access_token' => 'token']),
            '*/mpesa/transactionstatus/v1/query' => function (HttpRequest $request) {
                $this->sent[] = $request->data();

                return Http::response(['OriginatorConversationID' => $request['OriginatorConversationID'], 'ConversationID' => 'AG_'.count($this->sent), 'ResponseCode' => '0']);
            },
        ]);
    }

    private function c2b(string $receipt, string $account, string $amount = '1000.00', string $shortcode = '152451'): void
    {
        $this->postJson('/api/billing/mpesa/c2b/confirmation', ['TransactionType' => 'Pay Bill', 'TransID' => $receipt, 'TransTime' => now('Africa/Nairobi')->format('YmdHis'),
            'TransAmount' => $amount, 'BusinessShortCode' => $shortcode, 'BillRefNumber' => $account, 'MSISDN' => '254712345678', 'FirstName' => 'JANE'])->assertOk();
    }

    private function statusResult(object $row, array $overrides = [], array $parameters = []): array
    {
        $values = ['ReceiptNo' => $row->mpesa_receipt_number, 'Amount' => (float) $row->amount, 'TransactionStatus' => 'Completed',
            'CreditPartyName' => '152451 - Nifunze Bookshop', 'FinalisedTime' => now('Africa/Nairobi')->format('YmdHis'), ...$parameters];

        return ['Result' => ['ResultType' => 0, 'ResultCode' => 0, 'ResultDesc' => 'The service request is processed successfully.',
            'OriginatorConversationID' => $row->verification_request_id, 'ConversationID' => $row->verification_conversation_id,
            'TransactionID' => 'QUERY123', 'ResultParameters' => ['ResultParameter' => collect($values)->map(fn ($v, $k) => ['Key' => $k, 'Value' => $v])->values()->all()],
            ...$overrides]];
    }

    private function row(string $receipt): object
    {
        return DB::table('saf_payments')->where('mpesa_receipt_number', $receipt)->first();
    }

    public function test_paybill_payment_is_verified_with_safaricom_and_activates_the_subscription_without_an_operator(): void
    {
        $this->safaricom();
        $invoice = $this->invoice();
        $this->c2b('QK1ABC2DEF', $invoice->account_number);

        $row = $this->row('QK1ABC2DEF');
        $this->assertSame('pending', $row->verification_status, 'A callback alone never credits.');
        $this->assertSame('254712345678', $row->phone_number);
        $this->assertStringNotContainsString('JANE', $row->provider_payload, 'Payer names are not stored.');
        $this->assertCount(1, $this->sent);
        $this->assertSame('QK1ABC2DEF', $this->sent[0]['TransactionID']);
        $this->assertSame('152451', $this->sent[0]['PartyA']);
        $this->assertSame('expired', $this->subscription->fresh()->status);

        $this->postJson('/api/billing/mpesa/transaction-status/result', $this->statusResult($row))->assertOk();
        $row = $this->row('QK1ABC2DEF');
        $this->assertSame('reconciled', $row->verification_status);
        $this->assertSame('daraja_transaction_status', $row->verification_source);
        $this->assertSame($invoice->id, (int) $row->invoice_id);
        $this->assertSame($this->owner->bookshop_id, (int) $row->bookshop_id);
        $this->assertDatabaseHas('platform_billing_invoices', ['id' => $invoice->id, 'status' => 'paid']);
        $this->assertSame('active', $this->subscription->fresh()->status);
        $this->assertTrue($this->subscription->fresh()->current_period_ends_at->isFuture());
        Notification::assertSentTo($this->owner, SubscriptionPaymentConfirmed::class);
        $this->assertNotNull($row->confirmation_sent_at);
        $this->assertDatabaseHas('audit_logs', ['action' => 'billing.payment_reconciled']);

        // Duplicate notifications and results change nothing.
        $this->c2b('QK1ABC2DEF', $invoice->account_number);
        $this->postJson('/api/billing/mpesa/transaction-status/result', $this->statusResult($row))->assertOk();
        app(SafPaymentReconciler::class)->process($row->id);
        $this->assertSame(1, DB::table('saf_payments')->count());
        $this->assertSame(1, DB::table('platform_billing_payments')->where('status', 'confirmed')->count());
        $this->assertDatabaseCount('subscription_events', 1);
        Notification::assertSentToTimes($this->owner, SubscriptionPaymentConfirmed::class, 2); // database + mail, once
    }

    public function test_results_without_our_correlation_ids_or_with_different_values_never_credit(): void
    {
        $this->safaricom();
        $invoice = $this->invoice();
        $this->c2b('QK1FORGED1', $invoice->account_number);
        $row = $this->row('QK1FORGED1');

        // Forged: right receipt, wrong conversation.
        $this->postJson('/api/billing/mpesa/transaction-status/result', $this->statusResult($row, ['ConversationID' => 'AG_FORGED']))->assertOk();
        $this->assertSame('pending', $this->row('QK1FORGED1')->verification_status);
        // From a non-Safaricom IP when an allow-list is configured.
        config(['services.mpesa.callback_ips' => ['196.201.214.200']]);
        $this->postJson('/api/billing/mpesa/transaction-status/result', $this->statusResult($row))->assertOk();
        $this->assertSame('pending', $this->row('QK1FORGED1')->verification_status);
        config(['services.mpesa.callback_ips' => []]);
        // Genuine correlation but Safaricom's amount differs from the notification: exception queue.
        $this->postJson('/api/billing/mpesa/transaction-status/result', $this->statusResult($row, [], ['Amount' => 10]))->assertOk();
        $row = $this->row('QK1FORGED1');
        $this->assertSame('unmatched', $row->verification_status);
        $this->assertStringContainsString('amount', $row->exception_reason);
        $this->assertDatabaseHas('platform_billing_invoices', ['id' => $invoice->id, 'status' => 'pending']);
        $this->assertDatabaseCount('subscription_events', 0);
        // An unverified row cannot be assigned by hand either.
        $this->actingAs($this->operator, 'sanctum')->postJson("/api/platform/bills/{$row->id}/assign", ['account_number' => $invoice->account_number, 'note' => 'try'])->assertUnprocessable();
    }

    public function test_wrong_account_goes_to_the_exception_queue_and_can_be_assigned_after_review(): void
    {
        $this->safaricom();
        $invoice = $this->invoice();
        $this->c2b('QK1WRONG01', '123');
        $row = $this->row('QK1WRONG01');
        $this->postJson('/api/billing/mpesa/transaction-status/result', $this->statusResult($row))->assertOk();
        $row = $this->row('QK1WRONG01');
        $this->assertSame('unmatched', $row->verification_status);
        $this->assertNotNull($row->verified_at, 'Money is verified; only the account is wrong.');

        $admin = User::factory()->create(['role' => 'platform_admin']);
        $this->actingAs($admin, 'sanctum')->getJson("/api/platform/bills/{$row->id}")->assertOk()->assertJsonPath('data.candidate_invoices.0.account_number', $invoice->account_number);
        $this->postJson("/api/platform/bills/{$row->id}/assign", ['account_number' => $invoice->account_number, 'note' => 'Customer typed phone digits'])->assertForbidden();
        $this->actingAs($this->operator, 'sanctum')->postJson("/api/platform/bills/{$row->id}/assign", ['account_number' => $invoice->account_number])->assertUnprocessable();
        $this->postJson("/api/platform/bills/{$row->id}/assign", ['account_number' => $invoice->account_number, 'note' => 'Customer typed phone digits'])
            ->assertOk()->assertJsonPath('data.status', 'reconciled')->assertJsonPath('data.invoice.status', 'paid');
        $this->assertSame('active', $this->subscription->fresh()->status);
        $this->assertDatabaseHas('audit_logs', ['action' => 'billing.payment_account_corrected']);
        $this->postJson("/api/platform/bills/{$row->id}/assign", ['account_number' => $invoice->account_number, 'note' => 'again'])->assertUnprocessable();
        $this->assertDatabaseCount('subscription_events', 1);
    }

    public function test_partial_and_over_payments_are_applied_without_extra_access(): void
    {
        $this->safaricom();
        $invoice = $this->invoice();
        foreach ([['QK1PART001', '400.00'], ['QK1PART002', '900.00']] as [$receipt, $amount]) {
            $this->c2b($receipt, $invoice->account_number, $amount);
            $this->postJson('/api/billing/mpesa/transaction-status/result', $this->statusResult($this->row($receipt)))->assertOk();
        }
        $first = $this->row('QK1PART001');
        $second = $this->row('QK1PART002');
        $this->assertSame([400.0, 0.0], [(float) $first->allocated_amount, (float) $first->excess_amount]);
        $this->assertSame([600.0, 300.0], [(float) $second->allocated_amount, (float) $second->excess_amount]);
        $this->assertDatabaseHas('platform_billing_invoices', ['id' => $invoice->id, 'status' => 'paid']);
        $this->assertSame(300.0, (float) DB::table('platform_payment_reconciliation_items')->where('source', 'overpayment')->sum('amount'));
        $this->assertDatabaseCount('subscription_events', 1);
    }

    public function test_sandbox_and_wrong_paybill_payments_never_reach_production_subscriptions(): void
    {
        $this->safaricom();
        $invoice = $this->invoice();
        $this->c2b('QK1OTHERPB', $invoice->account_number, '1000.00', '600000');
        $this->assertSame('unmatched', $this->row('QK1OTHERPB')->verification_status);
        $this->assertCount(0, $this->sent, 'No verification is attempted for another shortcode.');

        $id = DB::table('saf_payments')->insertGetId(['account_number' => $invoice->account_number, 'mpesa_receipt_number' => 'SANDBOX001', 'amount' => 1000,
            'shortcode' => '174379', 'payment_channel' => 'paybill', 'environment' => 'sandbox', 'verification_status' => 'verified',
            'verification_source' => 'daraja_transaction_status', 'verified_at' => now(), 'created_at' => now(), 'updated_at' => now()]);
        $this->assertSame('unmatched', app(SafPaymentReconciler::class)->process($id));
        $this->assertDatabaseHas('platform_billing_invoices', ['id' => $invoice->id, 'status' => 'pending']);
        $this->assertDatabaseCount('subscription_events', 0);
    }

    public function test_concurrent_or_repeated_processing_credits_once(): void
    {
        $this->safaricom();
        $invoice = $this->invoice();
        $this->c2b('QK1TWICE01', $invoice->account_number);
        $row = $this->row('QK1TWICE01');
        DB::table('saf_payments')->where('id', $row->id)->update(['verification_status' => 'verified', 'verification_source' => 'daraja_transaction_status', 'verified_at' => now()]);
        $reconciler = app(SafPaymentReconciler::class);
        $this->assertSame('reconciled', $reconciler->process($row->id));
        $this->assertSame('reconciled', $reconciler->process($row->id));
        $this->assertSame('reconciled', app(SafPaymentVerifier::class)->handle($row->id));
        $this->artisan('billing:reconcile-payments')->assertSuccessful();
        $this->assertSame(1, DB::table('platform_billing_payments')->where('status', 'confirmed')->count());
        $this->assertDatabaseCount('subscription_events', 1);
    }

    public function test_pull_api_mode_verifies_synchronously(): void
    {
        config(['services.mpesa.c2b_verification' => 'pull_api']);
        $invoice = $this->invoice();
        Http::fake([
            '*/oauth/*' => Http::response(['access_token' => 'token']),
            '*/pulltransactions/v1/query' => Http::response(['ResponseCode' => '1000', 'Response' => [[
                ['transactionId' => 'QK1PULL001', 'trxDate' => now()->toDateTimeString(), 'billreference' => $invoice->account_number, 'amount' => '1000'],
            ]]]),
        ]);
        $this->c2b('QK1PULL001', $invoice->account_number);
        $this->assertSame('reconciled', $this->row('QK1PULL001')->verification_status);
        $this->assertSame('daraja_pull_api', $this->row('QK1PULL001')->verification_source);
        $this->assertSame('active', $this->subscription->fresh()->status);
    }

    public function test_unreachable_safaricom_is_retried_then_queued_as_an_exception(): void
    {
        Http::fake(fn () => throw new \Illuminate\Http\Client\ConnectionException('down'));
        $invoice = $this->invoice();
        $this->c2b('QK1RETRY01', $invoice->account_number);
        for ($i = 0; $i < SafPaymentVerifier::MAX_ATTEMPTS + 1; $i++) {
            $this->travel(61)->minutes();
            $this->artisan('billing:reconcile-payments')->assertSuccessful();
        }
        $row = $this->row('QK1RETRY01');
        $this->assertSame('unmatched', $row->verification_status);
        $this->assertStringContainsString('Not verified', $row->exception_reason);
        $this->actingAs($this->operator, 'sanctum')->postJson("/api/platform/bills/{$row->id}/retry")->assertOk()->assertJsonPath('data.status', 'pending');
        $this->postJson("/api/platform/bills/{$row->id}/reject", ['reason' => 'Duplicate of statement row 44'])->assertOk()->assertJsonPath('data.status', 'rejected');
        $this->postJson("/api/platform/bills/{$row->id}/retry")->assertUnprocessable();
        $this->assertDatabaseHas('audit_logs', ['action' => 'billing.payment_rejected']);
    }

    public function test_bills_page_lists_filters_summarises_and_exports_for_platform_staff_only(): void
    {
        $this->safaricom();
        $invoice = $this->invoice();
        $this->c2b('QK1BILLS01', $invoice->account_number, '400.00');
        $this->postJson('/api/billing/mpesa/transaction-status/result', $this->statusResult($this->row('QK1BILLS01')))->assertOk();
        $this->c2b('QK1BILLS02', '999999', '250.00');

        $this->actingAs($this->owner, 'sanctum')->getJson('/api/platform/bills')->assertForbidden();
        $this->getJson('/api/platform/bills/export')->assertForbidden();
        $admin = User::factory()->create(['role' => 'platform_admin']);
        $response = $this->actingAs($admin, 'sanctum')->getJson('/api/platform/bills')->assertOk();
        $response->assertJsonPath('total', 2)->assertJsonPath('summary.verified_collections', 400)->assertJsonPath('summary.today_collections', 400)
            ->assertJsonPath('summary.pending_count', 1)->assertJsonPath('summary.outstanding_balance', 600)->assertJsonPath('summary.paybill', '152451');
        $this->getJson('/api/platform/bills?status=reconciled')->assertJsonPath('total', 1)->assertJsonPath('data.0.bookshop_name', 'Kisumu Readers')->assertJsonPath('data.0.account_number', $invoice->account_number);
        $this->getJson('/api/platform/bills?search=QK1BILLS02')->assertJsonPath('total', 1)->assertJsonPath('data.0.status', 'pending');
        $this->getJson('/api/platform/bills?search=Kisumu')->assertJsonPath('total', 1);
        $this->getJson('/api/platform/bills/export?status=reconciled')->assertOk()->assertJsonCount(1, 'data');
        $detail = $this->getJson('/api/platform/bills/'.$this->row('QK1BILLS01')->id)->assertOk();
        $this->assertStringNotContainsString('encrypted-credential', $detail->getContent());
    }

    public function test_my_payments_shows_only_the_owners_bookshop_and_serves_receipts(): void
    {
        $this->safaricom();
        $invoice = $this->invoice();
        $this->c2b('QK1MINE001', $invoice->account_number);
        $this->postJson('/api/billing/mpesa/transaction-status/result', $this->statusResult($this->row('QK1MINE001')))->assertOk();
        $otherShop = Bookshop::factory()->create();
        $other = User::factory()->forBookshop($otherShop)->create(['role' => 'bookshop_owner']);
        $id = $this->row('QK1MINE001')->id;

        $this->actingAs($this->owner, 'sanctum')->getJson('/api/billing/payments')->assertOk()
            ->assertJsonPath('total', 1)->assertJsonPath('data.0.mpesa_receipt_number', 'QK1MINE001')->assertJsonPath('data.0.status', 'confirmed')
            ->assertJsonPath('data.0.account_number', $invoice->account_number)->assertJsonPath('data.0.phone', '2547•••678')->assertJsonPath('totals.total', 1000);
        $pdf = $this->get("/api/billing/payments/{$id}/receipt")->assertOk()->assertHeader('Content-Type', 'application/pdf')->getContent();
        foreach (['QK1MINE001', 'Kisumu Readers', 'Nifunze Bookshop', $invoice->account_number] as $text) $this->assertStringContainsString($text, $pdf);

        $this->actingAs($other, 'sanctum')->getJson('/api/billing/payments')->assertOk()->assertJsonPath('total', 0);
        $this->get("/api/billing/payments/{$id}/receipt")->assertNotFound();
        $cashier = User::factory()->forBookshop($this->owner->bookshop_id)->create(['role' => 'cashier']);
        $this->actingAs($cashier, 'sanctum')->getJson('/api/billing/payments')->assertForbidden();
    }

    public function test_renewal_invoices_get_new_permanent_account_numbers_and_are_not_duplicated(): void
    {
        $this->safaricom();
        $first = $this->invoice();
        $this->c2b('QK1RENEW01', $first->account_number);
        $this->postJson('/api/billing/mpesa/transaction-status/result', $this->statusResult($this->row('QK1RENEW01')))->assertOk();
        $this->travelTo($this->subscription->fresh()->current_period_ends_at->subDays(3));
        $this->artisan('billing:generate-renewals')->assertSuccessful();
        $this->artisan('billing:generate-renewals')->assertSuccessful();
        $invoices = DB::table('platform_billing_invoices')->orderBy('id')->get();
        $this->assertCount(2, $invoices);
        $this->assertNotSame($invoices[0]->account_number, $invoices[1]->account_number);
        $this->assertSame($first->account_number, $invoices[0]->account_number, 'Account numbers never change.');
        $this->assertMatchesRegularExpression('/^\d{6}$/', $invoices[1]->account_number);
    }

    public function test_history_is_copied_into_the_ledger_with_its_original_statuses(): void
    {
        $invoice = $this->invoice();
        $rows = [
            ['status' => 'confirmed', 'channel' => 'paybill', 'mpesa_receipt' => 'OLDPAID001', 'provider_response' => json_encode(['statement_reference' => 'stmt-9', 'verified_by' => $this->operator->id]), 'confirmed_at' => now()->subDay()],
            ['status' => 'awaiting_verification', 'channel' => 'stk', 'checkout_request_id' => 'ws_CO_1'],
            ['status' => 'unknown', 'channel' => 'stk'],
            ['status' => 'cancelled', 'channel' => 'stk', 'checkout_request_id' => 'ws_CO_2'],
        ];
        foreach ($rows as $row) {
            DB::table('platform_billing_payments')->insert(['platform_billing_invoice_id' => $invoice->id, 'environment' => 'production', 'amount' => 1000, 'phone' => '254712345678',
                'created_at' => now()->subDays(2), 'updated_at' => now()->subDays(2), ...$row]);
        }
        DB::table('platform_payment_reconciliation_items')->insert(['source' => 'c2b', 'environment' => 'production', 'provider_transaction_id' => 'OLDC2B0001',
            'account_number' => $invoice->account_number, 'destination_shortcode' => '152451', 'amount' => 500, 'status' => 'awaiting_verification',
            'payload' => json_encode(['TransID' => 'OLDC2B0001', 'FirstName' => 'JANE']), 'created_at' => now(), 'updated_at' => now()]);

        $backfill = app(SafPaymentBackfill::class);
        $this->assertSame(5, $backfill->run()['copied']);
        $this->assertSame(0, $backfill->run()['copied'], 'Running again copies nothing.');
        $statuses = DB::table('saf_payments')->orderBy('id')->pluck('verification_status')->all();
        $this->assertSame(['reconciled', 'pending', 'unmatched', 'rejected', 'pending'], $statuses);
        $paid = $this->row('OLDPAID001');
        $this->assertSame('statement_attestation', $paid->verification_source);
        $this->assertSame('stmt-9', $paid->verification_reference);
        $this->assertNotNull($paid->confirmation_sent_at, 'History is not re-announced to customers.');
        $this->assertStringNotContainsString('JANE', (string) $this->row('OLDC2B0001')->provider_payload);
        $this->assertSame(4, DB::table('platform_billing_payments')->count(), 'Old records are untouched.');
    }

    public function test_owner_can_confirm_a_payment_with_the_code_from_their_sms(): void
    {
        $this->safaricom();
        $invoice = $this->invoice();
        $url = "/api/billing/invoices/{$invoice->id}/confirm-payment";
        $this->actingAs($this->owner, 'sanctum')->postJson($url, ['mpesa_code' => 'ABC'])->assertUnprocessable()->assertJsonValidationErrors('mpesa_code');
        $this->postJson($url, ['mpesa_code' => ' tj4k 8l2m9p '])->assertOk()->assertJsonPath('status', 'processing');
        $row = $this->row('TJ4K8L2M9P');
        $this->assertSame('pending', $row->verification_status);
        $this->assertSame(0.0, (float) $row->amount, 'The customer never states the amount.');
        $this->assertSame('TJ4K8L2M9P', $this->sent[0]['TransactionID']);

        // Safaricom confirms the code and its amount, but does not report the account: the team confirms it.
        $this->postJson('/api/billing/mpesa/transaction-status/result', $this->statusResult($row, [], ['Amount' => 1000]))->assertOk();
        $row = $this->row('TJ4K8L2M9P');
        $this->assertSame('unmatched', $row->verification_status);
        $this->assertSame(1000.0, (float) $row->amount);
        $this->assertStringContainsString($invoice->account_number, $row->exception_reason);
        $this->assertDatabaseHas('platform_billing_invoices', ['id' => $invoice->id, 'status' => 'pending']);

        // Safaricom's Paybill notification for the same code names the account: applied automatically.
        $this->c2b('TJ4K8L2M9P', $invoice->account_number);
        $this->assertSame('reconciled', $this->row('TJ4K8L2M9P')->verification_status);
        $this->assertSame('active', $this->subscription->fresh()->status);
        $this->assertSame('TJ4K8L2M9P', DB::table('platform_billing_payments')->where('status', 'confirmed')->value('mpesa_receipt'));
        $this->assertSame(1, DB::table('saf_payments')->count());
        $this->postJson($url, ['mpesa_code' => 'TJ4K8L2M9P'])->assertOk()->assertJsonPath('status', 'confirmed');
    }

    public function test_a_claimed_code_waits_for_the_team_and_is_assigned_to_the_claimed_invoice(): void
    {
        $this->safaricom();
        $invoice = $this->invoice();
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/billing/invoices/{$invoice->id}/confirm-payment", ['mpesa_code' => 'TJ4K8L2M9Q'])->assertOk();
        $row = $this->row('TJ4K8L2M9Q');
        $this->postJson('/api/billing/mpesa/transaction-status/result', $this->statusResult($row, [], ['Amount' => 1000]))->assertOk();
        $id = $row->id;
        $this->actingAs($this->operator, 'sanctum')->getJson("/api/platform/bills/{$id}")->assertOk()
            ->assertJsonPath('data.claimed_account', $invoice->account_number)->assertJsonPath('data.candidate_invoices.0.account_number', $invoice->account_number);
        $this->postJson("/api/platform/bills/{$id}/assign", ['account_number' => $invoice->account_number, 'note' => 'Matches owner request'])->assertOk()->assertJsonPath('data.status', 'reconciled');
        $this->assertSame('active', $this->subscription->fresh()->status);
    }

    public function test_codes_cannot_be_reused_and_owners_only_reach_their_own_invoices(): void
    {
        $this->safaricom();
        $invoice = $this->invoice();
        $this->c2b('TJ4K8L2M9R', $invoice->account_number);
        $this->postJson('/api/billing/mpesa/transaction-status/result', $this->statusResult($this->row('TJ4K8L2M9R')))->assertOk();
        $otherShop = Bookshop::factory()->create();
        $other = User::factory()->forBookshop($otherShop)->create(['role' => 'bookshop_owner']);
        $otherSub = new BookshopSubscription(['subscription_plan_id' => $this->plan->id, 'status' => 'active', 'current_period_starts_at' => now(), 'current_period_ends_at' => now()->addDays(2)]);
        $otherSub->bookshop_id = $otherShop->id;
        $otherSub->save();
        $otherInvoice = $this->invoice($other);
        $this->actingAs($other, 'sanctum')->postJson("/api/billing/invoices/{$otherInvoice->id}/confirm-payment", ['mpesa_code' => 'TJ4K8L2M9R'])
            ->assertUnprocessable()->assertJsonValidationErrors('mpesa_code');
        $this->postJson("/api/billing/invoices/{$invoice->id}/confirm-payment", ['mpesa_code' => 'TJ4K8L2M9S'])->assertNotFound();
        $this->assertSame(1, DB::table('platform_billing_payments')->where('status', 'confirmed')->count());
    }

    public function test_pull_api_confirms_a_claimed_code_and_its_account_automatically(): void
    {
        config(['services.mpesa.c2b_verification' => 'pull_api']);
        $invoice = $this->invoice();
        Http::fake(['*/oauth/*' => Http::response(['access_token' => 'token']), '*/pulltransactions/v1/query' => Http::response(['ResponseCode' => '1000', 'Response' => [[
            ['transactionId' => 'TJ4K8L2M9T', 'trxDate' => now()->toDateTimeString(), 'billreference' => $invoice->account_number, 'amount' => '1000'],
        ]]])]);
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/billing/invoices/{$invoice->id}/confirm-payment", ['mpesa_code' => 'TJ4K8L2M9T'])
            ->assertOk()->assertJsonPath('status', 'confirmed');
        $this->assertSame(1000.0, (float) $this->row('TJ4K8L2M9T')->amount);
        $this->assertSame('active', $this->subscription->fresh()->status);
    }

    public function test_operators_confirm_by_code_and_safaricom_supplies_the_amount(): void
    {
        $this->safaricom();
        $invoice = $this->invoice();
        $this->actingAs($this->owner, 'sanctum')->postJson('/api/platform/bills/confirm-code', ['mpesa_code' => 'TJ4K8L2M9U', 'account_number' => $invoice->account_number])->assertForbidden();
        $this->actingAs($this->operator, 'sanctum')->postJson('/api/platform/bills/confirm-code', ['mpesa_code' => 'TJ4K8L2M9U', 'account_number' => '999999'])->assertUnprocessable();
        $this->postJson('/api/platform/bills/confirm-code', ['mpesa_code' => 'tj4k8l2m9u', 'account_number' => $invoice->account_number, 'note' => 'Customer called'])
            ->assertOk()->assertJsonPath('data.mpesa_receipt_number', 'TJ4K8L2M9U')->assertJsonPath('data.status', 'pending');
        $this->postJson('/api/billing/mpesa/transaction-status/result', $this->statusResult($this->row('TJ4K8L2M9U'), [], ['Amount' => 1000]))->assertOk();
        $this->assertSame('reconciled', $this->row('TJ4K8L2M9U')->verification_status);
        $this->assertSame('active', $this->subscription->fresh()->status);
    }

    public function test_stk_payments_show_the_real_confirmation_code(): void
    {
        config(['services.mpesa.c2b_verification' => 'pull_api']);
        $invoice = $this->invoice();
        $account = $invoice->account_number;
        Http::fake([
            '*/oauth/*' => Http::response(['access_token' => 'token']),
            '*/mpesa/stkpush/v1/processrequest' => Http::sequence()->push(['ResponseCode' => '0', 'CheckoutRequestID' => 'ws_CO_1', 'MerchantRequestID' => 'm1'])
                ->push(['ResponseCode' => '0', 'CheckoutRequestID' => 'ws_CO_2', 'MerchantRequestID' => 'm2']),
            '*/mpesa/stkpushquery/v1/query' => Http::response(['ResponseCode' => '0', 'ResultCode' => '0']),
            '*/pulltransactions/v1/query' => Http::response(['ResponseCode' => '1000', 'Response' => [[
                ['transactionId' => 'TJ4K8L2M9V', 'trxDate' => now()->toDateTimeString(), 'billreference' => $account, 'amount' => '400'],
            ]]]),
        ]);
        // 1. No callback: the code is fetched from Safaricom's transaction list.
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/billing/invoices/{$invoice->id}/stk", ['phone' => '254712345678', 'amount' => 400])->assertAccepted();
        $this->travel(3)->minutes();
        $this->artisan('billing:reconcile-payments')->assertSuccessful();
        $first = DB::table('saf_payments')->where('provider_transaction_id', 'ws_CO_1')->first();
        $this->assertSame(['reconciled', 'TJ4K8L2M9V'], [$first->verification_status, $first->mpesa_receipt_number]);
        $this->assertSame('TJ4K8L2M9V', DB::table('platform_billing_payments')->where('id', $first->platform_billing_payment_id)->value('mpesa_receipt'));

        // 2. Callback carries the code: recorded as is.
        $this->postJson("/api/billing/invoices/{$invoice->id}/stk", ['phone' => '254712345678', 'amount' => 600])->assertAccepted();
        $this->postJson('/api/billing/mpesa/stk/callback', ['Body' => ['stkCallback' => ['CheckoutRequestID' => 'ws_CO_2', 'ResultCode' => 0, 'CallbackMetadata' => ['Item' => [
            ['Name' => 'Amount', 'Value' => 600], ['Name' => 'MpesaReceiptNumber', 'Value' => 'TJ4K8L2M9W'], ['Name' => 'PhoneNumber', 'Value' => 254712345678]]]]]])->assertOk();
        $this->assertSame('TJ4K8L2M9W', DB::table('saf_payments')->where('provider_transaction_id', 'ws_CO_2')->value('mpesa_receipt_number'));
        $this->getJson('/api/billing/payments')->assertJsonPath('data.0.mpesa_receipt_number', 'TJ4K8L2M9W')->assertJsonPath('data.1.mpesa_receipt_number', 'TJ4K8L2M9V');
    }

    private function stkGateway(): void
    {
        Http::fake([
            '*/oauth/*' => Http::response(['access_token' => 'token']),
            '*/mpesa/stkpush/v1/processrequest' => Http::response(['ResponseCode' => '0', 'CheckoutRequestID' => 'ws_CO_9', 'MerchantRequestID' => 'm9']),
            '*/mpesa/stkpushquery/v1/query' => Http::response(['ResponseCode' => '0', 'ResultCode' => '0']),
            '*/mpesa/transactionstatus/v1/query' => Http::response(['ResponseCode' => '1']),
        ]);
    }

    public function test_one_payment_reported_by_paybill_and_stk_is_one_row_keyed_by_its_code(): void
    {
        $this->stkGateway();
        $invoice = $this->invoice();
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/billing/invoices/{$invoice->id}/stk", ['phone' => '254712345678', 'amount' => 1000])->assertAccepted();
        // Safaricom's Paybill notification arrives first, then the STK callback with the same code.
        $this->c2b('TJ4K8L2MAA', $invoice->account_number);
        $this->postJson('/api/billing/mpesa/stk/callback', ['Body' => ['stkCallback' => ['CheckoutRequestID' => 'ws_CO_9', 'ResultCode' => 0, 'CallbackMetadata' => ['Item' => [
            ['Name' => 'Amount', 'Value' => 1000], ['Name' => 'MpesaReceiptNumber', 'Value' => 'TJ4K8L2MAA']]]]]])->assertOk();
        $this->artisan('billing:sync-payments')->assertSuccessful();

        $this->assertSame(1, DB::table('saf_payments')->where('verification_status', '!=', 'rejected')->count());
        $row = $this->row('TJ4K8L2MAA');
        $this->assertSame('reconciled', $row->verification_status);
        $this->assertSame(1, DB::table('platform_billing_payments')->where('status', 'confirmed')->count());
        $this->assertSame('TJ4K8L2MAA', DB::table('platform_billing_payments')->where('status', 'confirmed')->value('mpesa_receipt'));
        $this->assertDatabaseCount('subscription_events', 1);
    }

    public function test_a_later_paybill_notification_completes_an_applied_stk_payment_without_crediting_again(): void
    {
        $this->stkGateway();
        $invoice = $this->invoice();
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/billing/invoices/{$invoice->id}/stk", ['phone' => '254712345678', 'amount' => 1000])->assertAccepted();
        $this->travel(3)->minutes();
        $this->artisan('billing:reconcile-payments')->assertSuccessful();
        $stk = DB::table('saf_payments')->first();
        $this->assertSame(['reconciled', null], [$stk->verification_status, $stk->mpesa_receipt_number]);

        $this->c2b('TJ4K8L2MAB', $invoice->account_number);
        $this->artisan('billing:sync-payments')->assertSuccessful();
        $this->assertSame(1, DB::table('saf_payments')->count());
        $this->assertSame('TJ4K8L2MAB', DB::table('saf_payments')->value('mpesa_receipt_number'));
        $this->assertSame('TJ4K8L2MAB', DB::table('platform_billing_payments')->where('status', 'confirmed')->value('mpesa_receipt'));
        $this->assertSame(1, DB::table('platform_billing_payments')->where('status', 'confirmed')->count());
        $this->assertDatabaseCount('subscription_events', 1);
    }

    public function test_update_payments_processes_every_row_by_its_code_for_managers_only(): void
    {
        $invoice = $this->invoice();
        // Rows already in saf_payments: one verified, one with a code but no invoice link on its credited record.
        DB::table('saf_payments')->insert(['account_number' => $invoice->account_number, 'mpesa_receipt_number' => 'TJ4K8L2MAC', 'amount' => 1000, 'shortcode' => '152451',
            'payment_channel' => 'paybill', 'environment' => 'production', 'verification_status' => 'verified', 'verification_source' => 'daraja_transaction_status',
            'verified_at' => now(), 'provider_transaction_id' => 'TJ4K8L2MAC', 'created_at' => now(), 'updated_at' => now()]);
        $admin = User::factory()->create(['role' => 'platform_admin']);
        $this->actingAs($admin, 'sanctum')->postJson('/api/platform/bills/sync')->assertForbidden();
        $this->actingAs($this->operator, 'sanctum')->postJson('/api/platform/bills/sync')->assertOk()
            ->assertJsonPath('data.applied', 1)->assertJsonPath('summary.verified_collections', 1000);
        $this->getJson('/api/platform/bills')->assertJsonPath('data.0.mpesa_receipt_number', 'TJ4K8L2MAC')->assertJsonPath('data.0.status', 'reconciled');
        $this->postJson('/api/platform/bills/sync')->assertOk()->assertJsonPath('data.applied', 0);
        $this->assertSame(1, DB::table('platform_billing_payments')->where('status', 'confirmed')->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'billing.payments_synced']);
    }

    public function test_shop_bills_show_their_own_payments_with_details_and_filters(): void
    {
        $this->safaricom();
        $invoice = $this->invoice();
        $this->c2b('TJ4K8L2MBA', $invoice->account_number, '400.00');
        $this->postJson('/api/billing/mpesa/transaction-status/result', $this->statusResult($this->row('TJ4K8L2MBA')))->assertOk();
        $this->c2b('TJ4K8L2MBB', $invoice->account_number, '600.00'); // Still being confirmed: shown via the shop's account number.
        $this->c2b('TJ4K8L2MBC', '999999', '50.00');                    // Someone else's account: never shown.

        $this->actingAs($this->owner, 'sanctum')->getJson('/api/billing/payments')->assertOk()->assertJsonPath('total', 2)
            ->assertJsonPath('data.0.bookshop_name', 'Kisumu Readers')->assertJsonPath('data.0.shortcode', '152451');
        $this->getJson('/api/billing/payments?status=processing')->assertJsonPath('total', 1)->assertJsonPath('data.0.mpesa_receipt_number', 'TJ4K8L2MBB');
        $this->getJson('/api/billing/payments?search=MBA')->assertJsonPath('total', 1);
        $id = $this->row('TJ4K8L2MBA')->id;
        $this->getJson("/api/billing/payments/{$id}")->assertOk()->assertJsonPath('data.verified_by', 'Safaricom (automatic)')
            ->assertJsonPath('data.invoice.account_number', $invoice->account_number)->assertJsonPath('data.invoice.balance', 600)
            ->assertJsonMissingPath('data.provider_payload')->assertJsonPath('data.phone', '2547•••678');
        $this->getJson('/api/billing/payments/'.$this->row('TJ4K8L2MBC')->id)->assertNotFound();

        $other = User::factory()->forBookshop(Bookshop::factory()->create())->create(['role' => 'bookshop_owner']);
        $this->actingAs($other, 'sanctum')->getJson("/api/billing/payments/{$id}")->assertNotFound();
        $this->getJson('/api/billing/payments')->assertJsonPath('total', 0);
    }

    private function stkWithQuery(string ...$codes): void
    {
        $sequence = Http::sequence();
        foreach ($codes as $code) $sequence->push(['ResponseCode' => '0', 'ResultCode' => $code, 'ResultDesc' => $code === '0' ? 'Success' : 'DS timeout user cannot be reached']);
        Http::fake([
            '*/oauth/*' => Http::response(['access_token' => 'token']),
            '*/mpesa/stkpush/v1/processrequest' => Http::response(['ResponseCode' => '0', 'CheckoutRequestID' => 'ws_CO_7', 'MerchantRequestID' => 'm7']),
            '*/mpesa/stkpushquery/v1/query' => $sequence,
            '*/mpesa/transactionstatus/v1/query' => function (HttpRequest $request) {
                $this->sent[] = $request->data();

                return Http::response(['OriginatorConversationID' => $request['OriginatorConversationID'], 'ConversationID' => 'AG_STK', 'ResponseCode' => '0']);
            },
        ]);
    }

    private function successCallback(string $code): array
    {
        return ['Body' => ['stkCallback' => ['CheckoutRequestID' => 'ws_CO_7', 'ResultCode' => 0, 'ResultDesc' => 'The service request is processed successfully.',
            'CallbackMetadata' => ['Item' => [['Name' => 'Amount', 'Value' => 1000], ['Name' => 'MpesaReceiptNumber', 'Value' => $code], ['Name' => 'PhoneNumber', 'Value' => 254713854231]]]]]];
    }

    public function test_a_late_success_after_a_timeout_is_applied_with_its_code(): void
    {
        $this->stkWithQuery('1037', '0');
        $invoice = $this->invoice();
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/billing/invoices/{$invoice->id}/stk", ['phone' => '254713854231', 'amount' => 1000])->assertAccepted();
        $this->travel(3)->minutes();
        $this->artisan('billing:reconcile-payments')->assertSuccessful();
        $this->assertSame('rejected', DB::table('saf_payments')->value('verification_status'));

        $this->postJson('/api/billing/mpesa/stk/callback', $this->successCallback('TJ4K8L2MCA'))->assertOk();
        $row = DB::table('saf_payments')->first();
        $this->assertSame(['reconciled', 'TJ4K8L2MCA'], [$row->verification_status, $row->mpesa_receipt_number]);
        $this->assertSame('active', $this->subscription->fresh()->status);
        $this->assertStringContainsString('MpesaReceiptNumber', (string) DB::table('platform_billing_payments')->where('checkout_request_id', 'ws_CO_7')->value('callback_payload'), 'The stored callback keeps the code.');
        $this->assertStringNotContainsString('254713854231', (string) $row->provider_payload, 'The stored callback drops the phone.');
    }

    public function test_when_the_status_check_still_says_failed_the_code_itself_is_confirmed(): void
    {
        $this->sent = [];
        $this->stkWithQuery('1037', '1037');
        $invoice = $this->invoice();
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/billing/invoices/{$invoice->id}/stk", ['phone' => '254713854231', 'amount' => 1000])->assertAccepted();
        $this->postJson('/api/billing/mpesa/stk/callback', $this->successCallback('TJ4K8L2MCB'))->assertOk();
        $row = DB::table('saf_payments')->first();
        $this->assertSame(['pending', 'TJ4K8L2MCB'], [$row->verification_status, $row->mpesa_receipt_number]);
        $this->assertSame('TJ4K8L2MCB', $this->sent[0]['TransactionID']);
        $this->postJson('/api/billing/mpesa/transaction-status/result', $this->statusResult($row))->assertOk();
        $this->assertSame('reconciled', DB::table('saf_payments')->value('verification_status'));
        $this->assertSame(1, DB::table('platform_billing_payments')->where('status', 'confirmed')->count());
    }

    public function test_update_payments_recovers_codes_saved_before_they_were_kept(): void
    {
        $this->stkWithQuery('0');
        $invoice = $this->invoice();
        // An older STK request: callback stored in full on the request, ledger row rejected without a code.
        $attempt = DB::table('platform_billing_payments')->insertGetId(['platform_billing_invoice_id' => $invoice->id, 'environment' => 'production', 'channel' => 'stk',
            'status' => 'timed_out', 'checkout_request_id' => 'ws_CO_7', 'phone' => '254713854231', 'amount' => 1000,
            'callback_payload' => json_encode($this->successCallback('TJ4K8L2MCC')['Body']['stkCallback']), 'created_at' => now(), 'updated_at' => now()]);
        DB::table('saf_payments')->insert(['stk_attempt_id' => $attempt, 'account_number' => $invoice->account_number, 'amount' => 1000, 'shortcode' => '152451',
            'payment_channel' => 'stk', 'environment' => 'production', 'verification_status' => 'rejected', 'provider_transaction_id' => 'ws_CO_7',
            'exception_reason' => 'Safaricom reported the request as timed out.', 'created_at' => now(), 'updated_at' => now()]);

        $this->actingAs($this->operator, 'sanctum')->postJson('/api/platform/bills/sync')->assertOk()->assertJsonPath('data.codes_filled', 1)->assertJsonPath('data.applied', 1);
        $row = DB::table('saf_payments')->first();
        $this->assertSame(['reconciled', 'TJ4K8L2MCC'], [$row->verification_status, $row->mpesa_receipt_number]);
        $this->getJson('/api/platform/bills')->assertJsonPath('data.0.mpesa_receipt_number', 'TJ4K8L2MCC')->assertJsonPath('data.0.status', 'reconciled');
    }
}
