<?php

use App\Services\Billing\SafPaymentBackfill;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * saf_payments: one ledger row per M-Pesa transaction received for platform subscriptions.
 * Additive only. platform_billing_payments and platform_payment_reconciliation_items stay in place
 * (the invoice paid-amount calculation still reads platform_billing_payments) and their history is
 * copied in with its original statuses.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('saf_payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bookshop_id')->nullable()->constrained('bookshops')->nullOnDelete();
            $table->foreignId('invoice_id')->nullable()->constrained('platform_billing_invoices')->restrictOnDelete();
            // The credited row in platform_billing_payments once the money is allocated to an invoice.
            $table->foreignId('platform_billing_payment_id')->nullable()->unique()->constrained('platform_billing_payments')->restrictOnDelete();
            // For STK payments: the initiated request this transaction belongs to.
            $table->foreignId('stk_attempt_id')->nullable()->constrained('platform_billing_payments')->restrictOnDelete();
            $table->string('account_number', 20)->nullable()->index();
            $table->string('mpesa_receipt_number', 30)->nullable();
            $table->string('phone_number', 20)->nullable();
            $table->decimal('amount', 12, 2);
            $table->decimal('allocated_amount', 12, 2)->default(0);
            $table->decimal('excess_amount', 12, 2)->default(0);
            $table->dateTime('transaction_date')->nullable();
            $table->string('shortcode', 20)->nullable();
            $table->string('payment_channel', 10);        // stk | paybill
            $table->string('environment', 16);            // production | sandbox | legacy
            // pending -> verified -> reconciled, or unmatched / rejected (exception queue).
            $table->string('verification_status', 20)->default('pending');
            $table->string('verification_source', 40)->nullable();
            $table->string('verification_request_id', 100)->nullable()->unique(); // our OriginatorConversationID
            $table->string('verification_conversation_id', 100)->nullable();     // Safaricom ConversationID
            $table->string('verification_reference', 255)->nullable();
            $table->timestamp('verified_at')->nullable();
            $table->unsignedSmallInteger('verification_attempts')->default(0);
            $table->timestamp('next_verification_at')->nullable();
            $table->string('provider_transaction_id', 100)->nullable();
            $table->json('provider_payload')->nullable();
            $table->string('exception_reason', 255)->nullable();
            $table->foreignId('resolved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('resolution_note')->nullable();
            $table->timestamp('reconciled_at')->nullable();
            $table->timestamp('confirmation_sent_at')->nullable();
            $table->timestamps();

            // A receipt can be credited once per environment; a provider transaction is recorded once per channel.
            $table->unique(['environment', 'mpesa_receipt_number'], 'saf_payments_env_receipt_unique');
            $table->unique(['environment', 'payment_channel', 'provider_transaction_id'], 'saf_payments_env_channel_tx_unique');
            $table->index(['verification_status', 'environment'], 'saf_payments_status_env_index');
            $table->index(['bookshop_id', 'transaction_date'], 'saf_payments_shop_date_index');
            $table->index(['verification_status', 'next_verification_at'], 'saf_payments_due_index');
        });

        app(SafPaymentBackfill::class)->run();
    }

    public function down(): void
    {
        Schema::dropIfExists('saf_payments');
    }
};
