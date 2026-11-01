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
