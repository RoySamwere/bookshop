<?php

namespace App\Http\Controllers;

use App\Http\Requests\BranchRequest;
use App\Http\Resources\BranchResource;
use App\Models\AuditLog;
use App\Models\Branch;
use App\Services\EntitlementService;
use App\Support\Tenancy\Tenant;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class BranchController extends Controller
{
    /** The owner sees every branch of their bookshop; everyone else sees the branches they are assigned to. */
    public function index(Request $request): AnonymousResourceCollection
    {
        $caller = $request->user();
        $branches = Branch::query()->withCount('users')
            ->where('bookshop_id', Tenant::requireId())->whereIn('id', $caller->branchIds())
            ->when($request->boolean('active_only'), fn ($query) => $query->where('is_active', true))
            ->orderByDesc('is_main')->orderBy('name')->get();

        return BranchResource::collection($branches);
    }

    public function store(BranchRequest $request, EntitlementService $entitlements): JsonResponse
    {
        $entitlements->ensureCanAddBranch(Tenant::bookshop());
        $branch = new Branch($request->validated());
        $branch->bookshop_id = Tenant::requireId();
        // A bookshop's first branch is its main branch.
        $branch->is_main = ! Branch::where('bookshop_id', $branch->bookshop_id)->exists();
        $branch->save();
        AuditLog::record('branch.created', "Created branch {$branch->name} ({$branch->code})", $branch);

        return (new BranchResource($branch->loadCount('users')))
            ->additional(['message' => "{$branch->name} was created."])
            ->response()->setStatusCode(201);
    }

    public function update(BranchRequest $request, Branch $branch): BranchResource
    {
        abort_unless($branch->bookshop_id === Tenant::requireId(), 404);
        $data = $request->validated();
        if ($branch->is_main && array_key_exists('is_active', $data) && ! $data['is_active']) {
            abort(422, 'The main branch cannot be deactivated.');
        }

        $branch->fill($data)->save();
        AuditLog::record('branch.updated', "Updated branch {$branch->name}", $branch, ['changed' => array_keys($branch->getChanges())]);

        return (new BranchResource($branch->loadCount('users')))->additional(['message' => "{$branch->name} was updated."]);
    }
}
