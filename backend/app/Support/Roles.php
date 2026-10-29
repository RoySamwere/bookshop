<?php

namespace App\Support;

/**
 * Single source of truth for application roles and the permissions they grant.
 * The backend enforces these; the frontend only uses them to decide what to show.
 */
final class Roles
{
    // Platform roles have no tenant membership. A verified management context can grant the
    // Platform Owner tenant permissions for one explicitly authorized bookshop in that request.
    public const PLATFORM_OWNER = 'platform_owner';
    public const PLATFORM_ADMIN = 'platform_admin';

    // Tenant roles. Every one of them works inside exactly one bookshop.
    public const BOOKSHOP_OWNER = 'bookshop_owner';
    /** Legacy single-shop owner: full control of its own bookshop, kept so existing access survives the move to tenancy. */
    public const SYSTEM_OWNER = 'system_owner';
    public const ADMIN = 'admin';
    public const STORE_MANAGER = 'store_manager';
    public const CASHIER = 'cashier';
    public const INVENTORY_OFFICER = 'inventory_officer';
    public const CUSTOMER = 'customer';

    /** Business permissions; they only ever apply inside the user's own bookshop. */
    public const TENANT_PERMISSIONS = [
        'workspace.access', 'dashboard.view',
        'pos.access', 'sales.view', 'returns.process',
        'catalog.view', 'catalog.manage', 'inventory.view', 'inventory.manage',
        'suppliers.view', 'suppliers.manage', 'customers.view', 'customers.manage',
        'reports.view', 'finance.view', 'expenses.manage',
        'users.view', 'users.manage', 'branches.view', 'branches.manage',
        'settings.view', 'settings.manage', 'audit.view',
        'storefront.access',
    ];

    public const PLATFORM_PERMISSIONS = [
        'platform.access', 'platform.bookshops.view', 'platform.bookshops.onboard', 'platform.bookshops.suspend',
        'platform.users.view', 'platform.users.manage', 'platform.settings.view', 'platform.settings.manage',
        'platform.audit.view', 'platform.plans.view',
    ];

    public const PERMISSIONS = [...self::TENANT_PERMISSIONS, ...self::PLATFORM_PERMISSIONS];

    public const PLATFORM_ROLES = [self::PLATFORM_OWNER, self::PLATFORM_ADMIN];
    public const TENANT_OWNER_ROLES = [self::BOOKSHOP_OWNER, self::SYSTEM_OWNER];

    private const DEFINITIONS = [
        self::PLATFORM_OWNER => [
            'label' => 'Platform Owner',
            'description' => 'Administers the SaaS platform: bookshops, platform staff, plans and global settings. No access to bookshop business data.',
            'permissions' => 'platform',
        ],
        self::PLATFORM_ADMIN => [
            'label' => 'Platform Administrator',
            'description' => 'Supports bookshop onboarding and views platform records. Cannot suspend bookshops or manage platform staff.',
            'permissions' => [
                'platform.access', 'platform.bookshops.view', 'platform.bookshops.onboard',
                'platform.users.view', 'platform.settings.view', 'platform.audit.view', 'platform.plans.view',
            ],
        ],
        self::BOOKSHOP_OWNER => [
            'label' => 'Bookshop Owner',
            'description' => 'Full control of their own bookshop: profile, branches, staff, products, POS, stock, reports and settings.',
            'permissions' => '*',
        ],
        self::SYSTEM_OWNER => [
            'label' => 'System Owner',
            'description' => 'Full access to settings, users, branches, inventory, sales, finances and reports.',
            'permissions' => '*',
        ],
        self::ADMIN => [
            'label' => 'Administrator',
            'description' => 'Runs day-to-day operations, products, staff and reports within assigned branches.',
            'permissions' => [
                'workspace.access', 'dashboard.view', 'pos.access', 'sales.view', 'returns.process',
                'catalog.view', 'catalog.manage', 'inventory.view', 'inventory.manage',
                'suppliers.view', 'suppliers.manage', 'customers.view', 'customers.manage',
                'reports.view', 'expenses.manage', 'users.view', 'users.manage',
                'branches.view', 'settings.view', 'audit.view',
            ],
        ],
        self::STORE_MANAGER => [
            'label' => 'Store Manager',
            'description' => 'Oversees stock, sales, staff activity and store performance.',
            'permissions' => [
                'workspace.access', 'dashboard.view', 'pos.access', 'sales.view', 'returns.process',
                'catalog.view', 'inventory.view', 'suppliers.view', 'customers.view', 'customers.manage',
                'reports.view', 'users.view', 'branches.view', 'settings.view',
            ],
        ],
        self::CASHIER => [
            'label' => 'Cashier',
            'description' => 'Processes POS sales, payments, receipts and permitted returns.',
            'permissions' => [
                'workspace.access', 'dashboard.view', 'pos.access', 'sales.view', 'returns.process',
                'catalog.view', 'customers.view', 'customers.manage',
            ],
        ],
        self::INVENTORY_OFFICER => [
            'label' => 'Inventory Officer',
            'description' => 'Manages books, suppliers, stock receiving, transfers and adjustments.',
            'permissions' => [
                'workspace.access', 'dashboard.view', 'catalog.view', 'catalog.manage',
                'inventory.view', 'inventory.manage', 'suppliers.view', 'suppliers.manage',
            ],
        ],
        self::CUSTOMER => [
            'label' => 'Customer',
            'description' => 'Browses the online catalogue, places orders and manages their profile.',
            'permissions' => ['storefront.access'],
        ],
    ];

