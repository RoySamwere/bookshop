<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

class HekimaCategorySeeder extends Seeder {
 public function run():void {
  $map=[
   'Educational Books'=>['CBC Curriculum','National Exam Set Books','General Reference','Revision & Past Papers'],
   'General Literature'=>['Fiction & African Literature','Self-Help & Finance',"Children's Books",'Poetry & Drama'],
   'Scholastic Stationery'=>['Exercise Books','Counter Books','Mathematical Instruments','School Essentials'],
   'Office & Commercial Stationery'=>['Writing Materials','Filing & Desktop','Paper Supplies'],
   'Creative Arts & Lifestyle'=>['Fine Art Materials','Games & Gifting'],
  ];
  foreach($map as $category=>$subcategories){
   DB::table('product_categories')->updateOrInsert(['name'=>$category],['updated_at'=>now(),'created_at'=>now()]);
   $id=DB::table('product_categories')->where('name',$category)->value('id');
   foreach($subcategories as $sub)DB::table('product_subcategories')->updateOrInsert(['product_category_id'=>$id,'name'=>$sub],['updated_at'=>now(),'created_at'=>now()]);
  }
  $lookup=DB::table('product_subcategories as s')->join('product_categories as c','c.id','=','s.product_category_id')->select('s.id','s.name','c.name as category')->get();
  $find=fn(string $name)=>$lookup->firstWhere('name',$name)?->id;
  $existing=['CBC Textbooks'=>'CBC Curriculum','Revision & Past Papers'=>'Revision & Past Papers','Readers & Storybooks'=>"Children's Books",'Reference Books'=>'General Reference','Exercise Books'=>'Exercise Books','Pens & Writing'=>'Writing Materials','Pencils & Erasers'=>'Writing Materials','Art & Craft'=>'Fine Art Materials','Paper & Filing'=>'Paper Supplies','Geometry & Calculators'=>'Mathematical Instruments','School Essentials'=>'School Essentials'];
  foreach($existing as $old=>$new){
   $oldId=DB::table('book_categories')->where('name',$old)->value('id');
   if($oldId)DB::table('books')->where('book_category_id',$oldId)->whereNull('product_subcategory_id')->update(['product_subcategory_id'=>$find($new)]);
  }
 }
}