<?php

namespace App\Http\Controllers;

use App\Http\Requests\TaxRateRequest;
use App\Models\AuditLog;
use App\Models\TaxRate;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class TaxRateController extends Controller
{
    public function index(): JsonResponse
    {
        return response()->json(['data' => TaxRate::orderByDesc('is_default')->orderBy('name')->get()]);
    }

    public function store(TaxRateRequest $request): JsonResponse
    {
        $taxRate = DB::transaction(fn () => $this->save(new TaxRate(), $request->validated()));
        AuditLog::record('tax_rate.created', "Created tax rate {$taxRate->name} ({$taxRate->rate}%)", $taxRate);

        return response()->json(['message' => "{$taxRate->name} was added.", 'data' => $taxRate], 201);
    }

    public function update(TaxRateRequest $request, TaxRate $taxRate): JsonResponse
    {
        $data = $request->validated();
        if ($taxRate->is_default && (! ($data['is_active'] ?? true) || ! ($data['is_default'] ?? true))) {
            abort(422, 'Choose another default tax rate before changing this one.');
        }

        DB::transaction(fn () => $this->save($taxRate, $data));
        AuditLog::record('tax_rate.updated', "Updated tax rate {$taxRate->name}", $taxRate, ['changed' => array_keys($taxRate->getChanges())]);

        return response()->json(['message' => "{$taxRate->name} was updated.", 'data' => $taxRate->fresh()]);
    }

    public function destroy(TaxRate $taxRate): JsonResponse
    {
        if ($taxRate->is_default) {
            abort(422, 'The default tax rate cannot be deleted.');
        }

        AuditLog::record('tax_rate.deleted', "Deleted tax rate {$taxRate->name}", $taxRate, ['rate' => $taxRate->rate]);
        $taxRate->delete();

        return response()->json(['message' => "{$taxRate->name} was deleted."]);
    }

    /** Only one active rate can be the default. */
    private function save(TaxRate $taxRate, array $data): TaxRate
    {
        $taxRate->fill($data);
        if ($taxRate->is_default) {
            $taxRate->is_active = true;
            TaxRate::where('is_default', true)->whereKeyNot($taxRate->id)->update(['is_default' => false]);
        }
        $taxRate->save();

        return $taxRate;
    }
}
