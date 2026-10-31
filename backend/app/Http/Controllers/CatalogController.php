<?php

namespace App\Http\Controllers;

use App\Support\Tenancy\Tenant;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Products, suppliers and catalogue lookups belong to the current bookshop. The product category
 * hierarchy (product_categories / product_subcategories) is shared, read-only reference data.
 */
class CatalogController extends Controller
{
    public function books(Request $request) {
        $request->validate([
            'search'=>'nullable|string|max:255','per_page'=>'nullable|integer|in:10,20,30,50,100,200',
            'category_id'=>'nullable|integer|exists:product_categories,id',
            'subcategory_id'=>'nullable|integer|exists:product_subcategories,id',
            'ruling_style'=>'nullable|string|max:100','page_count'=>'nullable|integer|min:1',
            'paper_size'=>'nullable|string|max:30','binding_type'=>'nullable|string|max:100',
            'receiving_search'=>'nullable|boolean',
        ]);
        $query=DB::table('books as b')->where('b.bookshop_id',Tenant::requireId())
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
        $tenant=Tenant::requireId();
        $data=$request->validate([
            'rows'=>'required|array|min:1|max:200',
            'rows.*.title'=>'required|string|max:255',
            'rows.*.sku'=>'required|string|max:100',
            'rows.*.product_subcategory_id'=>'nullable|integer|exists:product_subcategories,id',
            'rows.*.category_name'=>'required|string|max:255',
            'rows.*.subcategory_name'=>'required|string|max:255',
            'rows.*.selling_price'=>'required|numeric|min:0',
            'rows.*.cost_price'=>'required|numeric|min:0',
            'rows.*.reorder_level'=>'nullable|integer|min:0',
        ]);
        $skus=array_map(fn($row)=>strtoupper(trim($row['sku'])),$data['rows']);
        if(count($skus)!==count(array_unique($skus)))
            throw \Illuminate\Validation\ValidationException::withMessages(['rows'=>'Duplicate SKUs in upload batch.']);
        $existing=DB::table('books')->where('bookshop_id',$tenant)->whereIn('sku',array_column($data['rows'],'sku'))->pluck('sku')->all();
        if($existing)
            throw \Illuminate\Validation\ValidationException::withMessages(['rows'=>'Already registered SKUs: '.implode(', ',array_slice($existing,0,10))]);
        $now=now();
        DB::transaction(function()use($data,$now,$tenant){
            foreach($data['rows'] as $row) {
                $categoryName=trim(preg_replace('/\\s+/u',' ',$row['category_name']));
                $subcategoryName=trim(preg_replace('/\\s+/u',' ',$row['subcategory_name']));
                $category=DB::table('product_categories')->whereRaw('LOWER(name) = ?', [mb_strtolower($categoryName)])->first();
                $categoryId=$category?->id;
                if(!$categoryId) {
                    DB::table('product_categories')->insertOrIgnore(['name'=>$categoryName,'created_at'=>$now,'updated_at'=>$now]);
                    $categoryId=DB::table('product_categories')->whereRaw('LOWER(name) = ?', [mb_strtolower($categoryName)])->value('id');
                }
                $subcategory=DB::table('product_subcategories')->where('product_category_id',$categoryId)->whereRaw('LOWER(name) = ?', [mb_strtolower($subcategoryName)])->first();
                $subcategoryId=$subcategory?->id;
                if(!$subcategoryId) {
                    DB::table('product_subcategories')->insertOrIgnore(['product_category_id'=>$categoryId,'name'=>$subcategoryName,'created_at'=>$now,'updated_at'=>$now]);
                    $subcategoryId=DB::table('product_subcategories')->where('product_category_id',$categoryId)->whereRaw('LOWER(name) = ?', [mb_strtolower($subcategoryName)])->value('id');
                }
                unset($row['category_name'],$row['subcategory_name']);
                $row['product_subcategory_id']=$subcategoryId;
                DB::table('books')->insert(array_merge($row,['bookshop_id'=>$tenant,'reorder_level'=>$row['reorder_level']??10,'is_active'=>true,'created_at'=>$now,'updated_at'=>$now]));
            }
        });
        return response()->json(['created'=>count($data['rows'])],201);
    }
    public function exportBooks(Request $request) {
        $tenant=Tenant::requireId();
        $columns=['id','title','sku','isbn','brand','ruling_style','page_count','paper_size','binding_type','cost_price','selling_price','reorder_level','is_active','product_subcategory_id'];
        return response()->streamDownload(function() use ($columns,$tenant) {
            $out=fopen('php://output','w');
            fputcsv($out,$columns);
            DB::table('books')->where('bookshop_id',$tenant)->orderBy('id')->chunk(500,function($rows)use($out,$columns){
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
        $tenant=Tenant::requireId();
        $data=$request->validate([
            'rows'=>'required|array|min:1|max:200',
            'rows.*.id'=>['required','integer','distinct',Tenant::exists('books')],
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
        DB::transaction(function()use($data,$tenant){
            foreach($data['rows'] as $row){
                $id=$row['id'];unset($row['id']);
                DB::table('books')->where('bookshop_id',$tenant)->where('id',$id)->update(array_merge($row,['updated_at'=>now()]));
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
        $tenant=Tenant::requireId();
        $data = $request->validate([
            'title'=>'required|string|max:255','subtitle'=>'nullable|string|max:255','isbn'=>['nullable','string','max:20',Tenant::unique('books','isbn')],
            'sku'=>['required','string','max:100',Tenant::unique('books','sku')],'product_subcategory_id'=>'required|integer|exists:product_subcategories,id','book_category_id'=>['nullable',Tenant::exists('book_categories')],
            'publisher_id'=>['nullable',Tenant::exists('publishers')],'edition'=>'nullable|string|max:100','language'=>'nullable|string|max:100',
            'curriculum'=>'nullable|string|max:100','grade'=>'nullable|string|max:100','description'=>'nullable|string',
            'cover_url'=>'nullable|url|max:2048','cost_price'=>'required|numeric|min:0','selling_price'=>'required|numeric|min:0',
            'reorder_level'=>'integer|min:0','is_active'=>'boolean','author_ids'=>'array','author_ids.*'=>['integer',Tenant::exists('authors')]
        ]);
        $authors = $data['author_ids'] ?? []; unset($data['author_ids']);
        $id = DB::transaction(function () use ($data,$authors,$tenant) {
            $id = DB::table('books')->insertGetId(array_merge($data,['bookshop_id'=>$tenant,'created_at'=>now(),'updated_at'=>now()]));
            foreach (array_unique($authors) as $author) DB::table('author_book')->insert(['book_id'=>$id,'author_id'=>$author]);
            return $id;
        });
        return response()->json(DB::table('books')->find($id),201);
    }
    public function updateBook(Request $request, int $book) {
        $tenant=Tenant::requireId();
        abort_unless(DB::table('books')->where('bookshop_id',$tenant)->where('id',$book)->exists(),404);
        $data=$request->validate([
            'title'=>'sometimes|required|string|max:255','subtitle'=>'nullable|string|max:255',
            'isbn'=>['nullable','string','max:20',Tenant::unique('books','isbn')->ignore($book)],
            'sku'=>['sometimes','required','string','max:100',Tenant::unique('books','sku')->ignore($book)],
            'book_category_id'=>['nullable',Tenant::exists('book_categories')],'publisher_id'=>['nullable',Tenant::exists('publishers')],
            'edition'=>'nullable|string|max:100','language'=>'nullable|string|max:100','curriculum'=>'nullable|string|max:100',
            'grade'=>'nullable|string|max:100','description'=>'nullable|string','cover_url'=>'nullable|url|max:2048',
            'cost_price'=>'numeric|min:0','selling_price'=>'numeric|min:0','reorder_level'=>'integer|min:0','is_active'=>'boolean',
            'author_ids'=>'array','author_ids.*'=>['integer',Tenant::exists('authors')]
        ]);
        $authors=$data['author_ids']??null;unset($data['author_ids']);
        DB::transaction(function () use ($book,$data,$authors,$tenant) {
            if($data) DB::table('books')->where('bookshop_id',$tenant)->where('id',$book)->update(array_merge($data,['updated_at'=>now()]));
            if($authors!==null) { DB::table('author_book')->where('book_id',$book)->delete(); foreach(array_unique($authors) as $author) DB::table('author_book')->insert(['book_id'=>$book,'author_id'=>$author]); }
        });
        return DB::table('books')->find($book);
    }
    public function lookup(string $table) {
        abort_unless(in_array($table,['authors','publishers','book_categories'],true),404);
        return DB::table($table)->where('bookshop_id',Tenant::requireId())->orderBy('name')->get();
    }
    public function createLookup(Request $request,string $table) {
        abort_unless(in_array($table,['authors','publishers','book_categories'],true),404);
        $tenant=Tenant::requireId();
        $data=$request->validate(['name'=>['required','string','max:255',Tenant::unique($table,'name')]]);
        $id=DB::table($table)->insertGetId(array_merge($data,['bookshop_id'=>$tenant,'created_at'=>now(),'updated_at'=>now()]));
        return response()->json(DB::table($table)->find($id),201);
    }
    public function suppliers(Request $request) {
        return DB::table('suppliers')->where('bookshop_id',Tenant::requireId())->when($request->query('search'),fn($q,$s)=>$q->where('name','like',"%{$s}%"))->orderBy('name')->paginate(20);
    }
    public function storeSupplier(Request $request) {
        $tenant=Tenant::requireId();
        $data=$request->validate(['name'=>'required|string|max:255','contact_person'=>'nullable|string|max:255','email'=>'nullable|email','phone'=>'nullable|string|max:50','address'=>'nullable|string','tax_pin'=>'nullable|string|max:50']);
        $id=DB::table('suppliers')->insertGetId(array_merge($data,['bookshop_id'=>$tenant,'created_at'=>now(),'updated_at'=>now()]));
        return response()->json(DB::table('suppliers')->find($id),201);
    }
}
