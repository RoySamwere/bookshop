<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;

/**
 * Opt-in demo catalogue: synthetic examples based on Kenyan bookshop categories.
 * Do not treat generated titles, prices or ISBNs as verified supplier/KICD records.
 * Run: php artisan db:seed --class=HekimaDemoCatalogSeeder
 */
class HekimaDemoCatalogSeeder extends Seeder
{
    public function run(): void
    {
        $now = now();
        $categories = ['CBC Textbooks','Revision & Past Papers','Readers & Storybooks','Reference Books','Exercise Books','Pens & Writing','Pencils & Erasers','Art & Craft','Paper & Filing','Geometry & Calculators','School Essentials'];
        foreach ($categories as $name) DB::table('book_categories')->updateOrInsert(['name'=>$name],['updated_at'=>$now,'created_at'=>$now]);
        $categoryIds = DB::table('book_categories')->pluck('id','name')->all();
        $rows = [];
        $add = function(string $title,string $category,int $price,int $n) use (&$rows,$categoryIds,$now) {
            $rows[] = [
                'title'=>preg_replace('/^Demo /', '', str_replace(' (Demo)', '', $title)),'sku'=>'HEK-DEMO-'.str_pad((string)$n,5,'0',STR_PAD_LEFT),
                'isbn'=>null,'book_category_id'=>$categoryIds[$category],
                'description'=>'Initial catalogue entry; verify actual ISBN, publisher and pricing before selling.',
                'cost_price'=>round($price * 0.72,2),'selling_price'=>$price,'reorder_level'=>10,
                'is_active'=>true,'created_at'=>$now,'updated_at'=>$now,
            ];
        };
        $subjects=['Mathematics','English','Kiswahili','Integrated Science','Social Studies','Agriculture','Creative Arts','Religious Education','Pre-Technical Studies','Business Studies','Computer Studies','Biology','Chemistry','Physics','History','Geography','Literature','French','Home Science','Music'];
        $series=['Learner Book','Teacher Guide','Revision Companion','Practice Workbook','Activity Book'];
        $n=0;
        foreach(range(1,10) as $grade) foreach($subjects as $subject) foreach($series as $kind) {
            $n++;
            $category=in_array($kind,['Revision Companion','Practice Workbook'],true)?'Revision & Past Papers':'CBC Textbooks';
            $add("Demo Grade {$grade} {$subject} {$kind}",$category,280+($grade*35)+(strlen($subject)*8),$n);
        }
        // The delivery note illustrates pen variants; its quantities/prices are NOT imported as stock or sales.
        $brands=['Bic Crystal','Bic Fine','Obama','Teepee Biro','Champion Pen','Kasuku Biro','Simba Biro','Gelx','Pilot','Staedtler','Parker','Paper Mate','Pentel','Cello','Reynolds','Deli','Maped','Faber-Castell','Monami','Generic School'];
        $colors=['Black','Blue','Red','Green','Purple','Pink','Orange','Brown','Turquoise','Navy'];
        $packSizes=['Single','Pack of 2','Pack of 3','Pack of 5','Pack of 10'];
        foreach($brands as $brand) foreach($colors as $color) foreach($packSizes as $pack) {
            $n++;$add("{$brand} {$color} {$pack} (Demo)",'Pens & Writing',30+($n%14)*15,$n);
        }

        $rulings = ['Single Line','Double Line','Four Line','Square Ruled','Plain','Graph Ruled','Music Stave','Margin Ruled'];
        $pages = [32,48,64,80,96,120,160,200];
        $sizes = ['A4','A5','B5','A6'];
        $bindings = ['Saddle Stitched','Perfect Bound','Spiral Bound','Case Bound'];
        $exercise = [];
        foreach ($rulings as $ruling) foreach ($pages as $volume) foreach ($sizes as $size) foreach ($bindings as $binding) {
            $exercise[] = [
                'title'=>"Exercise Book {$ruling} {$volume} Pages {$size} {$binding}",
                'sku'=>'HEK-EX-'.str_pad((string)(count($exercise)+1),4,'0',STR_PAD_LEFT),
                'isbn'=>null, 'book_category_id'=>$categoryIds['Exercise Books'],
                'description'=>"Ruling: {$ruling}; Pages: {$volume}; Size: {$size}; Binding: {$binding}. Verify actual specifications with supplier.",
                'cost_price'=>0, 'selling_price'=>0, 'reorder_level'=>10, 'is_active'=>false,
                'created_at'=>$now, 'updated_at'=>$now,
            ];
        }
        DB::table('books')->where('sku','like','HEK-DEMO-%')->where('title','like','Demo %')
            ->update(['title'=>DB::raw("SUBSTRING(title, 6)"),'updated_at'=>$now]);
        DB::table('books')->where('sku','like','HEK-DEMO-%')->where('title','like','% (Demo)')
            ->update(['title'=>DB::raw("REPLACE(title, ' (Demo)', '')"),'updated_at'=>$now]);
        foreach (array_chunk($exercise, 200) as $chunk) DB::table('books')->insertOrIgnore($chunk);

        foreach(array_chunk($rows,200) as $chunk) DB::table('books')->insertOrIgnore($chunk);
        $this->command?->info('Hekima catalogue: 2,000 original SKUs and 1,024 exercise-book variants; repeat runs skip existing SKUs.');
        $this->command?->warn('No inventory quantities were fabricated. Use goods receiving or authorized opening-stock adjustments to create auditable stock.');
    }
}
