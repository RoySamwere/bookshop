<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/** People who asked to be told when the public bookshop opens. */
return new class extends Migration {
    public function up(): void
    {
        Schema::create('launch_subscribers', function (Blueprint $table) {
            $table->id();
            $table->string('email')->unique();
            $table->string('source', 40)->default('coming_soon');
            $table->string('ip_address', 45)->nullable();
            $table->timestamp('notified_at')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('launch_subscribers');
    }
};
