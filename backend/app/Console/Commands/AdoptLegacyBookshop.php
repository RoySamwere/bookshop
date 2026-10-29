<?php

namespace App\Console\Commands;

use App\Models\AuditLog;
use App\Models\Bookshop;
use App\Models\User;
use App\Services\SubscriptionService;
use App\Support\Roles;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Assigns the records of the original single-shop installation (bookshop_id NULL) to one explicitly
 * named bookshop. It is a dry run unless --apply is given, and it refuses whenever ownership cannot be
 * determined safely instead of guessing.
 */
class AdoptLegacyBookshop extends Command
{
    protected $signature = 'tenancy:adopt-legacy
        {--owner= : Email of the existing System Owner who will own the bookshop}
        {--name= : Bookshop name (defaults to the existing business profile name)}
        {--apply : Write the changes; without it nothing is changed}
        {--convert-owner : Change the owner\'s role from system_owner to bookshop_owner}';

    protected $description = 'Assign unreconciled legacy business records to a new bookshop tenant (dry run by default)';

    /** Tables whose legacy rows move with the business. Users, branches and audit entries are handled separately. */
    private const TABLES = [
        'business_profiles', 'tax_rates', 'books', 'authors', 'publishers', 'book_categories', 'suppliers', 'product_units',
        'inventory_balances', 'inventory_movements', 'purchase_orders', 'goods_receipts', 'pos_sales',
    ];

    public function handle(SubscriptionService $subscriptions): int
    {
        $counts = ['branches' => DB::table('branches')->whereNull('bookshop_id')->count()];
        foreach (self::TABLES as $table) {
            $counts[$table] = DB::table($table)->whereNull('bookshop_id')->count();
        }
        // Staff, plus customers who asked this business for staff access. Other customers stay platform-level.
        $staffQuery = User::whereNull('bookshop_id')->where(fn ($query) => $query
            ->whereIn('role', [...Roles::TENANT_OWNER_ROLES, ...Roles::BRANCH_ROLES])
            ->orWhere(fn ($applicant) => $applicant->where('role', Roles::CUSTOMER)->whereNotNull('staff_access_status')));
        $counts['staff users and staff applicants'] = (clone $staffQuery)->count();

        $this->table(['Legacy records without a bookshop', 'Rows'], collect($counts)->map(fn ($n, $t) => [$t, $n])->values()->all());

        if (array_sum($counts) === 0) {
            $this->info('Nothing to adopt: every business record already belongs to a bookshop.');

            return self::SUCCESS;
        }

        // Refuse anything ambiguous. A single-shop installation has at most one business profile.
        if ($counts['business_profiles'] > 1) {
            return $this->refuse('More than one unassigned business profile exists, so the legacy data may belong to several businesses. Reconcile it manually.');
        }
        $email = strtolower(trim((string) $this->option('owner')));
        if ($email === '') {
            return $this->refuse('Name the owner explicitly with --owner=email (the existing System Owner account).');
        }
        $owner = User::where('email', $email)->first();
        if (! $owner || $owner->bookshop_id !== null || ! $owner->isOwner()) {
            return $this->refuse("{$email} must be an existing System Owner (or Bookshop Owner) account that is not yet in a bookshop.");
        }
        $foreignBranchLinks = DB::table('branch_user')
            ->join('users', 'users.id', '=', 'branch_user.user_id')->join('branches', 'branches.id', '=', 'branch_user.branch_id')
            ->whereNull('users.bookshop_id')->whereNotNull('branches.bookshop_id')
            ->whereIn('users.role', [...Roles::TENANT_OWNER_ROLES, ...Roles::BRANCH_ROLES])->count();
        if ($foreignBranchLinks > 0) {
            return $this->refuse("{$foreignBranchLinks} unassigned staff account(s) are linked to branches of another bookshop. Reconcile those accounts first.");
        }

        $profileName = DB::table('business_profiles')->whereNull('bookshop_id')->value('name');
        $name = trim((string) ($this->option('name') ?: $profileName ?: 'Hekima Bookshop'));
        $this->line("Bookshop: <info>{$name}</info>  Owner: <info>{$owner->name} <{$owner->email}></info> ({$owner->role})");

        if (! $this->option('apply')) {
            $this->warn('Dry run: nothing was changed. Re-run with --apply after taking a database backup.');

            return self::SUCCESS;
        }

        $bookshop = DB::transaction(function () use ($name, $owner, $staffQuery, $subscriptions) {
            $profile = DB::table('business_profiles')->whereNull('bookshop_id')->first();
            $bookshop = new Bookshop([
                'name' => $name, 'business_email' => $profile->email ?? $owner->email, 'phone' => $profile->phone ?? null,
                'location' => $profile->city ?? null, 'country' => $profile->country ?? 'Kenya',
                'currency' => $profile->currency ?? 'KES', 'timezone' => $profile->timezone ?? 'Africa/Nairobi',
            ]);
            $bookshop->forceFill([
                'slug' => Bookshop::uniqueSlug($name), 'owner_user_id' => $owner->id, 'status' => Bookshop::STATUS_ACTIVE,
                'registered_at' => now(), 'verified_at' => now(),
            ])->save();

            $staffIds = (clone $staffQuery)->pluck('id');
            DB::table('users')->whereIn('id', $staffIds)->update(['bookshop_id' => $bookshop->id]);
            if ($this->option('convert-owner') && $owner->role === Roles::SYSTEM_OWNER) {
                $owner->forceFill(['role' => Roles::BOOKSHOP_OWNER])->save();
            }
            DB::table('branches')->whereNull('bookshop_id')->update(['bookshop_id' => $bookshop->id]);
            foreach (self::TABLES as $table) {
                DB::table($table)->whereNull('bookshop_id')->update(['bookshop_id' => $bookshop->id]);
            }
            // Activity by the adopted staff becomes this bookshop's history; platform entries stay global.
            DB::table('audit_logs')->whereNull('bookshop_id')->whereIn('user_id', $staffIds)
                ->where('action', 'not like', 'platform.%')->update(['bookshop_id' => $bookshop->id]);

            $subscriptions->startLegacy($bookshop);
            AuditLog::record('bookshop.legacy_adopted', "Adopted the existing business as bookshop {$bookshop->name}", $bookshop, [
                'owner' => $owner->email, 'staff' => $staffIds->count(),
            ], $owner, $bookshop->id);

            return $bookshop;
        });

        $this->info("Adopted into bookshop #{$bookshop->id} ({$bookshop->slug}).");

        return self::SUCCESS;
    }

    private function refuse(string $message): int
    {
        $this->error($message);
        $this->line('No changes were made.');

        return self::FAILURE;
    }
}
