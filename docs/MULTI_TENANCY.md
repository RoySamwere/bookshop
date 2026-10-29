# Multi-tenancy (Milestone 1)

Hekima now runs many independent bookshops in one Laravel application and one MySQL database.
This document covers how isolation works, which data is shared, how the existing single-shop data is
moved over, and how to deploy and roll back.

## Roles

| Role | Scope | Notes |
| --- | --- | --- |
| `platform_owner` | Platform | SaaS administration; no tenant membership or default tenant permissions. An explicit database grant and cookie-session entry permit management of the verified original business. See ORIGINAL_BOOKSHOP_MANAGEMENT.md. |
| `platform_admin` | Platform | Views bookshops, users, settings and audit history. Can create bookshops with separate owners and resend verification. Cannot open private workspaces, suspend bookshops, change settings or manage platform staff. |
| `bookshop_owner` | One bookshop | Full control of their own bookshop. Assigns admin, store manager, cashier, inventory officer. |
| `system_owner` | One bookshop | The legacy single-shop owner. It has the same tenant permissions as `bookshop_owner`, so existing access keeps working after adoption. `tenancy:adopt-legacy --convert-owner` renames it to `bookshop_owner`. |
| `admin`, `store_manager`, `cashier`, `inventory_officer` | One bookshop | Unchanged permissions, now limited to their own bookshop and branches. |
| `customer` | Platform, or one bookshop | Public customers have no bookshop. A customer who asks for staff access names the bookshop by its code. |

Permissions live in `app/Support/Roles.php` and are enforced by middleware and policies. React only uses them to decide what to show.
No public payload can set `role`, `bookshop_id`, `status`, `owner_user_id` or `permissions`: registration requests mark them `prohibited`, and controllers set them explicitly.

## How isolation works

- **Membership:** `users.bookshop_id` is the user's single bookshop membership. One account belongs to at most one bookshop; a person working for two shops needs two accounts in M1.
- **Tenant resolver:** `App\Support\Tenancy\Tenant::id()` comes from the signed-in user's membership or a server-verified original-bookshop management context. A client-submitted `bookshop_id` is never used. Console code uses `Tenant::run($bookshop, fn () => …)`.
- **`tenant` middleware** (`EnsureTenantContext`) guards every workspace route. It rejects platform accounts without a verified management context, users without a bookshop and suspended bookshops. It also rejects unverified emails and bookshops not yet activated. `tenant:onboarding` relaxes the last two checks for `GET/PATCH /bookshop` only. Each refusal returns a `code`: `platform_account`, `no_bookshop`, `bookshop_suspended`, `email_unverified` or `bookshop_pending`.
- **Queries:** the business controllers use `DB::table()`. Every read, write, export and aggregate adds `where bookshop_id = Tenant::requireId()`.
- **Validation:** every related ID uses `Tenant::exists('table')` and every business code uses `Tenant::unique('table', 'column')`. A cross-tenant ID therefore fails as a normal validation error or a 404, never as a silent success.
- **Eloquent scope:** `Branch`, `TaxRate` and `BusinessProfile` use the `BelongsToBookshop` global scope, which denies by default. A signed-in account without a bookshop matches nothing. Platform code opts out explicitly with `withoutGlobalScope('bookshop')`.
- **Service-level guard:** `InventoryService::change()` refuses unless the product, branch, supplier and packaging all belong to the same bookshop as the current tenant. This holds even if a controller check were missed.
- **Database:** every tenant table has a `bookshop_id` foreign key (`restrictOnDelete`, so business records are never cascaded away). Business codes are unique per bookshop with composite unique indexes.
- **Platform privacy:** `/api/platform/*` returns tenant metadata only. Platform audit history is limited to `platform.*` and `bookshop.*` events. Original-business management now requires an explicit console-created grant, session entry and validation on every request; platform administrators cannot enter workspaces. See [Original bookshop management](ORIGINAL_BOOKSHOP_MANAGEMENT.md).

### Data classification

| Tenant-owned (`bookshop_id`) | Inherits its bookshop from a parent | Global |
| --- | --- | --- |
| users, branches, business_profiles, tax_rates, books, authors, publishers, book_categories, suppliers, product_units, inventory_balances, inventory_movements, purchase_orders, goods_receipts, pos_sales, bookshop_subscriptions, subscription_events, audit_logs (NULL = platform event) | branch_user, author_book, purchase_order_items, goods_receipt_items, pos_sale_items | product_categories and product_subcategories (shared read-only taxonomy), subscription_plans, plan_features, platform_settings, launch_subscribers (platform marketing list), notifications (per user), Laravel infrastructure tables |

## Registration and onboarding

`POST /api/auth/register/bookshop` creates, in one transaction:

1. the owner (`bookshop_owner`, unverified)
2. the bookshop (`pending_verification`, unique slug)
3. the MAIN branch
4. the business profile
5. Kenyan default tax rates, when the country is Kenya
6. a trial subscription

It also writes the `bookshop.registered` audit entry. After the transaction it sends the standard signed verification email. Browser sign-ups are signed in and continue to `/onboarding/verify-email`.

Verifying the email activates the bookshop. React routes: `/register/bookshop`, `/onboarding/verify-email`, `/onboarding/setup`, `/onboarding/bookshop`, `/accept-invitation`.
Employees are invited from **My Bookshop** in the workspace (`POST /api/staff-invitations`). The invitee sets a password from a link, which also verifies their email. The link token reuses Laravel's hashed password-reset store through the `invitations` broker.
The Platform Owner can pause registrations in platform settings.

