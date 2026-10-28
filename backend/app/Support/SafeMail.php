<?php

namespace App\Support;

use Throwable;

/**
 * Sends mail without letting a missing or broken SMTP setup fail the request that triggered it.
 * The failure is still reported to the log so it can be fixed.
 */
final class SafeMail
{
    public static function send(callable $send): bool
    {
        try {
            $send();

            return true;
        } catch (Throwable $exception) {
            report($exception);

            return false;
        }
    }
}
