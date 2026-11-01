# Subscription billing and VPS staging test runbook

The platform subscription Paybill is **153283**. Tenant POS payments remain separate. Tenant owners open **Admin → Subscription billing** from the desktop sidebar or mobile drawer (`/billing`). Platform administrators open **Subscription billing** in the platform sidebar (`/platform/billing`). Only platform operators with `platform.settings.manage` can settle funds, release unknown requests, or add paid plans. Tenant owners (including legacy system owners) can create and pay only their own invoices, even when their subscription has expired. Platform management sessions cannot impersonate an owner for billing.

## What constitutes a verified payment

Daraja STK callbacks are unsigned. A callback records a notification only: it cannot credit funds, fail an attempt, or activate access. A server-initiated STK query verifies checkout outcome but does not authenticate a receipt, amount, or invoice account. Consequently, query success alone does not settle money either.

For STK, an authorized operator must independently check the merchant statement, enter the receipt, amount, payment date, destination shortcode and statement reference, and explicitly attest to verification. The application also queries Safaricom at settlement time. For manual Paybill, the same operator checks statement values against the captured C2B record. If a callback was lost, use **Record independently verified statement payment**. Never verify against a customer's SMS, screenshots, callback payload, or an invented statement reference. The application does not offer an automatic authenticated merchant-statement feed; operator statement verification is an explicit trust boundary, not an automated receipt lookup. Keep operator access tightly restricted.

Verified records retain the verifier and statement reference in the payment ledger. Settlement locks the invoice and subscription, uniquely allocates the receipt, and commits funds, invoice state and subscription event together. Duplicate receipts cannot buy extra days or credit a different invoice. Payments to another destination are rejected. Invalid, missing, future-dated and mismatched evidence does not settle. No API credential or OAuth token is returned to the browser.

## Sandbox versus production

- `MPESA_ENVIRONMENT=sandbox` uses `https://sandbox.safaricom.co.ke`; `MPESA_SHORTCODE` is the shortcode assigned to the sandbox app (often 174379), not the real Paybill.
- `MPESA_ENVIRONMENT=production` uses `https://api.safaricom.co.ke` and requires `MPESA_SHORTCODE=153283`. The platform Paybill is fixed in server configuration and cannot be overridden to redirect subscription payments.
- Every new invoice and payment snapshots its environment. Switching environment cannot transform old sandbox records into real payments. A sandbox settlement can mark a sandbox invoice paid for testing, but **never updates subscription access**, on any installation. `APP_ENV=production` additionally rejects sandbox settlement entirely.
- Historical records migrated without known provenance are labelled `legacy`, not silently relabelled production. They cannot be settled through these endpoints. Review any existing open legacy invoices and their statements separately before rollout; do not change environment fields or replay old test callbacks to make them payable. New invoices use new six-digit accounts and retain all historical records.
- Sandbox tests and fixtures belong to a dedicated staging database. Do not copy them to production or use them as production statement evidence.

## Creating a sandbox test plan from the platform UI

In sandbox mode, `/platform/billing` shows **Test the billing journey**. An authorized operator clicks **Prepare sandbox test plan** to open Plans & pricing with a unique code, name, KES 1 total price and monthly period filled in. This is an editable draft: nothing is saved until **Add plan** is clicked. Plan creation makes an offer available to owners; it does not create an invoice, send an STK prompt or activate a subscription. Sign in as a test bookshop owner and open `/billing` to select the saved offer and generate its invoice. Then initiate the real sandbox prompt using the sandbox test phone. Review requests back in the platform console; never fabricate verified payment evidence.

The plan price is the total for the chosen period, not a per-month amount multiplied later. Monthly, quarterly and annual prices are separate offers. Plan codes are unique internal identifiers; names appear to owners. Edits affect new invoices, while already-issued invoices keep their original amount and duration. Plans are shared across environments: deactivate low-value test offers before requesting authorization for production testing. The sandbox shortcut is absent in production and unavailable to read-only platform administrators.

## Invoice and renewal rules

An invoice has a globally unique six-digit account from 100000 through 999999; allocation is serialized by a database sequence row held until commit. Accounts are never reused. Exhaustion fails explicitly. An outstanding invoice is reused for the same shop, plan and environment; a second plan cannot replace an unpaid invoice. Prices must be positive whole KES; the Starter trial plan remains unchanged. Add paid monthly, quarterly and annual plans in platform Billing with the intended business prices. Prices are not invented or seeded by this change.

