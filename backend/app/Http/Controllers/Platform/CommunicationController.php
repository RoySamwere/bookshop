<?php

namespace App\Http\Controllers\Platform;

use App\Http\Controllers\Controller;
use App\Models\Announcement;
use App\Models\AuditLog;
use App\Models\Bookshop;
use App\Models\CommunicationLog;
use App\Models\CommunicationTemplate;
use App\Services\CommunicationService;
use App\Support\CommunicationTemplates;
use App\Support\Roles;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** Platform Owner communication centre: delivery log, retries, templates and announcements. */
class CommunicationController extends Controller
{
    public function __construct(private readonly CommunicationService $communications) {}

    public function summary(Request $request): JsonResponse
    {
        $this->owner($request);
        $counts = CommunicationLog::query()->selectRaw('status, COUNT(*) as total')->groupBy('status')->pluck('total', 'status');
        $recent = CommunicationLog::query()->where('created_at', '>=', now()->subDays(30));

        return response()->json(['data' => [
            'sent' => (int) ($counts[CommunicationLog::SENT] ?? 0),
            'queued' => (int) (($counts[CommunicationLog::QUEUED] ?? 0) + ($counts[CommunicationLog::SENDING] ?? 0)),
            'failed' => (int) ($counts[CommunicationLog::FAILED] ?? 0),
            'last_30_days' => (clone $recent)->count(),
            'announcements' => Announcement::count(),
        ]]);
    }

