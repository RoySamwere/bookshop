<?php

// Run only against a NEW EMPTY database named nifunze_billing_test_<unique suffix>.
// No database or table is dropped, reset or cleaned by this script.
require __DIR__.'/../../vendor/autoload.php';
$app = require __DIR__.'/../../bootstrap/app.php';
$app->make(Kernel::class)->bootstrap();

use App\Models\Bookshop;
use App\Models\BookshopSubscription;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Services\PlatformBillingInvoiceService;
use App\Services\PlatformPaymentSettlementService;
use Illuminate\Contracts\Console\Kernel;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;

function check(bool $condition, string $message): void
{
    if (! $condition) {
        throw new RuntimeException($message);
    }
}
check(app()->environment('testing'), 'APP_ENV must be testing.');
check(DB::getDriverName() === 'mysql', 'MySQL/MariaDB is required.');
check(str_starts_with(DB::connection()->getDatabaseName(), 'nifunze_billing_test_'), 'Dedicated test database prefix required.');
config(['services.mpesa.environment' => 'production', 'services.mpesa.shortcode' => '153283']);
$options = getopt('', ['worker:', 'shop:', 'plan:', 'invoice:', 'verifier:', 'receipt:']);
if (isset($options['worker'])) {
    if ($options['worker'] === 'create') {
        $invoice = app(PlatformBillingInvoiceService::class)->create((int) $options['shop'], SubscriptionPlan::findOrFail($options['plan']));
        echo json_encode(['invoice' => $invoice->id, 'account' => $invoice->account_number]);
    } else {
        $invoice = DB::table('platform_billing_invoices')->where('id', $options['invoice'])->first();
        app(PlatformPaymentSettlementService::class)->settle($options['receipt'], $invoice->account_number, '153283', 1000, now(), 'paybill',
            ['environment' => 'production', 'verified_by' => (int) $options['verifier'], 'statement_reference' => 'AUTOMATED-ISOLATED-CONCURRENCY-TEST']);
        echo json_encode(['settled' => true]);
    }
    exit(0);
}
check(count(DB::connection()->getSchemaBuilder()->getTables(DB::connection()->getDatabaseName())) === 0, 'Database is not empty; refusing to modify existing records.');
check(Artisan::call('migrate', ['--force' => true]) === 0, 'Migrations failed.');
$shop = Bookshop::factory()->create();
$verifier = User::factory()->create(['role' => 'platform_owner']);
$plan = SubscriptionPlan::create(['code' => 'concurrency', 'name' => 'Concurrency', 'price' => 1000, 'currency' => 'KES', 'billing_interval' => 'monthly', 'is_active' => true]);
$start = now()->startOfSecond();
$subscription = new BookshopSubscription(['subscription_plan_id' => $plan->id, 'status' => 'active', 'current_period_starts_at' => $start, 'current_period_ends_at' => $start->copy()->addDays(10)]);
$subscription->bookshop_id = $shop->id;
$subscription->save();

function workers(array $sets): array
{
    $running = [];
    foreach ($sets as $options) {
        $command = [PHP_BINARY, __FILE__];
        foreach ($options as $key => $value) {
            $command[] = '--'.$key.'='.$value;
        }
        $process = proc_open($command, [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes);
        check(is_resource($process), 'Cannot start worker.');
        fclose($pipes[0]);
        $running[] = [$process, $pipes];
    }
    $results = [];
    foreach ($running as [$process, $pipes]) {
        $output = stream_get_contents($pipes[1]);
        $error = stream_get_contents($pipes[2]);
        fclose($pipes[1]);
        fclose($pipes[2]);
        check(proc_close($process) === 0, 'Concurrency worker failed; inspect isolated test logs.');
        $results[] = json_decode($output, true, 512, JSON_THROW_ON_ERROR);
    }

    return $results;
}
$created = workers(array_fill(0, 6, ['worker' => 'create', 'shop' => $shop->id, 'plan' => $plan->id]));
check(count(array_unique(array_column($created, 'invoice'))) === 1, 'Concurrent checkout duplicated invoices.');
check(DB::table('platform_billing_invoices')->count() === 1, 'Unexpected invoice count.');
$invoiceId = $created[0]['invoice'];
$base = ['worker' => 'settle', 'invoice' => $invoiceId, 'verifier' => $verifier->id];
workers(array_fill(0, 6, [...$base, 'receipt' => 'CONCURRENT01']));
check(DB::table('platform_billing_payments')->where('status', 'confirmed')->count() === 1, 'Duplicate receipt was credited twice.');
check(DB::table('subscription_events')->where('event', 'payment_confirmed')->count() === 1, 'Duplicate subscription activation.');
$expiry = $subscription->fresh()->current_period_ends_at;
check($expiry->equalTo($start->copy()->addDays(10)->addMonthNoOverflow()), 'Remaining paid time was lost.');
workers(array_map(fn ($n) => [...$base, 'receipt' => 'EXCESSPAY00'.$n], [1, 2, 3]));
check((float) DB::table('platform_payment_reconciliation_items')->where('source', 'overpayment')->sum('amount') === 3000.0, 'Concurrent excess funds lost.');
check($subscription->fresh()->current_period_ends_at->equalTo($expiry), 'Late payments extended access twice.');
echo "PASS: real MySQL/MariaDB row locks, six concurrent invoice requests, six duplicate-receipt settlements, three concurrent overpayments; one renewal, no reset or deletion.\n";
