# Bookshop local setup — Windows XAMPP

Run from `C:\xampp\htdocs\bookshop` in PowerShell after the frontend has been moved into `frontend`.

## Requirements
- XAMPP with PHP 8.2+ and MySQL running
- Composer available on PATH
- Node.js and pnpm

## Laravel install

```powershell
cd C:\xampp\htdocs\bookshop
composer create-project laravel/laravel backend
cd backend
php artisan install:api --no-interaction
php artisan key:generate
```

Create an empty MySQL database named `bookshop` using phpMyAdmin. Set `DB_CONNECTION=mysql`, `DB_HOST=127.0.0.1`, `DB_PORT=3306`, `DB_DATABASE=bookshop`, `DB_USERNAME=root` and your local `DB_PASSWORD` in `backend/.env`.

```powershell
php artisan migrate
php artisan serve --host=127.0.0.1 --port=8000
```

## System Owner account

Do not commit passwords. In a separate terminal, create a password hash through Laravel and store the owner using the included seeder once it is added. Until then, Laravel's built-in user model can be used for a temporary API authentication smoke test:

```powershell
cd C:\xampp\htdocs\bookshop\backend
php artisan tinker
```

Inside Tinker:

```php
$user = App\Models\User::firstOrCreate(['email' => 'owner@bookshop.local'], ['name' => 'System Owner', 'password' => Illuminate\Support\Facades\Hash::make('ChangeMeImmediately!2026')]);
$user->createToken('local-smoke-test')->plainTextToken;
```

**Important:** The token is for development testing only. Change the example password immediately and revoke the token after testing. This creates a Laravel user but does not yet implement the System Owner authorization role or a frontend login screen. Those must be implemented before calling login complete.

## Frontend

Once the existing Next.js files are in `frontend/`:

```powershell
cd C:\xampp\htdocs\bookshop\frontend
corepack enable
pnpm install
pnpm dev
```

Frontend: http://localhost:3000

Backend: http://127.0.0.1:8000
