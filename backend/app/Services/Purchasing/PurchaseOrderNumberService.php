<?php

namespace App\Services\Purchasing;

use Illuminate\Support\Facades\DB;

/**
 * Issues LPO numbers such as LPO-2026-000001: sequential per bookshop per year, never reused.
 * The sequence row is locked for the rest of the caller's transaction, so two people confirming
 * orders at the same moment always get different numbers; the unique index is the final guard.
 */
class PurchaseOrderNumberService
{
    public function next(int $bookshopId, ?int $year = null): string
    {
        $year ??= (int) now()->format('Y');

        return DB::transaction(function () use ($bookshopId, $year) {
            DB::table('purchase_order_sequences')->insertOrIgnore([
                'bookshop_id' => $bookshopId, 'year' => $year, 'last_number' => 0, 'created_at' => now(), 'updated_at' => now(),
            ]);
            $sequence = DB::table('purchase_order_sequences')->where('bookshop_id', $bookshopId)->where('year', $year)->lockForUpdate()->first();
            $number = (int) $sequence->last_number + 1;
            // Skip any number already used (for example one typed in before numbering existed).
            while (DB::table('purchase_orders')->where('bookshop_id', $bookshopId)->where('lpo_number', $this->format($year, $number))->exists()) {
                $number++;
            }
            DB::table('purchase_order_sequences')->where('id', $sequence->id)->update(['last_number' => $number, 'updated_at' => now()]);

            return $this->format($year, $number);
        });
    }

    public function format(int $year, int $number): string
    {
        return sprintf('LPO-%d-%06d', $year, $number);
    }
}
