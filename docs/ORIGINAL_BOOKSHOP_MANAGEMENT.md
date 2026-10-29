# Original Hekima Bookshop management

The Platform Owner keeps `/platform` for SaaS administration. **Bookshop Management** lists only bookshops with an explicit, active grant in `platform_bookshop_management`. Opening a listed business starts a CSRF-protected cookie-session management context; it does not change the user's stored role or tenant membership. The existing `/dashboard` and all its original sections are reused. **Return to Platform** is visible in the workspace, including POS mode, and ends that context.

Every request rechecks the Platform Owner role, grant and active bookshop before resolving the effective tenant. Revocation, suspension, logout, role changes and a fresh login remove or invalidate access. A supplied URL, query/body `bookshop_id`, browser flag or bearer token cannot create a context. Normal tenant users continue to use only their own stored membership. Platform administrators cannot enter business workspaces even if an invalid grant is inserted for them. All business queries and related-ID validation remain tenant-scoped. Platform routes always execute outside the business context.

Platform Owner and Platform Administrator accounts can use **Bookshops → Create bookshop** to open the creation modal on `/platform/bookshops`. The modal validates the shop and owner details, keeps errors in the form, and closes with confirmation and a refreshed directory after success. This creates a separate tenant, main branch, business profile, subscription trial and `bookshop_owner` account. The new owner verifies their email; the operator stays signed in as platform staff. Creation does not grant the operator access to the new shop's transactions. Platform administration can create shops even when public self-registration is paused. The existing `/platform/bookshops/new` form remains available for direct navigation.

## Restore and adopt the original business

`php artisan platform:restore-original-bookshop` is read-only by default. It uses the existing trusted `SYSTEM_OWNER_EMAIL`, requires a unique active verified System Owner or Platform Owner, lists unassigned records and staff IDs, and verifies existing ownership. It does not require or create a second login for the original business owner.

If no original tenant exists, the apply step creates its tenant container and assigns existing records by updating only `bookshop_id`; existing IDs, foreign keys, quantities, transactions, receipt/item records, timestamps and passwords are preserved. The existing single legacy profile supplies the business name and locale. Missing branch/profile/subscription foundation records are created only when absent. Staff/applicants retain their roles and active/verification status. Shared product taxonomy remains shared. Platform audit events remain global; existing business audit history is associated with the original tenant.

The original administrator remains/becomes `platform_owner` with `users.bookshop_id=NULL`. The bookshop's ownership points to that same original account, and a console-created grant authorizes its business management. The obsolete branch membership is detached. Adoption and authorization commit in one transaction and are audited as `platform.original_bookshop_restored`. Repeating the command does not create duplicate tenants, accounts, grants, subscriptions or audit events. Previously revoked grants are never silently restored.

If an existing bookshop is already owned by the trusted administrator, it can be selected with `--bookshop=ID`. If unassigned records coexist with it, an explicit ID and ownership confirmation are required. Conflicting profiles, duplicate business codes, another unassigned owner, a foreign-owned target and cross-tenant parent/item/branch references are refused. Reconcile ambiguous ownership instead of guessing or deleting records. New unassigned records after a completed adoption require a separate review; repeating the command does not absorb them automatically.

## Safe VPS release

Run as the deployment account. The paths below use the VPS location provided in this conversation. Keep the existing `.env`, `APP_KEY` and credentials. Do not reset the database or run development seeders. First take and verify a database backup using your hosting panel or this MySQL command (it prompts privately for the password):

```bash
set -e
umask 077
mkdir -p /home/nifunzel/backups
read -r -p 'Production database name: ' BOOKSHOP_BACKUP_DATABASE
read -r -p 'MySQL backup user: ' BOOKSHOP_BACKUP_USER
BOOKSHOP_BACKUP_FILE="/home/nifunzel/backups/before-original-management-$(date -u +%Y%m%dT%H%M%SZ).sql"
mysqldump --single-transaction --quick --no-tablespaces -u "$BOOKSHOP_BACKUP_USER" -p --databases "$BOOKSHOP_BACKUP_DATABASE" > "$BOOKSHOP_BACKUP_FILE"
test -s "$BOOKSHOP_BACKUP_FILE"
```

Deploy the source, additive grant-table migration and frontend, then inspect the adoption plan:

```bash
set -e
cd /home/nifunzel/domains/hekimabookshop.co.ke/app
test -z "$(git status --porcelain)"
git pull --ff-only origin main
git log -1 --oneline
cd backend
php artisan down --retry=60
composer install --no-dev --prefer-dist --no-interaction --optimize-autoloader
php artisan optimize:clear
php artisan migrate --force
php artisan config:cache
cd ../frontend
npm ci
VITE_API_URL=/api/v1 npm run build
cd ../backend
php artisan platform:restore-original-bookshop
```

Review the displayed records and confirm they belong to the original Hekima business before applying:

```bash
set -e
cd /home/nifunzel/domains/hekimabookshop.co.ke/app/backend
php artisan platform:restore-original-bookshop --apply --confirm-legacy-ownership
php artisan platform:restore-original-bookshop
php artisan optimize
php artisan queue:restart
php artisan up
```

For an existing verified original tenant, include the same `--bookshop=ID` on both dry-run and apply commands; replace ID with its actual numeric ID. Do not select a shop by name alone. Use this restore command instead of the old `tenancy:adopt-legacy` / platform-owner upgrade sequence for this workflow.

These commands assume the web server serves `frontend/dist` as described in DEPLOYMENT.md. If the host publishes frontend assets elsewhere, publish the new build with the existing hosting procedure before reopening traffic; the document root cannot be verified from the repository. Preserve SPA history fallback for direct `/platform/management` and `/dashboard` navigation. Laravel maintenance does not block directly served static files; use the host's frontend maintenance mechanism if needed. If a command fails, the sequence stops and Laravel remains in maintenance until resolved; do not blindly continue or reset records. Reload PHP-FPM through the host's established process if OPcache requires it.

Sign out/in, then select **Platform → Bookshop Management → Open bookshop workspace**. Verify Products & Books, Inventory & Stock, Suppliers, POS, Sales History, Customers, Staff (Team & access), My Bookshop, Settings/Branches and Reports. Refresh the workspace, then use **Return to Platform**. A direct `/dashboard` visit without explicit entry redirects to `/platform`.

The existing Customers, Reports & Analytics and Expenses screens remain previews backed by sample data, as they were before this change. Their interface is restored, but this change does not implement their unfinished persistence. Live catalogue, inventory, suppliers, POS, sales, staff, branches and settings retain their existing APIs and records. No mock transactions should be inserted into production to verify deployment.

## Verification

Run `php artisan test` in backend and `npm run test` / `npm run build` in frontend. Regression coverage includes grant-only navigation, session restoration, return action, original menu visibility, grant revocation/suspension/role changes, admin exclusion, cross-tenant reads and writes, shop creation without session replacement, legacy record and credential preservation, idempotent adoption, stock receiving and idempotent POS checkout.

Production was not deployed or modified by the implementation. SQLite tests do not replace staging checks of MySQL locking or the host's static-file publication configuration.
