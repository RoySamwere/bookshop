<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Additive: every bookshop-owned table gets a nullable bookshop_id. Existing rows stay NULL
 * ("legacy, not yet reconciled") until `php artisan tenancy:adopt-legacy` assigns them explicitly;
 * nothing is guessed here. Unique business codes become unique per bookshop instead of globally.
 *
 * Child rows that are only reachable through a scoped parent inherit its bookshop:
 * author_book (books), purchase_order_items and goods_receipt_items (purchase orders),
 * pos_sale_items (pos_sales) and branch_user (branches + users).
 */
return new class extends Migration {
    /** table => [single-column uniques that become (bookshop_id, column)] */
    private const TABLES = [
        'business_profiles' => [],
        'tax_rates' => ['code'],
        'books' => ['sku', 'isbn'],
        'authors' => ['name'],
        'publishers' => ['name'],
        'book_categories' => ['name'],
        'suppliers' => [],
        'product_units' => ['barcode'],
        'inventory_balances' => [],
        'inventory_movements' => [],
        'purchase_orders' => [],
        'goods_receipts' => ['reference'],
        'pos_sales' => ['idempotency_key'],
        'audit_logs' => [],
    ];

    public function up(): void
    {
        foreach (self::TABLES as $name => $uniques) {
            Schema::table($name, function (Blueprint $table) use ($uniques) {
                // Business records are never deleted with a bookshop; suspension is the off switch.
                $table->foreignId('bookshop_id')->nullable()->constrained('bookshops')->restrictOnDelete();
                foreach ($uniques as $column) {
                    $table->dropUnique([$column]);
                    $table->unique(['bookshop_id', $column]);
                }
            });
        }

        Schema::table('branches', function (Blueprint $table) {
            $table->dropUnique(['code']);
            $table->unique(['bookshop_id', 'code']);
        });
    }

    /**
     * Restores the global uniques. This only succeeds while no two bookshops share a code,
     * SKU, ISBN or reference; once they do, roll back by restoring the pre-deployment backup.
     */
    public function down(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            $table->dropUnique(['bookshop_id', 'code']);
            $table->unique('code');
        });

        foreach (array_reverse(self::TABLES, true) as $name => $uniques) {
            Schema::table($name, function (Blueprint $table) use ($uniques) {
                // MySQL refuses to drop an index that still backs a foreign key, so the key goes first.
                $table->dropForeign(['bookshop_id']);
                foreach ($uniques as $column) {
                    $table->dropUnique(['bookshop_id', $column]);
                    $table->unique($column);
                }
                $table->dropColumn('bookshop_id');
            });
        }
    }
};
