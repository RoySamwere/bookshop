<?php

use App\Http\Controllers\AccountReviewController;
use App\Http\Controllers\AuditLogController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\BookshopController;
use App\Http\Controllers\BookshopRegistrationController;
use App\Http\Controllers\BranchController;
use App\Http\Controllers\BusinessProfileController;
use App\Http\Controllers\CatalogController;
use App\Http\Controllers\InventoryController;
use App\Http\Controllers\LaunchSubscriberController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\ProcurementController;
use App\Http\Controllers\PosController;
use App\Http\Controllers\ProductUnitController;
use App\Http\Controllers\RegistrationController;
use App\Http\Controllers\Platform\BookshopDirectoryController;
use App\Http\Controllers\Platform\PlatformController;
use App\Http\Controllers\Platform\PlatformUserController;
use App\Http\Controllers\RoleController;
use App\Http\Controllers\StaffInvitationController;
use App\Http\Controllers\TaxRateController;
use App\Http\Controllers\UserController;
use Illuminate\Support\Facades\Route;

Route::post('/auth/login', [AuthController::class, 'login'])->middleware('throttle:login');
Route::post('/auth/forgot-password', [AuthController::class, 'forgotPassword'])->middleware('throttle:3,1');
Route::post('/auth/reset-password', [AuthController::class, 'resetPassword'])->middleware('throttle:5,1');

// Public registration and email verification. Sign-ups are always customer accounts.
Route::post('/auth/register', [RegistrationController::class, 'register'])->middleware('throttle:register');
Route::get('/auth/email/verify/{id}/{hash}', [RegistrationController::class, 'verify'])
    ->middleware('throttle:6,1')->name($verificationRouteName ?? 'verification.verify');
