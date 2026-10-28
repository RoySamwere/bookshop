<?php

namespace App\Support;

/**
 * Single source of truth for application roles and the permissions they grant.
 * The backend enforces these; the frontend only uses them to decide what to show.
 */
final class Roles
{
    public const SYSTEM_OWNER = 'system_owner';
    public const ADMIN = 'admin';
    public const STORE_MANAGER = 'store_manager';
    public const CASHIER = 'cashier';
    public const INVENTORY_OFFICER = 'inventory_officer';
    public const CUSTOMER = 'customer';

    public const PERMISSIONS = [
        'workspace.access', 'dashboard.view',
        'pos.access', 'sales.view', 'returns.process',
        'catalog.view', 'catalog.manage', 'inventory.view', 'inventory.manage',
        'suppliers.view', 'suppliers.manage', 'customers.view', 'customers.manage',
        'reports.view', 'finance.view', 'expenses.manage',
        'users.view', 'users.manage', 'branches.view', 'branches.manage',
        'settings.view', 'settings.manage', 'audit.view',
        'storefront.access',
    ];

    private const DEFINITIONS = [
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

        return $permissions === '*' ? self::PERMISSIONS : $permissions;
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
