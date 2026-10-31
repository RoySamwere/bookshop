<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Local Purchase Orders (LPO), smart reordering and receiving.
 * Additive only: it extends the existing purchase_orders / goods_receipts tables and adds the few
 * supporting tables the workflow needs. No existing column or row is removed.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('suppliers', function (Blueprint $table) {
            $table->string('payment_terms', 120)->nullable()->after('tax_pin');
            $table->unsignedSmallInteger('lead_time_days')->nullable()->after('payment_terms');
        });

        Schema::table('purchase_orders', function (Blueprint $table) {
            $table->string('lpo_number', 30)->nullable()->after('id');
            $table->date('order_date')->nullable()->after('status');
            $table->string('delivery_location', 255)->nullable()->after('expected_date');
            $table->string('payment_terms', 120)->nullable()->after('delivery_location');
            $table->text('internal_notes')->nullable()->after('payment_terms');
            $table->text('supplier_notes')->nullable()->after('internal_notes');
            $table->string('currency', 3)->nullable()->after('supplier_notes');
            $table->decimal('tax_rate', 5, 2)->default(0)->after('currency');
            $table->boolean('prices_include_tax')->default(false)->after('tax_rate');
            $table->decimal('subtotal', 14, 2)->default(0)->after('prices_include_tax');
            $table->decimal('discount_total', 14, 2)->default(0)->after('subtotal');
            $table->decimal('tax_total', 14, 2)->default(0)->after('discount_total');
            $table->decimal('total', 14, 2)->default(0)->after('tax_total');
            $table->unsignedInteger('version')->default(1)->after('total');
            $table->string('rejection_reason', 500)->nullable();
            $table->string('cancellation_reason', 500)->nullable();
            $table->foreignId('submitted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('submitted_at')->nullable();
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->foreignId('confirmed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('confirmed_at')->nullable();
            $table->foreignId('cancelled_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            // Order status and email delivery are tracked separately: a sent email is not supplier acceptance.
            $table->string('delivery_method', 20)->nullable();
            $table->string('email_status', 20)->default('not_sent');
            $table->timestamp('email_last_attempt_at')->nullable();
            $table->timestamp('email_sent_at')->nullable();
            $table->string('pdf_path', 255)->nullable();
            $table->timestamp('pdf_generated_at')->nullable();
            $table->unique(['bookshop_id', 'lpo_number']);
            $table->index(['bookshop_id', 'status']);
            $table->index(['bookshop_id', 'expected_date']);
        });

        Schema::table('purchase_order_items', function (Blueprint $table) {
            $table->string('description', 255)->nullable()->after('book_id');
            $table->string('sku', 120)->nullable()->after('description');
            $table->string('isbn', 32)->nullable()->after('sku');
            $table->foreignId('product_unit_id')->nullable()->after('isbn')->constrained('product_units')->nullOnDelete();
            $table->string('unit_label', 60)->nullable()->after('product_unit_id');
            $table->unsignedInteger('units_per_package')->default(1)->after('unit_label');
            $table->unsignedInteger('cancelled_quantity')->default(0)->after('received_quantity');
            $table->decimal('discount', 12, 2)->default(0)->after('unit_cost');
            $table->decimal('line_total', 14, 2)->default(0)->after('discount');
            $table->unsignedSmallInteger('position')->default(0);
        });

        Schema::table('goods_receipts', function (Blueprint $table) {
            $table->string('delivery_note_number', 120)->nullable()->after('reference');
            $table->date('received_on')->nullable()->after('delivery_note_number');
            $table->text('notes')->nullable()->after('received_on');
            // Client-generated key so a double-clicked or retried submission never adds stock twice.
            $table->string('submission_key', 64)->nullable()->after('notes');
            $table->unique(['bookshop_id', 'submission_key']);
        });

        Schema::table('goods_receipt_items', function (Blueprint $table) {
            $table->unsignedInteger('damaged_quantity')->default(0)->after('quantity');
            $table->string('notes', 500)->nullable()->after('damaged_quantity');
        });

        // Concurrency-safe LPO numbering: one row per bookshop per year, locked while a number is issued.
        Schema::create('purchase_order_sequences', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bookshop_id')->constrained()->cascadeOnDelete();
            $table->unsignedSmallInteger('year');
            $table->unsignedInteger('last_number')->default(0);
            $table->timestamps();
            $table->unique(['bookshop_id', 'year']);
        });

        // Workflow history: submissions, approvals, rejections, confirmations, amendments (with snapshots), cancellations.
        Schema::create('purchase_order_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bookshop_id')->constrained()->cascadeOnDelete();
            $table->foreignId('purchase_order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('action', 40);
            $table->string('from_status', 30)->nullable();
            $table->string('to_status', 30)->nullable();
            $table->unsignedInteger('version')->default(1);
            $table->text('notes')->nullable();
            $table->json('snapshot')->nullable();
            $table->timestamp('created_at')->nullable();
            $table->index(['purchase_order_id', 'id']);
        });

        Schema::create('purchase_order_email_attempts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bookshop_id')->constrained()->cascadeOnDelete();
            $table->foreignId('purchase_order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->string('recipient', 255);
            $table->string('status', 20)->default('queued');
            $table->text('error')->nullable();
            $table->timestamp('attempted_at')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->timestamps();
            $table->index(['purchase_order_id', 'id']);
        });

        Schema::create('purchasing_settings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bookshop_id')->unique()->constrained()->cascadeOnDelete();
            $table->boolean('approval_required')->default(false);
            $table->unsignedInteger('default_reorder_level')->default(5);
            $table->unsignedInteger('default_target_stock')->default(30);
            $table->string('default_payment_terms', 120)->nullable();
            $table->string('default_delivery_location', 255)->nullable();
            $table->timestamps();
        });

        Schema::create('product_reorder_settings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bookshop_id')->constrained()->cascadeOnDelete();
            $table->foreignId('book_id')->constrained()->cascadeOnDelete();
            $table->unsignedInteger('reorder_level')->nullable();
            $table->unsignedInteger('target_stock')->nullable();
            $table->foreignId('preferred_supplier_id')->nullable()->constrained('suppliers')->nullOnDelete();
            $table->unsignedInteger('minimum_order_quantity')->nullable();
            $table->unsignedInteger('pack_size')->nullable();
            $table->timestamps();
            $table->unique(['bookshop_id', 'book_id']);
        });

        // Older code marked fully received orders "received"; the LPO workflow calls that state "completed".
        DB::table('purchase_orders')->where('status', 'received')->update(['status' => 'completed']);
        DB::table('purchase_orders')->whereNull('order_date')->update(['order_date' => DB::raw('DATE(created_at)')]);
    }

    public function down(): void
    {
        Schema::dropIfExists('product_reorder_settings');
        Schema::dropIfExists('purchasing_settings');
        Schema::dropIfExists('purchase_order_email_attempts');
        Schema::dropIfExists('purchase_order_events');
        Schema::dropIfExists('purchase_order_sequences');

        // MySQL may use the new composite indexes for the bookshop_id foreign keys; give them back their own index first.
        foreach (['purchase_orders', 'goods_receipts'] as $table) {
            if (! Schema::hasIndex($table, "{$table}_bookshop_id_fk_index")) {
                Schema::table($table, fn (Blueprint $t) => $t->index('bookshop_id', "{$table}_bookshop_id_fk_index"));
            }
        }
        $this->dropColumns('goods_receipt_items', ['damaged_quantity', 'notes']);
        if (Schema::hasIndex('goods_receipts', 'goods_receipts_bookshop_id_submission_key_unique')) {
            Schema::table('goods_receipts', fn (Blueprint $t) => $t->dropUnique(['bookshop_id', 'submission_key']));
        }
        $this->dropColumns('goods_receipts', ['delivery_note_number', 'received_on', 'notes', 'submission_key']);
        if (Schema::hasColumn('purchase_order_items', 'product_unit_id')) {
            Schema::table('purchase_order_items', fn (Blueprint $t) => $t->dropConstrainedForeignId('product_unit_id'));
        }
        $this->dropColumns('purchase_order_items', ['description', 'sku', 'isbn', 'unit_label', 'units_per_package', 'cancelled_quantity', 'discount', 'line_total', 'position']);
        foreach (['purchase_orders_bookshop_id_lpo_number_unique' => 'dropUnique', 'purchase_orders_bookshop_id_status_index' => 'dropIndex', 'purchase_orders_bookshop_id_expected_date_index' => 'dropIndex'] as $index => $method) {
            if (Schema::hasIndex('purchase_orders', $index)) Schema::table('purchase_orders', fn (Blueprint $t) => $t->{$method}($index));
        }
        foreach (['submitted_by', 'approved_by', 'confirmed_by', 'cancelled_by'] as $column) {
            if (Schema::hasColumn('purchase_orders', $column)) Schema::table('purchase_orders', fn (Blueprint $t) => $t->dropConstrainedForeignId($column));
        }
        $this->dropColumns('purchase_orders', ['lpo_number', 'order_date', 'delivery_location', 'payment_terms', 'internal_notes', 'supplier_notes', 'currency', 'tax_rate', 'prices_include_tax', 'subtotal', 'discount_total', 'tax_total', 'total', 'version', 'rejection_reason', 'cancellation_reason', 'submitted_at', 'approved_at', 'confirmed_at', 'cancelled_at', 'completed_at', 'delivery_method', 'email_status', 'email_last_attempt_at', 'email_sent_at', 'pdf_path', 'pdf_generated_at']);
        $this->dropColumns('suppliers', ['payment_terms', 'lead_time_days']);
    }

    private function dropColumns(string $table, array $columns): void
    {
        $present = array_values(array_filter($columns, fn ($column) => Schema::hasColumn($table, $column)));
        if ($present) Schema::table($table, fn (Blueprint $t) => $t->dropColumn($present));
    }
};
