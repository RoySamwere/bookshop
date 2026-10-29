<?php

namespace App\Http\Controllers;

use App\Models\Branch;
use App\Models\BusinessProfile;
use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class DashboardController extends Controller
{
    public function __invoke(Request $request)
    {
        $data = $request->validate(['branch_id' => 'nullable|integer|exists:branches,id', 'period' => 'nullable|in:today,week']);
        $user = $request->user();
        $branches = Branch::query()->where('is_active', true)
            ->when(! $user->isOwner(), fn ($q) => $q->whereIn('id', $user->branchIds()))->orderByDesc('is_main')->orderBy('name')->get(['id', 'name']);
        $branchId = isset($data['branch_id']) ? (int) $data['branch_id'] : null;
        abort_if($branchId !== null && ! $branches->contains('id', $branchId), 403, 'Branch access denied.');
        $branchIds = $branchId ? [$branchId] : $branches->pluck('id')->all();
        $timezone = BusinessProfile::query()->value('timezone') ?: config('app.timezone');
        $today = CarbonImmutable::now($timezone)->startOfDay();
        $start = ($data['period'] ?? 'today') === 'week' ? $today->subDays(6) : $today;
        $end = $today->addDay();
        $sales = DB::table('pos_sales as s')->whereIn('s.branch_id', $branchIds)->where('s.status', 'completed')
            ->where('s.created_at', '>=', $start->utc())->where('s.created_at', '<', $end->utc());
        $result = ['branches' => $branches, 'timezone' => $timezone, 'summary' => null, 'hourly' => [], 'top_sellers' => [], 'recent_sales' => [], 'stock' => null, 'staff_requests' => null];

        if ($user->hasPermission('sales.view')) {
            $summary = (clone $sales)->selectRaw('COUNT(*) as transactions, COALESCE(SUM(s.total), 0) as revenue')->first();
            $payments = (clone $sales)->select('s.payment_method')->selectRaw('SUM(s.total) as total')->groupBy('s.payment_method')->pluck('total', 'payment_method');
            $items = DB::table('pos_sale_items as item')->joinSub(clone $sales, 'sale', 'sale.id', '=', 'item.sale_id');
            $summary->items = (int) (clone $items)->sum('item.quantity');
            $summary->payments = $payments;
            $summary->average = $summary->transactions ? round((float) $summary->revenue / $summary->transactions, 2) : 0;
            $result['summary'] = $summary;
            $result['top_sellers'] = (clone $items)->select('item.book_id')->selectRaw('MAX(item.title) as title, SUM(item.quantity) as units, SUM(item.line_total) as revenue')
                ->groupBy('item.book_id')->orderByDesc('revenue')->limit(5)->get();
            $result['recent_sales'] = (clone $sales)->leftJoin('users as u', 'u.id', '=', 's.cashier_id')
                ->leftJoinSub(DB::table('pos_sale_items')->select('sale_id')->selectRaw('SUM(quantity) as units')->groupBy('sale_id'), 'i', 'i.sale_id', '=', 's.id')
                ->select('s.id', 's.receipt_number', 's.created_at', 's.payment_method', 's.total', 'u.name as cashier_name', 'i.units')->orderByDesc('s.created_at')->orderByDesc('s.id')->limit(5)->get();
            // Aggregate in SQL before converting each UTC hour to the business timezone.
            $hour = DB::connection()->getDriverName() === 'sqlite' ? "strftime('%Y-%m-%d %H:00:00', s.created_at)" : "DATE_FORMAT(s.created_at, '%Y-%m-%d %H:00:00')";
            $buckets = (clone $sales)->selectRaw("{$hour} as bucket, SUM(s.total) as revenue")->groupByRaw($hour)->get();
            $hours = array_fill(0, 24, 0);
            foreach ($buckets as $bucket) {
                $hours[CarbonImmutable::parse($bucket->bucket, 'UTC')->setTimezone($timezone)->hour] += (float) $bucket->revenue;
            }
            $result['hourly'] = collect($hours)->map(fn ($revenue, $hour) => ['hour' => $hour, 'label' => CarbonImmutable::createFromTime($hour)->format('ga'), 'revenue' => round($revenue, 2)])->values();
        }
        if ($user->hasPermission('inventory.view')) {
            $stock = DB::table('books as b')->crossJoin('branches as br')
                ->leftJoin('inventory_balances as i', fn ($join) => $join->on('i.book_id', '=', 'b.id')->on('i.branch_id', '=', 'br.id'))
                ->where('b.is_active', true)->whereIn('br.id', $branchIds);
            $available = 'COALESCE(i.quantity, 0) - COALESCE(i.reserved, 0)';
            $summary = (clone $stock)->selectRaw("COALESCE(SUM(CASE WHEN {$available} <= 0 THEN 1 ELSE 0 END), 0) as out_of_stock, COALESCE(SUM(CASE WHEN {$available} > 0 AND {$available} <= b.reorder_level THEN 1 ELSE 0 END), 0) as low")->first();
            $summary->reorder = (clone $stock)->whereRaw("{$available} <= b.reorder_level")
                ->select('b.id', 'b.title', 'b.reorder_level', 'br.name as branch_name')->selectRaw("{$available} as available")
                ->orderByRaw($available)->orderBy('b.title')->limit(4)->get();
            $result['stock'] = $summary;
        }
        if ($user->hasPermission('users.view')) {
            $result['staff_requests'] = User::query()->visibleTo($user)->where('staff_access_status', User::ACCESS_PENDING)->count();
        }

        return response()->json(['data' => $result]);
    }
}
