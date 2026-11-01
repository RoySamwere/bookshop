<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('platform_billing_sequences', function (Blueprint $table) {
            $table->unsignedInteger('id')->primary();
            $table->unsignedInteger('next_account');
        });
        DB::table('platform_billing_sequences')->insert(['id' => 1, 'next_account' => max(100000, 1 + (int) DB::table('platform_billing_invoices')->max('account_number'))]);
        Schema::table('platform_billing_invoices', function (Blueprint $table) {
            // Existing invoices have unknown provenance and must not silently become live invoices.
            $table->string('environment', 16)->default('legacy')->index();
            $table->unsignedSmallInteger('billing_months')->nullable();
        });
        foreach (DB::table('subscription_plans')->get() as $plan) {
            DB::table('platform_billing_invoices')->where('subscription_plan_id', $plan->id)->update([
                'billing_months' => match ($plan->billing_interval) {
                    'monthly' => 1, 'quarterly' => 3, 'annual', 'annually', 'yearly' => 12, default => null
                },
            ]);
        }
        Schema::table('platform_billing_payments', function (Blueprint $table) {
            $table->string('environment', 16)->default('legacy');
            $table->json('callback_payload')->nullable();
            $table->json('query_response')->nullable();
            $table->timestamp('queried_at')->nullable();
        });
        Schema::table('platform_payment_reconciliation_items', function (Blueprint $table) {
            $table->string('environment', 16)->default('legacy');
        });
    }

    public function down(): void
    {
        Schema::table('platform_payment_reconciliation_items', fn (Blueprint $t) => $t->dropColumn('environment'));
        Schema::table('platform_billing_payments', fn (Blueprint $t) => $t->dropColumn(['environment', 'callback_payload', 'query_response', 'queried_at']));
        Schema::table('platform_billing_invoices', function (Blueprint $t) {
            $t->dropIndex(['environment']);
            $t->dropColumn(['environment', 'billing_months']);
        });
        Schema::dropIfExists('platform_billing_sequences');
    }
};
