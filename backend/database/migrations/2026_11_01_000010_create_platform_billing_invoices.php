<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('platform_billing_invoices', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bookshop_id')->constrained('bookshops')->restrictOnDelete();
            $table->foreignId('subscription_plan_id')->constrained('subscription_plans')->restrictOnDelete();
            $table->string('account_number', 6)->unique();
            $table->decimal('amount', 12, 2);
            $table->string('currency', 3)->default('KES');
            $table->string('status', 20)->default('pending')->index();
            // Business dates must not inherit MySQL's legacy implicit TIMESTAMP defaults.
            $table->dateTime('period_starts_at');
            $table->dateTime('period_ends_at');
            $table->timestamp('due_at')->nullable();
            $table->timestamp('paid_at')->nullable();
            $table->timestamps();
            $table->index(['bookshop_id', 'status']);
        });

        Schema::create('platform_billing_payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('platform_billing_invoice_id')->constrained('platform_billing_invoices')->restrictOnDelete();
            $table->string('channel', 20); // stk | paybill
            $table->string('status', 32)->default('pending')->index();
            $table->string('checkout_request_id')->nullable()->unique();
            $table->string('merchant_request_id')->nullable();
            $table->string('mpesa_receipt')->nullable()->unique();
            $table->string('phone', 20)->nullable();
            $table->decimal('amount', 12, 2);
            $table->json('provider_response')->nullable();
            $table->timestamp('confirmed_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('platform_billing_payments');
        Schema::dropIfExists('platform_billing_invoices');
    }
};
