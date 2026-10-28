<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class CatalogController extends Controller
{
    public function books(Request $request) {
        $request->validate([
            'search'=>'nullable|string|max:255','per_page'=>'nullable|integer|in:10,20,50,100,200',
            'category_id'=>'nullable|integer|exists:product_categories,id',
            'subcategory_id'=>'nullable|integer|exists:product_subcategories,id',
            'ruling_style'=>'nullable|string|max:100','page_count'=>'nullable|integer|min:1',
            'paper_size'=>'nullable|string|max:30','binding_type'=>'nullable|string|max:100',
            'receiving_search'=>'nullable|boolean',
        ]);
        $query=DB::table('books as b')
            ->leftJoin('product_subcategories as s','s.id','=','b.product_subcategory_id')
            ->leftJoin('product_categories as c','c.id','=','s.product_category_id')
            ->when($request->boolean('active_only'),fn($q)=>$q->where('b.is_active',true))
            ->when($request->query('category_id'),fn($q,$v)=>$q->where('c.id',$v))
            ->when($request->query('subcategory_id'),fn($q,$v)=>$q->where('s.id',$v));
        foreach(['ruling_style','page_count','paper_size','binding_type'] as $field)
            if($request->filled($field)) $query->where('b.'.$field,$request->input($field));
        if($request->filled('search')){
            $words=preg_split('/\\s+/',trim($request->input('search')));
            foreach($words as $word) $query->where(fn($q)=>$q->where('b.title','like',"%{$word}%")->orWhere('b.sku','like',"%{$word}%")->orWhere('b.isbn','like',"%{$word}%")->orWhere('s.name','like',"%{$word}%")->orWhere('c.name','like',"%{$word}%")->orWhere('b.brand','like',"%{$word}%")->orWhere('b.ruling_style','like',"%{$word}%")->orWhere('b.paper_size','like',"%{$word}%"));
        }
        return $query->when($request->boolean('receiving_search'),fn($q)=>$q->orderBy('b.is_active','desc'))->select('b.*','s.name as subcategory_name','c.name as category_name')->orderBy('b.title')->orderBy('b.id')->paginate((int)$request->input('per_page',20));
    }
    public function bulkCreateBooks(Request $request) {
        $data=$request->validate([
            'rows'=>'required|array|min:1|max:200',
            'rows.*.title'=>'required|string|max:255',
            'rows.*.sku'=>'required|string|max:100',
            'rows.*.selling_price'=>'required|numeric|min:0',
            'rows.*.cost_price'=>'required|numeric|min:0',
            'rows.*.reorder_level'=>'nullable|integer|min:0',
        ]);
        $skus=array_map(fn($row)=>strtoupper(trim($row['sku'])),$data['rows']);
        if(count($skus)!==count(array_unique($skus)))
            throw \Illuminate\Validation\ValidationException::withMessages(['rows'=>'Duplicate SKUs in upload batch.']);
        $existing=DB::table('books')->whereIn('sku',array_column($data['rows'],'sku'))->pluck('sku')->all();
        if($existing)
            throw \Illuminate\Validation\ValidationException::withMessages(['rows'=>'Already registered SKUs: '.implode(', ',array_slice($existing,0,10))]);
        $now=now();
        DB::transaction(function()use($data,$now){
            foreach($data['rows'] as $row)
                DB::table('books')->insert(array_merge($row,['reorder_level'=>$row['reorder_level']??10,'is_active'=>true,'created_at'=>$now,'updated_at'=>$now]));
        });
        return response()->json(['created'=>count($data['rows'])],201);
    }
    public function exportBooks(Request $request) {
        $columns=['id','title','sku','isbn','brand','ruling_style','page_count','paper_size','binding_type','cost_price','selling_price','reorder_level','is_active','product_subcategory_id'];
        return response()->streamDownload(function() use ($columns) {
            $out=fopen('php://output','w');
            fputcsv($out,$columns);
            DB::table('books')->orderBy('id')->chunk(500,function($rows)use($out,$columns){
                foreach($rows as $row) {
                    $values=array_map(fn($key)=>$row->$key,$columns);
                    // Prevent spreadsheet formula execution when CSV is opened.
                    foreach($values as &$value) if(is_string($value)&&preg_match('/^[=+@\\-\\t\\r]/',$value))$value="'".$value;
                    unset($value);
                    fputcsv($out,$values);
                }
            });
            fclose($out);
        },'hekima-products-all.csv',['Content-Type'=>'text/csv; charset=UTF-8']);
    }
    public function importBooks(Request $request) {
        $data=$request->validate([
            'rows'=>'required|array|min:1|max:200',
            'rows.*.id'=>'required|integer|distinct|exists:books,id',
            'rows.*.title'=>'required|string|max:255',
            'rows.*.sku'=>'required|string|max:100',
            'rows.*.isbn'=>'nullable|string|max:20',
            'rows.*.brand'=>'nullable|string|max:255',
            'rows.*.ruling_style'=>'nullable|string|max:100',
            'rows.*.page_count'=>'nullable|integer|min:1',
            'rows.*.paper_size'=>'nullable|string|max:30',
            'rows.*.binding_type'=>'nullable|string|max:100',
            'rows.*.cost_price'=>'required|numeric|min:0',
            'rows.*.selling_price'=>'required|numeric|min:0',
            'rows.*.reorder_level'=>'required|integer|min:0',
            'rows.*.is_active'=>'required|boolean',
            'rows.*.product_subcategory_id'=>'nullable|integer|exists:product_subcategories,id',
        ]);
        DB::transaction(function()use($data){
            foreach($data['rows'] as $row){
                $id=$row['id'];unset($row['id']);
                DB::table('books')->where('id',$id)->update(array_merge($row,['updated_at'=>now()]));
            }
        });
        return response()->json(['updated'=>count($data['rows'])]);
    }
    public function hierarchy() {
        return DB::table('product_categories')->orderBy('name')->get()->map(function($category){
            $category->subcategories=DB::table('product_subcategories')->where('product_category_id',$category->id)->orderBy('name')->get();
            return $category;
        });
    }
    public function storeBook(Request $request) {
        $data = $request->validate([
            'title'=>'required|string|max:255','subtitle'=>'nullable|string|max:255','isbn'=>'nullable|string|max:20|unique:books,isbn',
            'sku'=>'required|string|max:100|unique:books,sku','book_category_id'=>'nullable|exists:book_categories,id',
            'publisher_id'=>'nullable|exists:publishers,id','edition'=>'nullable|string|max:100','language'=>'nullable|string|max:100',
            'curriculum'=>'nullable|string|max:100','grade'=>'nullable|string|max:100','description'=>'nullable|string',
            'cover_url'=>'nullable|url|max:2048','cost_price'=>'required|numeric|min:0','selling_price'=>'required|numeric|min:0',
            'reorder_level'=>'integer|min:0','is_active'=>'boolean','author_ids'=>'array','author_ids.*'=>'integer|exists:authors,id'
        ]);
        $authors = $data['author_ids'] ?? []; unset($data['author_ids']);
        $id = DB::transaction(function () use ($data,$authors) {
            $id = DB::table('books')->insertGetId(array_merge($data,['created_at'=>now(),'updated_at'=>now()]));
            foreach (array_unique($authors) as $author) DB::table('author_book')->insert(['book_id'=>$id,'author_id'=>$author]);
            return $id;
        });
        return response()->json(DB::table('books')->find($id),201);
    }
    public function updateBook(Request $request, int $book) {
        abort_unless(DB::table('books')->where('id',$book)->exists(),404);
        $data=$request->validate([
            'title'=>'sometimes|required|string|max:255','subtitle'=>'nullable|string|max:255',
            'isbn'=>['nullable','string','max:20',Rule::unique('books','isbn')->ignore($book)],
            'sku'=>['sometimes','required','string','max:100',Rule::unique('books','sku')->ignore($book)],
            'book_category_id'=>'nullable|exists:book_categories,id','publisher_id'=>'nullable|exists:publishers,id',
            'edition'=>'nullable|string|max:100','language'=>'nullable|string|max:100','curriculum'=>'nullable|string|max:100',
            'grade'=>'nullable|string|max:100','description'=>'nullable|string','cover_url'=>'nullable|url|max:2048',
            'cost_price'=>'numeric|min:0','selling_price'=>'numeric|min:0','reorder_level'=>'integer|min:0','is_active'=>'boolean',
            'author_ids'=>'array','author_ids.*'=>'integer|exists:authors,id'
        ]);
        $authors=$data['author_ids']??null;unset($data['author_ids']);
        DB::transaction(function () use ($book,$data,$authors) {
            if($data) DB::table('books')->where('id',$book)->update(array_merge($data,['updated_at'=>now()]));
            if($authors!==null) { DB::table('author_book')->where('book_id',$book)->delete(); foreach(array_unique($authors) as $author) DB::table('author_book')->insert(['book_id'=>$book,'author_id'=>$author]); }
        });
        return DB::table('books')->find($book);
    }
    public function lookup(string $table) {
        abort_unless(in_array($table,['authors','publishers','book_categories'],true),404);
        return DB::table($table)->orderBy('name')->get();
    }
    public function createLookup(Request $request,string $table) {
        abort_unless(in_array($table,['authors','publishers','book_categories'],true),404);
        $data=$request->validate(['name'=>['required','string','max:255',Rule::unique($table,'name')]]);
        $id=DB::table($table)->insertGetId(array_merge($data,['created_at'=>now(),'updated_at'=>now()]));
        return response()->json(DB::table($table)->find($id),201);
    }
    public function suppliers(Request $request) {
        return DB::table('suppliers')->when($request->query('search'),fn($q,$s)=>$q->where('name','like',"%{$s}%"))->orderBy('name')->paginate(20);
    }
    public function storeSupplier(Request $request) {
        $data=$request->validate(['name'=>'required|string|max:255','contact_person'=>'nullable|string|max:255','email'=>'nullable|email','phone'=>'nullable|string|max:50','address'=>'nullable|string','tax_pin'=>'nullable|string|max:50']);
        $id=DB::table('suppliers')->insertGetId(array_merge($data,['created_at'=>now(),'updated_at'=>now()]));
        return response()->json(DB::table('suppliers')->find($id),201);
    }
}
