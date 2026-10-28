<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\URL;

/** Builds links that open pages on the Next.js frontend. */
final class FrontendUrl
{
    public static function to(string $path, array $query = []): string
    {
        $base = rtrim((string) config('app.frontend_url'), '/');

        return $base.'/'.ltrim($path, '/').($query ? '?'.http_build_query($query) : '');
    }

    /**
     * Email verification link. The signature is relative (path + query only), so it stays valid
     * whether the API is reached as localhost, 127.0.0.1 or a LAN address.
     */
    public static function verification(User $user): string
    {
        $signed = URL::temporarySignedRoute(
            'verification.verify',
            now()->addMinutes((int) config('auth.verification.expire', 1440)),
            ['id' => $user->getKey(), 'hash' => sha1($user->getEmailForVerification())],
            absolute: false,
        );
        parse_str((string) parse_url($signed, PHP_URL_QUERY), $query);

        return self::to('/verify-email', [
            'id' => $user->getKey(),
            'hash' => sha1($user->getEmailForVerification()),
            'expires' => $query['expires'] ?? '',
            'signature' => $query['signature'] ?? '',
        ]);
    }
}
