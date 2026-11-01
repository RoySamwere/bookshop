<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('platform_billing_invoices', function (Blueprint $table) {
            $table->string('account_number', 6)->change();
        });
    }

    public function down(): void
    {
        // Do not shrink account references: existing six-digit accounts must remain valid.
    }
};
