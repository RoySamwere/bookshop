<?php

namespace App\Services;

use App\Support\Tenancy\Tenant;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class InventoryService
{
    public function change(int $bookId,int $branchId,int $delta,string $type,?int $userId=null,?string $reference=null,?string $notes=null,?int $productUnitId=null,?int $packageQuantity=null,?int $unitsPerPackage=null,?int $supplierId=null): int
    {
        $bookshopId=$this->assertSameBookshop($bookId,$branchId,$supplierId,$productUnitId);
        return DB::transaction(function () use ($bookshopId,$bookId,$branchId,$delta,$type,$userId,$reference,$notes,$productUnitId,$packageQuantity,$unitsPerPackage,$supplierId) {
            DB::table('inventory_balances')->insertOrIgnore(['bookshop_id'=>$bookshopId,'book_id'=>$bookId,'branch_id'=>$branchId,'quantity'=>0,'reserved'=>0,'created_at'=>now(),'updated_at'=>now()]);
            $balance=DB::table('inventory_balances')->where('book_id',$bookId)->where('branch_id',$branchId)->lockForUpdate()->first();
            $next=$balance->quantity+$delta;
            if ($next < $balance->reserved || $next < 0) throw ValidationException::withMessages(['quantity'=>'Insufficient available stock.']);
            DB::table('inventory_balances')->where('id',$balance->id)->update(['quantity'=>$next,'updated_at'=>now()]);
            DB::table('inventory_movements')->insert(['bookshop_id'=>$bookshopId,'book_id'=>$bookId,'branch_id'=>$branchId,'user_id'=>$userId,'type'=>$type,'quantity_change'=>$delta,'quantity_after'=>$next,'reference'=>$reference,'notes'=>$notes,'supplier_id'=>$supplierId,'product_unit_id'=>$productUnitId,'package_quantity'=>$packageQuantity,'units_per_package'=>$unitsPerPackage,'created_at'=>now(),'updated_at'=>now()]);
            return $next;
        });
    }

    /**
     * Last line of defence against cross-tenant IDs: the product, branch, supplier and packaging must
     * all belong to one bookshop, and to the current bookshop when there is one.
     */
    private function assertSameBookshop(int $bookId,int $branchId,?int $supplierId,?int $productUnitId): int
    {
        $owners=[
            DB::table('books')->where('id',$bookId)->value('bookshop_id'),
            DB::table('branches')->where('id',$branchId)->value('bookshop_id'),
        ];
        if($supplierId!==null) $owners[]=DB::table('suppliers')->where('id',$supplierId)->value('bookshop_id');
        if($productUnitId!==null) $owners[]=DB::table('product_units')->where('id',$productUnitId)->value('bookshop_id');
        $tenant=Tenant::id();
        if($tenant!==null) $owners[]=$tenant;
        $owners=array_unique(array_map(fn($id)=>$id===null?null:(int)$id,$owners),SORT_REGULAR);
        if(count($owners)!==1||reset($owners)===null)
            throw ValidationException::withMessages(['branch_id'=>'The product, branch and supplier must all belong to your bookshop.']);
        return reset($owners);
    }
}
