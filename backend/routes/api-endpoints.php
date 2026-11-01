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
use App\Http\Controllers\PurchaseOrderController;
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

// Daraja callbacks must be publicly reachable; callbacks never activate subscriptions.
Route::post('/billing/mpesa/stk/callback', [\App\Http\Controllers\DarajaCallbackController::class, 'stk'])->middleware('throttle:120,1');
Route::post('/billing/mpesa/c2b/confirmation', [\App\Http\Controllers\DarajaCallbackController::class, 'c2b'])->middleware('throttle:120,1');
Route::post('/billing/mpesa/c2b/validation', [\App\Http\Controllers\DarajaCallbackController::class, 'c2bValidation'])->middleware('throttle:120,1');
Route::post('/billing/mpesa/transaction-status/result', [\App\Http\Controllers\DarajaCallbackController::class, 'transactionStatusResult'])->middleware('throttle:120,1');
Route::post('/billing/mpesa/transaction-status/timeout', [\App\Http\Controllers\DarajaCallbackController::class, 'transactionStatusTimeout'])->middleware('throttle:120,1');

// Public registration and email verification. Sign-ups are always customer accounts.
Route::post('/auth/register', [RegistrationController::class, 'register'])->middleware('throttle:register');
Route::get('/auth/email/verify/{id}/{hash}', [RegistrationController::class, 'verify'])
    ->middleware('throttle:6,1')->name($verificationRouteName ?? 'verification.verify');
Route::post('/auth/email/resend', [RegistrationController::class, 'resend'])->middleware('throttle:verification');
// Self-service bookshop owners: creates the owner, the bookshop tenant and its main branch.
Route::post('/auth/register/bookshop', [BookshopRegistrationController::class, 'register'])->middleware('throttle:register');
Route::post('/auth/invitations/accept', [StaffInvitationController::class, 'accept'])->middleware('throttle:5,1');

// Public product discovery: explicitly whitelisted descriptive fields only.
// Never expose tenant identity, pricing, inventory, suppliers, or private book records.
Route::get('/public/products', function (\Illuminate\Http\Request $request) {
    $data = $request->validate(['search' => 'nullable|string|max:100', 'page' => 'nullable|integer|min:1|max:10000']);
    $search = trim($data['search'] ?? '');
    $query = \Illuminate\Support\Facades\DB::table('books as b')
        ->leftJoin('product_subcategories as s', 's.id', '=', 'b.product_subcategory_id')
        ->leftJoin('product_categories as c', 'c.id', '=', 's.product_category_id')
        ->where('b.is_active', true)
        ->when($search !== '', fn ($q) => $q->where(fn ($w) => $w
            ->where('b.title', 'like', '%'.$search.'%')
            ->orWhere('b.sku', 'like', '%'.$search.'%')
            ->orWhere('b.isbn', 'like', '%'.$search.'%')
            ->orWhere('b.brand', 'like', '%'.$search.'%')
            ->orWhere('c.name', 'like', '%'.$search.'%')
            ->orWhere('s.name', 'like', '%'.$search.'%')))
        ->select('b.id', 'b.title', 'b.sku', 'b.isbn', 'b.brand', 'c.name as category', 's.name as subcategory')
        ->distinct()->orderBy('b.title')->orderBy('b.sku');
    return response()->json($query->paginate(24));
})->middleware('throttle:60,1');

// Shared, read-only reference hierarchy. Never query tenant-owned books or inventory here.
Route::get('/public/products-catalogue', function (\Illuminate\Http\Request $request) {
    $data = $request->validate(['search' => 'nullable|string|max:100']);
    $search = trim($data['search'] ?? '');
    $categories = \Illuminate\Support\Facades\DB::table('product_categories')
        ->select('id', 'name')->orderBy('name')->get();
    $subcategories = \Illuminate\Support\Facades\DB::table('product_subcategories')
        ->select('id', 'product_category_id', 'name')->orderBy('name')->get();
    $rows = $categories->map(function ($category) use ($subcategories, $search) {
        $children = $subcategories->where('product_category_id', $category->id)
            ->filter(fn ($child) => $search === '' || stripos($child->name, $search) !== false || stripos($category->name, $search) !== false)
            ->map(fn ($child) => ['id' => $child->id, 'name' => $child->name])->values();
        if ($search !== '' && stripos($category->name, $search) === false && $children->isEmpty()) return null;
        return ['id' => $category->id, 'name' => $category->name, 'subcategories' => $children];
    })->filter()->values();
    return response()->json(['data' => $rows])->header('Cache-Control', 'public, max-age=300');
})->middleware('throttle:60,1');

// Public website: launch notification signups.
Route::post('/public/launch-subscribers', [LaunchSubscriberController::class, 'store'])->middleware('throttle:subscribe');

