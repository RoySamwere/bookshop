<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Registration sources include "bookshop_registration" (21 characters).
     * Earlier installations may have a shorter VARCHAR column.
     */
    public function up(): void
    {
        if (! Schema::hasColumn('users', 'registration_source')) {
            return;
        }

        // Preserve all existing values and the column's nullability/default.
        // MySQL/MariaDB support widening a VARCHAR without dropping the column.
        $column = DB::selectOne("SHOW COLUMNS FROM users LIKE 'registration_source'");
        if ($column === null) {
            return;
        }

        if (preg_match('/^varchar\\((\\d+)\\)$/i', $column->Type, $matches) && (int) $matches[1] >= 50) {
            return;
        }

        if (! preg_match('/^varchar\\((\\d+)\\)$/i', $column->Type)) {
            throw new \RuntimeException('Unexpected users.registration_source type; inspect it before altering.');
        }

        $nullable = $column->Null === 'YES' ? 'NULL' : 'NOT NULL';
        $default = $column->Default === null ? '' : ' DEFAULT '.DB::getPdo()->quote($column->Default);
        DB::statement("ALTER TABLE users MODIFY COLUMN registration_source VARCHAR(50) {$nullable}{$default}");
    }

    public function down(): void
    {
        // Intentionally no-op: shrinking could truncate existing registration sources.
    }
};
