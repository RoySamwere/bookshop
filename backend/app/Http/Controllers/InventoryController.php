<?php

namespace App\Http\Controllers;

use App\Services\InventoryService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class InventoryController extends Controller
{
    public function index(Request $request) {
        $request->validate(['branch_id'=>'nullable|integer|exists:branches,id', 'search'=>'nullable|string|max:255', 'status'=>'nullable|in:low,out', 'per_page'=>'nullable|integer|in:10,20,30,50,100,200']);
        $user=$request->user();
        $branches=$user->role==='system_owner' ? null : $user->branches()->pluck('branches.id')->all();
        $query = DB::table('inventory_balances as i')->join('books as b','b.id','=','i.book_id')
            ->join('branches as br','br.id','=','i.branch_id')
            ->when($branches!==null,fn($q)=>$q->whereIn('i.branch_id',$branches))
            ->when($request->query('branch_id'),fn($q,$id)=>$q->where('i.branch_id',$id))
            ->when($request->query('search'), fn($q,$search) => $q->where(fn($q) => $q->where('b.title','like',"%{$search}%")->orWhere('b.sku','like',"%{$search}%")->orWhere('b.isbn','like',"%{$search}%")));
        $summary = (clone $query)->selectRaw('COALESCE(SUM(i.quantity), 0) as units, COALESCE(SUM(i.quantity * b.selling_price), 0) as value, COUNT(*) as stock_lines, COALESCE(SUM(CASE WHEN i.quantity - i.reserved > 0 AND i.quantity - i.reserved <= b.reorder_level THEN 1 ELSE 0 END), 0) as low, COALESCE(SUM(CASE WHEN i.quantity - i.reserved = 0 THEN 1 ELSE 0 END), 0) as out_of_stock')->first();
        $result = $query
            ->when($request->query('status') === 'low', fn($q) => $q->whereRaw('i.quantity - i.reserved > 0 AND i.quantity - i.reserved <= b.reorder_level'))
            ->when($request->query('status') === 'out', fn($q) => $q->whereRaw('i.quantity - i.reserved = 0'))
            ->select('i.*','b.title','b.sku','b.isbn','b.reorder_level','br.name as branch_name')
            ->orderBy('b.title')->orderBy('i.id')->paginate((int) ($request->input('per_page') ?? 30));
        return response()->json(array_merge($result->toArray(), ['summary' => $summary]));
    }
    public function receive(Request $request, InventoryService $service) {
        $data = $request->validate([
            'book_id' => ['required', 'integer', Rule::exists('books', 'id')->where('is_active', true)],
            'branch_id' => ['required', 'integer', Rule::exists('branches', 'id')->where('is_active', true)],
            'quantity' => 'required|integer|min:1|max:2147483647',
            'product_unit_id' => 'nullable|integer|exists:product_units,id',
            'supplier_id' => ['required','integer',Rule::exists('suppliers','id')->where('is_active',true)],
            'reference' => 'nullable|string|max:255',
            'notes' => 'nullable|string|max:1000',
        ]);
        $this->authorizeBranch($request, (int) $data['branch_id']);
        $unit = isset($data['product_unit_id']) ? DB::table('product_units')->where('id',$data['product_unit_id'])->where('book_id',$data['book_id'])->first() : null;
        if(isset($data['product_unit_id']) && !$unit) throw \Illuminate\Validation\ValidationException::withMessages(['product_unit_id'=>'Selected packaging does not belong to this product.']);
        $factor=$unit ? (int)$unit->pieces_per_unit : 1;
        $pieces=(int)$data['quantity']*$factor;
        if($pieces>2147483647) throw \Illuminate\Validation\ValidationException::withMessages(['quantity'=>'Converted quantity exceeds the maximum stock movement.']);
        $quantity=$service->change($data['book_id'],$data['branch_id'],$pieces,'receipt',$request->user()->id,$data['reference']??null,$data['notes']??null,$unit?->id,(int)$data['quantity'],$factor,$data['supplier_id']??null);
        return response()->json(['message'=>'Stock received successfully.','quantity'=>$quantity,'pieces_received'=>$pieces,'units_per_package'=>$factor],201);
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