The invoice snapshots price and duration (1, 3 or 12 months). Subsequent plan edits cannot alter purchased duration. Early settlement extends from the later of the existing paid expiry, remaining trial expiry and current time; expired subscriptions renew from current time. Calendar months use no-overflow arithmetic (January 31 + one month = February 28/29). Existing paid access start is retained during early renewal. Bookshop approval/suspension is independent: payment never approves or unsuspends a bookshop.

Partial verified payments reduce the balance without extending access. Once the total covers the invoice, one renewal is applied. All excess funds, including later payments to an already-paid account, remain recorded as `requires_review` reconciliation entries and never automatically buy additional periods. Refunds are handled using the merchant's approved refund process outside this application. An authorized operator records the independently verified refund reference in the excess-review form, moving the item to `resolved` without changing paid access or erasing the payment ledger. No automatic refund or future-invoice credit is asserted.

An uncertain STK response creates an `unknown` attempt, preventing another prompt. Check the merchant statement first. Record any received payment through statement reconciliation; matching unknown attempts are marked reconciled. If independently verified that nothing was received, an operator can release the unknown request for retry with a statement reference. A late receipt can still be reconciled. Pending requests with known checkout IDs are queried by the scheduler; known terminal failures allow retry. Missing/query-in-progress results remain unverified.

The scheduler runs `billing:reconcile-stk` every five minutes, `billing:expire-subscriptions` every five minutes and `billing:generate-renewals` hourly. Near-expiry paid subscriptions get one outstanding invoice. Clock-based access checks do not depend on cron running exactly on time; an expired trial or paid period cannot keep using the workspace. Existing legacy subscriptions with no expiry retain their prior access. Billing stays accessible for renewal. Business records are never deleted on expiry.

## Local verification

```sh
cd /workspace/bookshop/backend
# In this cloud workspace only: export PATH=/workspace/toolchain/bin:$PATH
php artisan test
php artisan test --filter='SubscriptionBillingTest|PlatformBillingSafetyTest'
cd ../frontend
npm ci
npm run build
npm test -- --maxWorkers=2
```

Laravel tests use isolated in-memory SQLite and Laravel `Http::fake` with stray requests prohibited for the billing workflow. They exercise STK initiation, callbacks, independent query, statement attestation, settlement and sandbox non-activation. Those are automated contract tests, **not evidence of a call to the real Safaricom sandbox**. They also test partial/overpayments, renewal periods, duplicate receipts, failed verification, lost callbacks, timeouts, expiry and tenant isolation. React tests exercise invoice-scoped STK submissions, pending/unknown request blocking, sandbox messaging and statement-attestation gating. The existing browser cookie smoke test uses only a disposable SQLite database and fixture user; never seed it into the application database.

## Recorded cloud validation

- Full Laravel suite: **235 passed**, 1,779 assertions.
- Billing/security contract suites: **47 passed**, 205 assertions (part of the full suite).
- Frontend: TypeScript/Vite production build passed; **90 tests passed** across 14 files.
- Billing browser smoke passed owner login, actual local plan selection/invoice generation, correct sandbox-only instructions, printable invoice controls and 390px/1440px layout. No Safaricom request was initiated.
- Existing headless Chromium smoke: desktop/mobile login, cookie authentication, refresh restoration, permission redirects and logout passed without runtime exceptions.
- New billing migration: applied, rolled back by its specific migration path and reapplied successfully against a disposable SQLite database. Local development database migration and scheduler registration also passed.
- An isolated MariaDB 11.8 instance with `explicit_defaults_for_timestamp=OFF` and strict zero-date checks reproduced error 1067 using the old period column definitions. The full application migration chain then passed with required `DATETIME` period columns and the shortened reconciliation unique-index name.
- Local MariaDB concurrency passed: six parallel invoice requests, six duplicate-receipt settlements and three distinct late overpayments produced one invoice, one renewal and the correct excess ledger. No existing database was reset or deleted.
- Real Safaricom OAuth/STK/query and public callback delivery remain **unverified**. A credential-free gateway connectivity probe from the cloud workspace failed at the outbound proxy with CONNECT HTTP 403; no M-Pesa credentials or remote execution connection are available here. No VPS deployment or payment configuration change was performed.

## Approved testing installation and data preservation

The user confirmed that **https://hekimabookshop.co.ke is the existing testing application**, not a commercial deployment serving paying customers. Use its existing installation and database; do not create a staging subdomain, replacement installation or new application database. All automated tests still use isolated test databases. Do not run `migrate:fresh`, `db:wipe`, `migrate:reset` or demo seeders against the application database. Preserve the existing APP_KEY and private `.env`.

All development and verified commits are on **main**. The commands below are operator-run on the existing VPS; they have not been executed by the cloud agent.

## Existing VPS update, backup, migrations and build

