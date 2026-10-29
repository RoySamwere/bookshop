<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('bookshops', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->foreignId('owner_user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::table('users', function (Blueprint $table) {
            $table->foreignId('bookshop_id')->nullable()->after('id')->constrained('bookshops')->nullOnDelete();
            $table->index(['bookshop_id', 'role']);
        });

        Schema::table('branches', function (Blueprint $table) {
            $table->foreignId('bookshop_id')->nullable()->constrained('bookshops')->nullOnDelete();
            $table->index('bookshop_id');
        });
    }

    public function down(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            $table->dropConstrainedForeignId('bookshop_id');
        });
        Schema::table('users', function (Blueprint $table) {
            $table->dropIndex(['bookshop_id', 'role']);
            $table->dropConstrainedForeignId('bookshop_id');
        });
        Schema::dropIfExists('bookshops');
    }
};
