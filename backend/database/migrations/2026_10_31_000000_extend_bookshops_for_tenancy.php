<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

/**
 * Additive: the bookshop (tenant) profile, lifecycle status and verification timestamps.
 * Any existing bookshop rows keep their data; slugs and status are derived from what is there.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('bookshops', function (Blueprint $table) {
            $table->string('slug', 80)->nullable()->after('id');
            $table->string('business_email')->nullable()->after('name');
            $table->string('phone', 30)->nullable()->after('business_email');
            $table->string('location')->nullable()->after('phone');
            $table->string('country', 100)->default('Kenya')->after('location');
            $table->string('currency', 3)->default('KES')->after('country');
            $table->string('timezone', 64)->default('Africa/Nairobi')->after('currency');
            // pending_verification | active | suspended
            $table->string('status', 30)->default('active')->after('owner_user_id')->index();
            $table->timestamp('registered_at')->nullable()->after('is_active');
            $table->timestamp('verified_at')->nullable()->after('registered_at');
            $table->timestamp('suspended_at')->nullable()->after('verified_at');
            $table->string('suspension_reason', 500)->nullable()->after('suspended_at');
        });

        foreach (DB::table('bookshops')->get() as $bookshop) {
            DB::table('bookshops')->where('id', $bookshop->id)->update([
                'slug' => Str::limit(Str::slug($bookshop->name) ?: 'bookshop', 60, '').'-'.$bookshop->id,
                'status' => $bookshop->is_active ? 'active' : 'suspended',
                'registered_at' => $bookshop->created_at,
            ]);
        }

        Schema::table('bookshops', function (Blueprint $table) {
            $table->unique('slug');
        });
    }

    public function down(): void
    {
        Schema::table('bookshops', function (Blueprint $table) {
            $table->dropUnique(['slug']);
            $table->dropIndex(['status']);
            $table->dropColumn([
                'slug', 'business_email', 'phone', 'location', 'country', 'currency', 'timezone',
                'status', 'registered_at', 'verified_at', 'suspended_at', 'suspension_reason',
            ]);
        });
    }
};
