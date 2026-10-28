<?php

namespace App\Http\Controllers;

use App\Http\Requests\BranchRequest;
use App\Http\Resources\BranchResource;
use App\Models\AuditLog;
use App\Models\Branch;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class BranchController extends Controller
{
    /** The owner sees every branch; everyone else sees the branches they are assigned to. */
    public function index(Request $request): AnonymousResourceCollection
    {
        $caller = $request->user();
        $branches = Branch::query()->withCount('users')
            ->when(! $caller->isOwner(), fn ($query) => $query->whereIn('id', $caller->branchIds()))
            ->when($request->boolean('active_only'), fn ($query) => $query->where('is_active', true))
            ->orderByDesc('is_main')->orderBy('name')->get();

        return BranchResource::collection($branches);
    }

    public function store(BranchRequest $request): JsonResponse
    {
        $branch = Branch::create($request->validated());
        AuditLog::record('branch.created', "Created branch {$branch->name} ({$branch->code})", $branch);

        return (new BranchResource($branch->loadCount('users')))
            ->additional(['message' => "{$branch->name} was created."])
            ->response()->setStatusCode(201);
    }

    public function update(BranchRequest $request, Branch $branch): BranchResource
    {
        $data = $request->validated();
        if ($branch->is_main && array_key_exists('is_active', $data) && ! $data['is_active']) {
            abort(422, 'The main branch cannot be deactivated.');
        }

        $branch->fill($data)->save();
        AuditLog::record('branch.updated', "Updated branch {$branch->name}", $branch, ['changed' => array_keys($branch->getChanges())]);

        return (new BranchResource($branch->loadCount('users')))->additional(['message' => "{$branch->name} was updated."]);
    }
}
