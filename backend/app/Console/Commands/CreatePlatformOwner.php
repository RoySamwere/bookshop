<?php

namespace App\Console\Commands;

use App\Models\AuditLog;
use App\Models\User;
use App\Support\Roles;
use Illuminate\Console\Command;

/**
 * The only way to create a Platform Owner: from the server console, using credentials kept in
 * backend/.env (PLATFORM_OWNER_EMAIL, PLATFORM_OWNER_PASSWORD, PLATFORM_OWNER_NAME). No API can do this.
 */
class CreatePlatformOwner extends Command
{
    protected $signature = 'platform:owner';

    protected $description = 'Create or confirm the Platform Owner account from PLATFORM_OWNER_* settings in .env';

    public function handle(): int
    {
        $email = strtolower(trim((string) env('PLATFORM_OWNER_EMAIL')));
        $password = (string) env('PLATFORM_OWNER_PASSWORD');
        $name = (string) env('PLATFORM_OWNER_NAME', 'Platform Owner');

        if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            $this->error('Set a valid PLATFORM_OWNER_EMAIL in backend/.env.');

            return self::FAILURE;
        }

        $user = User::where('email', $email)->first();
        if ($user && $user->role !== Roles::PLATFORM_OWNER) {
            $this->error('This email already belongs to a bookshop or customer account. Use a separate address for platform administration.');

            return self::FAILURE;
        }
        if (! $user && strlen($password) < 12) {
            $this->error('Set PLATFORM_OWNER_PASSWORD to at least 12 characters in backend/.env.');

            return self::FAILURE;
        }

        if (! $user) {
            $user = new User(['name' => $name, 'email' => $email, 'password' => $password]);
        }
        $user->forceFill(['name' => $name, 'role' => Roles::PLATFORM_OWNER, 'bookshop_id' => null, 'is_active' => true]);
        $user->email_verified_at ??= now();
        $created = ! $user->exists;
        $user->save();

        if ($created) {
            AuditLog::record('platform.owner_provisioned', "Provisioned Platform Owner {$user->email} from the console", $user, actor: $user, bookshopId: null);
        }
        $this->info($created ? "Platform Owner {$email} created." : "Platform Owner {$email} is up to date.");
        $this->line('Remove PLATFORM_OWNER_PASSWORD from .env now that the account exists.');

        return self::SUCCESS;
    }
}
