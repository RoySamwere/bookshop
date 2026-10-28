<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
 public function up():void {
  Schema::table('inventory_movements',function(Blueprint $t){
   $t->foreignId('supplier_id')->nullable()->constrained('suppliers')->nullOnDelete();
  });
 }
 public function down():void {
  Schema::table('inventory_movements',fn(Blueprint $t)=>$t->dropConstrainedForeignId('supplier_id'));
 }
};