Run from anywhere inside the existing repository checkout. Confirm the configured database name before the backup; the reported application database is `nifunzel_bookshop`. The dump command prompts for credentials without putting a password in shell history. Use `mariadb-dump` instead of `mysqldump` if that is the installed client.

```sh
set -eu
BILLING_ROOT="$(git rev-parse --show-toplevel)"
cd "$BILLING_ROOT"
test -z "$(git status --porcelain)"
umask 077
BILLING_BACKUP_DIR="$BILLING_ROOT/../nifunze-private-backups"
mkdir -p "$BILLING_BACKUP_DIR"
chmod 700 "$BILLING_BACKUP_DIR"
BILLING_STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
cp -p backend/.env "$BILLING_BACKUP_DIR/env-$BILLING_STAMP"
read -r -p 'Existing database user: ' BILLING_DB_USER
mysqldump --single-transaction --routines --triggers -h 127.0.0.1 -u "$BILLING_DB_USER" -p nifunzel_bookshop > "$BILLING_BACKUP_DIR/database-$BILLING_STAMP.sql"
test -s "$BILLING_BACKUP_DIR/database-$BILLING_STAMP.sql"
git fetch origin main
git switch main
git pull --ff-only origin main
git rev-parse HEAD
cd backend
composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction
php artisan down --retry=60
php artisan optimize:clear
php artisan migrate --force
if [ ! -e public/storage ] && [ ! -L public/storage ]; then php artisan storage:link; fi
cd ../frontend
npm ci
npm run build
cd ../backend
php artisan optimize
php artisan queue:restart
php artisan up
php artisan migrate:status
php artisan schedule:list
curl --fail --show-error https://hekimabookshop.co.ke/up
curl --fail --show-error https://hekimabookshop.co.ke/api/v1/public/products-catalogue
```

No `.env` value is overwritten by these commands. On failure, inspect the error before bringing the application back up; do not reset the database or automatically roll back billing tables. Restart/reload the installed PHP-FPM service only if required by the server's existing opcache configuration, using its actual service name; no Nginx routing change is needed for these existing `/api` and React routes. Ensure `storage` and `bootstrap/cache` remain writable by the existing PHP user.

Keep one scheduler instance for this installation. If not already configured, add to the existing deployment user's cron using the absolute repository path obtained above:

```cron
* * * * * cd /ABSOLUTE/EXISTING/REPOSITORY/backend && /usr/bin/php artisan schedule:run >> storage/logs/scheduler.log 2>&1
```

## Real sandbox verification on the existing VPS (pending)

Keep the existing sandbox settings and callback:

```dotenv
MPESA_ENVIRONMENT=sandbox
MPESA_SHORTCODE=174379
MPESA_CALLBACK_URL=https://hekimabookshop.co.ke/api/billing/mpesa/stk/callback
```

Consumer key, consumer secret and passkey stay in the existing secure VPS environment. No values are printed or committed. Rebuild cached config after any independently authorized correction. The `/billing` screen now displays **TEST MODE** and the actual sandbox shortcode, never live Paybill payment instructions while operating in sandbox. Historical environment-mismatched invoices cannot be paid through the current environment.

1. From the existing backend directory run:

   ```sh
   php artisan billing:sandbox-check --staging-confirmed
   ```

   The legacy flag name means “I confirm this is the authorized testing installation.” This command performs a **real** OAuth request and withholds the token. It refuses production payment mode, does not initiate STK and does not settle any invoice. If it fails, record the error safely and resolve the credential, HTTPS trust or outbound access blocker. A fake or mocked response is not acceptance evidence.
2. Log in as the bookshop owner. Select a paid monthly, quarterly or annual plan in `/billing`, generate an invoice, and use the Safaricom sandbox test phone supplied for the app. Send an STK prompt against the displayed sandbox shortcode. In `/platform/billing` → STK requests capture the real CheckoutRequestID and MerchantRequestID. Do not post credentials, phone numbers or OAuth tokens in logs/reports.
3. Verify that Safaricom reaches the configured public HTTPS callback. Inspect `callback_payload` for that checkout in the backend database using authorized administrative tools. An HTTP 200 alone is not proof of delivery for a particular checkout. A callback must not confirm funds or extend access.
4. Query the actual checkout (substitute the ID captured from your request):

   ```sh
   php artisan billing:sandbox-check --staging-confirmed --checkout=ACTUAL_CHECKOUT_REQUEST_ID
   # Scheduled verification selects requests at least two minutes old:
   php artisan billing:reconcile-stk
   ```

   Record sanitized ResponseCode/ResultCode and whether the provider supplied success, cancellation (1032), timeout (1037), failure or pending. Test outcomes only where the real sandbox supports them; unsupported outcomes remain unverified externally even when their automated tests pass.
