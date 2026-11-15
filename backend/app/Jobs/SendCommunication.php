<?php

namespace App\Jobs;

use App\Models\CommunicationLog;
use App\Notifications\PlatformMessage;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Notification;
use Throwable;

/** Delivers one logged email. Safe to run twice: only a queued row is claimed and sent. */
class SendCommunication implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;

    /** Seconds before each automatic retry. */
    public array $backoff = [60, 300];

    public function __construct(public readonly int $logId) {}

    public function handle(): void
    {
        $claimed = CommunicationLog::whereKey($this->logId)->where('status', CommunicationLog::QUEUED)
            ->update(['status' => CommunicationLog::SENDING, 'updated_at' => now()]);
        if (! $claimed) {
            return;
        }
        $log = CommunicationLog::findOrFail($this->logId);
        try {
            Notification::route('mail', [$log->recipient_email => $log->recipient_name])
                ->notifyNow(new PlatformMessage($log->subject, $log->body));
            $log->forceFill(['status' => CommunicationLog::SENT, 'sent_at' => now(), 'last_error' => null, 'attempts' => $log->attempts + 1])->save();
        } catch (Throwable $exception) {
            report($exception);
            // The sync driver cannot retry later, so a failure there is final; a retry can be requested from the log.
            $final = $this->attempts() >= $this->tries || ! $this->job || $this->job->getConnectionName() === 'sync';
            $log->forceFill([
                'status' => $final ? CommunicationLog::FAILED : CommunicationLog::QUEUED,
                'attempts' => $log->attempts + 1,
                'last_error' => mb_substr(class_basename($exception).': '.$exception->getMessage(), 0, 500),
                'failed_at' => $final ? now() : null,
            ])->save();
            if (! $final && $this->job) {
                $this->release($this->backoff[$this->attempts() - 1] ?? 300);
            }
        }
    }
}
