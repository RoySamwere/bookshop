# React migration audit and plan

Audit date: 2026-10-29. Existing files were inspected before implementation.

## Actual starting architecture

The repository already separates Laravel 12 (`backend`) and React 19 / Next.js 16 (`frontend`). It is not a Blade/Livewire application: the only Blade view is Laravel's welcome page. No Livewire components or Alpine application functionality were found. Existing React screens and Laravel controllers must be retained during migration.

Routes: public home, terms, login, register, forgot/reset password, verify email; protected account, dashboard, and dashboard/catalog. Dashboard sections use `?section=`. Existing layouts include public auth pages, WorkspaceShell, and a dedicated POS mode. All existing API routes live in `backend/routes/api.php`.

## Workflow inventory

| Module | Existing frontend / backend | Migration needs |
| --- | --- | --- |
| Authentication | Login, logout, profile, password changes/recovery; Sanctum bearer tokens in browser storage | Cookie SPA auth, CSRF, credentials, server session inactivity; preserve legacy token API |
| Registration | Customer registration, email verification, staff approval/rejection and audit history | Preserve flow; **bookshop owner registration is absent** and must be implemented separately |
| Dashboard | OverviewDashboard; derives summaries from existing endpoints | Dedicated aggregate API, branch filtering, real charts |
| Products | Product listing, catalog hierarchy, imports, exports, units | Preserve APIs and management UI, add missing edit/bulk workflows |
| Inventory | Balances, movement history, receiving, adjustments, transfers, purchase orders/receiving | Preserve InventoryService transactions and branch checks; stocktaking absent |
| POS / sales | Real catalogue, stock limits, draft/held carts, payment references, idempotent checkout, locked stock, receipts, sales history | Keep server totals and transactions; verify Vite routing/printing and query migration |
| Suppliers | Directory/create + purchase orders | Edit profiles, payments |
| Customers | Sample-data screen | Real tenant-scoped schema/APIs/forms/history required |
| Employees | Users, roles, branch assignment, activation, staff approval, audit | Preserve policies and permissions |
| Finance / reports | Preview/unfinished sections | Expenses, reconciliation, reports/export APIs and screens required |
| Settings | Business profile, branches, taxes, receipts/preferences | Preserve existing APIs; tenant scoping required |
| System owner | Role and user administration exist | Platform bookshop administration absent |
| Public | Launch signup and marketing landing page, terms | Full storefront/about/features remain to implement |

## Security findings / release gates

`bookshops`, `users.bookshop_id`, and `branches.bookshop_id` exist, but bookshop isolation is incomplete. Catalog/supplier/business queries are shared and branch visibility is not a substitute for tenant isolation. Do not claim this is a production-ready multi-tenant service. Before tenant rollout: add tenant ownership to domain tables, backfill only through an explicitly reviewed migration, implement tenant middleware and query scopes for DB query-builder controllers, constrain validation and writes, distinguish shop admins from platform owners, and test cross-tenant reads/writes/exports. No existing business records should be rewritten during the frontend foundation work.

Tenant isolation (Milestone 1) is implemented; see [MULTI_TENANCY.md](MULTI_TENANCY.md) for the design, data classification, legacy adoption and deployment steps.

## Sequence and API compatibility

1. Establish Vite, TypeScript, React Router, Tailwind and lazy public/protected routes while keeping existing React components. Add test/build commands and deploy documentation.
2. Cookie-based Sanctum SPA login/logout/profile, CSRF and CORS; shared query/auth context and permission guards. Keep `/api/*` consumers working; introduce `/api/v1/*` aliases backed by the same controllers. Keep signed verification route names stable.
3. Dashboard/products/inventory/settings: remove sample implementations only after real API replacements are verified. Migrate data access to TanStack Query and forms to RHF/Zod, tables/charts to TanStack Table/Recharts. Resolve tenant release gates before tenant enablement.
4. POS: preserve real checkout, receipts, held carts; test dedicated layout, scanner, mobile checkout, inventory locking/idempotency on MySQL.
5. Real customer, supplier payment, expense, refund and report workflows, with matching schemas, policies, requests/resources and tests.
6. Bookshop onboarding, system owner tenant administration, storefront and remaining public pages.
7. End-to-end responsive/browser checks, MySQL concurrency tests, remove verified obsolete code/dependencies, production deployment.

Each completed stage requires frontend build/tests and relevant backend tests before commit. An existing uncommitted change to `frontend/package-lock.json` was present at audit time; preserve it rather than reverting it.

## Foundation delivery status

Implemented: source moved intact under `frontend/src`; Vite/TypeScript/Tailwind build; lazy React Router routes for all existing pages; TanStack Query/auth context and permission guards; RHF/Zod login/registration; versioned API aliases; cookie-based Sanctum auth, CSRF, credentialed CORS, session regeneration/logout/inactivity; backwards-compatible bearer API and signed email paths; VPS instructions.

Verified: frontend production build; 30 Vitest/RTL tests; 106 Laravel tests (651 assertions); headless Chrome login at 390px and 1440px, real cookie login through Vite proxy, HttpOnly flag, refresh restoration, denied workspace access for a customer, logout/401, no runtime exceptions. Browser checks used a disposable SQLite database and fixture user, never the application MySQL database.

Remaining: stages 3–7 above, complete owner registration/tenant isolation, consistent dark mode, module-wide Query/form/table/chart conversion, missing workflows and real replacements for existing preview screens. Existing Laravel welcome Blade is retained until final production routing verification. No database migrations or production record changes were needed for this foundation. The backend framework/dependencies and business services were retained.

Build warnings: ExcelJS remains a large lazily loaded import/export chunk; Zod emits upstream annotation warnings. Dependency audit reports five inherited findings (three low in shadcn/deepmerge and two moderate in ExcelJS/uuid). Newly added Vitest was updated to 5.0.5 to clear its reported critical findings. Resolve remaining dependency findings before production release without downgrading working import/export functionality blindly.