    /** Roles each role may assign when creating or editing accounts. */
    private const ASSIGNABLE = [
        self::PLATFORM_OWNER => [self::PLATFORM_ADMIN],
        self::BOOKSHOP_OWNER => [self::ADMIN, self::STORE_MANAGER, self::CASHIER, self::INVENTORY_OFFICER, self::CUSTOMER],
        self::SYSTEM_OWNER => [self::ADMIN, self::STORE_MANAGER, self::CASHIER, self::INVENTORY_OFFICER, self::CUSTOMER],
        self::ADMIN => [self::STORE_MANAGER, self::CASHIER, self::INVENTORY_OFFICER, self::CUSTOMER],
    ];

    /** Staff roles work inside branches; customers do not. */
    public const BRANCH_ROLES = [self::ADMIN, self::STORE_MANAGER, self::CASHIER, self::INVENTORY_OFFICER];

    public static function all(): array
    {
        return array_keys(self::DEFINITIONS);
    }

    public static function exists(?string $role): bool
    {
        return $role !== null && isset(self::DEFINITIONS[$role]);
    }

    public static function label(string $role): string
    {
        return self::DEFINITIONS[$role]['label'] ?? $role;
    }

    public static function permissionsFor(?string $role): array
    {
        if (! self::exists($role)) {
            return [];
        }
        $permissions = self::DEFINITIONS[$role]['permissions'];

        return match ($permissions) {
            '*' => self::TENANT_PERMISSIONS,
            'platform' => self::PLATFORM_PERMISSIONS,
            default => $permissions,
        };
    }

    public static function isPlatform(?string $role): bool
    {
        return in_array($role, self::PLATFORM_ROLES, true);
    }

    public static function isTenantOwner(?string $role): bool
    {
        return in_array($role, self::TENANT_OWNER_ROLES, true);
    }

    /** Roles that exist inside a bookshop, shown in the workspace role picker. */
    public static function tenantRoles(): array
    {
        return array_values(array_diff(self::all(), self::PLATFORM_ROLES));
    }

    public static function assignableBy(?string $role): array
    {
        return self::ASSIGNABLE[$role] ?? [];
    }

    public static function describe(string $role): array
    {
        return [
            'value' => $role,
            'label' => self::label($role),
            'description' => self::DEFINITIONS[$role]['description'],
            'permissions' => self::permissionsFor($role),
            'uses_branches' => in_array($role, self::BRANCH_ROLES, true),
        ];
    }
}
