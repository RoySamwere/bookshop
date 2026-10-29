<?php

namespace App\Support\Tenancy;

use App\Models\User;

final class ManagementContext
{
    public const SESSION_KEY = 'platform_management_bookshop';

    public static function idFor(User $user): ?int
    {
        $context = request()->attributes->get(self::SESSION_KEY);

        return $user->isPlatformUser() && $context && $context['user_id'] === $user->id
            ? $context['bookshop_id'] : null;
    }
}
