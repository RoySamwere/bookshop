<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Platform communication: editable email templates (overrides of built-in defaults), Platform Owner
 * announcements, and one delivery log row per recipient and message. In-app copies still use the
 * existing notifications table; queued sending uses the existing jobs table.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('communication_templates', function (Blueprint $table) {
            $table->string('key', 40)->primary();
            $table->string('subject', 200);
            $table->text('body');
            $table->boolean('is_enabled')->default(true);
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('announcements', function (Blueprint $table) {
            $table->id();
            $table->string('subject', 200);
            $table->text('body');
            // update | maintenance | feature | general
            $table->string('category', 20);
            // all | selected
            $table->string('audience', 10);
            $table->json('bookshop_ids')->nullable();
            // owners | staff
            $table->string('recipients', 10);
            $table->unsignedInteger('recipient_count')->default(0);
            // Client key: submitting the same compose form twice sends one announcement.
            $table->string('idempotency_key', 64)->unique();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('communication_logs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bookshop_id')->nullable()->constrained('bookshops')->nullOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('announcement_id')->nullable()->constrained('announcements')->nullOnDelete();
            $table->string('event', 40)->index();
            $table->string('recipient_email');
            $table->string('recipient_name')->nullable();
            $table->string('subject', 200);
            $table->text('body');
            // queued | sending | sent | failed
            $table->string('status', 10)->default('queued')->index();
            $table->unsignedSmallInteger('attempts')->default(0);
            $table->string('last_error', 500)->nullable();
            // One message per recipient per occurrence; repeats of the same event are ignored.
            $table->string('dedupe_key', 191)->unique();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('sent_at')->nullable();
            $table->timestamp('failed_at')->nullable();
            $table->timestamps();
            $table->index(['bookshop_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('communication_logs');
        Schema::dropIfExists('announcements');
        Schema::dropIfExists('communication_templates');
    }
};
