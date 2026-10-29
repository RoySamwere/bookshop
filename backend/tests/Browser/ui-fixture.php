<?php

// Used only by the Chrome UI check against its disposable SQLite database.
use App\Models\Branch;
use App\Models\BusinessProfile;
use App\Models\TaxRate;
use App\Models\User;
use Illuminate\Support\Facades\DB;

if (config('database.default') !== 'sqlite' || ! str_ends_with((string) config('database.connections.sqlite.database'), 'ui-smoke.sqlite')) {
    throw new RuntimeException('UI fixtures require the dedicated ui-smoke.sqlite database.');
}
$branch = Branch::factory()->main()->create(['name' => 'Main Shop']);
$user = User::factory()->inBranches($branch)->create(['name' => 'Roy Sam', 'email' => 'spa-smoke@example.test', 'role' => 'system_owner']);
BusinessProfile::create(['name' => 'Hekima Bookshop', 'timezone' => 'Africa/Nairobi', 'prices_include_tax' => true]);
TaxRate::create(['name' => 'VAT', 'code' => 'VAT', 'rate' => 16, 'is_default' => true, 'is_active' => true]);
$categories = [];
foreach (['Educational books', 'School stationery', 'Literature', 'Office', 'Arts & gifts'] as $name) {
    $categories[] = DB::table('product_categories')->insertGetId(['name' => $name]);
}
$specs = [
    ["Grade 7 Integrated Science Learner's Book", 890, 43, 0, 'CBC curriculum'],
    ["Grade 8 Mathematics Learner's Book", 920, 50, 0, 'CBC curriculum'],
    ['KCSE Mathematics Revision Guide', 650, 19, 0, 'Revision and past papers'],
    ['Kamusi ya Kiswahili Sanifu', 1650, 3, 0, 'General reference'],
    ['Exercise Book A4 · 96 pages · Ruled', 60, 456, 1, 'Exercise books'],
    ['Exercise Book A5 · 200 pages · Ruled', 85, 260, 1, 'Exercise books'],
    ['Geometry Set · 9 pieces', 180, 45, 1, 'Mathematical instruments'],
    ['Scientific Calculator FX-82MS', 1850, 2, 1, 'Mathematical instruments'],
    ['Ballpoint Pen · Blue', 25, 297, 3, 'Writing materials'],
    ['A4 Photocopy Paper · 500 sheets', 720, 48, 3, 'Paper supplies'],
    ['Blossoms of the Savannah', 560, 21, 2, 'National exam set books'],
    ['Scrabble Junior', 2600, 0, 4, 'Games and gifting'],
];
foreach ($specs as $index => [$title, $price, $stock, $category, $subName]) {
    $sub = DB::table('product_subcategories')->where('name', $subName)->value('id') ?: DB::table('product_subcategories')->insertGetId(['product_category_id' => $categories[$category], 'name' => $subName]);
    $book = DB::table('books')->insertGetId(['title' => $title, 'sku' => 'UI-'.($index + 1), 'selling_price' => $price, 'reorder_level' => 5, 'product_subcategory_id' => $sub]);
    DB::table('inventory_balances')->insert(['branch_id' => $branch->id, 'book_id' => $book, 'quantity' => $stock, 'reserved' => 0]);
    if ($index < 5) {
        $sale = DB::table('pos_sales')->insertGetId(['idempotency_key' => 'ui-history-'.$index, 'receipt_number' => 'HK-'.(1280 + $index), 'branch_id' => $branch->id, 'cashier_id' => $user->id, 'total' => $price * ($index + 1), 'subtotal' => $price * ($index + 1), 'payment_method' => ['mpesa', 'cash', 'card'][$index % 3], 'amount_received' => $price * ($index + 1), 'created_at' => now()->subMinutes(($index + 1) * 45), 'updated_at' => now()]);
        DB::table('pos_sale_items')->insert(['sale_id' => $sale, 'book_id' => $book, 'title' => $title, 'sku' => 'UI-'.($index + 1), 'quantity' => $index + 1, 'unit_price' => $price, 'line_total' => $price * ($index + 1)]);
    }
}
