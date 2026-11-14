<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Permanent, append-only history of manual trial extensions granted by the Platform Owner.
 * Rows are never updated or deleted by the application; the subscription itself keeps the live expiry.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('subscription_trial_extensions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bookshop_id')->constrained('bookshops')->restrictOnDelete();
            $table->foreignId('bookshop_subscription_id')->constrained('bookshop_subscriptions')->restrictOnDelete();
            $table->string('previous_status', 20);
            $table->dateTime('previous_trial_ends_at')->nullable();
            $table->dateTime('new_trial_ends_at');
            $table->unsignedSmallInteger('days_granted');
            // True when the trial had already lapsed and was restarted from the time of the extension.
            $table->boolean('reactivated')->default(false);
            $table->foreignId('extended_by')->nullable()->constrained('users')->nullOnDelete();
            // Snapshot so the history stays readable even if the operator account is later removed.
            $table->string('extended_by_name', 255)->nullable();
            $table->string('reason', 500)->nullable();
            // Client-generated key; a repeated submission returns the original grant instead of adding days again.
            $table->string('idempotency_key', 64)->unique();
            $table->timestamp('created_at')->useCurrent()->index();
            $table->index(['bookshop_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('subscription_trial_extensions');
    }
};
