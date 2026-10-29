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
    public function run(?int $replacementOwnerId = null, bool $dryRun = false): User
    {
        $email = strtolower(trim((string) config('platform.legacy_owner_email')));
        if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new RuntimeException('A valid trusted SYSTEM_OWNER_EMAIL must be configured.');
        }

        return DB::transaction(function () use ($email, $replacementOwnerId, $dryRun) {
            $matches = User::whereRaw('LOWER(email) = ?', [$email])->lockForUpdate()->get();
            if ($matches->count() !== 1) {
                throw new RuntimeException('Expected exactly one existing account matching SYSTEM_OWNER_EMAIL; no accounts changed.');
            }
            $user = $matches->first();
            if (! in_array($user->role, [Roles::SYSTEM_OWNER, Roles::PLATFORM_OWNER], true)) {
                throw new RuntimeException('The trusted account is not a legacy System Owner or Platform Owner; no accounts changed.');
            }
            // Unadopted single-shop records have no bookshop ownership pointer yet.
            if ($user->role === Roles::SYSTEM_OWNER && $user->bookshop_id === null) {
                foreach (['branches', 'business_profiles', 'tax_rates', 'books', 'authors', 'publishers', 'book_categories', 'suppliers', 'product_units', 'inventory_balances', 'inventory_movements', 'purchase_orders', 'goods_receipts', 'pos_sales'] as $table) {
                    if (DB::table($table)->whereNull('bookshop_id')->exists()) {
                        throw new RuntimeException('Unassigned legacy business records exist. Adopt them into a bookshop with a separate verified tenant owner using tenancy:adopt-legacy before upgrading; no accounts changed.');
                    }
                }
            }
            $shops = Bookshop::where(function ($query) use ($user) {
                $query->where('owner_user_id', $user->id);
                if ($user->bookshop_id !== null) {
                    $query->orWhere('id', $user->bookshop_id);
                }
            })->lockForUpdate()->get();
            $transfers = [];
            foreach ($shops as $shop) {
                $ownerId = $shop->owner_user_id === $user->id ? null : $shop->owner_user_id;
                $owner = User::whereKey($ownerId)->where('bookshop_id', $shop->id)
                    ->whereIn('role', Roles::TENANT_OWNER_ROLES)->where('is_active', true)->lockForUpdate()->first();
                if (! $owner) {
                    $replacement = User::whereKey($replacementOwnerId)->whereKeyNot($user->id)
                        ->where('bookshop_id', $shop->id)->whereIn('role', Roles::TENANT_OWNER_ROLES)
                        ->where('is_active', true)->lockForUpdate()->first();
                    if (! $replacement) {
                        throw new RuntimeException("Bookshop {$shop->id} would lose its owner. Supply --replacement-owner with an active tenant owner from that bookshop; no accounts changed.");
                    }
                    $transfers[] = ['bookshop_id' => $shop->id, 'from' => $shop->owner_user_id, 'to' => $replacement->id];
                }
            }
            $branchIds = $user->branches()->withoutGlobalScope('bookshop')->pluck('branches.id')->all();
            if ($dryRun || ($user->role === Roles::PLATFORM_OWNER && $user->bookshop_id === null && ! $branchIds && ! $transfers)) {
                return $user;
            }
            $before = ['role' => $user->role, 'bookshop_id' => $user->bookshop_id, 'branch_ids' => $branchIds];
            foreach ($transfers as $transfer) {
                Bookshop::whereKey($transfer['bookshop_id'])->update(['owner_user_id' => $transfer['to']]);
            }
            // Keep the account ID and all historical foreign keys; detach only access memberships.
            $user->branches()->detach();
            $user->forceFill(['role' => Roles::PLATFORM_OWNER, 'bookshop_id' => null])->save();
            AuditLog::record('platform.legacy_owner_upgraded', 'Upgraded the configured legacy administrator from the console', $user,
                ['before' => $before, 'after' => ['role' => Roles::PLATFORM_OWNER, 'bookshop_id' => null], 'ownership_transfers' => $transfers], actor: $user);

            return $user;
        });
    }
}
