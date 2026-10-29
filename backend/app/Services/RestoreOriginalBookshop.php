<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\Bookshop;
use App\Models\Branch;
use App\Models\BusinessProfile;
use App\Models\User;
use App\Support\Roles;
use Illuminate\Support\Facades\DB;
use RuntimeException;

final class RestoreOriginalBookshop
{
    private const TABLES = ['branches', 'business_profiles', 'tax_rates', 'books', 'authors', 'publishers', 'book_categories', 'suppliers', 'product_units', 'inventory_balances', 'inventory_movements', 'purchase_orders', 'goods_receipts', 'pos_sales'];

    public function run(?int $targetId, bool $apply, bool $confirmed): array
    {
        return DB::transaction(function () use ($targetId, $apply, $confirmed) {
            $email = strtolower(trim((string) config('platform.legacy_owner_email')));
            if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
                throw new RuntimeException('Configure the trusted SYSTEM_OWNER_EMAIL first.');
            }
            $users = User::whereRaw('LOWER(email) = ?', [$email])->lockForUpdate()->get();
            $owner = $users->first();
            if ($users->count() !== 1 || ! in_array($owner->role, [Roles::SYSTEM_OWNER, Roles::PLATFORM_OWNER], true) || ! $owner->is_active || ! $owner->hasVerifiedEmail()) {
                throw new RuntimeException('The trusted original administrator must be one active, verified System Owner or Platform Owner.');
            }
            $grant = DB::table('platform_bookshop_management')->where('user_id', $owner->id)->where('source', 'legacy_original')->lockForUpdate()->first();
            if ($grant && ($grant->revoked_at || ($targetId && $targetId !== (int) $grant->bookshop_id))) {
                throw new RuntimeException('The original management grant was revoked or points to a different bookshop. Reconcile it explicitly.');
            }
            $id = $targetId ?? ($grant ? (int) $grant->bookshop_id : $owner->bookshop_id);
            $owned = Bookshop::where('owner_user_id', $owner->id)->lockForUpdate()->get();
            if ($id === null && $owned->count() === 1) {
                $id = $owned->first()->id;
            }
            if ($id === null && $owned->count() > 1) {
                throw new RuntimeException('More than one owned bookshop exists. Specify --bookshop with the verified original ID.');
            }
            $shop = $id ? Bookshop::whereKey($id)->lockForUpdate()->first() : null;
            if ($id && ! $shop) {
                throw new RuntimeException('The selected bookshop does not exist.');
            }
            if ($shop && ! $grant && $shop->owner_user_id !== $owner->id) {
                throw new RuntimeException('The selected bookshop is not owned by the configured original administrator. No access granted.');
            }
            if ($owner->bookshop_id !== null && $owner->bookshop_id !== $shop?->id) {
                throw new RuntimeException('The original administrator belongs to another bookshop. Reconcile membership first.');
            }
            $counts = [];
            foreach (self::TABLES as $table) {
                $counts[$table] = DB::table($table)->whereNull('bookshop_id')->lockForUpdate()->pluck('id')->count();
            }
            if ($counts['business_profiles'] > 1 || ($shop && array_sum($counts) > 0 && $targetId === null)) {
                throw new RuntimeException('Legacy ownership is ambiguous: multiple profiles, or an existing bookshop alongside unassigned rows without an explicit --bookshop ID. Reconcile before restoring.');
            }
            if ($shop && $counts['business_profiles'] && BusinessProfile::withoutGlobalScope('bookshop')->where('bookshop_id', $shop->id)->exists()) {
                throw new RuntimeException('Both the existing bookshop and unassigned records have business profiles. Reconcile the profiles without deleting records first.');
            }
            $staff = User::whereKeyNot($owner->id)->whereNull('bookshop_id')
                ->whereNotIn('role', Roles::PLATFORM_ROLES)
                ->where(fn ($query) => $query->whereIn('role', [...Roles::TENANT_OWNER_ROLES, ...Roles::BRANCH_ROLES])->orWhereNotNull('staff_access_status'))
                ->lockForUpdate()->get();
            if ($staff->contains(fn ($user) => Roles::isTenantOwner($user->role))) {
                throw new RuntimeException('Another unassigned business owner exists. Legacy records cannot be attributed automatically.');
            }
            if ($grant && (array_sum($counts) > 0 || $staff->isNotEmpty())) {
                throw new RuntimeException('New unassigned records appeared after adoption. They require a separate ownership review.');
            }
            $this->validateReferences($shop?->id);
            foreach (['branches' => ['code'], 'tax_rates' => ['code'], 'books' => ['sku', 'isbn'], 'authors' => ['name'], 'publishers' => ['name'], 'book_categories' => ['name'], 'product_units' => ['barcode'], 'goods_receipts' => ['reference'], 'pos_sales' => ['idempotency_key']] as $table => $columns) {
                foreach ($columns as $column) {
                    $duplicate = DB::table($table)->select($column)->where(fn ($q) => $q->whereNull('bookshop_id')->when($shop, fn ($q) => $q->orWhere('bookshop_id', $shop->id)))
                        ->whereNotNull($column)->groupBy($column)->havingRaw('COUNT(*) > 1')->exists();
                    if ($duplicate) {
                        throw new RuntimeException("Duplicate {$table}.{$column} values would conflict during adoption. Reconcile them first.");
                    }
                }
            }
            $name = $shop?->name ?? DB::table('business_profiles')->whereNull('bookshop_id')->value('name') ?? 'Hekima Bookshop';
            $plan = ['administrator_id' => $owner->id, 'bookshop_id' => $shop?->id, 'bookshop_name' => $name, 'legacy_rows' => $counts, 'staff_ids' => $staff->pluck('id')->all(), 'applied' => false];
            if (! $apply) {
                return $plan;
            }
            if (! $confirmed && (array_sum($counts) > 0 || $staff->isNotEmpty())) {
                throw new RuntimeException('Review the dry-run inventory, then explicitly confirm ownership with --confirm-legacy-ownership.');
            }
            if ($grant) {
                return [...$plan, 'applied' => true];
            }
            if (! $shop) {
                $profile = DB::table('business_profiles')->whereNull('bookshop_id')->first();
                $shop = new Bookshop(['name' => $name, 'business_email' => $profile?->email ?? $owner->email,
                    'phone' => $profile?->phone, 'location' => $profile?->city ?? $profile?->address,
                    'country' => $profile?->country ?? 'Kenya', 'currency' => $profile?->currency ?? 'KES', 'timezone' => $profile?->timezone ?? 'Africa/Nairobi']);
                $shop->forceFill(['slug' => Bookshop::uniqueSlug($name), 'owner_user_id' => $owner->id, 'status' => Bookshop::STATUS_ACTIVE, 'registered_at' => now(), 'verified_at' => now()])->save();
            }
            foreach (self::TABLES as $table) {
                DB::table($table)->whereNull('bookshop_id')->update(['bookshop_id' => $shop->id]);
            }
            User::whereIn('id', $staff->pluck('id'))->update(['bookshop_id' => $shop->id]);
            DB::table('audit_logs')->whereNull('bookshop_id')->whereIn('user_id', [...$staff->pluck('id')->all(), $owner->id])
                ->where('action', 'not like', 'platform.%')->update(['bookshop_id' => $shop->id]);
            if (! Branch::withoutGlobalScope('bookshop')->where('bookshop_id', $shop->id)->exists()) {
                $branch = new Branch(['name' => 'Main Shop', 'code' => 'MAIN', 'city' => 'Nairobi']);
                $branch->forceFill(['bookshop_id' => $shop->id, 'is_main' => true])->save();
            }
            if (! BusinessProfile::withoutGlobalScope('bookshop')->where('bookshop_id', $shop->id)->exists()) {
                $profile = new BusinessProfile(['name' => $shop->name]);
                $profile->bookshop_id = $shop->id;
                $profile->save();
            }
            if (! $shop->subscription()->exists()) {
                app(SubscriptionService::class)->startLegacy($shop);
            }
            $before = ['role' => $owner->role, 'bookshop_id' => $owner->bookshop_id];
            $owner->branches()->detach();
            $owner->forceFill(['role' => Roles::PLATFORM_OWNER, 'bookshop_id' => null])->save();
            DB::table('platform_bookshop_management')->insert(['user_id' => $owner->id, 'bookshop_id' => $shop->id, 'source' => 'legacy_original', 'created_at' => now(), 'updated_at' => now()]);
            AuditLog::record('platform.original_bookshop_restored', 'Verified and authorized original bookshop management from the console', $shop,
                ['before' => $before, 'legacy_rows' => $counts, 'staff_ids' => $plan['staff_ids']], $owner, $shop->id);

            return [...$plan, 'bookshop_id' => $shop->id, 'applied' => true];
        });
    }

    private function validateReferences(?int $target): void
    {
        $relations = [
            ['books', 'publisher_id', 'publishers'], ['books', 'book_category_id', 'book_categories'],
            ['product_units', 'book_id', 'books'], ['inventory_balances', 'book_id', 'books'], ['inventory_balances', 'branch_id', 'branches'],
            ['inventory_movements', 'book_id', 'books'], ['inventory_movements', 'branch_id', 'branches'], ['inventory_movements', 'supplier_id', 'suppliers'], ['inventory_movements', 'product_unit_id', 'product_units'],
            ['purchase_orders', 'supplier_id', 'suppliers'], ['purchase_orders', 'branch_id', 'branches'], ['goods_receipts', 'purchase_order_id', 'purchase_orders'], ['pos_sales', 'branch_id', 'branches'],
        ];
        foreach ($relations as [$child, $column, $parent]) {
            $crossing = DB::table("{$child} as c")->join("{$parent} as p", "c.{$column}", '=', 'p.id')
                ->where(function ($query) use ($target) {
                    $query->where(fn ($q) => $q->whereNull('c.bookshop_id')->whereNotNull('p.bookshop_id')->when($target, fn ($q) => $q->where('p.bookshop_id', '!=', $target)))
                        ->orWhere(fn ($q) => $q->whereNull('p.bookshop_id')->whereNotNull('c.bookshop_id')->when($target, fn ($q) => $q->where('c.bookshop_id', '!=', $target)));
                })->exists();
            if ($crossing) {
                throw new RuntimeException("Cross-bookshop references found in {$child}. No records adopted.");
            }
        }
        // Item/pivot tables inherit their tenant from a parent and must not link to another tenant.
        foreach ([
            ['author_book', 'book_id', 'books', 'author_id', 'authors'],
            ['purchase_order_items', 'purchase_order_id', 'purchase_orders', 'book_id', 'books'],
            ['pos_sale_items', 'sale_id', 'pos_sales', 'book_id', 'books'],
        ] as [$items, $rootColumn, $root, $relatedColumn, $related]) {
            $crossing = DB::table("{$items} as i")->join("{$root} as r", "i.{$rootColumn}", '=', 'r.id')
                ->join("{$related} as b", "i.{$relatedColumn}", '=', 'b.id')
                ->where(fn ($q) => $q->where(fn ($q) => $q->whereNull('r.bookshop_id')->whereNotNull('b.bookshop_id')->when($target, fn ($q) => $q->where('b.bookshop_id', '!=', $target)))
                    ->orWhere(fn ($q) => $q->whereNull('b.bookshop_id')->whereNotNull('r.bookshop_id')->when($target, fn ($q) => $q->where('r.bookshop_id', '!=', $target))))->exists();
            if ($crossing) {
                throw new RuntimeException("Cross-bookshop item references found in {$items}. No records adopted.");
            }
        }
        $receiptLinks = DB::table('goods_receipt_items as i')->join('goods_receipts as r', 'i.goods_receipt_id', '=', 'r.id')
            ->join('purchase_order_items as pi', 'i.purchase_order_item_id', '=', 'pi.id')->join('purchase_orders as p', 'pi.purchase_order_id', '=', 'p.id')
            ->where(fn ($q) => $q->where(fn ($q) => $q->whereNull('r.bookshop_id')->whereNotNull('p.bookshop_id')->when($target, fn ($q) => $q->where('p.bookshop_id', '!=', $target)))
                ->orWhere(fn ($q) => $q->whereNull('p.bookshop_id')->whereNotNull('r.bookshop_id')->when($target, fn ($q) => $q->where('r.bookshop_id', '!=', $target))))->exists();
        if ($receiptLinks) {
            throw new RuntimeException('Cross-bookshop goods receipt item references found. No records adopted.');
        }
        $links = DB::table('branch_user as bu')->join('branches as b', 'bu.branch_id', '=', 'b.id')->join('users as u', 'bu.user_id', '=', 'u.id')
            ->where(fn ($q) => $q->where(fn ($q) => $q->whereNull('b.bookshop_id')->whereNotNull('u.bookshop_id')->when($target, fn ($q) => $q->where('u.bookshop_id', '!=', $target)))
                ->orWhere(fn ($q) => $q->whereNull('u.bookshop_id')->whereNotNull('b.bookshop_id')->when($target, fn ($q) => $q->where('b.bookshop_id', '!=', $target))))->exists();
        if ($links) {
            throw new RuntimeException('Legacy users and branches have existing tenant memberships. Reconcile before adoption.');
        }
    }
}
