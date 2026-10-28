<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class HekimaExpandedCatalogSeeder extends Seeder {
 public function run():void {
  $this->call([HekimaCategorySeeder::class,HekimaDemoCatalogSeeder::class]);
  $subcategory=DB::table('product_subcategories')->where('name','Exercise Books')->value('id');
  $rulings=['Single Line','Double Line','Four Line','Square Ruled','Plain','Graph Ruled','Music Stave','Margin Ruled','Irish Ruling'];
  $pages=[32,48,64,80,96,120,160,200,240,300];
  $sizes=['A4','A5','B5','A6'];
  $bindings=['Saddle Stitched','Perfect Bound','Spiral Bound','Case Bound'];
  $brands=['Unbranded','School Choice','Standard','Premium'];
  $rows=[];$index=0;
  foreach($brands as $brand)foreach($rulings as $ruling)foreach($pages as $page)foreach($sizes as $size)foreach($bindings as $binding){
   $index++;
   $rows[]=[
    'sku'=>'HEK-EX-V2-'.str_pad((string)$index,5,'0',STR_PAD_LEFT),
    'title'=>"{$brand} {$size} Exercise Book {$page} Pages {$ruling} {$binding}",
    'brand'=>$brand,'ruling_style'=>$ruling,'page_count'=>$page,'paper_size'=>$size,'binding_type'=>$binding,
    'product_subcategory_id'=>$subcategory,'book_category_id'=>DB::table('book_categories')->where('name','Exercise Books')->value('id'),
    'description'=>'Illustrative product variant for catalogue setup; confirm availability and specifications with supplier before activation.',
    'isbn'=>null,'cost_price'=>0,'selling_price'=>0,'reorder_level'=>10,'is_active'=>false,'created_at'=>now(),'updated_at'=>now(),
   ];
   if(count($rows)===200){DB::table('books')->insertOrIgnore($rows);$rows=[];}
  }
  if($rows)DB::table('books')->insertOrIgnore($rows);
  $this->command?->info("Added up to {$index} distinct exercise-book variants without overwriting existing records.");
  $this->command?->warn('Unverified variants are inactive and unpriced; no stock balances created.');
 }
}