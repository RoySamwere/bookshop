# Subscription billing and VPS staging test runbook

The platform subscription Paybill is **153283**. Tenant POS payments remain separate. The React owner interface is `/billing`; platform administrators view `/platform/billing`. Only platform operators with `platform.settings.manage` can settle funds, release unknown requests, or add paid plans. Tenant owners (including legacy system owners) can create and pay only their own invoices, even when their subscription has expired. Platform management sessions cannot impersonate an owner for billing.

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

- Full Laravel suite: **224 passed**, 1,714 assertions.
- Billing/security contract suites: **38 passed**, 151 assertions (part of the full suite).
- Frontend: TypeScript/Vite production build passed; **74 tests passed** across 13 files.
- Existing headless Chromium smoke: desktop/mobile login, cookie authentication, refresh restoration, permission redirects and logout passed without runtime exceptions.
- New billing migration: applied, rolled back by its specific migration path and reapplied successfully against a disposable SQLite database. Local development database migration and scheduler registration also passed.
- Real Safaricom requests/public callbacks and MySQL concurrency acceptance were **not performed**. No live VPS was accessed or changed.

## External Safaricom sandbox acceptance (pending until performed)

1. Create/enable a Daraja sandbox app with Lipa na M-Pesa Online. Securely configure `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_PASSKEY`, `MPESA_SHORTCODE` and `MPESA_CALLBACK_URL` in the staging backend environment. Values stay server-side; never use `VITE_*` for credentials.
2. Set `MPESA_ENVIRONMENT=sandbox`, `APP_ENV=staging`, `APP_DEBUG=false`, HTTPS cookies, real staging domain/CORS/Sanctum settings and a **separate MySQL staging database**. Allow outbound verified HTTPS to `sandbox.safaricom.co.ke`; production later needs `api.safaricom.co.ke`. Configure a publicly reachable HTTPS callback at `https://STAGING_HOST/api/billing/mpesa/stk/callback`. Register `/api/billing/mpesa/c2b/confirmation` if testing C2B for that sandbox app. Browser cookies are not required for callbacks.
3. Clear/rebuild Laravel's config cache after changes. Create a test shop and paid plans through normal registration/platform interfaces, approve the shop and create a sandbox invoice in `/billing`. Use the sandbox phone and credentials supplied by Safaricom, not an arbitrary real customer's phone.
4. Send STK; record CheckoutRequestID and MerchantRequestID from server-side payment records. Verify the real sandbox gateway accepted the request. Receive the callback and independently query with `php artisan billing:reconcile-stk` once the attempt is at least two minutes old. Query success must leave funds unconfirmed.
5. Reconcile only against evidence independently provided by the sandbox merchant tooling. A sandbox app may not expose a merchant statement; if unavailable, leave that manual step pending instead of inventing a receipt. Local mocked tests already cover the subsequent settlement contract.
6. Verify the sandbox invoice can become paid only through authorized reconciliation and **subscription dates/status remain unchanged**. Repeat duplicate callbacks and settlement attempts, cancellations, timeouts, partial payments and overpayments. Test a real public callback failure/retry and lost-response recovery. No live transaction or production subscription should be involved.
7. On staging MySQL, run simultaneous invoice creation and same/different-receipt reconciliation requests. Verify account uniqueness, one confirmed receipt, one renewal event and rollback of the losing request. SQLite tests validate behavior, not MySQL contention/row-lock behavior. These MySQL contention and real gateway/network steps must be recorded separately before production use.

## Exact VPS testing commands (operator-run; no VPS changes performed by Codex)

The following uses a **separate staging checkout** at `/var/www/nifunze-staging`, a dedicated MySQL database named `nifunze_staging`, PHP 8.3 FPM and Nginx. Substitute the installed PHP service/version and staging hostname if different. Do not run against the live application checkout or live database. Provision the private `.env`, staging database, HTTPS vhost and writable Laravel directories before this update. Preserve an existing `APP_KEY`; generate one only for a genuinely new installation. Nginx must serve `frontend/dist` and route `/api`, `/sanctum`, `/up` and `/storage` to Laravel as in DEPLOYMENT.md.

Initial checkout, if needed (run as the deployment user with write access to `/var/www`):

```sh
git clone --branch codex/mpesa-subscription-billing https://github.com/RoySamwere/bookshop.git /var/www/nifunze-staging
cd /var/www/nifunze-staging/backend
cp -n .env.example .env
# Edit .env securely with the staging settings above; do not paste credentials into shell history.
# For a new application ONLY, after dependencies are installed: php artisan key:generate
```

Update, build, backup and migrate the staging application:

```sh
set -eu
cd /var/www/nifunze-staging
test -z "$(git status --porcelain)"
git fetch origin codex/mpesa-subscription-billing
git switch codex/mpesa-subscription-billing
git pull --ff-only origin codex/mpesa-subscription-billing
git rev-parse HEAD
cd backend
test -s .env
composer install --no-dev --prefer-dist --optimize-autoloader --no-interaction
php artisan down --retry=60
# Uses an interactive password prompt; no password in the command or repository.
mkdir -p /var/www/nifunze-staging-backups
mysqldump --single-transaction --routines --triggers -u nifunze_staging -p nifunze_staging > "/var/www/nifunze-staging-backups/pre-billing-$(date -u +%Y%m%dT%H%M%SZ).sql"
php artisan optimize:clear
php artisan migrate --force
# Run only when public/storage does not already exist:
if [ ! -e public/storage ] && [ ! -L public/storage ]; then php artisan storage:link; fi
cd ../frontend
npm ci
npm run build
cd ../backend
php artisan optimize
php artisan queue:restart
sudo nginx -t
sudo systemctl reload php8.3-fpm
sudo systemctl reload nginx
php artisan up
php artisan migrate:status
php artisan schedule:list
```

Do not automatically run `migrate:rollback` after collecting real payments: rollback removes the billing provenance fields. If a step fails while in maintenance, diagnose it before `php artisan up`; retain the backup. Do not run demo seeders or replace a pre-existing production environment file. For a new staging install, run `php artisan key:generate` after `composer install` and before enabling the app.

Install this cron entry for the **staging deployment user** if its scheduler is not already supervised (avoid duplicate scheduler instances):

```cron
* * * * * cd /var/www/nifunze-staging/backend && /usr/bin/php artisan schedule:run >> /var/www/nifunze-staging/backend/storage/logs/scheduler.log 2>&1
```

With `QUEUE_CONNECTION=database`, supervise `php artisan queue:work --sleep=3 --tries=3 --timeout=90` as described in DEPLOYMENT.md. Staging health checks (replace the example hostname with the configured TLS hostname):

```sh
curl --fail --show-error https://staging.books.example.com/up
curl --fail --show-error https://staging.books.example.com/api/v1/public/products-catalogue
```

Then complete the external acceptance checklist above and verify mobile/desktop invoice printing, dashboard permissions, expiry/renewal, CSRF and cookie behavior on the actual HTTPS domain. Publishing this branch is not a deployment or proof of external sandbox/production readiness.
