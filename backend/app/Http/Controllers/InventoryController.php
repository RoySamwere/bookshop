<?php

namespace App\Http\Controllers;

use App\Services\InventoryService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class InventoryController extends Controller
{
    public function index(Request $request) {
        $request->validate(['branch_id'=>'nullable|integer|exists:branches,id']);
        $user=$request->user();
        $branches=$user->role==='system_owner' ? null : $user->branches()->pluck('branches.id')->all();
        return DB::table('inventory_balances as i')->join('books as b','b.id','=','i.book_id')
            ->join('branches as br','br.id','=','i.branch_id')
            ->when($branches!==null,fn($q)=>$q->whereIn('i.branch_id',$branches))
            ->when($request->query('branch_id'),fn($q,$id)=>$q->where('i.branch_id',$id))
            ->select('i.*','b.title','b.sku','b.isbn','b.reorder_level','br.name as branch_name')
            ->orderBy('b.title')->paginate(30);
    }
    public function movements(Request $request) {
        $user=$request->user();
        $branches=$user->role==='system_owner' ? null : $user->branches()->pluck('branches.id')->all();
        return DB::table('inventory_movements')->when($branches!==null,fn($q)=>$q->whereIn('branch_id',$branches))->orderByDesc('id')->paginate(30);
    }
    public function adjust(Request $request,InventoryService $service) {
        $data=$request->validate(['book_id'=>'required|exists:books,id','branch_id'=>'required|exists:branches,id','quantity_change'=>'required|integer|not_in:0','notes'=>'required|string|max:1000']);
        $this->authorizeBranch($request,(int)$data['branch_id']);
        $quantity=$service->change($data['book_id'],$data['branch_id'],$data['quantity_change'],'adjustment',$request->user()->id,null,$data['notes']);
        return response()->json(['quantity'=>$quantity]);
    }
    public function transfer(Request $request,InventoryService $service) {
        $data=$request->validate(['book_id'=>'required|exists:books,id','from_branch_id'=>'required|exists:branches,id|different:to_branch_id','to_branch_id'=>'required|exists:branches,id','quantity'=>'required|integer|min:1','notes'=>'nullable|string|max:1000']);
        $this->authorizeBranch($request,(int)$data['from_branch_id']);$this->authorizeBranch($request,(int)$data['to_branch_id']);
        $reference='TRANSFER-'.(string) \Illuminate\Support\Str::uuid();
        DB::transaction(function () use ($data,$request,$service,$reference) {
            $service->change($data['book_id'],$data['from_branch_id'],-$data['quantity'],'transfer_out',$request->user()->id,$reference,$data['notes']??null);
            $service->change($data['book_id'],$data['to_branch_id'],$data['quantity'],'transfer_in',$request->user()->id,$reference,$data['notes']??null);
        });
        return response()->json(['reference'=>$reference],201);
    }
    public function authorizeBranch(Request $request,int $branchId): void {
        abort_unless($request->user()->role==='system_owner'||$request->user()->branches()->where('branches.id',$branchId)->exists(),403,'Branch access denied.');
    }
}
