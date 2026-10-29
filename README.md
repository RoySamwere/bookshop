# Hekima Bookshop

Laravel 12 API in `backend/`; React 19 + TypeScript + Vite + Tailwind in `frontend/`. React Router supplies lazy-loaded routes, TanStack Query supplies the session cache, and React Hook Form/Zod validate login and registration. Existing business screens and POS have been preserved under `frontend/src`.

This is a staged migration. Read [the audit and remaining work](docs/MIGRATION.md), especially the tenant isolation release gates. Customer registration is working; it does **not** provision a bookshop owner or tenant. Customer/finance/report preview screens and the missing platform/storefront workflows are not completed production features.

## Local development

Use PHP 8.2+, Composer, MySQL, and Node 22.12+ (or a supported newer LTS).

```sh
cd backend
composer install
cp .env.example .env
php artisan key:generate
# Set MySQL connection values in .env before running migrations.
php artisan migrate
php artisan storage:link
php artisan serve --host=127.0.0.1 --port=8000
```

In another terminal:

```sh
cd frontend
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://127.0.0.1:5173`. Vite proxies `/api`, `/sanctum`, and `/storage` to Laravel. Use one hostname consistently; localhost and 127.0.0.1 have different cookies. Restart Laravel after config changes, running `php artisan config:clear` if needed. Do not run seeders against an existing database merely to start the frontend.

The default browser API base is `/api/v1`. An absolute `VITE_API_URL` must end in `/api/v1` and be on the same site as the frontend, with its frontend origin listed in Laravel's CORS and Sanctum configuration. `VITE_*` variables are public build-time values; never place secrets there. Existing `NEXT_PUBLIC_*` overrides should be renamed to `VITE_*`.

## Authentication

Browser writes initialize `/sanctum/csrf-cookie`, send `credentials: include`, and forward the decoded `XSRF-TOKEN` as `X-XSRF-TOKEN`. Login regenerates the server session and returns user/permissions/branch/bookshop information, without an API token. Authentication uses HttpOnly session cookies; no authentication tokens are stored in localStorage or sessionStorage. Old browser token storage is removed on startup, requiring a fresh login. Laravel independently enforces access and the ten-minute activity deadline; background polling does not renew it.

Legacy non-browser `/api/*` bearer contracts remain available. `/api/v1/*` routes use the same controllers, validation, policies, and services. Versioned login requires a configured first-party origin. Signed email verification links deliberately use their original `/api/auth/email/verify/...` path so already-issued signatures continue to work.

Reference: [Laravel Sanctum SPA authentication](https://laravel.com/docs/12.x/sanctum#spa-authentication).

## Verification

```sh
cd frontend
npm run build
npm run test
cd ../backend
php artisan test
```

Backend tests use an isolated in-memory SQLite database; they do not migrate or modify the application MySQL database. MySQL concurrency/stock-lock behavior, physical barcode hardware, thermal printing, browser cookie behavior and full responsive workflows require additional verification before production release.

A headless Chrome smoke test also verified login at 390px/1440px, real cookie login, HttpOnly cookies, refresh restoration, route permissions and logout against a disposable SQLite Laravel server. `frontend/scripts/browser-smoke.mjs` reruns those checks with a fixture customer `spa-smoke@example.test` / `password` **only in an isolated test database**, Laravel on port 8001, and Vite on port 5173 started with `DEV_API_TARGET=http://127.0.0.1:8001`. Set `CHROME_PATH` if needed. Never create that fixture in the application database.

## Linux VPS deployment

See [deployment instructions and Nginx example](docs/DEPLOYMENT.md). Build output stays in `frontend/dist`; never copy it over the whole Laravel `public/` directory. Laravel's PHP entry point, API routes, health endpoint, and public storage must remain intact.
