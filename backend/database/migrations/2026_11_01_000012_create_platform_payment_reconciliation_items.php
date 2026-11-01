<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::create('platform_payment_reconciliation_items', function (Blueprint $table) {
            $table->id();
            $table->string('source', 20);
            $table->string('provider_transaction_id')->nullable();
            $table->string('account_number', 20)->nullable();
            $table->string('destination_shortcode', 20)->nullable();
            $table->decimal('amount', 12, 2)->nullable();
            $table->string('status', 24)->default('awaiting_verification')->index();
            $table->json('payload');
            $table->timestamps();
            $table->unique(['source', 'provider_transaction_id']);
        });
    }
    public function down(): void { Schema::dropIfExists('platform_payment_reconciliation_items'); }
};
