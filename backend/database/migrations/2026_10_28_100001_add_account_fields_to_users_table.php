<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('phone', 30)->nullable()->after('email');
            $table->boolean('is_active')->default(true)->after('role')->index();
            $table->timestamp('last_login_at')->nullable()->after('is_active');
        });

        // Legacy workspace roles become cashiers, the closest match in the new role set.
        DB::table('users')->whereIn('role', ['user', 'staff'])->update(['role' => 'cashier']);

        Schema::table('users', function (Blueprint $table) {
            $table->string('role', 40)->default('cashier')->change();
        });
    }

    public function down(): void
    {
        DB::table('users')->whereIn('role', ['store_manager', 'cashier', 'inventory_officer'])->update(['role' => 'user']);

        Schema::table('users', function (Blueprint $table) {
            $table->string('role', 40)->default('staff')->change();
            $table->dropIndex(['is_active']);
            $table->dropColumn(['phone', 'is_active', 'last_login_at']);
        });
    }
};
