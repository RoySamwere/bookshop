<?php

namespace Database\Seeders;

use App\Models\AuditLog;
use App\Models\User;
use App\Services\UpgradeLegacyPlatformOwner;
use App\Support\Roles;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class SystemOwnerSeeder extends Seeder
{
    public function run(): void
    {
        $email = strtolower(trim((string) config('platform.legacy_owner_email')));
        if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new RuntimeException('Set a valid SYSTEM_OWNER_EMAIL.');
        }
        if (User::whereRaw('LOWER(email) = ?', [$email])->exists()) {
            app(UpgradeLegacyPlatformOwner::class)->run();

            return;
        }
        $password = (string) config('platform.legacy_owner_password');
        if (strlen($password) < 12) {
            throw new RuntimeException('Set SYSTEM_OWNER_PASSWORD to at least 12 characters for initial provisioning.');
        }
        DB::transaction(function () use ($email, $password) {
            $user = new User(['email' => $email, 'password' => $password, 'name' => config('platform.legacy_owner_name'), 'role' => Roles::PLATFORM_OWNER]);
            $user->email_verified_at = now();
            $user->save();
            AuditLog::record('platform.owner_provisioned', 'Provisioned configured Platform Owner from SystemOwnerSeeder', $user, actor: $user);
        });
    }
}
