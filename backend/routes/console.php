<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Schedule::command('sanctum:prune-expired --hours=24')->daily();
Schedule::command('billing:expire-subscriptions')->everyFiveMinutes()->withoutOverlapping();
Schedule::command('billing:generate-renewals')->hourly()->withoutOverlapping();
// Trial-ending and renewal reminders; each is sent once per end date however often this runs.
Schedule::command('communications:subscription-reminders')->hourly()->withoutOverlapping();
// Verifies received M-Pesa payments with Safaricom and applies them to invoices (no manual approval).
Schedule::command('billing:reconcile-payments')->everyMinute()->withoutOverlapping();

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');