Route::post('/auth/email/resend', [RegistrationController::class, 'resend'])->middleware('throttle:verification');
// Self-service bookshop owners: creates the owner, the bookshop tenant and its main branch.
Route::post('/auth/register/bookshop', [BookshopRegistrationController::class, 'register'])->middleware('throttle:register');
Route::post('/auth/invitations/accept', [StaffInvitationController::class, 'accept'])->middleware('throttle:5,1');

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

    // Onboarding: open to owners who have not verified yet, but never to a suspended bookshop.
    Route::middleware(['permission:workspace.access', 'tenant:onboarding'])->group(function () {
        Route::get('/bookshop', [BookshopController::class, 'show']);
        Route::patch('/bookshop', [BookshopController::class, 'update'])->middleware('permission:settings.manage');
    });

    // Bookshop workspace. Every route runs inside the signed-in user's own, active bookshop.
    Route::middleware(['permission:workspace.access', 'tenant'])->group(function () {
        Route::get('/bookshop/activity', [BookshopController::class, 'activity'])->middleware('permission:audit.view');
        Route::post('/staff-invitations', [StaffInvitationController::class, 'invite'])->middleware('permission:users.manage');
        Route::post('/staff-invitations/{user}/resend', [StaffInvitationController::class, 'resend'])->middleware(['permission:users.manage', 'throttle:6,1']);
        Route::get('/dashboard', \App\Http\Controllers\DashboardController::class)->middleware('permission:dashboard.view');
        Route::get('/pos/branches', [PosController::class, 'branchesForPos'])->middleware('permission:pos.access');
        Route::get('/pos/products', [PosController::class, 'products'])->middleware('permission:pos.access');
        Route::post('/pos/checkout', [PosController::class, 'checkout'])->middleware('permission:pos.access');
        Route::get('/pos/sales', [PosController::class, 'sales'])->middleware('permission:sales.view');
        Route::get('/pos/sales/{sale}', [PosController::class, 'show'])->middleware('permission:sales.view');
        Route::get('/product-hierarchy', [CatalogController::class, 'hierarchy'])->middleware('permission:catalog.view');
        Route::get('/books', [CatalogController::class, 'books'])->middleware('permission:catalog.view');
        Route::get('/books-export', [CatalogController::class, 'exportBooks'])->middleware('permission:catalog.view');
        Route::post('/books-bulk-create', [CatalogController::class, 'bulkCreateBooks'])->middleware('permission:catalog.manage');
        Route::post('/books-import', [CatalogController::class, 'importBooks'])->middleware('permission:catalog.manage');
        Route::get('/catalog/{table}', [CatalogController::class, 'lookup'])->middleware('permission:catalog.view');
        Route::get('/books/{book}/units', [ProductUnitController::class,'index'])->middleware('permission:catalog.view');
        Route::post('/books/{book}/units', [ProductUnitController::class,'store'])->middleware('permission:catalog.manage');
        Route::delete('/books/{book}/units/{unit}', [ProductUnitController::class,'destroy'])->middleware('permission:catalog.manage');
        Route::post('/books', [CatalogController::class, 'storeBook'])->middleware('permission:catalog.manage');
        Route::patch('/books/{book}', [CatalogController::class, 'updateBook'])->middleware('permission:catalog.manage');
        Route::post('/catalog/{table}', [CatalogController::class, 'createLookup'])->middleware('permission:catalog.manage');
        Route::get('/suppliers', [CatalogController::class, 'suppliers'])->middleware('permission:suppliers.view');
        Route::post('/suppliers', [CatalogController::class, 'storeSupplier'])->middleware('permission:suppliers.manage');
        Route::get('/inventory', [InventoryController::class, 'index'])->middleware('permission:inventory.view');
        Route::get('/inventory/movements', [InventoryController::class, 'movements'])->middleware('permission:inventory.view');
        Route::post('/inventory/bulk-receive', [InventoryController::class, 'bulkReceive'])->middleware('permission:inventory.manage');
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
        Route::get('/audit-logs', [AuditLogController::class, 'index'])->middleware('permission:audit.view');
    });

    // Platform administration: platform staff only, and no route here reads bookshop business data.
    Route::prefix('platform')->middleware('platform')->group(function () {
        Route::get('/overview', [PlatformController::class, 'overview']);
        Route::get('/bookshops', [BookshopDirectoryController::class, 'index'])->middleware('permission:platform.bookshops.view');
        Route::get('/bookshops/{bookshop}', [BookshopDirectoryController::class, 'show'])->middleware('permission:platform.bookshops.view');
        Route::post('/bookshops/{bookshop}/suspend', [BookshopDirectoryController::class, 'suspend'])->middleware('permission:platform.bookshops.suspend');
        Route::post('/bookshops/{bookshop}/reactivate', [BookshopDirectoryController::class, 'reactivate'])->middleware('permission:platform.bookshops.suspend');
        Route::post('/bookshops/{bookshop}/resend-owner-verification', [BookshopDirectoryController::class, 'resendOwnerVerification'])->middleware(['permission:platform.bookshops.onboard', 'throttle:6,1']);
        Route::get('/users', [PlatformUserController::class, 'index'])->middleware('permission:platform.users.view');
        Route::post('/users', [PlatformUserController::class, 'store'])->middleware('permission:platform.users.manage');
        Route::patch('/users/{user}/status', [PlatformUserController::class, 'updateStatus'])->middleware('permission:platform.users.manage');
        Route::get('/settings', [PlatformController::class, 'settings'])->middleware('permission:platform.settings.view');
        Route::put('/settings', [PlatformController::class, 'updateSettings'])->middleware('permission:platform.settings.manage');
        Route::get('/plans', [PlatformController::class, 'plans'])->middleware('permission:platform.plans.view');
        Route::get('/audit-logs', [PlatformController::class, 'audit'])->middleware('permission:platform.audit.view');
        Route::get('/launch-subscribers', [LaunchSubscriberController::class, 'index'])->middleware('permission:platform.settings.view');
    });
    // Original path kept for compatibility; the public launch list is platform data, not one bookshop's.
    Route::get('/launch-subscribers', [LaunchSubscriberController::class, 'index'])->middleware(['platform', 'permission:platform.settings.view']);
});
