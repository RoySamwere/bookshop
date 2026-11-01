<?php

// Invoke through Artisan/Tinker ONLY in the isolated browser-test SQLite database.
if (app()->environment('production') || config('database.default') !== 'sqlite'
    || !str_ends_with((string) config('database.connections.sqlite.database'), 'ui-smoke.sqlite')) {
    throw new RuntimeException('Billing fixtures require the isolated ui-smoke.sqlite database.');
}
$user = App\Models\User::where('email', 'billing-smoke@example.test')->first();
if (!$user) {
    $shop = App\Models\Bookshop::factory()->create(['name' => 'Billing Browser Fixture']);
    $user = App\Models\User::factory()->forBookshop($shop)->create(['name' => 'Billing Browser', 'email' => 'billing-smoke@example.test', 'role' => 'bookshop_owner']);
    $shop->forceFill(['owner_user_id' => $user->id])->save();
    $subscription = new App\Models\BookshopSubscription(['status' => 'trialing', 'trial_starts_at' => now(), 'trial_ends_at' => now()->addDays(14)]);
    $subscription->bookshop_id = $shop->id;
    $subscription->save();
}
App\Models\SubscriptionPlan::firstOrCreate(['code' => 'browser-fixture-monthly'], ['name' => 'Browser monthly', 'price' => 1000, 'currency' => 'KES', 'billing_interval' => 'monthly', 'is_active' => true]);
