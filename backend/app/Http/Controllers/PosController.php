<?php

namespace App\Http\Controllers;

use App\Services\InventoryService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class PosController extends Controller
{
    private function branches(Request $request): ?array {
        return $request->user()->role === 'system_owner' ? null : $request->user()->branches()->pluck('branches.id')->all();
    }

    public function branchesForPos(Request $request) {
        $allowed=$this->branches($request);
        return DB::table('branches')->where('is_active',true)->when($allowed!==null,fn($q)=>$q->whereIn('id',$allowed))->select('id','name')->orderBy('name')->get();
    }

    public function products(Request $request) {
        $data=$request->validate(['branch_id'=>'required|integer|exists:branches,id','search'=>'nullable|string|max:255']);
        $allowed=$this->branches($request);
        abort_if($allowed!==null && !in_array((int)$data['branch_id'],$allowed,true),403,'Branch access denied.');
        return DB::table('books as b')->leftJoin('inventory_balances as i',function($join)use($data){
            $join->on('i.book_id','=','b.id')->where('i.branch_id','=',$data['branch_id']);
        })->leftJoin('product_subcategories as sub','sub.id','=','b.product_subcategory_id')
        ->leftJoin('product_categories as cat','cat.id','=','sub.product_category_id')
        ->where('b.is_active',true)
        ->when($data['search']??null,function($q,$search){$q->where(function($q)use($search){
            $q->where('b.title','like',"%{$search}%")->orWhere('b.sku','like',"%{$search}%")->orWhere('b.isbn','like',"%{$search}%");
        });})
        ->select('b.id','b.title','b.sku','b.isbn','b.selling_price','sub.name as subcategory','cat.name as category')
        ->selectRaw('GREATEST(0,COALESCE(i.quantity,0)-COALESCE(i.reserved,0)) as available')
        ->orderBy('b.title')->paginate(30);
    }

    public function sales(Request $request) {
        $data=$request->validate([
            'date'=>'nullable|date_format:Y-m-d',
            'from'=>'nullable|date_format:Y-m-d',
            'to'=>'nullable|date_format:Y-m-d',
            'search'=>'nullable|string|max:100',
            'payment_method'=>['nullable',Rule::in(['cash','mpesa','card'])],
            'branch_id'=>'nullable|integer|exists:branches,id',
            'page'=>'nullable|integer|min:1',
        ]);
        $allowed=$this->branches($request);
        if(isset($data['branch_id']))abort_if($allowed!==null&&!in_array((int)$data['branch_id'],$allowed,true),403);
        $base=DB::table('pos_sales as s')->leftJoin('branches as b','b.id','=','s.branch_id')
            ->leftJoin('users as u','u.id','=','s.cashier_id')
            ->when($allowed!==null,fn($q)=>$q->whereIn('s.branch_id',$allowed))
            ->when(isset($data['branch_id']),fn($q)=>$q->where('s.branch_id',$data['branch_id']))
            ->when(isset($data['date']),fn($q)=>$q->whereDate('s.created_at',$data['date']))
            ->when(isset($data['from']),fn($q)=>$q->whereDate('s.created_at','>=',$data['from']))
            ->when(isset($data['to']),fn($q)=>$q->whereDate('s.created_at','<=',$data['to']))
            ->when(isset($data['payment_method']),fn($q)=>$q->where('s.payment_method',$data['payment_method']))
            ->when($data['search']??null,fn($q,$v)=>$q->where(function($q)use($v){
                $q->where('s.receipt_number','like',"%{$v}%")->orWhere('s.payment_reference','like',"%{$v}%");
            }));
        $summary=(clone $base)->selectRaw('COUNT(*) as transactions, COALESCE(SUM(s.total),0) as revenue, COALESCE(SUM(CASE WHEN s.payment_method="cash" THEN s.total ELSE 0 END),0) as cash, COALESCE(SUM(CASE WHEN s.payment_method="mpesa" THEN s.total ELSE 0 END),0) as mpesa, COALESCE(SUM(CASE WHEN s.payment_method="card" THEN s.total ELSE 0 END),0) as card')->first();
        $sales=(clone $base)->select('s.*','b.name as branch_name','u.name as cashier_name')->orderByDesc('s.id')->paginate(30);
        return response()->json(['data'=>$sales->items(),'current_page'=>$sales->currentPage(),'last_page'=>$sales->lastPage(),'total'=>$sales->total(),'summary'=>$summary]);
    }

    public function checkout(Request $request, InventoryService $inventory) {
        $data=$request->validate([
            'idempotency_key'=>'required|string|max:100',
            'branch_id'=>'required|integer|exists:branches,id',
            'items'=>'required|array|min:1|max:100',
            'items.*.book_id'=>'required|integer|distinct|exists:books,id',
            'items.*.quantity'=>'required|integer|min:1|max:10000',
            'payment_method'=>['required',Rule::in(['cash','mpesa','card'])],
            'payment_reference'=>'nullable|string|max:100',
            'amount_received'=>'required|numeric|min:0|max:999999999',
        ]);
        $allowed=$this->branches($request);
        abort_if($allowed!==null && !in_array((int)$data['branch_id'],$allowed,true),403,'Branch access denied.');
        if($data['payment_method']!=='cash' && empty(trim($data['payment_reference']??'')))
            throw ValidationException::withMessages(['payment_reference'=>'Transaction reference is required.']);
        return DB::transaction(function()use($data,$request,$inventory){
            $previous=DB::table('pos_sales')->where('idempotency_key',$data['idempotency_key'])->first();
            if($previous) {
                abort_unless((int)$previous->cashier_id===(int)$request->user()->id,403);
                return response()->json($this->receipt($previous->id));
            }
            $ids=array_column($data['items'],'book_id');
            $books=DB::table('books')->whereIn('id',$ids)->where('is_active',true)->get()->keyBy('id');
            if($books->count()!==count($ids))throw ValidationException::withMessages(['items'=>'One or more products are unavailable.']);
            $items=[];$totalCents=0;
            foreach($data['items'] as $item){
                $book=$books[$item['book_id']];
                $unit=(int)round((float)$book->selling_price*100);
                $line=$unit*$item['quantity'];$totalCents+=$line;
                $items[]=['book_id'=>$book->id,'title'=>$book->title,'sku'=>$book->sku,
                    'quantity'=>$item['quantity'],'unit_price'=>number_format($unit/100,2,'.',''),
                    'line_total'=>number_format($line/100,2,'.','')];
            }
            $received=(int)round((float)$data['amount_received']*100);
            if($received<$totalCents)throw ValidationException::withMessages(['amount_received'=>'Payment does not cover the total.']);
            if($data['payment_method']!=='cash' && $received!==$totalCents)
                throw ValidationException::withMessages(['amount_received'=>'Non-cash payment must equal the total.']);
            $saleId=DB::table('pos_sales')->insertGetId([
                'idempotency_key'=>$data['idempotency_key'],'branch_id'=>$data['branch_id'],
                'cashier_id'=>$request->user()->id,'subtotal'=>number_format($totalCents/100,2,'.',''),
                'total'=>number_format($totalCents/100,2,'.',''),
                'payment_method'=>$data['payment_method'],'payment_reference'=>$data['payment_reference']??null,
                'amount_received'=>number_format($received/100,2,'.',''),
                'change_due'=>number_format(($received-$totalCents)/100,2,'.',''),
                'created_at'=>now(),'updated_at'=>now()
            ]);
            $receipt='HK-'.str_pad((string)$saleId,7,'0',STR_PAD_LEFT);
            DB::table('pos_sales')->where('id',$saleId)->update(['receipt_number'=>$receipt]);
            foreach($items as $item){
                DB::table('pos_sale_items')->insert(array_merge($item,['sale_id'=>$saleId,'created_at'=>now(),'updated_at'=>now()]));
                $inventory->change((int)$item['book_id'],(int)$data['branch_id'],-(int)$item['quantity'],
                    'sale',$request->user()->id,$receipt,'POS sale');
            }
            return response()->json($this->receipt($saleId),201);
        },3);
    }

    private function receipt(int $id): array {
        $sale=DB::table('pos_sales')->where('id',$id)->first();
        return ['sale'=>$sale,'items'=>DB::table('pos_sale_items')->where('sale_id',$id)->get()];
    }

    public function show(Request $request,int $sale) {
        $record=DB::table('pos_sales')->where('id',$sale)->first();
        abort_unless($record,404);
        $allowed=$this->branches($request);
        abort_if($allowed!==null && !in_array((int)$record->branch_id,$allowed,true),403);
        return $this->receipt($sale);
    }
}
