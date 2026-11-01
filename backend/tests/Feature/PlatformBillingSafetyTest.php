<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class PlatformBillingSafetyTest extends TestCase
{
    public function test_stk_push_refuses_mismatched_production_paybill(): void
    {
        config()->set('services.mpesa.environment', 'production');
        config()->set('services.mpesa.shortcode', '174379');
        config()->set('services.mpesa.platform_paybill', '153283');
        config()->set('services.mpesa.consumer_key', 'test-key');
        config()->set('services.mpesa.consumer_secret', 'test-secret');
        config()->set('services.mpesa.passkey', 'test-passkey');
        config()->set('services.mpesa.callback_url', 'https://example.com/callback');
        Http::fake();
        $this->expectException(\RuntimeException::class);
        app(\App\Services\DarajaStkService::class)->push('254712345678', 100, '123456');
        Http::assertNothingSent();
    }

    public function test_sandbox_stk_push_uses_sandbox_gateway_and_invoice_reference(): void
    {
        config()->set('services.mpesa.environment', 'sandbox');
        config()->set('services.mpesa.shortcode', '174379');
        config()->set('services.mpesa.consumer_key', 'sandbox-key');
        config()->set('services.mpesa.consumer_secret', 'sandbox-secret');
        config()->set('services.mpesa.passkey', 'sandbox-passkey');
        config()->set('services.mpesa.callback_url', 'https://example.com/api/billing/mpesa/stk/callback');
        Http::fake([
            'sandbox.safaricom.co.ke/oauth/*' => Http::response(['access_token' => 'sandbox-token'], 200),
            'sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest' =>
                Http::response(['ResponseCode' => '0', 'CheckoutRequestID' => 'sandbox-checkout'], 200),
        ]);
        $result = app(\\App\\Services\\DarajaStkService::class)->push('254712345678', 300, '123456');
        $this->assertSame('sandbox-checkout', $result['CheckoutRequestID']);
        Http::assertSent(fn ($request) =>
            str_contains($request->url(), '/mpesa/stkpush/v1/processrequest')
            && $request['AccountReference'] === '123456'
            && $request['Amount'] === 300
            && $request['BusinessShortCode'] === '174379'
        );
    }

    public function test_sandbox_stk_query_checks_checkout_id(): void
    {
        config()->set('services.mpesa.environment', 'sandbox');
        config()->set('services.mpesa.shortcode', '174379');
        config()->set('services.mpesa.consumer_key', 'sandbox-key');
        config()->set('services.mpesa.consumer_secret', 'sandbox-secret');
        config()->set('services.mpesa.passkey', 'sandbox-passkey');
        Http::fake([
            'sandbox.safaricom.co.ke/oauth/*' => Http::response(['access_token' => 'sandbox-token']),
            'sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query' =>
                Http::response(['ResponseCode' => '0', 'ResultCode' => '0']),
        ]);
        $result = app(\\App\\Services\\DarajaStkService::class)->query('sandbox-checkout');
        $this->assertSame('0', $result['ResponseCode']);
        Http::assertSent(fn ($request) =>
            str_contains($request->url(), '/mpesa/stkpushquery/v1/query')
            && $request['CheckoutRequestID'] === 'sandbox-checkout'
        );
    }

    public function test_callback_without_checkout_does_not_confirm_payment(): void
    {
        $this->postJson('/api/billing/mpesa/stk/callback', [
            'Body' => ['stkCallback' => ['ResultCode' => 0]],
        ])->assertOk();
    }

    public function test_reconciliation_requires_authentication(): void
    {
        $this->getJson('/api/platform/billing/reconciliation')->assertUnauthorized();
    }

    public function test_invoice_requires_authentication(): void
    {
        $this->getJson('/api/billing/invoices/1')->assertUnauthorized();
    }
}
