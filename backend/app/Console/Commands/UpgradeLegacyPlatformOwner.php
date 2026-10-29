<?php

namespace App\Console\Commands;

use App\Services\UpgradeLegacyPlatformOwner as Upgrade;
use Illuminate\Console\Command;
use RuntimeException;

class UpgradeLegacyPlatformOwner extends Command
{
    protected $signature = 'platform:upgrade-legacy-owner {--dry-run : Validate without writing} {--replacement-owner= : Existing active tenant owner ID to receive business ownership}';

    protected $description = 'Safely upgrade only the existing administrator identified by configured SYSTEM_OWNER_EMAIL';

    public function handle(Upgrade $upgrade): int
    {
        $replacement = $this->option('replacement-owner');
        if ($replacement !== null && (! ctype_digit((string) $replacement) || (int) $replacement < 1)) {
            $this->error('--replacement-owner must be a positive user ID.');

            return self::FAILURE;
        }
        try {
            $user = $upgrade->run($replacement === null ? null : (int) $replacement, (bool) $this->option('dry-run'));
        } catch (RuntimeException $exception) {
            $this->error($exception->getMessage());

            return self::FAILURE;
        }
        $this->info($this->option('dry-run') ? "Validated account {$user->id}; no changes written." : "Account {$user->id} is a Platform Owner. Sign in at /platform.");

        return self::SUCCESS;
    }
}
