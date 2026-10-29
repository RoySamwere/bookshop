# Platform Owner login correction

`system_owner` remains a tenant role. Only the original administrator matching the server's trusted `SYSTEM_OWNER_EMAIL` is eligible for `platform:upgrade-legacy-owner`. Never select the identity from a browser request or bulk-convert legacy owners.

The upgrade uses a transaction and row locks, preserves ID, password hash, verification, active status, remember token and historical foreign keys, and records `platform.legacy_owner_upgraded` with previous membership and ownership transfers. Repeated runs do not duplicate the account or audit event. It does not activate deactivated accounts. The seeder now provisions a Platform Owner on a new installation and uses the same safe upgrade for an existing identity without replacing credentials. Configuration caching preserves the trusted identity.

Platform users receive `account_type=platform`, no tenant context or tenant permissions, and route to `/platform` even from a direct `/dashboard` URL. Existing cookie sessions read the changed role on the next request. The console preserves its design and includes overview, directory and bookshop details/status, administrators, subscription plans, settings and platform audit history. Private POS, stock and transaction endpoints remain tenant-only.

## Safe VPS release

These commands assume the documented deployment root `/var/www/hekima/current`, MySQL, a clean checkout, existing production configuration including the correct `SYSTEM_OWNER_EMAIL`, and Nginx serving `frontend/dist` with SPA history fallback as described in DEPLOYMENT.md. Run as the deployment account. Substitute the commit hash supplied with the delivery. The commit must first be published to the repository by your release process; the fix is committed locally and is not automatically pushed or deployed.

Take a database backup before the upgrade. The commands prompt for database name and backup user and let `mysqldump` prompt privately for its password. No production `.env`, application key or credentials are changed. Do not run `migrate:fresh`, reset, rollback, or the full database seeder.

```bash
set -euo pipefail
cd /var/www/hekima/current
test -z "$(git status --porcelain)"
read -r -p 'Published fix commit hash: ' FIX_COMMIT
git fetch origin main
git cat-file -e "${FIX_COMMIT}^{commit}"
git merge-base --is-ancestor HEAD "$FIX_COMMIT"
read -r -p 'Production MySQL database name: ' BACKUP_DATABASE
read -r -p 'MySQL backup user: ' BACKUP_USER
umask 077
mkdir -p /var/www/hekima/backups
BACKUP_FILE="/var/www/hekima/backups/platform-owner-$(date -u +%Y%m%dT%H%M%SZ).sql"
mysqldump --single-transaction --quick --no-tablespaces -u "$BACKUP_USER" -p --databases "$BACKUP_DATABASE" > "$BACKUP_FILE"
test -s "$BACKUP_FILE"
cd backend
php artisan down --retry=60
cd ..
git merge --ff-only "$FIX_COMMIT"
cd backend
composer install --no-dev --prefer-dist --no-interaction --optimize-autoloader
php artisan migrate --force
php artisan config:cache
php artisan platform:upgrade-legacy-owner --dry-run
php artisan platform:upgrade-legacy-owner
php artisan platform:upgrade-legacy-owner --dry-run
cd ../frontend
npm ci
VITE_API_URL=/api/v1 npm run build
cd ../backend
php artisan optimize
php artisan queue:restart
php artisan up
```

If any step fails, `set -e` stops the sequence and the backend stays in maintenance until resolved. Do not blindly continue or roll back schema changes. Reload PHP-FPM using your host's established process if OPcache does not check file timestamps. The React files are served by Nginx independently of Laravel maintenance; use your normal frontend maintenance mechanism during an in-place build, or prepare assets in an immutable release before switching the current symlink.

If the dry run reports that a bookshop would lose its owner, select an existing active `bookshop_owner` or legitimate `system_owner` in that same bookshop. After verifying the replacement, run the following instead of the three upgrade lines above (enter the numeric user ID when prompted):

```bash
read -r -p 'Verified replacement tenant owner user ID: ' REPLACEMENT_OWNER_ID
php artisan platform:upgrade-legacy-owner --dry-run --replacement-owner="$REPLACEMENT_OWNER_ID"
php artisan platform:upgrade-legacy-owner --replacement-owner="$REPLACEMENT_OWNER_ID"
php artisan platform:upgrade-legacy-owner --dry-run
```

If the shop has no other owner but has an existing active `admin`, the business may explicitly choose that administrator as its new Bookshop Owner. This requires both the selected user ID and `--promote-replacement-owner`; the command never selects or promotes an employee automatically. It refuses other-bookshop users, inactive users and non-administrator staff. Promotion and ownership transfer are recorded together in the same audit event and transaction; the administrator's credentials are preserved. Review the ownership decision before running:

```bash
read -r -p 'Verified existing bookshop administrator user ID: ' REPLACEMENT_ADMIN_ID
php artisan platform:upgrade-legacy-owner --dry-run --replacement-owner="$REPLACEMENT_ADMIN_ID" --promote-replacement-owner
php artisan platform:upgrade-legacy-owner --replacement-owner="$REPLACEMENT_ADMIN_ID" --promote-replacement-owner
php artisan platform:upgrade-legacy-owner --dry-run
```

If unassigned legacy business records exist, the upgrade refuses to leave their ownership unresolved. First reconcile those records using the existing `tenancy:adopt-legacy` workflow and a separate, verified tenant owner. Review its dry run and docs/MULTI_TENANCY.md before applying. Do not use the original platform administrator as the new business owner. Multiple businesses or missing replacement owners need an explicit business ownership decision; the command makes no guesses.

After release, sign in with the original administrator's unchanged credentials. Confirm `/platform` opens, refreshing it restores the console, `/dashboard` redirects to `/platform`, and a bookshop owner cannot enter the console. Verify a real tenant's normal inventory/POS workflow without inserting mock production transactions. The production account was not modified or tested remotely by this change.

## Verification

From `backend`: `php artisan test` (SQLite in-memory database from phpunit.xml).
From `frontend`: `npm run test` and `npm run build`.
Tests cover targeted upgrade, wrong identity/role refusal, dry runs, owner transfer safety, record preservation, repeated command/seeder execution, unchanged credentials, upgraded cookie sessions, tenant isolation, POS/inventory and React login/direct navigation/session restoration.

Modified files:

- `backend/app/Console/Commands/UpgradeLegacyPlatformOwner.php`
- `backend/app/Services/UpgradeLegacyPlatformOwner.php`
- `backend/config/platform.php`
- `backend/database/seeders/SystemOwnerSeeder.php`
- `backend/app/Models/User.php`
- `backend/app/Support/Tenancy/Tenant.php`
- `backend/tests/Feature/LegacyPlatformOwnerUpgradeTest.php`
- `frontend/src/routes/protected-route.tsx`
- `frontend/src/routes/protected-route.test.tsx`
- `frontend/src/components/workspace-app.tsx`
- `frontend/src/features/auth/forms.test.tsx`
- `frontend/src/lib/tenancy-api.ts`
- `frontend/src/pages/platform/page.tsx`
- `frontend/src/pages/platform/page.test.tsx`
- `docs/PLATFORM_OWNER_LOGIN_FIX.md`
