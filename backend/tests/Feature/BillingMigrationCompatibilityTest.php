<?php

namespace Tests\Feature;

use Illuminate\Database\MySqlConnection;
use Illuminate\Support\Facades\Schema;
use LogicException;
use Tests\TestCase;

class BillingMigrationCompatibilityTest extends TestCase
{
    public function test_required_period_dates_do_not_generate_legacy_mysql_timestamp_defaults(): void
    {
        $sql = $this->mysqlSql('2026_11_01_000010_create_platform_billing_invoices.php');
        $this->assertStringContainsString('`period_starts_at` datetime not null', $sql);
        $this->assertStringContainsString('`period_ends_at` datetime not null', $sql);
        $this->assertStringNotContainsString('`period_starts_at` timestamp', $sql);
        $this->assertStringNotContainsString('`period_ends_at` timestamp', $sql);
        $this->assertStringNotContainsString('0000-00-00', $sql);
    }

    public function test_reconciliation_unique_index_respects_mysql_identifier_limit(): void
    {
        $sql = $this->mysqlSql('2026_11_01_000012_create_platform_payment_reconciliation_items.php');
        $this->assertStringContainsString('(`source`, `provider_transaction_id`)', $sql);
        preg_match_all('/\b(?:unique|index|constraint)\s+`([^`]+)`/i', $sql, $matches);
        $this->assertNotEmpty($matches[1]);
        foreach ($matches[1] as $name) {
            $this->assertLessThanOrEqual(64, strlen($name), 'MySQL schema identifier exceeds 64 characters: '.$name);
        }
    }

    private function mysqlSql(string $file): string
    {
        // Compile the real migrations with MySQL's grammar; SQLite cannot detect these regressions.
        $connection = new MySqlConnection(function () {
            throw new LogicException('SQL compilation must not connect to an application database.');
        }, 'migration_test', '', ['charset' => 'utf8mb4', 'collation' => 'utf8mb4_unicode_ci']);
        $connection->useDefaultSchemaGrammar();
        $original = Schema::getFacadeRoot();
        Schema::swap($connection->getSchemaBuilder());
        try {
            $migration = require database_path('migrations/'.$file);
            $queries = $connection->pretend(fn () => $migration->up());

            return implode("\n", array_column($queries, 'query'));
        } finally {
            Schema::swap($original);
        }
    }
}
