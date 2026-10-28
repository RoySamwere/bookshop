<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Additive: public registration and staff-access approval.
 * Existing accounts keep every value they have; the new columns start empty.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->string('registration_source', 20)->nullable()->after('created_by');
            $table->timestamp('terms_accepted_at')->nullable()->after('registration_source');
            // null = never requested; pending | approved | rejected otherwise.
            $table->string('staff_access_status', 20)->nullable()->after('terms_accepted_at')->index();
            $table->timestamp('staff_access_requested_at')->nullable()->after('staff_access_status');
            $table->timestamp('staff_access_reviewed_at')->nullable()->after('staff_access_requested_at');
            $table->foreignId('staff_access_reviewed_by')->nullable()->after('staff_access_reviewed_at')
                ->constrained('users')->nullOnDelete();
            $table->string('staff_access_note', 500)->nullable()->after('staff_access_reviewed_by');
        });
    }

    public function down(): void
    {
        Schema::table('users', function (Blueprint $table) {
            $table->dropConstrainedForeignId('staff_access_reviewed_by');
            $table->dropIndex(['staff_access_status']);
            $table->dropColumn([
                'registration_source', 'terms_accepted_at', 'staff_access_status',
                'staff_access_requested_at', 'staff_access_reviewed_at', 'staff_access_note',
            ]);
        });
    }
};
