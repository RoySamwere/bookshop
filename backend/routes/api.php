<?php

use Illuminate\Support\Facades\Route;

// Preserve existing contracts and signed verification route names.
require __DIR__.'/api-endpoints.php';

// Versioned SPA endpoints share the same validation, authorization and business logic.
Route::prefix('v1')->group(function () {
    $verificationRouteName = 'v1.verification.verify';
    require __DIR__.'/api-endpoints.php';
});
