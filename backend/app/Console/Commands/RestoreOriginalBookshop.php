<?php

namespace App\Console\Commands;

use App\Services\RestoreOriginalBookshop as Restore;
use Illuminate\Console\Command;
use RuntimeException;

class RestoreOriginalBookshop extends Command
{
    protected $signature = 'platform:restore-original-bookshop {--bookshop= : Verified original existing bookshop ID} {--apply : Apply reviewed changes} {--confirm-legacy-ownership : Confirm the listed unassigned records belong to the original business}';

    protected $description = 'Verify, adopt and authorize the original Hekima bookshop (dry run by default)';

    public function handle(Restore $restore): int
    {
        $id = $this->option('bookshop');
        if ($id !== null && (! ctype_digit((string) $id) || (int) $id < 1)) {
            $this->error('--bookshop must be a positive ID.');

            return self::FAILURE;
        }
        try {
            $plan = $restore->run($id === null ? null : (int) $id, (bool) $this->option('apply'), (bool) $this->option('confirm-legacy-ownership'));
        } catch (RuntimeException $exception) {
            $this->error($exception->getMessage());

            return self::FAILURE;
        }
        $this->table(['Unassigned legacy table', 'Rows'], collect($plan['legacy_rows'])->map(fn ($count, $table) => [$table, $count])->values()->all());
        $this->line("Original administrator #{$plan['administrator_id']}; business: {$plan['bookshop_name']}; existing bookshop: ".($plan['bookshop_id'] ?? 'new tenant'));
        $this->line('Staff IDs to adopt: '.implode(', ', $plan['staff_ids']));
        $this->info($plan['applied'] ? 'Original bookshop authorized. Open Platform → Bookshop Management.' : 'Dry run: no changes. Review ownership before using --apply --confirm-legacy-ownership.');

        return self::SUCCESS;
    }
}
