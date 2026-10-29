<?php

return [
    // Trial length for newly registered bookshops. The Platform Owner can override it in platform settings.
    'trial_days' => (int) env('SUBSCRIPTION_TRIAL_DAYS', 14),

    // subscription_plans.code given to new bookshops.
    'default_plan' => env('SUBSCRIPTION_DEFAULT_PLAN', 'starter'),
];
