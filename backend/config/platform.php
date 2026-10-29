<?php

return [
    // Preserve the trusted identity when configuration is cached.
    'legacy_owner_email' => env('SYSTEM_OWNER_EMAIL'),
    'legacy_owner_name' => env('SYSTEM_OWNER_NAME', 'Platform Owner'),
    'legacy_owner_password' => env('SYSTEM_OWNER_PASSWORD'),
];
