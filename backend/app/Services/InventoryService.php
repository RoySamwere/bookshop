<?php

namespace App\Services;

use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class InventoryService
{
    public function change(int $bookId,int $branchId,int $delta,string $type,?int $userId=null,?string $reference=null,?string $notes=null,?int $productUnitId=null,?int $packageQuantity=null,?int $unitsPerPackage=null): int
    {
        return DB::transaction(function () use ($bookId,$branchId,$delta,$type,$userId,$reference,$notes,$productUnitId,$packageQuantity,$unitsPerPackage) {
            DB::table('inventory_balances')->insertOrIgnore(['book_id'=>$bookId,'branch_id'=>$branchId,'quantity'=>0,'reserved'=>0,'created_at'=>now(),'updated_at'=>now()]);
            $balance=DB::table('inventory_balances')->where('book_id',$bookId)->where('branch_id',$branchId)->lockForUpdate()->first();
            $next=$balance->quantity+$delta;
            if ($next < $balance->reserved || $next < 0) throw ValidationException::withMessages(['quantity'=>'Insufficient available stock.']);
            DB::table('inventory_balances')->where('id',$balance->id)->update(['quantity'=>$next,'updated_at'=>now()]);
            DB::table('inventory_movements')->insert(['book_id'=>$bookId,'branch_id'=>$branchId,'user_id'=>$userId,'type'=>$type,'quantity_change'=>$delta,'quantity_after'=>$next,'reference'=>$reference,'notes'=>$notes,'product_unit_id'=>$productUnitId,'package_quantity'=>$packageQuantity,'units_per_package'=>$unitsPerPackage,'created_at'=>now(),'updated_at'=>now()]);
            return $next;
        });
    }
}
