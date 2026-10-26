#!/usr/bin/env bash
set -euo pipefail

# Run from the repository root on a machine with PHP, Composer and Node.js installed.
if [ ! -f frontend/package.json ]; then
  echo "Move the existing Next.js project into frontend/ before running this script."
  exit 1
fi
command -v composer >/dev/null || { echo "Composer is required to install Laravel."; exit 1; }
command -v php >/dev/null || { echo "PHP is required."; exit 1; }
command -v node >/dev/null || { echo "Node.js is required."; exit 1; }
if [ -e backend ]; then
  echo "backend/ already exists; refusing to overwrite it."
  exit 1
fi

composer create-project laravel/laravel backend
cd backend
php artisan install:api --no-interaction
cp -n .env.example .env || true
php artisan key:generate --no-interaction
echo "Laravel installed. Configure DB_* values in backend/.env before migrations."
cd ../frontend
if command -v corepack >/dev/null; then corepack enable; fi
pnpm install --frozen-lockfile
echo "Next: configure MySQL and run cd backend && php artisan migrate."
