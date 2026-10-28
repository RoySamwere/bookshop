<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class TaxRateRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        if ($this->has('code')) {
            $this->merge(['code' => strtoupper(trim((string) $this->input('code')))]);
        }
    }

    public function rules(): array
    {
        $taxRate = $this->route('taxRate');
        $required = $taxRate ? 'sometimes' : 'required';

        return [
            'name' => [$required, 'string', 'max:100'],
            'code' => [$required, 'string', 'max:20', 'regex:/^[A-Z0-9-]+$/', Rule::unique('tax_rates', 'code')->ignore($taxRate?->id)],
            'rate' => [$required, 'numeric', 'min:0', 'max:100'],
            'is_default' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }
}