Route::middleware(['auth:sanctum', 'active', 'session.active', \App\Http\Middleware\ResolveBookshopManagement::class])->group(function () {
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

    Route::get('/billing', [\App\Http\Controllers\PlatformBillingController::class, 'index']);
    Route::post('/billing/invoices', [\App\Http\Controllers\PlatformBillingController::class, 'create'])->middleware('throttle:10,1');

    // Subscription invoice access is scoped to the authenticated bookshop.
    Route::get('/billing/invoices/{invoice}', [\App\Http\Controllers\PlatformBillingController::class, 'invoice'])->whereNumber('invoice');
    Route::get('/billing/payments', [\App\Http\Controllers\PlatformBillingController::class, 'myPayments']);
    Route::get('/billing/payments/{payment}/receipt', [\App\Http\Controllers\PlatformBillingController::class, 'paymentReceipt'])->whereNumber('payment');
    Route::post('/billing/invoices/{invoice}/stk', [\App\Http\Controllers\PlatformBillingController::class, 'stk'])->whereNumber('invoice')->middleware('throttle:5,1');

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
        Route::post('/books/shared-stock-status', [CatalogController::class, 'sharedStockStatus'])->middleware('permission:inventory.view');
        Route::post('/books/adopt-public', [CatalogController::class, 'adoptPublicProduct'])->middleware('permission:catalog.manage');
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
        Route::put('/suppliers/{supplier}', [CatalogController::class, 'updateSupplier'])->middleware('permission:suppliers.manage')->whereNumber('supplier');
        Route::post('/inventory/catalogue-stock-summary', [InventoryController::class, 'catalogueStockSummary'])->middleware('permission:inventory.view');
        Route::get('/inventory', [InventoryController::class, 'index'])->middleware('permission:inventory.view');
        Route::get('/inventory/stocktake-snapshot', [InventoryController::class, 'stocktakeSnapshot'])->middleware('permission:inventory.view');
        Route::post('/inventory/stocktake-apply', [InventoryController::class, 'stocktakeApply'])->middleware('permission:inventory.manage');
        Route::get('/inventory/movements', [InventoryController::class, 'movements'])->middleware('permission:inventory.view');
        Route::post('/inventory/bulk-receive', [InventoryController::class, 'bulkReceive'])->middleware('permission:inventory.manage');
        Route::post('/inventory/receive', [InventoryController::class, 'receive'])->middleware('permission:inventory.manage');
        Route::post('/inventory/adjust', [InventoryController::class, 'adjust'])->middleware('permission:inventory.manage');
        Route::post('/inventory/transfer', [InventoryController::class, 'transfer'])->middleware('permission:inventory.manage');
        // Local Purchase Orders (LPO), smart reordering and receiving.
        Route::middleware('permission:purchases.view')->group(function () {
            Route::get('/purchase-orders', [PurchaseOrderController::class, 'index']);
            Route::get('/purchase-orders/summary', [PurchaseOrderController::class, 'summary']);
            Route::get('/purchase-orders/reports', [PurchaseOrderController::class, 'reports']);
            Route::get('/purchase-orders/suggestions', [PurchaseOrderController::class, 'suggestions']);
            Route::get('/purchase-orders/catalogue', [PurchaseOrderController::class, 'catalogue']);
            Route::get('/purchase-orders/price-history/{book}', [PurchaseOrderController::class, 'priceHistory'])->whereNumber('book');
            Route::get('/purchase-orders/settings', [PurchaseOrderController::class, 'settings']);
            Route::get('/purchase-orders/{order}', [PurchaseOrderController::class, 'show'])->whereNumber('order');
            Route::get('/purchase-orders/{order}/pdf', [PurchaseOrderController::class, 'pdf'])->whereNumber('order');
        });
        Route::put('/purchase-orders/settings', [PurchaseOrderController::class, 'updateSettings'])->middleware('permission:settings.manage');
        Route::middleware('permission:purchases.manage')->group(function () {
            Route::put('/purchase-orders/reorder-settings/{book}', [PurchaseOrderController::class, 'updateReorderSettings'])->whereNumber('book');
            Route::post('/purchase-orders/generate', [PurchaseOrderController::class, 'generate']);
            Route::post('/purchase-orders', [PurchaseOrderController::class, 'store']);
            Route::put('/purchase-orders/{order}', [PurchaseOrderController::class, 'update'])->whereNumber('order');
            Route::delete('/purchase-orders/{order}', [PurchaseOrderController::class, 'destroy'])->whereNumber('order');
            Route::post('/purchase-orders/{order}/submit', [PurchaseOrderController::class, 'submit'])->whereNumber('order');
            Route::post('/purchase-orders/{order}/cancel', [PurchaseOrderController::class, 'cancel'])->whereNumber('order');
            Route::post('/purchase-orders/{order}/receive', [PurchaseOrderController::class, 'receive'])->whereNumber('order');
        });
        Route::middleware('permission:purchases.approve')->group(function () {
            Route::post('/purchase-orders/{order}/approve', [PurchaseOrderController::class, 'approve'])->whereNumber('order');
            Route::post('/purchase-orders/{order}/reject', [PurchaseOrderController::class, 'reject'])->whereNumber('order');
        });
        Route::middleware('permission:purchases.confirm')->group(function () {
            Route::post('/purchase-orders/{order}/confirm', [PurchaseOrderController::class, 'confirm'])->whereNumber('order');
            Route::post('/purchase-orders/{order}/send', [PurchaseOrderController::class, 'send'])->whereNumber('order');
            Route::post('/purchase-orders/{order}/mark-sent', [PurchaseOrderController::class, 'markSent'])->whereNumber('order');
            Route::post('/purchase-orders/{order}/amend', [PurchaseOrderController::class, 'amend'])->whereNumber('order');
        });
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
        Route::get('/billing/context', [\App\Http\Controllers\PlatformBillingController::class, 'context'])->middleware('permission:platform.settings.view');
        // Bills: the saf_payments ledger and its exception queue.
        Route::get('/bills', [\App\Http\Controllers\Platform\BillsController::class, 'index'])->middleware('permission:platform.settings.view');
        Route::get('/bills/export', [\App\Http\Controllers\Platform\BillsController::class, 'export'])->middleware(['permission:platform.settings.view', 'throttle:10,1']);
        Route::get('/bills/{payment}', [\App\Http\Controllers\Platform\BillsController::class, 'show'])->whereNumber('payment')->middleware('permission:platform.settings.view');
        Route::post('/bills/{payment}/retry', [\App\Http\Controllers\Platform\BillsController::class, 'retry'])->whereNumber('payment')->middleware(['permission:platform.settings.manage', 'throttle:20,1']);
        Route::post('/bills/{payment}/assign', [\App\Http\Controllers\Platform\BillsController::class, 'assign'])->whereNumber('payment')->middleware(['permission:platform.settings.manage', 'throttle:10,1']);
        Route::post('/bills/{payment}/reject', [\App\Http\Controllers\Platform\BillsController::class, 'reject'])->whereNumber('payment')->middleware(['permission:platform.settings.manage', 'throttle:10,1']);
        Route::get('/billing/subscriptions', [\App\Http\Controllers\PlatformBillingController::class, 'subscriptions'])->middleware('permission:platform.settings.view');
        Route::get('/billing/payments', [\App\Http\Controllers\PlatformBillingController::class, 'payments'])->middleware('permission:platform.settings.view');
        Route::patch('/billing/plans/{plan}', [\App\Http\Controllers\PlatformBillingController::class, 'updatePlan'])->whereNumber('plan')->middleware('permission:platform.settings.manage');
        Route::get('/billing/invoices', [\App\Http\Controllers\PlatformBillingController::class, 'admin'])->middleware('permission:platform.settings.view');
        Route::post('/billing/plans', [\App\Http\Controllers\PlatformBillingController::class, 'plan'])->middleware('permission:platform.settings.manage');
        Route::post('/billing/statement-payments', [\App\Http\Controllers\Platform\PaymentReconciliationController::class, 'statement'])->middleware(['permission:platform.settings.manage', 'throttle:10,1']);
        Route::post('/billing/stk-attempts/{attempt}/resolve-unknown', [\App\Http\Controllers\Platform\PaymentReconciliationController::class, 'resolveUnknown'])->whereNumber('attempt')->middleware('permission:platform.settings.manage');
        Route::post('/billing/reconciliation/{item}/resolve-overpayment', [\App\Http\Controllers\Platform\PaymentReconciliationController::class, 'resolveOverpayment'])->whereNumber('item')->middleware('permission:platform.settings.manage');
        Route::get('/billing/stk-attempts', [\App\Http\Controllers\Platform\PaymentReconciliationController::class, 'stkAttempts'])->middleware('permission:platform.settings.view');
        Route::post('/billing/stk-attempts/{attempt}/confirm', [\App\Http\Controllers\Platform\PaymentReconciliationController::class, 'confirmStk'])->whereNumber('attempt')->middleware(['permission:platform.settings.manage', 'throttle:10,1']);
        Route::get('/billing/reconciliation', [\App\Http\Controllers\Platform\PaymentReconciliationController::class, 'index'])->middleware('permission:platform.settings.view');
        Route::post('/billing/reconciliation/{item}/confirm', [\App\Http\Controllers\Platform\PaymentReconciliationController::class, 'confirm'])->whereNumber('item')->middleware(['permission:platform.settings.manage', 'throttle:10,1']);
        Route::get('/managed-bookshops', [\App\Http\Controllers\Platform\BookshopManagementController::class, 'index']);
        Route::post('/management/{bookshop}/enter', [\App\Http\Controllers\Platform\BookshopManagementController::class, 'enter'])->middleware('throttle:10,1');
        Route::post('/management/leave', [\App\Http\Controllers\Platform\BookshopManagementController::class, 'leave']);
        Route::post('/bookshops', [BookshopDirectoryController::class, 'store'])->middleware('permission:platform.bookshops.onboard');
        Route::get('/bookshops', [BookshopDirectoryController::class, 'index'])->middleware('permission:platform.bookshops.view');
        Route::get('/bookshops/{bookshop}', [BookshopDirectoryController::class, 'show'])->middleware('permission:platform.bookshops.view');
        Route::patch('/bookshops/{bookshop}', [BookshopDirectoryController::class, 'update'])->middleware('permission:platform.bookshops.onboard');
        Route::post('/bookshops/{bookshop}/approve', [BookshopDirectoryController::class, 'approve'])->middleware('permission:platform.bookshops.onboard');
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
