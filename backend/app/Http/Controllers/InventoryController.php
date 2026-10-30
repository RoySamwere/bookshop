<?php

namespace App\Http\Controllers;

use App\Services\InventoryService;
use App\Support\Tenancy\Tenant;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class InventoryController extends Controller
{
    public function index(Request $request) {
        $tenant=Tenant::requireId();
        $request->validate(['branch_id'=>['nullable','integer',Tenant::exists('branches')], 'search'=>'nullable|string|max:255', 'search_field'=>'nullable|in:all,title,sku,isbn', 'min_available'=>'nullable|integer|min:0', 'max_available'=>'nullable|integer|min:0', 'sort'=>'nullable|in:available_desc,available_asc,title_asc,title_desc,sku_asc', 'status'=>'nullable|in:available,low,out', 'per_page'=>'nullable|integer|in:10,20,30,50,100,200']);
        $user=$request->user();
        $branches=$user->isOwner() ? null : $user->branchIds();
        // Only products explicitly assigned to a shop through inventory receiving
        // are visible here. A zero balance remains visible for stock history/restocking.
        $query = DB::table('inventory_balances as i')
            ->join('books as b','b.id','=','i.book_id')
            ->join('branches as br','br.id','=','i.branch_id')
            ->where('b.bookshop_id',$tenant)->where('br.bookshop_id',$tenant)->where('i.bookshop_id',$tenant)
            ->where('b.is_active',true)->where('br.is_active',true)
            ->when($branches!==null,fn($q)=>$q->whereIn('br.id',$branches))
            ->when($request->query('branch_id'),fn($q,$id)=>$q->where('br.id',$id))
            ->when($request->query('search'), function($q,$search) use ($request) {
                $terms=preg_split('/\\s+/',trim($search),-1,PREG_SPLIT_NO_EMPTY);
                $field=$request->query('search_field','all');
                foreach ($terms as $term) {
                    $escaped=addcslashes($term,'%_\\\\');
                    $like='%'.$escaped.'%';
                    $q->where(function($inner) use($field,$like) {
                        if($field==='all'||$field==='title')$inner->orWhere('b.title','like',$like);
                        if($field==='all'||$field==='sku')$inner->orWhere('b.sku','like',$like);
                        if($field==='all'||$field==='isbn')$inner->orWhere('b.isbn','like',$like);
                    });
                }
            })
            ->when($request->filled('min_available'),fn($q)=>$q->whereRaw('GREATEST(COALESCE(i.quantity,0) - COALESCE(i.reserved,0),0) >= ?',[(int)$request->query('min_available')]))
            ->when($request->filled('max_available'),fn($q)=>$q->whereRaw('GREATEST(COALESCE(i.quantity,0) - COALESCE(i.reserved,0),0) <= ?',[(int)$request->query('max_available')]));
        $summary = (clone $query)->selectRaw('COALESCE(SUM(COALESCE(i.quantity,0)), 0) as units, COALESCE(SUM(COALESCE(i.quantity,0) * b.selling_price), 0) as value, COUNT(*) as stock_lines, COALESCE(SUM(CASE WHEN COALESCE(i.quantity,0) - COALESCE(i.reserved,0) > 0 AND COALESCE(i.quantity,0) - COALESCE(i.reserved,0) <= b.reorder_level THEN 1 ELSE 0 END), 0) as low, COALESCE(SUM(CASE WHEN COALESCE(i.quantity,0) - COALESCE(i.reserved,0) = 0 THEN 1 ELSE 0 END), 0) as out_of_stock')->first();
        $result = $query
            ->when($request->query('status') === 'available', fn($q) => $q->whereRaw('COALESCE(i.quantity,0) - COALESCE(i.reserved,0) > 0'))
            ->when($request->query('status') === 'low', fn($q) => $q->whereRaw('COALESCE(i.quantity,0) - COALESCE(i.reserved,0) > 0 AND COALESCE(i.quantity,0) - COALESCE(i.reserved,0) <= b.reorder_level'))
            ->when($request->query('status') === 'out', fn($q) => $q->whereRaw('COALESCE(i.quantity,0) - COALESCE(i.reserved,0) = 0'))
            ->selectRaw('COALESCE(i.id, 0) as id, b.id as book_id, br.id as branch_id, COALESCE(i.quantity, 0) as quantity, COALESCE(i.reserved, 0) as reserved, b.title, b.sku, b.isbn, b.reorder_level, br.name as branch_name')
            ->when($request->query('sort','available_desc')==='available_desc',fn($q)=>$q->orderByRaw('GREATEST(COALESCE(i.quantity,0) - COALESCE(i.reserved,0),0) DESC'))
            ->when($request->query('sort')==='available_asc',fn($q)=>$q->orderByRaw('GREATEST(COALESCE(i.quantity,0) - COALESCE(i.reserved,0),0) ASC'))
            ->when($request->query('sort')==='title_desc',fn($q)=>$q->orderBy('b.title','desc'))
            ->when($request->query('sort')==='sku_asc',fn($q)=>$q->orderBy('b.sku'))
            ->orderBy('b.title')->orderBy('br.id')->paginate((int) ($request->input('per_page') ?? 30));
        return response()->json(array_merge($result->toArray(), ['summary' => $summary]));
    }
    public function bulkReceive(Request $request, InventoryService $service) {
        $data=$request->validate([
            'branch_id'=>['required','integer',Tenant::exists('branches')->where('is_active',true)],
            'supplier_id'=>['required','integer',Tenant::exists('suppliers')->where('is_active',true)],
            'rows'=>'required|array|min:1|max:100',
            'rows.*.title'=>'required|string|max:255',
            'rows.*.sku'=>'required|string|max:100',
            'rows.*.product_subcategory_id'=>['required','integer',Rule::exists('product_subcategories','id')],
            'rows.*.cost_price'=>'required|numeric|min:0',
            'rows.*.selling_price'=>'required|numeric|min:0',
            'rows.*.quantity'=>'required|integer|min:1|max:1000000',
        ]);
        $this->authorizeBranch($request,(int)$data['branch_id']);
        $skus=array_map(fn($r)=>strtoupper(trim($r['sku'])),$data['rows']);
        if(count($skus)!==count(array_unique($skus)))
            throw \Illuminate\Validation\ValidationException::withMessages(['rows'=>'Duplicate SKUs in this batch.']);
        $tenant=Tenant::requireId();
        $received=DB::transaction(function()use($data,$request,$service,$tenant){
            foreach($data['rows'] as $row){
                $book=DB::table('books')->where('bookshop_id',$tenant)->where('sku',$row['sku'])->lockForUpdate()->first();
                if($book && !$book->is_active)
                    throw \Illuminate\Validation\ValidationException::withMessages(['rows'=>'Inactive product: '.$row['sku']]);
                if(!$book){
                    $id=DB::table('books')->insertGetId([
                        'bookshop_id'=>$tenant,'title'=>$row['title'],'sku'=>$row['sku'],
                        'product_subcategory_id'=>$row['product_subcategory_id'],
                        'cost_price'=>$row['cost_price'],'selling_price'=>$row['selling_price'],
                        'reorder_level'=>10,'is_active'=>true,'created_at'=>now(),'updated_at'=>now()
                    ]);
                }else{
                    if ((int)$book->product_subcategory_id !== (int)$row['product_subcategory_id'])
                        throw \Illuminate\Validation\ValidationException::withMessages(['rows'=>'SKU '.$row['sku'].' belongs to another subcategory.']);
                    $id=$book->id;
                }
                $service->change((int)$id,(int)$data['branch_id'],(int)$row['quantity'],'receipt',
                    $request->user()->id,'Bulk CSV import','Stock received from bulk CSV',null,
                    (int)$row['quantity'],1,(int)$data['supplier_id']);
            }
            return count($data['rows']);
        });
        return response()->json(['received'=>$received],201);
    }
    public function receive(Request $request, InventoryService $service) {
        $data = $request->validate([
            'book_id' => ['required', 'integer', Tenant::exists('books')->where('is_active', true)],
            'branch_id' => ['required', 'integer', Tenant::exists('branches')->where('is_active', true)],
            'quantity' => 'required|integer|min:1|max:2147483647',
            'product_unit_id' => ['nullable','integer',Tenant::exists('product_units')],
            'supplier_id' => ['required','integer',Tenant::exists('suppliers')->where('is_active',true)],
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
        $branches=$user->isOwner() ? null : $user->branchIds();
        return DB::table('inventory_movements')->where('bookshop_id',Tenant::requireId())->when($branches!==null,fn($q)=>$q->whereIn('branch_id',$branches))->orderByDesc('id')->paginate(30);
    }
    public function adjust(Request $request,InventoryService $service) {
        $data=$request->validate(['book_id'=>['required',Tenant::exists('books')],'branch_id'=>['required',Tenant::exists('branches')],'quantity_change'=>'required|integer|not_in:0','notes'=>'required|string|max:1000']);
        $this->authorizeBranch($request,(int)$data['branch_id']);
        $quantity=$service->change($data['book_id'],$data['branch_id'],$data['quantity_change'],'adjustment',$request->user()->id,null,$data['notes']);
        return response()->json(['quantity'=>$quantity]);
    }
    public function transfer(Request $request,InventoryService $service) {
        $data=$request->validate(['book_id'=>['required',Tenant::exists('books')],'from_branch_id'=>['required',Tenant::exists('branches'),'different:to_branch_id'],'to_branch_id'=>['required',Tenant::exists('branches')],'quantity'=>'required|integer|min:1','notes'=>'nullable|string|max:1000']);
        $this->authorizeBranch($request,(int)$data['from_branch_id']);$this->authorizeBranch($request,(int)$data['to_branch_id']);
        $reference='TRANSFER-'.(string) \Illuminate\Support\Str::uuid();
        DB::transaction(function () use ($data,$request,$service,$reference) {
            $service->change($data['book_id'],$data['from_branch_id'],-$data['quantity'],'transfer_out',$request->user()->id,$reference,$data['notes']??null);
            $service->change($data['book_id'],$data['to_branch_id'],$data['quantity'],'transfer_in',$request->user()->id,$reference,$data['notes']??null);
        });
        return response()->json(['reference'=>$reference],201);
    }
    public function authorizeBranch(Request $request,int $branchId): void {
        abort_unless(in_array($branchId,$request->user()->branchIds(),true),403,'Branch access denied.');
    }
}
