<?php

use App\Http\Controllers\AccountReviewController;
use App\Http\Controllers\AuditLogController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\BranchController;
use App\Http\Controllers\BusinessProfileController;
use App\Http\Controllers\CatalogController;
use App\Http\Controllers\InventoryController;
use App\Http\Controllers\LaunchSubscriberController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\ProcurementController;
use App\Http\Controllers\RegistrationController;
use App\Http\Controllers\RoleController;
use App\Http\Controllers\TaxRateController;
use App\Http\Controllers\UserController;
use Illuminate\Support\Facades\Route;

Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:login');
Route::post('/auth/forgot-password', [AuthController::class, 'forgotPassword'])->middleware('throttle:3,1');
Route::post('/auth/reset-password', [AuthController::class, 'resetPassword'])->middleware('throttle:5,1');

// Public registration and email verification. Sign-ups are always customer accounts.
Route::post('/auth/register', [RegistrationController::class, 'register'])->middleware('throttle:register');
Route::get('/auth/email/verify/{id}/{hash}', [RegistrationController::class, 'verify'])
    ->middleware('throttle:6,1')->name('verification.verify');
Route::post('/auth/email/resend', [RegistrationController::class, 'resend'])->middleware('throttle:verification');

// Public website: launch notification signups.
Route::post('/public/launch-subscribers', [LaunchSubscriberController::class, 'store'])->middleware('throttle:subscribe');

Route::middleware(['auth:sanctum', 'active', 'session.active'])->group(function () {
    Route::post('/auth/activity', fn () => response()->noContent());
    // Every signed-in account, including customers.
    Route::get('/auth/me', [AuthController::class, 'me']);
    Route::post('/auth/logout', [AuthController::class, 'logout']);
    Route::patch('/auth/profile', [AuthController::class, 'updateProfile']);
    Route::put('/auth/password', [AuthController::class, 'changePassword'])->middleware('throttle:5,1');
    Route::post('/auth/email/verification-notification', [RegistrationController::class, 'resendForCurrentUser'])->middleware('throttle:3,1');

    Route::get('/notifications', [NotificationController::class, 'index']);
    Route::post('/notifications/read-all', [NotificationController::class, 'markAllRead']);
    Route::post('/notifications/{id}/read', [NotificationController::class, 'markRead']);

    Route::middleware('permission:workspace.access')->group(function () {
        Route::get('/product-hierarchy', [CatalogController::class, 'hierarchy'])->middleware('permission:catalog.view');
        Route::get('/books', [CatalogController::class, 'books'])->middleware('permission:catalog.view');
        Route::get('/catalog/{table}', [CatalogController::class, 'lookup'])->middleware('permission:catalog.view');
        Route::post('/books', [CatalogController::class, 'storeBook'])->middleware('permission:catalog.manage');
        Route::patch('/books/{book}', [CatalogController::class, 'updateBook'])->middleware('permission:catalog.manage');
        Route::post('/catalog/{table}', [CatalogController::class, 'createLookup'])->middleware('permission:catalog.manage');
        Route::get('/suppliers', [CatalogController::class, 'suppliers'])->middleware('permission:suppliers.view');
        Route::post('/suppliers', [CatalogController::class, 'storeSupplier'])->middleware('permission:suppliers.manage');
        Route::get('/inventory', [InventoryController::class, 'index'])->middleware('permission:inventory.view');
        Route::get('/inventory/movements', [InventoryController::class, 'movements'])->middleware('permission:inventory.view');
        Route::post('/inventory/receive', [InventoryController::class, 'receive'])->middleware('permission:inventory.manage');
        Route::post('/inventory/adjust', [InventoryController::class, 'adjust'])->middleware('permission:inventory.manage');
        Route::post('/inventory/transfer', [InventoryController::class, 'transfer'])->middleware('permission:inventory.manage');
        Route::get('/purchase-orders', [ProcurementController::class, 'index'])->middleware('permission:inventory.view');
        Route::get('/purchase-orders/{order}', [ProcurementController::class, 'show'])->middleware('permission:inventory.view');
        Route::post('/purchase-orders', [ProcurementController::class, 'store'])->middleware('permission:inventory.manage');
        Route::post('/purchase-orders/{order}/approve', [ProcurementController::class, 'approve'])->middleware('permission:inventory.manage');
        Route::post('/purchase-orders/{order}/receive', [ProcurementController::class, 'receive'])->middleware('permission:inventory.manage');
        Route::get('/business', [BusinessProfileController::class, 'show']);
        Route::put('/business', [BusinessProfileController::class, 'update'])->middleware('permission:settings.manage');

        Route::get('/tax-rates', [TaxRateController::class, 'index']);
        Route::middleware('permission:settings.manage')->group(function () {
            Route::post('/tax-rates', [TaxRateController::class, 'store']);
            Route::patch('/tax-rates/{taxRate}', [TaxRateController::class, 'update']);
            Route::delete('/tax-rates/{taxRate}', [TaxRateController::class, 'destroy']);
        });

        Route::get('/branches', [BranchController::class, 'index'])->middleware('permission:branches.view,inventory.view');
        Route::post('/branches', [BranchController::class, 'store'])->middleware('permission:branches.manage');
        Route::patch('/branches/{branch}', [BranchController::class, 'update'])->middleware('permission:branches.manage');

        Route::get('/roles', [RoleController::class, 'index'])->middleware('permission:users.view');
        Route::get('/users', [UserController::class, 'index'])->middleware('permission:users.view');
        Route::get('/users/{user}', [UserController::class, 'show'])->middleware('permission:users.view');
        Route::middleware('permission:users.manage')->group(function () {
            Route::post('/users', [UserController::class, 'store']);
            Route::patch('/users/{user}', [UserController::class, 'update']);
            Route::patch('/users/{user}/status', [UserController::class, 'updateStatus']);
            Route::post('/users/{user}/reset-password', [UserController::class, 'resetPassword']);
            Route::delete('/users/{user}', [UserController::class, 'destroy']);
            Route::post('/users/{user}/approve', [AccountReviewController::class, 'approve']);
            Route::post('/users/{user}/reject', [AccountReviewController::class, 'reject']);
            Route::post('/users/{user}/resend-verification', [AccountReviewController::class, 'resendVerification'])->middleware('throttle:6,1');
        });
        Route::get('/users/{user}/audit-logs', [AccountReviewController::class, 'history'])->middleware('permission:audit.view');
        Route::get('/launch-subscribers', [LaunchSubscriberController::class, 'index'])->middleware('permission:settings.manage');

        Route::get('/audit-logs', [AuditLogController::class, 'index'])->middleware('permission:audit.view');
    });
});
