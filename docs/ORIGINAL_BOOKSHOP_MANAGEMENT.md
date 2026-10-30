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

### Platform overview 401 after several minutes

`SessionManager` previously monitored `/dashboard` and `/account`, but excluded `/platform`. Active platform users therefore never sent the `/auth/activity` heartbeat, and Laravel correctly rejected their session after ten minutes since login. The monitor now covers `/platform` and all its subpages. Real interaction extends the session; overview polling does not. Truly idle users retain the existing ten-minute expiry and return to login with their platform URL preserved. Authentication, CSRF and tenant restrictions remain enforced.

Deploy and publish the new frontend bundle, then sign in again; an already expired session cannot be revived. For the reported VPS checkout:

```bash
set -e
cd /home/nifunzel/domains/hekimabookshop.co.ke/app
git pull --ff-only origin main
cd frontend
npm ci
VITE_API_URL=/api/v1 npm run build
```

Publish `frontend/dist` using the existing hosting process. If the site serves a separate `public_html` copy, building `frontend/dist` alone does not update it. Preserve `public_html/index.php` and `.htaccess` when publishing the frontend. This session fix needs no production environment or credential changes and no new database migration.

Checks cover the platform root/subpages, signed-out/public routes, monitor cleanup, active platform cookie sessions beyond ten minutes and rejection of idle sessions. Browser verification observed login and refresh restoration, overview HTTP 200 and periodic activity HTTP 204 after real interaction. The MySQL-specific compatibility migration was also guarded so it does not execute `SHOW COLUMNS` in SQLite tests; MySQL behavior is unchanged. Existing registration/onboarding tests that still expect the older email-only activation workflow fail against the recently merged platform-approval flow; that flow is outside this session fix.

### MySQL shop-creation 500 correction

MySQL error 1406 (`Data too long for column 'registration_source'`) occurs when registration writes `bookshop_registration` (21 characters) into the original `VARCHAR(20)`. Migration `2026_11_01_000002_widen_bookshop_registration_fields` expands that column to 64 characters. It also expands `branches.city` and `business_profiles.city` to 255 characters to match the existing registration location validation. Existing values, credentials, IDs and nullability are preserved. Its down method intentionally retains the wider columns to avoid truncating valid data.

After a verified database backup, this backend-only fix can be applied on the VPS without rebuilding the frontend:

```bash
set -e
cd /home/nifunzel/domains/hekimabookshop.co.ke/app
git pull --ff-only origin main
cd backend
php artisan down --retry=60
php artisan optimize:clear
php artisan migrate --force
php artisan config:cache
php artisan queue:restart
php artisan up
```

Then retry **Create bookshop**. The migration, not a cache clear or frontend rebuild, fixes the column limit. Do not shorten existing role/source values manually or disable MySQL strict mode. If a step fails, stop and resolve the error before reopening traffic.

The failure was reproduced on strict MySQL (SQLSTATE 22001 / error 1406), then registration and platform-management feature tests passed against a disposable MySQL schema with the correction applied. A separate MySQL migration check verified old values survive, repeated up calls are safe, and down does not truncate the widened values. The application database and production configuration were not modified during verification.

Run `php artisan test` in backend and `npm run test` / `npm run build` in frontend. Regression coverage includes grant-only navigation, session restoration, return action, original menu visibility, grant revocation/suspension/role changes, admin exclusion, cross-tenant reads and writes, shop creation without session replacement, legacy record and credential preservation, idempotent adoption, stock receiving and idempotent POS checkout.

Production was not deployed or modified by the implementation. SQLite tests do not replace staging checks of MySQL locking or the host's static-file publication configuration.
