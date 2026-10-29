<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\BusinessProfile;
use App\Models\User;
use App\Support\Roles;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class DashboardTest extends TestCase
{
    use RefreshDatabase;

    public function test_summary_counts_all_sales_and_respects_branch_and_business_timezone(): void
    {
        $this->travelTo(CarbonImmutable::parse('2026-10-29 12:00:00', 'UTC'));
        BusinessProfile::create(['name' => 'Test shop', 'timezone' => 'Africa/Nairobi']);
        $branch = Branch::factory()->create();
        $other = Branch::factory()->create();
        $user = User::factory()->inBranches($branch)->create(['role' => Roles::ADMIN]);
        $book = DB::table('books')->insertGetId(['title' => 'Test book', 'sku' => 'TEST-1', 'selling_price' => 50, 'reorder_level' => 5]);
        $insert = function (int $branchId, string $created, int $number) use ($user, $book) {
            $sale = DB::table('pos_sales')->insertGetId(['idempotency_key' => "test-{$number}", 'receipt_number' => "TEST-{$number}", 'branch_id' => $branchId, 'cashier_id' => $user->id, 'subtotal' => 100, 'total' => 100, 'payment_method' => 'mpesa', 'payment_reference' => 'SJK7H2M1QX', 'amount_received' => 100, 'status' => 'completed', 'created_at' => $created]);
            DB::table('pos_sale_items')->insert(['sale_id' => $sale, 'book_id' => $book, 'title' => 'Test book', 'sku' => 'TEST-1', 'quantity' => 2, 'unit_price' => 50, 'line_total' => 100]);
        };
        for ($i = 1; $i <= 35; $i++) $insert($branch->id, '2026-10-29 10:00:00', $i);
        $insert($other->id, '2026-10-29 10:00:00', 36);
        // This is today at 00:30 in the business timezone, although the UTC date is yesterday.
        $insert($branch->id, '2026-10-28 21:30:00', 37);
        $insert($branch->id, '2026-10-28 20:00:00', 38);
        $response = $this->actingAs($user, 'sanctum')->getJson('/api/v1/dashboard')->assertOk()
            ->assertJsonPath('data.summary.transactions', 36)->assertJsonPath('data.summary.items', 72)
            ->assertJsonCount(5, 'data.recent_sales')->assertJsonCount(1, 'data.branches')
            ->assertJsonPath('data.hourly.13.revenue', 3500)->assertJsonPath('data.hourly.0.revenue', 100)
            ->assertJsonPath('data.stock.out_of_stock', 1);
        $this->assertEquals(3600, $response->json('data.summary.revenue'));
        $this->assertEquals(3600, $response->json('data.summary.payments.mpesa'));
        $this->assertEquals(72, $response->json('data.top_sellers.0.units'));
        $this->getJson("/api/v1/dashboard?branch_id={$other->id}")->assertForbidden();
        $this->getJson('/api/v1/dashboard?period=invalid')->assertUnprocessable();
    }

    public function test_dashboard_never_exposes_sales_or_staff_data_to_inventory_only_roles(): void
    {
        $user = User::factory()->create(['role' => Roles::INVENTORY_OFFICER]);
        $this->actingAs($user, 'sanctum')->getJson('/api/v1/dashboard')->assertOk()
            ->assertJsonPath('data.summary', null)->assertJsonPath('data.staff_requests', null)
            ->assertJsonCount(0, 'data.recent_sales')->assertJsonCount(0, 'data.hourly');
    }

    public function test_guests_and_customers_cannot_read_the_dashboard(): void
    {
        $this->getJson('/api/v1/dashboard')->assertUnauthorized();
        $this->actingAs(User::factory()->create(['role' => Roles::CUSTOMER]), 'sanctum')
            ->getJson('/api/v1/dashboard')->assertForbidden();
    }
}
