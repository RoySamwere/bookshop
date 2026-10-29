<?php

namespace Database\Seeders;

use App\Models\Bookshop;
use App\Models\Branch;
use App\Models\BusinessProfile;
use App\Models\TaxRate;
use App\Models\User;
use App\Support\Roles;
use Illuminate\Database\Seeder;

/**
 * Idempotent: safe to run on an existing database without overwriting saved settings.
 * Defaults are ensured inside each bookshop separately, so nothing is ever attached across bookshops.
 * Legacy rows that are not yet assigned to a bookshop (bookshop_id NULL) are only matched with each other.
 */
class BusinessFoundationSeeder extends Seeder
{
    public function run(): void
    {
        foreach (Bookshop::all() as $bookshop) {
            $this->ensureDefaults($bookshop->id, $bookshop->name, $bookshop->country === 'Kenya');
        }

        $legacyStaff = User::whereNull('bookshop_id')->whereIn('role', [Roles::SYSTEM_OWNER, ...Roles::BRANCH_ROLES])->exists();
        if ($legacyStaff) {
            $this->ensureDefaults(null, 'Hekima Bookshop', true);
        }
    }

    private function ensureDefaults(?int $bookshopId, string $name, bool $kenyanTaxes): void
    {
        $profile = BusinessProfile::query()->where('bookshop_id', $bookshopId)->first();
        if (! $profile) {
            $profile = new BusinessProfile([
                'name' => $name,
                'country' => 'Kenya',
                'currency' => 'KES',
                'timezone' => 'Africa/Nairobi',
                'receipt_prefix' => 'NS',
                'receipt_footer' => "Thank you for shopping with {$name}.",
            ]);
            $profile->bookshop_id = $bookshopId;
            $profile->save();
        }

        $main = Branch::query()->where('bookshop_id', $bookshopId)->where('is_main', true)->first();
        if (! $main) {
            $main = new Branch(['name' => 'Main Shop', 'code' => 'MAIN', 'city' => 'Nairobi']);
            $main->forceFill(['bookshop_id' => $bookshopId, 'is_main' => true, 'is_active' => true])->save();
        }

        if ($kenyanTaxes && ! TaxRate::query()->where('bookshop_id', $bookshopId)->exists()) {
            foreach ([['VAT 16%', 'VAT16', 16, true], ['Zero rated', 'ZERO', 0, false], ['Exempt', 'EXEMPT', 0, false]] as [$taxName, $code, $rate, $default]) {
                $tax = new TaxRate(['name' => $taxName, 'code' => $code, 'rate' => $rate, 'is_default' => $default]);
                $tax->bookshop_id = $bookshopId;
                $tax->save();
            }
        }

        // Existing staff created before branches existed start in their own bookshop's main branch.
        User::where('bookshop_id', $bookshopId)->whereIn('role', [...Roles::TENANT_OWNER_ROLES, ...Roles::BRANCH_ROLES])
            ->whereDoesntHave('branches')->get()
            ->each(fn (User $user) => $user->branches()->attach($main->id));
    }
}
