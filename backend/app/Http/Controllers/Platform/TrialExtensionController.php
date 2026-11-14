<?php

namespace App\Http\Controllers\Platform;

use App\Http\Controllers\Controller;
use App\Models\Bookshop;
use App\Models\BookshopSubscription;
use App\Models\SubscriptionTrialExtension;
use App\Services\SubscriptionService;
use App\Support\Roles;
use Closure;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Manual trial extensions. Platform Owner only: the route permission is withheld from Platform
 * Administrators, and each action re-checks the role. History is read-only; there is no edit or delete.
 */
class TrialExtensionController extends Controller
{
    public function __construct(private readonly SubscriptionService $subscriptions) {}

    /** Every bookshop subscription with its trial state and whether a trial extension is allowed. */
    public function index(Request $request): JsonResponse
    {
        $this->authorizeOwner($request);
        $filters = $request->validate([
            'search' => ['nullable', 'string', 'max:100'],
            'state' => ['nullable', 'in:all,active,expired,eligible'],
            'bookshop_id' => ['nullable', 'integer', 'min:1'],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);
        $now = now();
        $rows = BookshopSubscription::query()->with(['bookshop:id,name,slug,status', 'plan:id,code,name'])->withCount('trialExtensions')
            ->when($filters['bookshop_id'] ?? null, fn (Builder $q, $id) => $q->where('bookshop_id', $id))
            ->when($filters['search'] ?? null, fn (Builder $q, $search) => $q->whereHas('bookshop', fn (Builder $b) => $b->where('name', 'like', "%{$search}%")))
            ->when($filters['state'] ?? null, function (Builder $q, string $state) use ($now) {
                match ($state) {
                    'active' => $q->where('status', BookshopSubscription::TRIALING)
                        ->where(fn (Builder $q) => $q->whereNull('trial_ends_at')->orWhere('trial_ends_at', '>', $now)),
                    'expired' => $q->where(fn (Builder $q) => $q
                        ->where(fn (Builder $q) => $q->where('status', BookshopSubscription::TRIALING)->where('trial_ends_at', '<=', $now))
                        ->orWhere(fn (Builder $q) => $q->where('status', BookshopSubscription::EXPIRED)->whereNull('current_period_ends_at'))),
                    'eligible' => $q->whereIn('status', [BookshopSubscription::TRIALING, BookshopSubscription::EXPIRED])->whereNull('current_period_ends_at'),
                    default => null,
                };
            })
            ->orderBy('bookshop_id')->paginate(20)->withQueryString();

        $paid = DB::table('platform_billing_invoices')->whereIn('bookshop_id', $rows->pluck('bookshop_id'))->where('status', 'paid')
            ->distinct()->pluck('bookshop_id')->map(fn ($id) => (int) $id)->all();
        $rows->through(fn (BookshopSubscription $row) => $this->row($row, in_array($row->bookshop_id, $paid, true)));

        return response()->json([...$rows->toArray(), 'max_days' => $this->subscriptions->maxTrialExtensionDays()]);
    }

    /** Permanent extension history, newest first, optionally for one bookshop. */
    public function history(Request $request): JsonResponse
    {
        $this->authorizeOwner($request);
        $filters = $request->validate(['bookshop_id' => ['nullable', 'integer', 'min:1'], 'page' => ['nullable', 'integer', 'min:1']]);

        return response()->json(SubscriptionTrialExtension::query()->with('bookshop:id,name')
            ->when($filters['bookshop_id'] ?? null, fn (Builder $q, $id) => $q->where('bookshop_id', $id))
            ->latest('id')->paginate(20)->withQueryString()->through(fn (SubscriptionTrialExtension $e) => $e->toApi()));
    }

    public function store(Request $request, int $bookshop): JsonResponse
    {
        $this->authorizeOwner($request);
        $shop = Bookshop::findOrFail($bookshop);
        $max = $this->subscriptions->maxTrialExtensionDays();
        $data = $request->validate([
            // The integer rule alone accepts JSON 5.0; only true whole numbers are allowed.
            'days' => ['required', $this->wholeNumber(), 'integer', 'min:1', "max:{$max}"],
            'reason' => ['nullable', 'string', 'max:500'],
            'idempotency_key' => ['required', 'string', 'regex:/^[A-Za-z0-9-]{8,64}$/'],
            'expected_trial_ends_at' => ['present', 'nullable', 'date'],
        ], ['days.max' => "A single extension can add at most {$max} days."]);

        $reason = isset($data['reason']) ? trim($data['reason']) : null;
        [$extension, $duplicate] = $this->subscriptions->extendTrial($shop, (int) $data['days'], $reason !== '' ? $reason : null,
            $data['idempotency_key'], $data['expected_trial_ends_at'], $request->user());
        $subscription = BookshopSubscription::with(['bookshop:id,name,slug,status', 'plan:id,code,name'])->withCount('trialExtensions')
            ->findOrFail($extension->bookshop_subscription_id);

        return response()->json([
            'message' => $duplicate ? 'This extension was already saved. No extra days were added.'
                : "Trial extended by {$extension->days_granted} day(s) for {$shop->name}.",
            'duplicate' => $duplicate,
            'data' => $extension->load('bookshop:id,name')->toApi(),
            'subscription' => $this->row($subscription),
        ], $duplicate ? 200 : 201);
    }

    private function row(BookshopSubscription $row, ?bool $paid = null): array
    {
        $blocker = $this->subscriptions->trialExtensionBlocker($row, $row->hasPaidAccess($paid));
        $isTrial = in_array($row->status, [BookshopSubscription::TRIALING, BookshopSubscription::EXPIRED], true) && $blocker === null;

        return [
            'id' => $row->id,
            'bookshop_id' => $row->bookshop_id,
            'bookshop_name' => $row->bookshop?->name,
            'bookshop_status' => $row->bookshop?->status,
            ...$row->summary(),
            'trial_starts_at' => $row->trial_starts_at?->toIso8601String(),
            'trial_state' => $row->inActiveTrial() ? 'active' : ($isTrial ? 'expired' : 'not_trial'),
            'remaining_trial_days' => $row->inActiveTrial() ? BookshopSubscription::daysUntil($row->trial_ends_at) : 0,
            'eligible' => $blocker === null,
            'ineligible_reason' => $blocker,
            'extensions_count' => (int) ($row->trial_extensions_count ?? 0),
        ];
    }

    private function wholeNumber(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail) {
            if (! is_int($value) && ! (is_string($value) && preg_match('/^\d+$/', $value))) {
                $fail('Enter a whole number of days.');
            }
        };
    }

    private function authorizeOwner(Request $request): void
    {
        abort_unless($request->user()?->role === Roles::PLATFORM_OWNER, 403, 'Only the Platform Owner can manage trial extensions.');
    }
}
