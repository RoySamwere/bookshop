<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // bookshop_registration is 21 characters; the original VARCHAR(20) fails on strict MySQL.
        Schema::table('users', function (Blueprint $table) {
            $table->string('registration_source', 64)->nullable()->change();
        });

        // Registration accepts a 255-character business location and stores it in both profiles.
        foreach (['branches', 'business_profiles'] as $name) {
            Schema::table($name, function (Blueprint $table) {
                $table->string('city', 255)->nullable()->change();
            });
        }
    }

    public function down(): void
    {
        // Intentionally keep the wider columns: narrowing them can truncate valid existing data.
        // Older application versions can read these columns without a schema rollback.
    }
};
