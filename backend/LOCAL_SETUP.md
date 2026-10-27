# Bookshop local setup — Windows XAMPP

Run from `C:\xampp\htdocs\bookshop` in PowerShell after the frontend has been moved into `frontend`.

## Requirements
- XAMPP with PHP 8.2+ and MySQL running
- Composer available on PATH
- Node.js and pnpm

## Laravel API

Laravel 12 and Sanctum are installed in `backend/`. The `User` model supports Sanctum API tokens, and the API routes are in `backend/routes/api.php`.

Create an empty MySQL database named `bookshop` using phpMyAdmin. Set `DB_CONNECTION=mysql`, `DB_HOST=127.0.0.1`, `DB_PORT=3306`, `DB_DATABASE=bookshop`, `DB_USERNAME=root` and your local `DB_PASSWORD` in `backend/.env`.

```powershell
cd C:\xampp\htdocs\bookshop\backend
php artisan migrate
php artisan serve --host=127.0.0.1 --port=8000
```

## System Owner account

Set `SYSTEM_OWNER_EMAIL`, `SYSTEM_OWNER_NAME`, and `SYSTEM_OWNER_PASSWORD` in `backend/.env`. Use a password of at least 12 characters. Do not commit this file. Create the initial owner with the included seeder:

```powershell
cd C:\xampp\htdocs\bookshop\backend
php artisan db:seed --class=SystemOwnerSeeder
```

The seeder preserves an existing owner's password and refuses to promote an existing non-owner account. Sign in through the frontend using the owner's credentials, then open **Users** to create team accounts.

## User rights

| Role | Sign in and shop workspace | User management | Settings access |
| --- | --- | --- | --- |
| System Owner | Full access | View all accounts; create admins/users; change non-owner roles; remove non-owner accounts | Yes |
| Administrator (`admin`) | Full access | Create users; list/remove only their own user/staff accounts | Yes |
| User (`user`) / existing Staff (`staff`) | Shop operations, including POS, catalogue, stock, sales, customers, suppliers, expenses and reports | None | No |

Owners can change a non-owner account between Administrator and User using the role selector in **Users**. Owner accounts and self-deletion are protected. Role changes and account deletion revoke that account's API tokens. The user must sign in again after a role change. Existing `staff` accounts retain operational access without a database migration or promotion to administrator. Unknown roles are denied.

`GET /api/auth/me` and login return the current role, permission names, and assignable roles. The frontend uses these to display permitted navigation; the API independently enforces user-management rules on every request. `created_by` is set by the server so admins cannot choose another account's ownership. Previously created accounts with no creator remain manageable by the owner.

The shop operation screens currently use demo data and some sections, including Settings, are placeholders. Their navigation rights are defined here; persistent business operations will need matching API authorization when implemented.

Run access-control regression tests with `php artisan test`. Tests use an isolated in-memory SQLite database.

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
