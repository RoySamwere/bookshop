<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('pos_sales', function(Blueprint $t) {
            $t->id(); $t->string('idempotency_key',100)->unique();
            $t->string('receipt_number')->nullable()->unique();
            $t->foreignId('branch_id')->constrained('branches');
            $t->foreignId('cashier_id')->constrained('users');
            $t->decimal('subtotal',14,2); $t->decimal('total',14,2);
            $t->string('payment_method',20); $t->string('payment_reference')->nullable();
            $t->decimal('amount_received',14,2); $t->decimal('change_due',14,2)->default(0);
            $t->string('status')->default('completed'); $t->timestamps();
        });
        Schema::create('pos_sale_items', function(Blueprint $t) {
            $t->id(); $t->foreignId('sale_id')->constrained('pos_sales')->cascadeOnDelete();
            $t->foreignId('book_id')->constrained('books');
            $t->string('title'); $t->string('sku'); $t->unsignedInteger('quantity');
            $t->decimal('unit_price',14,2); $t->decimal('line_total',14,2); $t->timestamps();
        });
    }
    public function down(): void { Schema::dropIfExists('pos_sale_items'); Schema::dropIfExists('pos_sales'); }
};
