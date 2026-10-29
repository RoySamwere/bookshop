<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\Bookshop;
use App\Models\User;
use App\Support\Roles;
use Illuminate\Support\Facades\DB;
use RuntimeException;

final class UpgradeLegacyPlatformOwner
{
    public function run(?int $replacementOwnerId = null, bool $dryRun = false, bool $promoteReplacementOwner = false): User
    {
        $email = strtolower(trim((string) config('platform.legacy_owner_email')));
        if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new RuntimeException('A valid trusted SYSTEM_OWNER_EMAIL must be configured.');
        }

        return DB::transaction(function () use ($email, $replacementOwnerId, $dryRun, $promoteReplacementOwner) {
            $matches = User::whereRaw('LOWER(email) = ?', [$email])->lockForUpdate()->get();
            if ($matches->count() !== 1) {
                throw new RuntimeException('Expected exactly one existing account matching SYSTEM_OWNER_EMAIL; no accounts changed.');
            }
            $user = $matches->first();
            if (! in_array($user->role, [Roles::SYSTEM_OWNER, Roles::PLATFORM_OWNER], true)) {
                throw new RuntimeException('The trusted account is not a legacy System Owner or Platform Owner; no accounts changed.');
            }
            $retainedDefaults = [];
            // Real legacy business data requires adoption; untouched installation defaults do not.
            if ($user->role === Roles::SYSTEM_OWNER && $user->bookshop_id === null) {
                foreach (['books', 'authors', 'publishers', 'book_categories', 'suppliers', 'product_units', 'inventory_balances', 'inventory_movements', 'purchase_orders', 'goods_receipts', 'pos_sales'] as $table) {
                    if (DB::table($table)->whereNull('bookshop_id')->exists()) {
                        throw new RuntimeException('Unassigned legacy business records exist. Adopt them into a bookshop with a separate verified tenant owner using tenancy:adopt-legacy before upgrading; no accounts changed.');
                    }
                }
                $retainedDefaults = $this->verifiedBootstrapDefaults($user);
            }
            $shops = Bookshop::where(function ($query) use ($user) {
                $query->where('owner_user_id', $user->id);
                if ($user->bookshop_id !== null) {
                    $query->orWhere('id', $user->bookshop_id);
                }
            })->lockForUpdate()->get();
            $transfers = [];
            $promotions = [];
            foreach ($shops as $shop) {
                $ownerId = $shop->owner_user_id === $user->id ? null : $shop->owner_user_id;
                $owner = User::whereKey($ownerId)->where('bookshop_id', $shop->id)
                    ->whereIn('role', Roles::TENANT_OWNER_ROLES)->where('is_active', true)->lockForUpdate()->first();
                if (! $owner) {
                    $replacement = User::whereKey($replacementOwnerId)->whereKeyNot($user->id)
                        ->where('bookshop_id', $shop->id)->whereIn('role', $promoteReplacementOwner ? [...Roles::TENANT_OWNER_ROLES, Roles::ADMIN] : Roles::TENANT_OWNER_ROLES)
                        ->where('is_active', true)->lockForUpdate()->first();
                    if (! $replacement) {
                        throw new RuntimeException("Bookshop {$shop->id} would lose its owner. Supply --replacement-owner with an active tenant owner from that bookshop, or explicitly add --promote-replacement-owner for its existing administrator; no accounts changed.");
                    }
                    $transfers[] = ['bookshop_id' => $shop->id, 'from' => $shop->owner_user_id, 'to' => $replacement->id];
                    if ($replacement->role === Roles::ADMIN) {
                        $promotions[] = ['user_id' => $replacement->id, 'from' => Roles::ADMIN, 'to' => Roles::BOOKSHOP_OWNER];
                    }
                }
            }
            $branchIds = $user->branches()->withoutGlobalScope('bookshop')->pluck('branches.id')->all();
            if ($dryRun || ($user->role === Roles::PLATFORM_OWNER && $user->bookshop_id === null && ! $branchIds && ! $transfers)) {
                return $user;
            }
            $before = ['role' => $user->role, 'bookshop_id' => $user->bookshop_id, 'branch_ids' => $branchIds];
            foreach ($promotions as $promotion) {
                User::whereKey($promotion['user_id'])->update(['role' => Roles::BOOKSHOP_OWNER]);
            }
            foreach ($transfers as $transfer) {
                Bookshop::whereKey($transfer['bookshop_id'])->update(['owner_user_id' => $transfer['to']]);
            }
            // Keep the account ID and all historical foreign keys; detach only access memberships.
            $user->branches()->detach();
            $user->forceFill(['role' => Roles::PLATFORM_OWNER, 'bookshop_id' => null])->save();
            AuditLog::record('platform.legacy_owner_upgraded', 'Upgraded the configured legacy administrator from the console', $user,
                ['before' => $before, 'after' => ['role' => Roles::PLATFORM_OWNER, 'bookshop_id' => null], 'ownership_transfers' => $transfers, 'owner_promotions' => $promotions, 'retained_bootstrap_defaults' => $retainedDefaults], actor: $user);

            return $user;
        });
    }

    /** Recognize only BusinessFoundationSeeder's unchanged defaults; never delete or reassign them. */
    private function verifiedBootstrapDefaults(User $user): array
    {
        $expected = [
            'business_profiles' => [[
                'name' => 'Hekima Bookshop', 'legal_name' => null, 'kra_pin' => null, 'email' => null,
                'phone' => null, 'website' => null, 'address' => null, 'city' => null,
                'country' => 'Kenya', 'currency' => 'KES', 'timezone' => 'Africa/Nairobi',
                'prices_include_tax' => 1, 'receipt_prefix' => 'NS', 'receipt_header' => null,
                'receipt_footer' => 'Thank you for shopping with Hekima Bookshop.', 'low_stock_threshold' => 10,
            ]],
            'branches' => [[
                'name' => 'Main Shop', 'code' => 'MAIN', 'email' => null, 'phone' => null,
                'address' => null, 'city' => 'Nairobi', 'is_main' => 1, 'is_active' => 1,
            ]],
            'tax_rates' => [
                ['name' => 'VAT 16%', 'code' => 'VAT16', 'rate' => 16, 'is_default' => 1, 'is_active' => 1],
                ['name' => 'Zero rated', 'code' => 'ZERO', 'rate' => 0, 'is_default' => 0, 'is_active' => 1],
                ['name' => 'Exempt', 'code' => 'EXEMPT', 'rate' => 0, 'is_default' => 0, 'is_active' => 1],
            ],
        ];
        $retained = [];
        foreach ($expected as $table => $defaults) {
            $rows = DB::table($table)->whereNull('bookshop_id')->orderBy('id')->lockForUpdate()->get();
            foreach ($rows as $row) {
                $values = array_diff_key((array) $row, array_flip(['id', 'bookshop_id', 'created_at', 'updated_at']));
                $match = null;
                foreach ($defaults as $index => $default) {
                    if (array_diff_key($values, $default) || array_diff_key($default, $values)) {
                        continue;
                    }
                    foreach ($default as $column => $value) {
                        if (! array_key_exists($column, $values) || ($value === null ? $values[$column] !== null
                            : ($column === 'rate' ? (float) $values[$column] !== (float) $value : (string) $values[$column] !== (string) $value))) {
                            continue 2;
                        }
                    }
                    $match = $index;
                    break;
                }
                if ($match === null) {
                    throw new RuntimeException("Unassigned {$table} contains customized or duplicate business settings. Adopt the legacy business before upgrading; no accounts changed.");
                }
                unset($defaults[$match]);
                $retained[$table][] = (int) $row->id;
            }
        }
        if (! $retained) {
            return [];
        }
        $otherStaff = User::whereKeyNot($user->id)->whereNull('bookshop_id')
            ->where(fn ($query) => $query->whereIn('role', [...Roles::TENANT_OWNER_ROLES, ...Roles::BRANCH_ROLES])->orWhereNotNull('staff_access_status'))
            ->lockForUpdate()->first();
        $branches = $retained['branches'] ?? [];
        if ($otherStaff || DB::table('branch_user')->whereIn('branch_id', $branches)->where('user_id', '!=', $user->id)->exists()) {
            throw new RuntimeException('Other accounts still use the legacy business setup. Adopt the business with its tenant owner before upgrading; no accounts changed.');
        }
        foreach (['inventory_balances', 'inventory_movements', 'purchase_orders', 'pos_sales'] as $table) {
            if (DB::table($table)->whereIn('branch_id', $branches)->exists()) {
                throw new RuntimeException('The legacy branch has business records. Reconcile its ownership before upgrading; no accounts changed.');
            }
        }

        return $retained;
    }
}
