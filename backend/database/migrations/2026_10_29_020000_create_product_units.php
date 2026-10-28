<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
 public function up():void {
  Schema::table('books',fn(Blueprint $t)=>$t->string('base_unit',40)->default('piece'));
  Schema::create('product_units',function(Blueprint $t){
   $t->id();$t->foreignId('book_id')->constrained('books')->cascadeOnDelete();
   $t->string('name',80);$t->unsignedInteger('pieces_per_unit');$t->string('barcode',100)->nullable()->unique();
   $t->timestamps();$t->unique(['book_id','name']);
  });
  Schema::table('inventory_movements',function(Blueprint $t){
   $t->foreignId('product_unit_id')->nullable()->constrained('product_units')->nullOnDelete();
   $t->unsignedInteger('package_quantity')->nullable();$t->unsignedInteger('units_per_package')->nullable();
  });
 }
 public function down():void {
  Schema::table('inventory_movements',fn(Blueprint $t)=>$t->dropConstrainedForeignId('product_unit_id'));
  Schema::table('inventory_movements',fn(Blueprint $t)=>$t->dropColumn(['package_quantity','units_per_package']));
  Schema::dropIfExists('product_units');
  Schema::table('books',fn(Blueprint $t)=>$t->dropColumn('base_unit'));
 }
};