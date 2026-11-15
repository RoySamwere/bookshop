<?php

namespace App\Http\Controllers\Platform;

use App\Http\Controllers\Controller;
use App\Models\AuditLog;
use App\Models\Bookshop;
use App\Models\BookshopSubscription;
use App\Models\SubscriptionPlan;
use App\Models\User;
use App\Services\CommunicationService;
use App\Services\PlatformBillingInvoiceService;
use App\Services\SubscriptionService;
use App\Support\Roles;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Per-bookshop administration for the Platform Owner: the bookshop's user accounts (metadata only),
 * its plan for future renewals and on-demand renewal invoices. Business records are never exposed.
 */
class BookshopAdministrationController extends Controller
{
    public function users(Bookshop $bookshop): JsonResponse
    {
        $users = User::query()->where('bookshop_id', $bookshop->id)->where('role', '!=', Roles::CUSTOMER)
            ->orderByRaw('CASE WHEN id = ? THEN 0 ELSE 1 END', [$bookshop->owner_user_id ?? 0])->orderBy('name')->get();

        return response()->json(['data' => $users->map(fn (User $user) => $this->userRow($bookshop, $user))->values()]);
    }

    public function setUserStatus(Request $request, Bookshop $bookshop, User $user): JsonResponse
    {
        $this->owner($request);
        // A user id from another bookshop is treated as not found, never changed.
        abort_unless($user->bookshop_id === $bookshop->id && ! Roles::isPlatform($user->role) && $user->role !== Roles::CUSTOMER, 404);
        abort_if($user->id === $bookshop->owner_user_id, 422, "The bookshop owner's account cannot be deactivated here. Suspend the bookshop instead.");
        $data = $request->validate(['is_active' => ['required', 'boolean']]);

        $user->forceFill(['is_active' => $data['is_active']])->save();
        if (! $user->is_active) {
            $user->tokens()->delete();
        }
        AuditLog::record($user->is_active ? 'platform.bookshop_user_activated' : 'platform.bookshop_user_deactivated',
            ($user->is_active ? 'Activated ' : 'Deactivated ')."{$user->name}'s account in {$bookshop->name}", $user, bookshopId: $bookshop->id);

        return response()->json(['message' => $user->is_active ? "{$user->name} can sign in again." : "{$user->name} has been deactivated and signed out.", 'data' => $this->userRow($bookshop, $user)]);
    }

    /** Sets the plan used for this bookshop's future renewals. Current paid time and issued invoices are unchanged. */
    public function changePlan(Request $request, Bookshop $bookshop, SubscriptionService $subscriptions, CommunicationService $communications): JsonResponse
    {
        $this->owner($request);
        $data = $request->validate(['plan_id' => ['required', 'integer', 'exists:subscription_plans,id']]);
        $plan = SubscriptionPlan::findOrFail($data['plan_id']);
        abort_unless($plan->is_active, 422, 'Choose an available plan.');

        $result = DB::transaction(function () use ($bookshop, $plan, $request, $subscriptions, $communications) {
            $subscription = BookshopSubscription::where('bookshop_id', $bookshop->id)->lockForUpdate()->first();
            abort_unless($subscription, 422, 'This bookshop has no subscription record.');
            abort_if($subscription->subscription_plan_id === $plan->id, 422, "{$bookshop->name} is already on {$plan->name}.");
            $from = $subscription->plan?->name ?? 'no plan';
            $event = $subscriptions->changePlan($subscription, $plan, $request->user());
            AuditLog::record('billing.plan_changed', "Changed {$bookshop->name} from {$from} to {$plan->name}", $subscription, ['from' => $from, 'to' => $plan->name], bookshopId: $bookshop->id);
            $communications->notify('subscription_updated', $bookshop, 'plan-'.$event->id, [
                'summary' => "Your plan has changed from {$from} to {$plan->name}. It applies from your next renewal; your current access period is unchanged.",
                'status' => ucfirst(str_replace('_', ' ', $subscription->status)), 'plan' => $plan->name,
            ], 'owners', actor: $request->user());

            return $subscription->fresh('plan');
        });

        return response()->json(['message' => "{$bookshop->name} will renew on {$plan->name}.", 'data' => $result->summary()]);
    }

    /** Issues (or returns the already open) renewal invoice, and tells the owner it is ready. */
    public function renewalInvoice(Request $request, Bookshop $bookshop, PlatformBillingInvoiceService $invoices, CommunicationService $communications): JsonResponse
    {
        $this->owner($request);
        $subscription = $bookshop->subscription;
        abort_unless($subscription, 422, 'This bookshop has no subscription record.');
        $data = $request->validate(['plan_id' => ['nullable', 'integer', 'exists:subscription_plans,id']]);
        $plan = SubscriptionPlan::find($data['plan_id'] ?? $subscription->subscription_plan_id);
        abort_unless($plan && $plan->is_active && (float) $plan->price > 0, 422, 'Choose an available paid plan for the invoice.');

        $existing = DB::table('platform_billing_invoices')->where('bookshop_id', $bookshop->id)->whereIn('status', ['pending', 'partially_paid'])->value('id');
        $invoice = $invoices->create($bookshop->id, $plan);
        if (! $existing) {
            AuditLog::record('billing.invoice_issued', "Issued renewal invoice {$invoice->account_number} to {$bookshop->name}", null, ['invoice_id' => $invoice->id, 'plan' => $plan->name], bookshopId: $bookshop->id);
        }
        $communications->invoiceDue($invoice, $plan);

        return response()->json([
            'message' => $existing ? "Invoice {$invoice->account_number} is already open for {$bookshop->name}; no new invoice was created." : "Invoice {$invoice->account_number} issued for KES ".number_format((float) $invoice->amount).'.',
            'data' => ['id' => $invoice->id, 'account_number' => $invoice->account_number, 'amount' => $invoice->amount, 'status' => $invoice->status],
        ], $existing ? 200 : 201);
    }

    private function userRow(Bookshop $bookshop, User $user): array
    {
        return [
            ...$user->only(['id', 'name', 'email', 'phone', 'role', 'is_active']),
            'role_label' => Roles::label($user->role),
            'is_owner' => $user->id === $bookshop->owner_user_id,
            'email_verified' => $user->hasVerifiedEmail(),
            'last_login_at' => $user->last_login_at?->toIso8601String(),
            'created_at' => $user->created_at?->toIso8601String(),
        ];
    }

    private function owner(Request $request): void
    {
        abort_unless($request->user()?->role === Roles::PLATFORM_OWNER, 403, 'Only the Platform Owner can change this.');
    }
}