5. Only an authorized operator with independent merchant evidence can reconcile through `/platform/billing`. STK settlement additionally queries the provider. If sandbox merchant-statement evidence is unavailable, leave the payment awaiting verification; do not invent a receipt or mark an SMS/callback as independent evidence. The payment ledger displays statement references and verifier IDs; the platform audit view includes billing actions.
6. Sandbox settlement **never modifies subscription access**, even if a test invoice becomes paid. Existing `APP_ENV=production` guards additionally reject sandbox settlement; the read-only OAuth/query command and sandbox initiation do not change that safeguard. If that guard prevents the final test step on this installation, record the blocked step rather than relabelling test payments as production or silently changing application environment.
7. Retest duplicate notifications and duplicate reconciliation, partial payments and excess funds. Neither duplicates nor excess funds may grant a second subscription period. Verify that failure/cancellation/timeout are provider-query outcomes, not decisions trusted from unsigned callbacks.

## Automated test and MySQL concurrency commands

Run development suites with development dependencies installed, not against the existing application database:

```sh
cd backend
php artisan test
php artisan test --filter='SubscriptionBillingTest|PlatformBillingSafetyTest|BillingMigrationCompatibilityTest|TenantIsolationTest'
cd ../frontend
npm run build
npm test -- --maxWorkers=2
```

For the billing browser test, start Laravel and Vite against an isolated `ui-smoke.sqlite` database (as for the existing browser smoke). In that isolated backend context run `php artisan tinker --execute='require base_path("tests/Browser/billing-fixture.php");'`, then run `CHROME_PATH=/usr/bin/chromium SMOKE_BASE_URL=http://127.0.0.1:5174 node scripts/billing-browser-smoke.mjs` from frontend. The fixture refuses production/non-isolated databases, preserves existing fixture records, and the browser script refuses non-loopback hosts. Do not use these fixtures on the Hekima application database.

`tests/Integration/billing-concurrency.php` requires a **new empty isolated** MySQL/MariaDB database named `nifunze_billing_test_<unique suffix>`, APP_ENV=testing, and development dependencies. It refuses an existing nonempty schema and never drops or resets a database. Do not supply the existing application database. The guard is scoped explicitly to the selected schema. It launches real concurrent PHP processes to verify row locks, account allocation, receipt uniqueness, one-time renewal, retained subscription time and excess funds. This local automated check passed; it is not a real Safaricom transaction.

```sh
# Set DB_* securely for a newly created isolated test schema only, then:
APP_ENV=testing DB_CONNECTION=mysql DB_DATABASE=nifunze_billing_test_UNIQUE_SUFFIX php tests/Integration/billing-concurrency.php
```

## Controlled production acceptance — authorization required

No production credential validation, shortcode entitlement confirmation or genuine payment has been performed from this workspace. Paybill **153283** is enforced in code; that is not proof that Safaricom has enabled this Paybill for the APIs. Before any switch:

1. Obtain the operator's evidence that production consumer key/secret, shortcode 153283 and production passkey are valid and API-enabled; confirm merchant-statement access and public HTTPS callback delivery.
2. Run `php artisan billing:pending-payments --environment=sandbox` (nonzero means unresolved records remain), then review `/platform/billing` filtered to sandbox for `pending`, `awaiting_verification` and `unknown` requests. Resolve or explicitly retain/document outstanding sandbox requests; never relabel their environment. Back up the existing database and `.env` again before a switch.
3. Confirm migrations, tests/build, scheduler and backup restoration procedures, plus the authorized test phone and agreed low invoice amount. Changing plan pricing affects new invoices only. Do not reprice an existing invoice or modify records directly to simulate payment.
4. **Ask for explicit authorization identifying the production switch, test phone, amount and one controlled payment.** Neither this runbook nor the prior sandbox authorization permits the switch or charge. Do not modify payment settings or initiate real payments before that authorization.
5. After authorization, the operator configures the real production credentials and `MPESA_ENVIRONMENT=production`, `MPESA_SHORTCODE=153283`, preserving all sandbox records. Rebuild config cache. Generate a new production invoice with its own six-digit account. Complete one real payment on the authorized phone; independently verify the receipt, amount, destination, account and payment date against merchant records.
6. Reconcile once through the platform UI; verify the invoice, payment ledger, statement reference, audit event and subscription expiry. Monthly/quarterly/annual renewal must preserve remaining paid time. Duplicate callback/reconciliation must add no second period. Keep reports free of credentials, tokens and full customer phone numbers.

Until those steps are performed, report production and real sandbox external verification as pending; passing automated tests alone does not authorize or prove real-money readiness.
