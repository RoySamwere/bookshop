<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'mpesa' => [
        'environment' => env('MPESA_ENVIRONMENT', 'sandbox'),
        'consumer_key' => env('MPESA_CONSUMER_KEY'),
        'consumer_secret' => env('MPESA_CONSUMER_SECRET'),
        'shortcode' => env('MPESA_SHORTCODE', '174379'),
        // The live platform Paybill is for SaaS subscriptions, not tenant POS receipts.
        'platform_paybill' => '152451',
        'passkey' => env('MPESA_PASSKEY'),
        'transaction_type' => env('MPESA_TRANSACTION_TYPE', 'CustomerPayBillOnline'),
        'callback_url' => env('MPESA_CALLBACK_URL'),
        // Automatic verification of Paybill (C2B) payments: transaction_status | pull_api | none.
        'c2b_verification' => env('MPESA_C2B_VERIFICATION', 'transaction_status'),
        'initiator_name' => env('MPESA_INITIATOR_NAME'),
        'security_credential' => env('MPESA_SECURITY_CREDENTIAL'),
        'result_url' => env('MPESA_RESULT_URL'),
        'timeout_url' => env('MPESA_TIMEOUT_URL'),
        // Optional comma-separated Safaricom callback IPs; when set, other sources are ignored.
        'callback_ips' => array_values(array_filter(array_map('trim', explode(',', (string) env('MPESA_CALLBACK_IPS', ''))))),
        'confirmation_url' => env('MPESA_C2B_CONFIRMATION_URL'),
        'validation_url' => env('MPESA_C2B_VALIDATION_URL'),
    ],

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

];
