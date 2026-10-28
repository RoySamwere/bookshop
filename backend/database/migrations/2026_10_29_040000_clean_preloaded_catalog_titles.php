<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration {
 public function up():void {
  // Clean presentation names only; preserve SKUs, prices, stock and audit references.
  DB::table('books')->where(function($q){
   $q->where('sku','like','HEK-DEMO-%')->orWhere('sku','like','HEK-EX-%');
  })->where(function($q){
   $q->where('title','like','Demo %')->orWhere('title','like','% (Demo)');
  })->update(['title'=>DB::raw("TRIM(REPLACE(CASE WHEN title LIKE 'Demo %' THEN SUBSTRING(title, 6) ELSE title END, ' (Demo)', ''))")]);
 }
 public function down():void {
  // Irreversible data normalization; never reintroduce demo labels.
 }
};