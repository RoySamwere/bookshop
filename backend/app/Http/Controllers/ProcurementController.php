<?php

namespace App\Http\Controllers;

use App\Services\InventoryService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class ProcurementController extends Controller
{
    private function checkBranch(Request $request,int $id): void {
        abort_unless($request->user()->role==='system_owner'||$request->user()->branches()->where('branches.id',$id)->exists(),403);
    }
    public function index(Request $request) {
        $branches=$request->user()->role==='system_owner'?null:$request->user()->branches()->pluck('branches.id')->all();
        return DB::table('purchase_orders')->when($branches!==null,fn($q)=>$q->whereIn('branch_id',$branches))->orderByDesc('id')->paginate(20);
    }
    public function show(Request $request,int $order) {
        $po=DB::table('purchase_orders')->find($order);abort_unless($po,404);$this->checkBranch($request,$po->branch_id);
        return response()->json(['order'=>$po,'items'=>DB::table('purchase_order_items')->where('purchase_order_id',$order)->get()]);
    }
    public function store(Request $request) {
        $data=$request->validate(['supplier_id'=>'required|exists:suppliers,id','branch_id'=>'required|exists:branches,id','expected_date'=>'nullable|date','items'=>'required|array|min:1','items.*.book_id'=>'required|exists:books,id','items.*.quantity'=>'required|integer|min:1','items.*.unit_cost'=>'required|numeric|min:0']);
        $this->checkBranch($request,$data['branch_id']);
        $id=DB::transaction(function()use($data,$request){
            $id=DB::table('purchase_orders')->insertGetId(['supplier_id'=>$data['supplier_id'],'branch_id'=>$data['branch_id'],'created_by'=>$request->user()->id,'expected_date'=>$data['expected_date']??null,'status'=>'draft','created_at'=>now(),'updated_at'=>now()]);
            foreach($data['items'] as $item) DB::table('purchase_order_items')->insert(array_merge($item,['purchase_order_id'=>$id,'received_quantity'=>0,'created_at'=>now(),'updated_at'=>now()]));
            return $id;
        });
        return response()->json(['id'=>$id],201);
    }
    public function approve(Request $request,int $order) {
        return DB::transaction(function()use($request,$order){
            $po=DB::table('purchase_orders')->where('id',$order)->lockForUpdate()->first();abort_unless($po,404);$this->checkBranch($request,$po->branch_id);
            abort_unless($po->status==='draft',422,'Only draft orders can be approved.');
            DB::table('purchase_orders')->where('id',$order)->update(['status'=>'approved','updated_at'=>now()]);
            return response()->json(['status'=>'approved']);
        });
    }
    public function receive(Request $request,int $order,InventoryService $service) {
        $data=$request->validate(['reference'=>'required|string|max:100|unique:goods_receipts,reference','items'=>'required|array|min:1','items.*.purchase_order_item_id'=>'required|integer','items.*.quantity'=>'required|integer|min:1']);
        return DB::transaction(function()use($request,$order,$data,$service){
            $po=DB::table('purchase_orders')->where('id',$order)->lockForUpdate()->first();abort_unless($po,404);$this->checkBranch($request,$po->branch_id);
            abort_unless(in_array($po->status,['approved','partially_received'],true),422,'Order is not receivable.');
            $ids=array_column($data['items'],'purchase_order_item_id');
            if(count($ids)!==count(array_unique($ids))) throw ValidationException::withMessages(['items'=>'Duplicate order items.']);
            $receiptId=DB::table('goods_receipts')->insertGetId(['purchase_order_id'=>$order,'received_by'=>$request->user()->id,'reference'=>$data['reference'],'created_at'=>now(),'updated_at'=>now()]);
            foreach($data['items'] as $row) {
                $item=DB::table('purchase_order_items')->where('id',$row['purchase_order_item_id'])->where('purchase_order_id',$order)->lockForUpdate()->first();
                if(!$item||$item->received_quantity+$row['quantity']>$item->quantity) throw ValidationException::withMessages(['items'=>'Quantity exceeds outstanding purchase order quantity.']);
                DB::table('purchase_order_items')->where('id',$item->id)->increment('received_quantity',$row['quantity']);
                DB::table('goods_receipt_items')->insert(['goods_receipt_id'=>$receiptId,'purchase_order_item_id'=>$item->id,'quantity'=>$row['quantity'],'created_at'=>now(),'updated_at'=>now()]);
                $service->change($item->book_id,$po->branch_id,$row['quantity'],'goods_received',$request->user()->id,$data['reference']);
            }
            $remaining=DB::table('purchase_order_items')->where('purchase_order_id',$order)->whereColumn('received_quantity','<','quantity')->exists();
            DB::table('purchase_orders')->where('id',$order)->update(['status'=>$remaining?'partially_received':'received','updated_at'=>now()]);
            return response()->json(['receipt_id'=>$receiptId,'status'=>$remaining?'partially_received':'received'],201);
        });
    }
}
