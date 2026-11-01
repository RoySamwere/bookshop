<?php

use Illuminate\Cookie\Middleware\EncryptCookies;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Laravel\Sanctum\Http\Middleware\AuthenticateSession;
use Laravel\Sanctum\Sanctum;

return [

    /*
    |--------------------------------------------------------------------------
    | Stateful Domains
    |--------------------------------------------------------------------------
    |
    | Requests from the following domains / hosts will receive stateful API
    | authentication cookies. Typically, these should include your local
    | and production domains which access your API via a frontend SPA.
    |
    */

    // The SPA's own site is always first-party, whatever SANCTUM_STATEFUL_DOMAINS says: the API host itself
    // (same-origin deployments such as public_html + /api), APP_URL, FRONTEND_URL and FRONTEND_ORIGINS.
    // A server .env copied from .env.example (localhost only) would otherwise reject every live sign-in.
    'stateful' => array_values(array_unique(array_filter([
        ...array_map('trim', explode(',', (string) env('SANCTUM_STATEFUL_DOMAINS', 'localhost,localhost:3000,localhost:5173,127.0.0.1,127.0.0.1:5173,127.0.0.1:8000,::1'))),
        ...array_map(
            fn ($url) => parse_url(trim($url), PHP_URL_HOST).(parse_url(trim($url), PHP_URL_PORT) ? ':'.parse_url(trim($url), PHP_URL_PORT) : ''),
            array_filter([(string) env('APP_URL', ''), (string) env('FRONTEND_URL', ''), ...explode(',', (string) env('FRONTEND_ORIGINS', ''))], fn ($url) => str_contains($url, '://')),
        ),
        Sanctum::$currentRequestHostPlaceholder,
    ]))),

    /*
    |--------------------------------------------------------------------------
    | Sanctum Guards
    |--------------------------------------------------------------------------
    |
    | This array contains the authentication guards that will be checked when
    | Sanctum is trying to authenticate a request. If none of these guards
    | are able to authenticate the request, Sanctum will use the bearer
    | token that's present on an incoming request for authentication.
    |
    */

    'guard' => ['web'],

    /*
    |--------------------------------------------------------------------------
    | Expiration Minutes
    |--------------------------------------------------------------------------
    |
    | This value controls the number of minutes until an issued token will be
    | considered expired. This will override any values set in the token's
    | "expires_at" attribute, but first-party sessions are not affected.
    |
    */

    // Hard ceiling for every token. Each sign-in also sets its own expiry below it:
    // token_lifetime normally, remember_lifetime when "Remember me" is ticked.
    'expiration' => env('SANCTUM_REMEMBER_EXPIRATION', 10080),

    'token_lifetime' => env('SANCTUM_TOKEN_EXPIRATION', 720),

    'remember_lifetime' => env('SANCTUM_REMEMBER_EXPIRATION', 10080),

    /*
    |--------------------------------------------------------------------------
    | Token Prefix
    |--------------------------------------------------------------------------
    |
    | Sanctum can prefix new tokens in order to take advantage of numerous
    | security scanning initiatives maintained by open source platforms
    | that notify developers if they commit tokens into repositories.
    |
    | See: https://docs.github.com/en/code-security/secret-scanning/about-secret-scanning
    |
    */

    'token_prefix' => env('SANCTUM_TOKEN_PREFIX', ''),

    /*
    |--------------------------------------------------------------------------
    | Sanctum Middleware
    |--------------------------------------------------------------------------
    |
    | When authenticating your first-party SPA with Sanctum you may need to
    | customize some of the middleware Sanctum uses while processing the
    | request. You may change the middleware listed below as required.
    |
    */

    'middleware' => [
        'authenticate_session' => AuthenticateSession::class,
        'encrypt_cookies' => EncryptCookies::class,
        'validate_csrf_token' => ValidateCsrfToken::class,
    ],

];
