<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Product photographs. Files live on the private disk (never under the public web root); they are
 * served through short-lived signed URLs issued only to the owning bookshop. books.cover_url (an
 * external URL) is kept untouched as a fallback for products without an uploaded photo.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('product_images', function (Blueprint $table) {
            $table->id();
            $table->foreignId('bookshop_id')->constrained('bookshops')->restrictOnDelete();
            // Removing a product removes its photos; removing a photo never touches the product.
            $table->foreignId('book_id')->constrained('books')->cascadeOnDelete();
            $table->string('path');
            $table->string('thumb_path');
            $table->string('original_name')->nullable();
            $table->unsignedInteger('width');
            $table->unsignedInteger('height');
            $table->unsignedInteger('size_bytes');
            // SHA-256 of the uploaded file: the same photo cannot be attached to a product twice.
            $table->char('checksum', 64);
            $table->unsignedSmallInteger('sort_order')->default(0);
            $table->foreignId('uploaded_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
            $table->unique(['book_id', 'checksum']);
            $table->index(['book_id', 'sort_order']);
        });

        Schema::table('books', function (Blueprint $table) {
            $table->foreignId('primary_image_id')->nullable()->after('cover_url')->constrained('product_images')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('books', function (Blueprint $table) {
            $table->dropConstrainedForeignId('primary_image_id');
        });
        Schema::dropIfExists('product_images');
    }
};
