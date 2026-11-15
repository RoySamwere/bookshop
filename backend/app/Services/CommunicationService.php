<?php

namespace App\Services;

use App\Jobs\SendCommunication;
use App\Models\Announcement;
use App\Models\Bookshop;
use App\Models\CommunicationLog;
use App\Models\User;
use App\Notifications\AccountNotification;
use App\Support\CommunicationTemplates;
use App\Support\Roles;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\UniqueConstraintViolationException;

/**
 * The one place platform emails start. Each message becomes a communication_logs row per recipient,
 * keyed so the same occurrence is never sent twice, then a queued job delivers it after the
 * surrounding transaction commits. Users also get an in-app copy in their notification panel.
 */
class CommunicationService
{
    public const GROUPS = ['owners', 'staff'];

    /** Active bookshop users with an email: owners only, or every staff account (customers never). */
    public function recipients(Bookshop $bookshop, string $group = 'owners'): Collection
    {
        $roles = $group === 'owners' ? Roles::TENANT_OWNER_ROLES : [...Roles::TENANT_OWNER_ROLES, ...Roles::BRANCH_ROLES];

        return User::query()->where('bookshop_id', $bookshop->id)->where('is_active', true)
            ->whereIn('role', $roles)->whereNotNull('email')->orderBy('id')->get();
    }

    /**
     * Sends a template to a bookshop's users. $occurrence identifies this event (an invoice id, an
     * end date); repeating the same occurrence sends nothing new. Returns how many emails were queued.
     */
    public function notify(string $event, Bookshop $bookshop, string $occurrence, array $vars = [], string $group = 'owners', bool $inApp = true, ?User $actor = null): int
    {
        $template = CommunicationTemplates::resolve($event);
        if (! $template['is_enabled']) {
            return 0;
        }
        $queued = 0;
        foreach ($this->recipients($bookshop, $group) as $user) {
            $values = ['name' => $user->name, 'bookshop' => $bookshop->name, ...$vars];
            $log = $this->queue([
                'event' => $event, 'bookshop_id' => $bookshop->id, 'user_id' => $user->id,
                'recipient_email' => $user->email, 'recipient_name' => $user->name,
                'subject' => mb_substr(CommunicationTemplates::render($template['subject'], $values), 0, 200),
                'body' => CommunicationTemplates::render($template['body'], $values),
                'dedupe_key' => "{$event}:{$bookshop->id}:{$occurrence}:{$user->id}",
                'created_by' => $actor?->id,
            ]);
            if ($log) {
                $queued++;
                if ($inApp) {
                    $user->notify(new AccountNotification($log->subject, $this->firstParagraph($log->body), $this->level($event), 'communication'));
                }
            }
        }

        return $queued;
    }

    /** "Invoice ready" notice for a platform billing invoice; sent once per invoice. Sandbox invoices are never announced. */
    public function invoiceDue(object $invoice, ?\App\Models\SubscriptionPlan $plan = null): int
    {
        $bookshop = Bookshop::find($invoice->bookshop_id);
        if (! $bookshop || ($invoice->environment ?? null) === 'sandbox') {
            return 0;
        }

        return $this->notify('payment_due', $bookshop, 'invoice-'.$invoice->id, [
            'account' => $invoice->account_number,
            'amount' => number_format((float) $invoice->amount),
            'paybill' => config('services.mpesa.shortcode'),
            'plan' => $plan?->name ?? \App\Models\SubscriptionPlan::find($invoice->subscription_plan_id)?->name ?? 'subscription',
            'due_on' => \Illuminate\Support\Carbon::parse($invoice->due_at ?? $invoice->period_starts_at)->format('j M Y'),
        ]);
    }

    /** Creates one log per recipient of an announcement and queues them. */
    public function announce(Announcement $announcement, iterable $bookshops, User $actor): int
    {
        $count = 0;
        foreach ($bookshops as $bookshop) {
            foreach ($this->recipients($bookshop, $announcement->recipients) as $user) {
                $vars = ['name' => $user->name, 'bookshop' => $bookshop->name];
                $log = $this->queue([
                    'event' => 'announcement', 'bookshop_id' => $bookshop->id, 'user_id' => $user->id, 'announcement_id' => $announcement->id,
                    'recipient_email' => $user->email, 'recipient_name' => $user->name,
                    'subject' => mb_substr(CommunicationTemplates::render($announcement->subject, $vars), 0, 200),
                    'body' => CommunicationTemplates::render($announcement->body, $vars),
                    'dedupe_key' => "announcement:{$announcement->id}:{$user->id}",
                    'created_by' => $actor->id,
                ]);
                if ($log) {
                    $count++;
                    $user->notify(new AccountNotification($log->subject, $this->firstParagraph($log->body), $announcement->category === 'maintenance' ? 'warning' : 'info', 'communication'));
                }
            }
        }

        return $count;
    }

    /** Puts a failed message back on the queue. */
    public function retry(CommunicationLog $log): void
    {
        abort_unless($log->status === CommunicationLog::FAILED, 422, 'Only failed messages can be retried.');
        $log->forceFill(['status' => CommunicationLog::QUEUED, 'failed_at' => null])->save();
        SendCommunication::dispatch($log->id)->afterCommit();
    }

    private function queue(array $attributes): ?CommunicationLog
    {
        if (CommunicationLog::where('dedupe_key', $attributes['dedupe_key'])->exists()) {
            return null; // Already sent (or queued) for this occurrence.
        }
        try {
            $log = CommunicationLog::create([...$attributes, 'status' => CommunicationLog::QUEUED]);
        } catch (UniqueConstraintViolationException) {
            return null; // Already sent (or queued) for this occurrence.
        }
        SendCommunication::dispatch($log->id)->afterCommit();

        return $log;
    }

    private function firstParagraph(string $body): string
    {
        $paragraphs = array_values(array_filter(preg_split('/\R{2,}/', $body) ?: [], fn ($p) => ! str_starts_with(trim($p), 'Hello ')));

        return mb_substr(trim($paragraphs[0] ?? $body), 0, 300);
    }

    private function level(string $event): string
    {
        return match ($event) {
            'payment_confirmed', 'bookshop_reactivated', 'welcome' => 'success',
            'bookshop_suspended', 'subscription_expired' => 'error',
            'trial_ending', 'renewal_due', 'payment_due' => 'warning',
            default => 'info',
        };
    }
}
