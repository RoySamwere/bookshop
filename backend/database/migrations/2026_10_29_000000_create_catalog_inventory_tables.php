<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('book_categories', function (Blueprint $t) { $t->id(); $t->string('name')->unique(); $t->timestamps(); });
        Schema::create('publishers', function (Blueprint $t) { $t->id(); $t->string('name')->unique(); $t->timestamps(); });
        Schema::create('authors', function (Blueprint $t) { $t->id(); $t->string('name')->unique(); $t->timestamps(); });
        Schema::create('books', function (Blueprint $t) {
            $t->id(); $t->string('title'); $t->string('subtitle')->nullable(); $t->string('isbn', 20)->nullable()->unique();
            $t->string('sku')->unique(); $t->foreignId('book_category_id')->nullable()->constrained()->nullOnDelete();
            $t->foreignId('publisher_id')->nullable()->constrained()->nullOnDelete();
            $t->string('edition')->nullable(); $t->string('language')->default('English');
            $t->string('curriculum')->nullable(); $t->string('grade')->nullable();
            $t->text('description')->nullable(); $t->string('cover_url')->nullable();
            $t->decimal('cost_price', 12, 2)->default(0); $t->decimal('selling_price', 12, 2)->default(0);
            $t->unsignedInteger('reorder_level')->default(0); $t->boolean('is_active')->default(true); $t->timestamps();
        });
        Schema::create('author_book', function (Blueprint $t) { $t->foreignId('author_id')->constrained()->cascadeOnDelete(); $t->foreignId('book_id')->constrained()->cascadeOnDelete(); $t->primary(['author_id','book_id']); });
        Schema::create('suppliers', function (Blueprint $t) { $t->id(); $t->string('name'); $t->string('contact_person')->nullable(); $t->string('email')->nullable(); $t->string('phone')->nullable(); $t->text('address')->nullable(); $t->string('tax_pin')->nullable(); $t->boolean('is_active')->default(true); $t->timestamps(); });
        Schema::create('inventory_balances', function (Blueprint $t) { $t->id(); $t->foreignId('book_id')->constrained()->cascadeOnDelete(); $t->foreignId('branch_id')->constrained()->cascadeOnDelete(); $t->unsignedInteger('quantity')->default(0); $t->unsignedInteger('reserved')->default(0); $t->unique(['book_id','branch_id']); $t->timestamps(); });
        Schema::create('inventory_movements', function (Blueprint $t) { $t->id(); $t->foreignId('book_id')->constrained(); $t->foreignId('branch_id')->constrained(); $t->foreignId('user_id')->nullable()->constrained()->nullOnDelete(); $t->string('type'); $t->integer('quantity_change'); $t->unsignedInteger('quantity_after'); $t->string('reference')->nullable(); $t->text('notes')->nullable(); $t->timestamps(); });
        Schema::create('purchase_orders', function (Blueprint $t) { $t->id(); $t->foreignId('supplier_id')->constrained(); $t->foreignId('branch_id')->constrained(); $t->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete(); $t->string('status')->default('draft'); $t->date('expected_date')->nullable(); $t->timestamps(); });
        Schema::create('purchase_order_items', function (Blueprint $t) { $t->id(); $t->foreignId('purchase_order_id')->constrained()->cascadeOnDelete(); $t->foreignId('book_id')->constrained(); $t->unsignedInteger('quantity'); $t->unsignedInteger('received_quantity')->default(0); $t->decimal('unit_cost',12,2); $t->timestamps(); });
        Schema::create('goods_receipts', function (Blueprint $t) { $t->id(); $t->foreignId('purchase_order_id')->constrained(); $t->foreignId('received_by')->nullable()->constrained('users')->nullOnDelete(); $t->string('reference')->unique(); $t->timestamps(); });
        Schema::create('goods_receipt_items', function (Blueprint $t) { $t->id(); $t->foreignId('goods_receipt_id')->constrained()->cascadeOnDelete(); $t->foreignId('purchase_order_item_id')->constrained(); $t->unsignedInteger('quantity'); $t->timestamps(); });
    }
    public function down(): void {
        foreach (['goods_receipt_items','goods_receipts','purchase_order_items','purchase_orders','inventory_movements','inventory_balances','suppliers','author_book','books','authors','publishers','book_categories'] as $table) Schema::dropIfExists($table);
    }
};
