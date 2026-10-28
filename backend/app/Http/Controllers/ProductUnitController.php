<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class ProductUnitController extends Controller {
 public function index(int $book) {
  abort_unless(DB::table('books')->where('id',$book)->exists(),404);
  return response()->json(DB::table('product_units')->where('book_id',$book)->orderBy('pieces_per_unit')->get());
 }
 public function store(Request $request,int $book) {
  abort_unless(DB::table('books')->where('id',$book)->exists(),404);
  $data=$request->validate([
   'name'=>['required','string','max:80',Rule::unique('product_units')->where('book_id',$book)],
   'pieces_per_unit'=>'required|integer|min:2|max:100000',
   'barcode'=>'nullable|string|max:100|unique:product_units,barcode',
  ]);
  $id=DB::table('product_units')->insertGetId([...$data,'book_id'=>$book,'created_at'=>now(),'updated_at'=>now()]);
  return response()->json(DB::table('product_units')->find($id),201);
 }
 public function destroy(int $book,int $unit) {
  $row=DB::table('product_units')->where('book_id',$book)->where('id',$unit)->first();
  abort_unless($row,404);
  abort_if(DB::table('inventory_movements')->where('product_unit_id',$unit)->exists(),409,'This packaging unit has receiving history and cannot be deleted.');
  DB::table('product_units')->where('id',$unit)->delete();
  return response()->noContent();
 }
}