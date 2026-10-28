# Hekima Bookshop — local setup (Windows XAMPP)

The repository has two folders: `backend/` (Laravel 12 API, MySQL, Sanctum) and `frontend/` (Next.js 16, React 19, TypeScript, Tailwind CSS). Run the commands below from `C:\xampp\htdocs\bookshop` in PowerShell.

## Requirements
- XAMPP with PHP 8.2+ and MySQL running
- Composer on PATH
- Node.js and pnpm (`corepack enable`)

## Laravel API

Create an empty MySQL database named `bookshop` in phpMyAdmin. Copy `backend/.env.example` to `backend/.env` and set the `DB_*` values, then:

```powershell
cd C:\xampp\htdocs\bookshop\backend
composer install
php artisan key:generate   # first time only
php artisan migrate
php artisan serve --host=127.0.0.1 --port=8000
```

Migrations are additive. They never overwrite existing users or records.

## System Owner account

Set `SYSTEM_OWNER_EMAIL`, `SYSTEM_OWNER_NAME` and `SYSTEM_OWNER_PASSWORD` (12+ characters) in `backend/.env`. Never commit this file.

```powershell
php artisan db:seed
```

The seeders are idempotent. They keep an existing owner's password, refuse to promote an existing non-owner account, and create the default business profile, main branch and tax rates only if they are missing.

## Frontend

```powershell
cd C:\xampp\htdocs\bookshop\frontend
copy .env.example .env.local   # then adjust if needed
pnpm install
pnpm dev
```

| Address | What it is |
| --- | --- |
| http://localhost:3000/ | Public Coming Soon website (no sign-in needed) |
| http://localhost:3000/login | Sign in to the management system |
| http://localhost:3000/register | Create an account (always a customer account) |
| http://localhost:3000/forgot-password, /reset-password | Password recovery |
| http://localhost:3000/verify-email | Email verification links land here |
| http://localhost:3000/dashboard | Management system (staff only) |
| http://localhost:3000/account | Customers and staff applicants |
| http://127.0.0.1:8000/api | Laravel API |

### Branding and contact details

The brand name and the contact details on the public site come from `frontend/.env.local` (`NEXT_PUBLIC_BRAND_NAME`, `NEXT_PUBLIC_CONTACT_EMAIL`, `NEXT_PUBLIC_CONTACT_PHONE`, `NEXT_PUBLIC_CONTACT_WHATSAPP`, `NEXT_PUBLIC_CONTACT_ADDRESS`, `NEXT_PUBLIC_CONTACT_HOURS`). Empty values are hidden, so nothing invented ever shows. Restart `pnpm dev` (or rebuild) after changing them. Set `APP_NAME="Hekima Bookshop"` in `backend/.env` so emails carry the same name.

## Email (verification, password reset, approvals)

By default `MAIL_MAILER=log`. Nothing is sent, and every email, with its link, is written to `backend/storage/logs/laravel.log`. Copy a link from there while testing locally.

For real delivery, set your provider's SMTP details in `backend/.env`:

```
MAIL_MAILER=smtp
MAIL_HOST=smtp.your-provider.com
MAIL_PORT=587
MAIL_SCHEME=null          # STARTTLS on 587; use smtps with port 465
MAIL_USERNAME=...
MAIL_PASSWORD=...
MAIL_FROM_ADDRESS="no-reply@your-domain"
MAIL_FROM_NAME="${APP_NAME}"
FRONTEND_URL=http://localhost:3000
```

Run `php artisan config:clear` after editing. If mail fails, registration and approvals still complete. The failure is logged, and users can request a new link.

## Accounts and access

Public registration always creates a **customer** account with an unverified email. Ticking "I work at Hekima Bookshop and need staff access" only files a **request**. No staff or admin rights are ever granted automatically.

System Owners and Administrators see requests at the top of **Users**. To approve, choose a role and branch (Administrators can assign Store Manager, Cashier or Inventory Officer within their own branches; owners can also assign Administrator). The applicant must verify their email first. To decline, add an optional note, which the applicant sees on their account page and in the email. Every decision is in the audit log and in the account's history.

| Role | Access |
| --- | --- |
| System Owner | Everything, including settings, branches and all users |
| Administrator | Operations, staff and customers in assigned branches |
| Store Manager | Sales, stock and staff overview |
| Cashier | POS, sales, receipts and permitted returns |
| Inventory Officer | Catalogue, suppliers and stock |
| Customer | Their own account; the online store when it opens |

Passwords need 8+ characters with upper and lower case, a number and a symbol. Sign-in tokens last 12 hours, or 7 days with "Remember me" (`SANCTUM_TOKEN_EXPIRATION`, `SANCTUM_REMEMBER_EXPIRATION`). Verification links last 24 hours (`AUTH_VERIFICATION_EXPIRE`) and reset links 60 minutes.

## Tests

```powershell
cd C:\xampp\htdocs\bookshop\backend
php artisan test          # isolated in-memory SQLite database
cd ..\frontend
npx tsc --noEmit
pnpm build
```
