<?php

namespace App\Support\Tenancy;

use App\Models\Bookshop;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Exists;
use Illuminate\Validation\Rules\Unique;

/**
 * The current bookshop (tenant). It always comes from the signed-in user's own membership
 * (users.bookshop_id), or a database-authorized platform management context resolved by middleware,
 * never from a client-submitted bookshop_id. Console code that has no
 * signed-in user can act for one bookshop with Tenant::run().
 */
final class Tenant
{
    private static ?int $override = null;

    /** The current bookshop id, or null when there is no tenant (guests, platform staff, console). */
    public static function id(): ?int
    {
        $user = auth()->user();

        return self::$override ?? $user?->workspaceBookshopId();
    }

    /** For tenant-only code paths; the `tenant` middleware guarantees this is set. */
    public static function requireId(): int
    {
        $id = self::id();
        abort_if($id === null, 403, 'This action requires a bookshop workspace.');

        return $id;
    }

    public static function bookshop(): ?Bookshop
    {
        $id = self::id();

        return $id === null ? null : Bookshop::find($id);
    }

    /**
     * How Eloquent tenant scopes should filter: a bookshop id, false to match nothing
     * (a signed-in account with no bookshop), or null for no filter (no signed-in user).
     */
    public static function scopeValue(): int|false|null
    {
        if (self::$override !== null) {
            return self::$override;
        }
        $user = auth()->user();
        if (! $user) {
            return null;
        }

        return $user->workspaceBookshopId() ?? false;
    }

    /** Runs code on behalf of one bookshop (console commands, jobs). */
    public static function run(Bookshop|int $bookshop, callable $callback): mixed
    {
        $previous = self::$override;
        self::$override = $bookshop instanceof Bookshop ? $bookshop->id : $bookshop;
        try {
            return $callback();
        } finally {
            self::$override = $previous;
        }
    }

    /** exists rule limited to the current bookshop's rows. */
    public static function exists(string $table, string $column = 'id'): Exists
    {
        return Rule::exists($table, $column)->where('bookshop_id', self::requireId());
    }

    /** unique rule evaluated within the current bookshop only. */
    public static function unique(string $table, string $column): Unique
    {
        return Rule::unique($table, $column)->where('bookshop_id', self::requireId());
    }
}
