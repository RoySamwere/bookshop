<?php

namespace App\Support;

use App\Models\CommunicationTemplate;

/**
 * Built-in email templates. Placeholders are written as {name}; unknown ones are left as typed.
 * Every template can use {name}, {bookshop}, {app_name}, {app_url} and {support_email}.
 */
final class CommunicationTemplates
{
    public const DEFAULTS = [
        'welcome' => [
            'label' => 'Bookshop activated',
            'description' => 'Sent to the bookshop owner when the Platform Owner approves and activates the bookshop.',
            'placeholders' => ['trial_ends'],
            'subject' => 'Welcome to {app_name}, {bookshop} is ready',
            'body' => "Hello {name},\n\n{bookshop} has been approved and your workspace is ready at {app_url}.\n\nTo get started:\n1. Complete your bookshop profile in Settings.\n2. Add your branches and invite your staff.\n3. Add your books and stock, then start selling from the Point of Sale.\n\nYour free trial runs until {trial_ends}. If you need help, write to {support_email}.",
        ],
        'trial_ending' => [
            'label' => 'Trial ending soon',
            'description' => 'Sent once, up to three days before a free trial ends.',
            'placeholders' => ['ends_on', 'days'],
            'subject' => 'Your {app_name} trial ends on {ends_on}',
            'body' => "Hello {name},\n\nThe free trial for {bookshop} ends on {ends_on} ({days} day(s) left).\n\nTo keep using the workspace without interruption, open Subscription billing at {app_url}/billing, choose a plan and pay with M-Pesa. Your records stay safe either way.",
        ],
        'renewal_due' => [
            'label' => 'Subscription ending soon',
            'description' => 'Sent once, up to seven days before a paid subscription period ends.',
            'placeholders' => ['ends_on', 'days', 'plan'],
            'subject' => 'Your {app_name} subscription renews on {ends_on}',
            'body' => "Hello {name},\n\nThe {plan} subscription for {bookshop} ends on {ends_on} ({days} day(s) left).\n\nRenew from Subscription billing at {app_url}/billing to keep your workspace open. Paying early keeps your remaining time.",
        ],
        'payment_due' => [
            'label' => 'Invoice ready for payment',
            'description' => 'Sent when a renewal invoice is created for a bookshop.',
            'placeholders' => ['account', 'amount', 'paybill', 'plan', 'due_on'],
            'subject' => 'Invoice {account} for KES {amount} is ready',
            'body' => "Hello {name},\n\nA {plan} invoice for {bookshop} is ready: KES {amount}, due {due_on}.\n\nPay with M-Pesa Paybill {paybill}, account number {account}, or open Subscription billing at {app_url}/billing to send a payment prompt to your phone.",
        ],
        'payment_confirmed' => [
            'label' => 'Payment confirmed',
            'description' => 'Sent only after Safaricom has verified a payment and it has been applied to an invoice.',
            'placeholders' => ['receipt', 'amount', 'account', 'invoice_status', 'balance', 'access_until'],
            'subject' => 'Payment received: KES {amount} for invoice {account}',
            'body' => "Hello {name},\n\nWe have received and verified your M-Pesa payment {receipt} of KES {amount} for {bookshop}.\n\nInvoice account {account} is now {invoice_status}. Remaining balance: KES {balance}. Subscription active until: {access_until}.\n\nYou can download a receipt from My Payments on your billing page.",
        ],
        'subscription_updated' => [
            'label' => 'Subscription updated',
            'description' => 'Sent when the Platform Owner changes a plan, extends a trial or the subscription status changes.',
            'placeholders' => ['summary', 'status', 'plan'],
            'subject' => '{bookshop}: your subscription has been updated',
            'body' => "Hello {name},\n\n{summary}\n\nCurrent plan: {plan}. Status: {status}. You can see the details in Subscription billing at {app_url}/billing.",
        ],
        'subscription_expired' => [
            'label' => 'Subscription ended',
            'description' => 'Sent once when a trial or paid period ends and the workspace closes.',
            'placeholders' => ['ended_on'],
            'subject' => 'Your {app_name} subscription has ended',
            'body' => "Hello {name},\n\nThe subscription for {bookshop} ended on {ended_on}, so the workspace is closed for now. All your records are kept.\n\nRenew from Subscription billing at {app_url}/billing to reopen it straight away.",
        ],
        'bookshop_suspended' => [
            'label' => 'Bookshop suspended',
            'description' => 'Sent to every user of a bookshop when the Platform Owner suspends it.',
            'placeholders' => ['reason'],
            'subject' => '{bookshop} is temporarily unavailable',
            'body' => "Hello {name},\n\nAccess to {bookshop} on {app_name} has been temporarily paused. Reason: {reason}\n\nYour records, sales and stock are safe and unchanged. You can still sign in to see this notice. To restore access, please contact {app_name} support at {support_email}.",
        ],
        'bookshop_reactivated' => [
            'label' => 'Bookshop reactivated',
            'description' => 'Sent to every user of a bookshop when its suspension is lifted.',
            'placeholders' => [],
            'subject' => '{bookshop} is available again',
            'body' => "Hello {name},\n\nGood news: access to {bookshop} on {app_name} has been restored. Sign in at {app_url} to continue where you left off.",
        ],
    ];

    /** @return array{subject: string, body: string, is_enabled: bool, customized: bool} */
    public static function resolve(string $key): array
    {
        $default = self::DEFAULTS[$key] ?? throw new \InvalidArgumentException("Unknown template {$key}");
        $override = CommunicationTemplate::find($key);

        return [
            'subject' => $override?->subject ?? $default['subject'],
            'body' => $override?->body ?? $default['body'],
            'is_enabled' => $override?->is_enabled ?? true,
            'customized' => $override !== null,
        ];
    }

    public static function render(string $text, array $vars): string
    {
        $vars = [
            'app_name' => config('app.name'),
            'app_url' => rtrim((string) config('app.frontend_url'), '/'),
            'support_email' => \App\Models\PlatformSetting::get('support_email') ?: config('mail.from.address'),
            ...$vars,
        ];

        return strtr($text, collect($vars)->mapWithKeys(fn ($value, $key) => ['{'.$key.'}' => (string) ($value ?? '—')])->all());
    }
}
