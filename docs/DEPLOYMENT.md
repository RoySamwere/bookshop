# Linux VPS deployment

Deploy only after resolving the release gates in MIGRATION.md. The foundation is compatible with standard PHP-FPM/Nginx hosting, but the remaining sample-data modules and tenant isolation are not ready for a multi-tenant launch.

## Build and runtime configuration

Use an application root such as `/var/www/hekima/current` with sibling `backend` and `frontend`. Keep Laravel's document root at `backend/public`.

1. Install backend dependencies: `cd backend && composer install --no-dev --optimize-autoloader`.
2. Create the private backend `.env`: set `APP_ENV=production`, `APP_DEBUG=false`, `APP_URL=https://books.example.com`, and the existing `APP_KEY` (generate one only for a new installation). Configure MySQL and real mail delivery.
3. Set `FRONTEND_URL=https://books.example.com`, `FRONTEND_ORIGINS=https://books.example.com`, `SANCTUM_STATEFUL_DOMAINS=books.example.com`, `SESSION_SECURE_COOKIE=true`, `SESSION_HTTP_ONLY=true`, `SESSION_SAME_SITE=lax`, `SESSION_DRIVER=database`. For a single origin leave `SESSION_DOMAIN=null`; shared subdomains require a deliberate parent-domain cookie configuration.
4. Build: `cd frontend && npm ci && npm run build`, using `VITE_API_URL=/api/v1`. Vite writes only `frontend/dist`; all Vite environment values are public. Static build guidance: [Vite deployment](https://vite.dev/guide/static-deploy).
5. Back up the database, then run `cd backend && php artisan migrate --force`, `php artisan storage:link`, and `php artisan optimize`. Ensure PHP-FPM can write `storage` and `bootstrap/cache`. Do not run development/demo seeders.
6. Serve the React output directly from `frontend/dist` with the routing below. Keep releases immutable and switch the `current` symlink atomically. Do not use a synchronizing command with `--delete` against Laravel's public directory.

## Nginx routing example

Replace hostnames, paths and the PHP socket. Install a valid TLS certificate and redirect HTTP to HTTPS.

```nginx
server {
    listen 443 ssl;
    server_name books.example.com;
    # ssl_certificate /.../fullchain.pem;
    # ssl_certificate_key /.../privkey.pem;

    root /var/www/hekima/current/backend/public;
    index index.php;

    # Always send backend paths to Laravel, including nonexistent API routes.
    location = /api { try_files /__backend_route_missing__ /index.php?$query_string; }
    location ^~ /api/ { try_files /__backend_route_missing__ /index.php?$query_string; }
    location ^~ /sanctum/ { try_files /__backend_route_missing__ /index.php?$query_string; }
    location = /up { try_files /__backend_route_missing__ /index.php?$query_string; }

    location ^~ /storage/ { try_files $uri =404; }
    location ^~ /assets/ {
        root /var/www/hekima/current/frontend/dist;
        try_files $uri =404;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    location / {
        root /var/www/hekima/current/frontend/dist;
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache";
    }
    location = /index.php {
        include fastcgi_params;
        fastcgi_pass unix:/run/php/php8.3-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $document_root/index.php;
    }
    location ~ \.php$ { return 404; }
    location ~ /\. { deny all; }
}
```

Keep `/assets/*` responses as 404 when missing; serving HTML for missing scripts hides broken deployments. React history paths such as `/dashboard/catalog` fall back to the SPA entry, while `/api/*` never do.

## Workers and release checks

With `QUEUE_CONNECTION=database`, supervise `php artisan queue:work --sleep=3 --tries=3 --timeout=90` and restart workers on deploy using `php artisan queue:restart`. Enable a scheduler only when application schedules are added. Configure logs, backups and health monitoring.

Verify HTTPS cookie flags, CSRF rejection, login/refresh/logout, password/verification mail links, permission denials, direct React URL refreshes, inventory writes, idempotent checkout, receipt print/reprint and mobile checkout. Test MySQL stock locking with concurrent checkout requests against a separate staging database. Do not test production transactions by inserting mock records.
