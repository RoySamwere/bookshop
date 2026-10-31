<?php

namespace App\Services;

use App\Support\Tenancy\Tenant;
use App\Models\User;
use App\Notifications\LowStockAlert;
use App\Services\Purchasing\PurchasingSettings;
use Illuminate\Support\Facades\Log;
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
            // Only alert when available stock crosses the threshold; no repeated emails below it.
            if ($delta < 0) {
                $book = DB::table('books')->where('id', $bookId)->first(['title', 'reorder_level']);
                $override = DB::table('product_reorder_settings')->where('bookshop_id', $bookshopId)->where('book_id', $bookId)->value('reorder_level');
                $threshold = $override !== null ? (int) $override : ((int) ($book->reorder_level ?? 0) > 0 ? (int) $book->reorder_level : PurchasingSettings::for($bookshopId)['default_reorder_level']);
                $previousAvailable = (int) $balance->quantity - (int) $balance->reserved;
                $newAvailable = $next - (int) $balance->reserved;
                if ($threshold > 0 && $previousAvailable >= $threshold && $newAvailable < $threshold) {
                    $branch = DB::table('branches')->where('id', $branchId)->value('name') ?? 'your branch';
                    DB::afterCommit(function () use ($bookshopId, $book, $newAvailable, $threshold, $branch) {
                        try {
                            User::query()->where('bookshop_id', $bookshopId)->where('is_active', true)
                                ->whereIn('role', ['bookshop_owner', 'system_owner', 'admin', 'store_manager', 'inventory_officer'])
                                ->whereNotNull('email_verified_at')
                                ->each(fn (User $user) => $user->notify(new LowStockAlert($book->title, $newAvailable, $threshold, $branch)));
                        } catch (\Throwable $e) {
                            Log::warning('Unable to queue low stock notification', ['bookshop_id' => $bookshopId, 'error' => $e->getMessage()]);
                        }
                    });
                }
            }
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