## Subscriptions (foundation only)

- Tables: `subscription_plans`, `plan_features`, `bookshop_subscriptions`, `subscription_events`.
- Statuses: trialing, active, past_due, grace_period, suspended, cancelled, expired.
- A default `starter` plan with unlimited features is created by the migration.
- `EntitlementService` is the single place for limits and features. A NULL limit means unlimited. Branch and staff limits are already enforced through it.
- There are no payments and no automatic expiry. Changing subscription state never deletes or hides records.

## Existing data: migration strategy

The migrations are additive. Existing rows get `bookshop_id = NULL`, meaning "legacy, not yet reconciled". Legacy staff are refused by the `tenant` middleware (`no_bookshop`) until the data is adopted explicitly:

```bash
php artisan tenancy:adopt-legacy --owner=roy@example.com           # dry run: prints what would move
php artisan tenancy:adopt-legacy --owner=roy@example.com --apply   # after a backup
```

The command refuses, and changes nothing, when:

- there is more than one unassigned business profile
- no owner is named
- the named owner is not an unassigned System Owner or Bookshop Owner
- an unassigned staff account is linked to another bookshop's branches

When it applies, it moves all unassigned business rows, branches and staff into one new active bookshop. That includes customers who requested staff access; plain public customers stay platform-level. It also files the adopted staff's audit history under the bookshop and records an `active` legacy subscription. The System Owner keeps full access.

`BusinessFoundationSeeder` is now tenant-safe. It fills in defaults inside each bookshop and only pairs unassigned legacy rows with each other.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PLATFORM_OWNER_EMAIL`, `PLATFORM_OWNER_PASSWORD`, `PLATFORM_OWNER_NAME` | — | Read only by `php artisan platform:owner`. Use an address that is not a bookshop account. Remove the password after use. |
| `SUBSCRIPTION_TRIAL_DAYS` | 14 | Trial length. The platform setting `trial_days` overrides it. |
| `SUBSCRIPTION_DEFAULT_PLAN` | starter | Plan code for new bookshops. |
| `STAFF_INVITATION_EXPIRE` | 4320 | Invitation link lifetime in minutes. |

`FRONTEND_URL` must be the production domain so that verification and invitation links open the real site.
**No new scheduled jobs or queue workers are required.** Emails are sent the same way as before.

## Deployment

1. Back up the production database (`mysqldump`) and keep the current release directory.
2. Deploy the code. Do **not** change `APP_KEY` or overwrite `.env`; only add the variables above.
3. `php artisan down`
4. `php artisan migrate --force`. Only the four migrations `2026_10_29_000001` (if still pending) and `2026_10_31_00000x` run; all are additive.
5. `php artisan tenancy:adopt-legacy --owner=<system owner email>`. Review the dry run, then re-run with `--apply`. Legacy staff are locked out between steps 4 and 5, so do both in the same maintenance window.
6. Set the `PLATFORM_OWNER_*` variables, run `php artisan platform:owner`, then remove `PLATFORM_OWNER_PASSWORD`.
7. `php artisan config:cache && php artisan route:cache`, build the frontend (`npm run build`), then `php artisan up`.
8. Smoke test:
   - the System Owner can sign in and see existing products and sales
   - the Platform Owner reaches `/platform`
   - a test bookshop can register and verify

## Rollback

- **Before any new bookshop registers:** `php artisan migrate:rollback --step=3` (four steps if `2026_10_29_000001` ran in this deployment), then redeploy the previous release. The rollback drops the new columns and tables and restores the global unique indexes. This is verified on MySQL and SQLite.
- **After other bookshops exist:** codes may collide across bookshops and the global unique indexes cannot be restored. Restore the step-1 backup instead. Data entered after the deployment is lost, so export it first if needed.
- To undo only an adoption, restore the backup. The command writes ownership in a single transaction but has no automatic reverse.

## Verification performed for M1

- Laravel: 145 tests and 1,087 assertions, including tenant isolation with two full bookshops and malicious ID substitution. They also cover registration, verification, onboarding limits, role escalation, platform permissions, suspension, legacy adoption and entitlement limits. All existing POS, inventory, procurement and reporting tests pass.
- React: `tsc` type check, 32 Vitest tests and the production build.
- Migrations: migrate, rollback and re-migrate on MySQL (MariaDB, XAMPP) and on SQLite. Adoption was dry-run and applied on a copy of a real single-shop database.
- Browser: `frontend/scripts/tenancy-smoke.mjs` runs in headless Chrome against a disposable SQLite server at 390 px and 1440 px. It covers registration, the unverified lockout, the verification link, setup and the workspace. It also covers owner exclusion from `/platform`, platform suspension and the suspended notice.

## Known limitations / follow-ups

- One bookshop per account. A membership table would allow multi-shop staff.
- Composite foreign keys (for example `(book_id, bookshop_id)`) are not used. Cross-tenant references are prevented by tenant-scoped validation and `InventoryService`, and by the per-table `bookshop_id` keys.
- Customers, reports, expenses and returns are still preview screens. They must use the same `Tenant` scoping when built.
- No audited support-access mechanism, billing or automatic trial expiry yet.