    public function logs(Request $request): JsonResponse
    {
        $this->owner($request);
        $filters = $request->validate([
            'status' => ['nullable', Rule::in([CommunicationLog::QUEUED, CommunicationLog::SENDING, CommunicationLog::SENT, CommunicationLog::FAILED])],
            'event' => ['nullable', Rule::in([...array_keys(CommunicationTemplates::DEFAULTS), 'announcement'])],
            'bookshop_id' => ['nullable', 'integer', 'min:1'],
            'announcement_id' => ['nullable', 'integer', 'min:1'],
            'search' => ['nullable', 'string', 'max:100'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        return response()->json(CommunicationLog::query()->with('bookshop:id,name')
            ->when($filters['status'] ?? null, fn (Builder $q, $s) => $q->where('status', $s))
            ->when($filters['event'] ?? null, fn (Builder $q, $e) => $q->where('event', $e))
            ->when($filters['bookshop_id'] ?? null, fn (Builder $q, $id) => $q->where('bookshop_id', $id))
            ->when($filters['announcement_id'] ?? null, fn (Builder $q, $id) => $q->where('announcement_id', $id))
            ->when($filters['search'] ?? null, fn (Builder $q, $s) => $q->where(fn (Builder $m) => $m->where('recipient_email', 'like', "%{$s}%")->orWhere('subject', 'like', "%{$s}%")))
            ->latest('id')->paginate(25)->withQueryString()->through(fn (CommunicationLog $log) => $log->toApi()));
    }

    public function retry(Request $request, int $log): JsonResponse
    {
        $this->owner($request);
        $row = CommunicationLog::findOrFail($log);
        $this->communications->retry($row);
        AuditLog::record('platform.communication_retried', "Retried email \"{$row->subject}\" to {$row->recipient_email}", $row, bookshopId: $row->bookshop_id);

        return response()->json(['message' => 'The message is queued to send again.', 'data' => $row->fresh()->toApi()]);
    }

    public function retryFailed(Request $request): JsonResponse
    {
        $this->owner($request);
        $count = 0;
        CommunicationLog::where('status', CommunicationLog::FAILED)->orderBy('id')->limit(500)->get()
            ->each(function (CommunicationLog $log) use (&$count) { $this->communications->retry($log); $count++; });
        AuditLog::record('platform.communications_retried', "Retried {$count} failed email(s)", null, ['count' => $count], bookshopId: null);

        return response()->json(['message' => "{$count} failed message(s) queued to send again.", 'count' => $count]);
    }

    public function templates(Request $request): JsonResponse
    {
        $this->owner($request);

        return response()->json(['data' => collect(CommunicationTemplates::DEFAULTS)->map(fn (array $default, string $key) => [
            'key' => $key, 'label' => $default['label'], 'description' => $default['description'],
            'placeholders' => ['name', 'bookshop', 'app_name', 'app_url', 'support_email', ...$default['placeholders']],
            ...CommunicationTemplates::resolve($key),
            'default_subject' => $default['subject'], 'default_body' => $default['body'],
        ])->values()]);
    }

    public function updateTemplate(Request $request, string $key): JsonResponse
    {
        $this->owner($request);
        abort_unless(isset(CommunicationTemplates::DEFAULTS[$key]), 404);
        $data = $request->validate([
            'subject' => ['required', 'string', 'max:200'],
            'body' => ['required', 'string', 'max:5000'],
            'is_enabled' => ['required', 'boolean'],
        ]);
        CommunicationTemplate::updateOrCreate(['key' => $key], [...$data, 'updated_by' => $request->user()->id]);
        AuditLog::record('platform.template_updated', 'Updated the "'.CommunicationTemplates::DEFAULTS[$key]['label'].'" email template', null, ['template' => $key, 'enabled' => $data['is_enabled']], bookshopId: null);

        return response()->json(['message' => 'Template saved. New messages use it from now on.', 'data' => CommunicationTemplates::resolve($key)]);
    }

    public function resetTemplate(Request $request, string $key): JsonResponse
    {
        $this->owner($request);
        abort_unless(isset(CommunicationTemplates::DEFAULTS[$key]), 404);
        CommunicationTemplate::whereKey($key)->delete();
        AuditLog::record('platform.template_reset', 'Restored the default "'.CommunicationTemplates::DEFAULTS[$key]['label'].'" email template', null, ['template' => $key], bookshopId: null);

        return response()->json(['message' => 'The default template is restored.', 'data' => CommunicationTemplates::resolve($key)]);
    }

    public function announcements(Request $request): JsonResponse
    {
        $this->owner($request);
        $page = Announcement::query()->withCount([
            'logs as sent_count' => fn (Builder $q) => $q->where('status', CommunicationLog::SENT),
            'logs as failed_count' => fn (Builder $q) => $q->where('status', CommunicationLog::FAILED),
        ])->latest('id')->paginate(15);

        return response()->json($page->through(fn (Announcement $a) => [
            ...$a->only(['id', 'subject', 'body', 'category', 'audience', 'bookshop_ids', 'recipients', 'recipient_count', 'sent_count', 'failed_count']),
            'created_at' => $a->created_at?->toIso8601String(),
        ]));
    }

    /** How many people an announcement would reach, before it is sent. */
    public function audience(Request $request): JsonResponse
    {
        $this->owner($request);
        $data = $request->validate($this->audienceRules());

        $targets = $this->targets($data);

        return response()->json(['data' => ['bookshops' => $targets->count(), 'recipients' => $targets->sum(fn (Bookshop $b) => $this->communications->recipients($b, $data['recipients'])->count())]]);
    }

    public function announce(Request $request): JsonResponse
    {
        $this->owner($request);
        $data = $request->validate([
            ...$this->audienceRules(),
            'subject' => ['required', 'string', 'max:200'],
            'body' => ['required', 'string', 'max:5000'],
            'category' => ['required', Rule::in(Announcement::CATEGORIES)],
            'idempotency_key' => ['required', 'string', 'regex:/^[A-Za-z0-9-]{8,64}$/'],
        ]);
        if ($existing = Announcement::where('idempotency_key', $data['idempotency_key'])->first()) {
            return response()->json(['message' => 'This announcement was already sent. Nothing was sent twice.', 'duplicate' => true, 'data' => ['id' => $existing->id, 'recipient_count' => $existing->recipient_count]]);
        }
        $targets = $this->targets($data);
        abort_if($targets->isEmpty(), 422, 'Choose at least one bookshop.');

        $announcement = DB::transaction(function () use ($data, $targets, $request) {
            $announcement = Announcement::create([
                'subject' => $data['subject'], 'body' => $data['body'], 'category' => $data['category'], 'audience' => $data['audience'],
                'bookshop_ids' => $data['audience'] === 'selected' ? $targets->pluck('id')->values()->all() : null,
                'recipients' => $data['recipients'], 'idempotency_key' => $data['idempotency_key'], 'created_by' => $request->user()->id,
            ]);
            $count = $this->communications->announce($announcement, $targets, $request->user());
            $announcement->forceFill(['recipient_count' => $count])->save();
            AuditLog::record('platform.announcement_sent', "Sent the announcement \"{$announcement->subject}\" to {$count} user(s)", $announcement, [
                'bookshops' => $targets->count(), 'recipients' => $data['recipients'], 'category' => $data['category'],
            ], bookshopId: null);

            return $announcement;
        });

        return response()->json(['message' => "Announcement queued for {$announcement->recipient_count} user(s) in {$targets->count()} bookshop(s).", 'duplicate' => false,
            'data' => ['id' => $announcement->id, 'recipient_count' => $announcement->recipient_count]], 201);
    }

    private function audienceRules(): array
    {
        return [
            'audience' => ['required', Rule::in(['all', 'selected'])],
            'bookshop_ids' => ['required_if:audience,selected', 'array', 'max:500'],
            'bookshop_ids.*' => ['integer', 'distinct', 'exists:bookshops,id'],
            'recipients' => ['required', Rule::in(CommunicationService::GROUPS)],
        ];
    }

    private function targets(array $data)
    {
        return Bookshop::query()->when($data['audience'] === 'selected', fn (Builder $q) => $q->whereIn('id', $data['bookshop_ids'] ?? []))
            ->orderBy('id')->get();
    }

    private function owner(Request $request): void
    {
        abort_unless($request->user()?->role === Roles::PLATFORM_OWNER, 403, 'Only the Platform Owner can manage communication.');
    }
}
