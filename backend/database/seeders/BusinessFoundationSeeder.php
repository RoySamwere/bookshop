<?php

namespace Database\Seeders;

use App\Models\Branch;
use App\Models\BusinessProfile;
use App\Models\TaxRate;
use App\Models\User;
use App\Support\Roles;
use Illuminate\Database\Seeder;

/** Idempotent: safe to run on an existing database without overwriting saved settings. */
class BusinessFoundationSeeder extends Seeder
{
    public function run(): void
    {
        BusinessProfile::query()->firstOrCreate([], [
            'name' => 'Nifunze Bookshop',
            'country' => 'Kenya',
            'currency' => 'KES',
            'timezone' => 'Africa/Nairobi',
            'receipt_prefix' => 'NS',
            'receipt_footer' => 'Thank you for shopping with Nifunze Bookshop.',
        ]);

        $main = Branch::where('is_main', true)->first();
        if (! $main) {
            $main = new Branch(['name' => 'Main Shop', 'code' => 'MAIN', 'city' => 'Nairobi']);
            $main->forceFill(['is_main' => true, 'is_active' => true])->save();
        }

        if (! TaxRate::exists()) {
            TaxRate::create(['name' => 'VAT 16%', 'code' => 'VAT16', 'rate' => 16, 'is_default' => true]);
            TaxRate::create(['name' => 'Zero rated', 'code' => 'ZERO', 'rate' => 0]);
            TaxRate::create(['name' => 'Exempt', 'code' => 'EXEMPT', 'rate' => 0]);
        }

        // Existing staff created before branches existed start in the main branch.
        User::whereIn('role', [Roles::SYSTEM_OWNER, ...Roles::BRANCH_ROLES])->whereDoesntHave('branches')->get()
            ->each(fn (User $user) => $user->branches()->attach($main->id));
    }
}
