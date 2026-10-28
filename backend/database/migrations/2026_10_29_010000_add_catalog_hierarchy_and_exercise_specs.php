<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
 public function up(): void {
  Schema::create('product_categories', function(Blueprint $t){$t->id();$t->string('name')->unique();$t->timestamps();});
  Schema::create('product_subcategories', function(Blueprint $t){$t->id();$t->foreignId('product_category_id')->constrained()->cascadeOnDelete();$t->string('name');$t->unique(['product_category_id','name']);$t->timestamps();});
  Schema::table('books',function(Blueprint $t){
   $t->foreignId('product_subcategory_id')->nullable()->after('book_category_id')->constrained()->nullOnDelete();
   $t->string('brand')->nullable();$t->string('ruling_style')->nullable();$t->unsignedSmallInteger('page_count')->nullable();$t->string('paper_size',30)->nullable();$t->string('binding_type')->nullable();
   $t->index(['product_subcategory_id','brand']);$t->index(['ruling_style','page_count','paper_size','binding_type'],'books_exercise_specs_index');
  });
 }
 public function down():void {
  Schema::table('books',function(Blueprint $t){$t->dropIndex('books_exercise_specs_index');$t->dropIndex(['product_subcategory_id','brand']);$t->dropConstrainedForeignId('product_subcategory_id');$t->dropColumn(['brand','ruling_style','page_count','paper_size','binding_type']);});
  Schema::dropIfExists('product_subcategories');Schema::dropIfExists('product_categories');
 }
};