<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Subscription-ready structures only: no payments, checkout or automatic charging.
 * Plans and their entitlements are global reference data; subscriptions belong to a bookshop.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('subscription_plans', function (Blueprint $table) {
            $table->id();
            $table->string('code', 40)->unique();
            $table->string('name', 100);
            $table->string('description', 500)->nullable();
            $table->decimal('price', 12, 2)->default(0);
            $table->string('currency', 3)->default('KES');
            $table->string('billing_interval', 20)->default('monthly');
            $table->unsignedSmallInteger('trial_days')->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->timestamps();
        });

        // A NULL limit means unlimited; is_enabled switches a feature on or off for the plan.
        Schema::create('plan_features', function (Blueprint $table) {
            $table->id();
            $table->foreignId('subscription_plan_id')->constrained()->cascadeOnDelete();
            $table->string('feature', 60);
            $table->boolean('is_enabled')->default(true);
            $table->unsignedInteger('limit')->nullable();
            $table->timestamps();
            $table->unique(['subscription_plan_id', 'feature']);
        });

        Schema::create('bookshop_subscriptions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bookshop_id')->unique()->constrained('bookshops')->restrictOnDelete();
            $table->foreignId('subscription_plan_id')->nullable()->constrained()->nullOnDelete();
            // trialing | active | past_due | grace_period | suspended | cancelled | expired
            $table->string('status', 20)->index();
            $table->timestamp('trial_starts_at')->nullable();
            $table->timestamp('trial_ends_at')->nullable();
            $table->timestamp('current_period_starts_at')->nullable();
            $table->timestamp('current_period_ends_at')->nullable();
            $table->timestamp('grace_ends_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamps();
        });

        Schema::create('subscription_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bookshop_id')->constrained('bookshops')->restrictOnDelete();
            $table->foreignId('bookshop_subscription_id')->constrained()->cascadeOnDelete();
            $table->foreignId('subscription_plan_id')->nullable()->constrained()->nullOnDelete();
            $table->string('event', 40);
            $table->string('from_status', 20)->nullable();
            $table->string('to_status', 20);
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('note', 500)->nullable();
            $table->timestamp('created_at')->useCurrent()->index();
        });

        Schema::create('platform_settings', function (Blueprint $table) {
            $table->string('key', 80)->primary();
            $table->json('value')->nullable();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        $now = now();
        $plan = DB::table('subscription_plans')->insertGetId([
            'code' => 'starter', 'name' => 'Starter', 'description' => 'Default plan for new bookshops during the trial.',
            'price' => 0, 'currency' => 'KES', 'billing_interval' => 'monthly', 'trial_days' => null,
            'is_active' => true, 'sort_order' => 1, 'created_at' => $now, 'updated_at' => $now,
        ]);
        foreach (['branches.max' => null, 'users.max' => null, 'pos' => null, 'inventory' => null, 'reports' => null] as $feature => $limit) {
            DB::table('plan_features')->insert([
                'subscription_plan_id' => $plan, 'feature' => $feature, 'is_enabled' => true, 'limit' => $limit,
                'created_at' => $now, 'updated_at' => $now,
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('platform_settings');
        Schema::dropIfExists('subscription_events');
        Schema::dropIfExists('bookshop_subscriptions');
        Schema::dropIfExists('plan_features');
        Schema::dropIfExists('subscription_plans');
    }
};
