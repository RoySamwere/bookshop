<?php

namespace App\Http\Controllers;

use App\Http\Requests\BusinessProfileRequest;
use App\Models\AuditLog;
use App\Models\BusinessProfile;
use App\Models\TaxRate;
use Illuminate\Http\JsonResponse;

class BusinessProfileController extends Controller
{
    public function show(): JsonResponse
    {
        return response()->json(['data' => $this->payload(BusinessProfile::current())]);
    }

    public function update(BusinessProfileRequest $request): JsonResponse
    {
        $profile = BusinessProfile::current();
        $profile->fill($request->validated())->save();
        AuditLog::record('business.updated', 'Updated business profile and store settings', $profile, ['changed' => array_keys($profile->getChanges())]);

        return response()->json(['message' => 'Business settings saved.', 'data' => $this->payload($profile)]);
    }

    private function payload(BusinessProfile $profile): array
    {
        $tax = TaxRate::where('bookshop_id', $profile->bookshop_id)->where('is_default', true)->where('is_active', true)->first();

        return [
            ...$profile->makeHidden(['created_at'])->toArray(),
            'default_tax' => $tax?->only(['id', 'name', 'code', 'rate']),
        ];
    }
}
