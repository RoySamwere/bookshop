<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class BusinessProfileRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'legal_name' => ['nullable', 'string', 'max:255'],
            'kra_pin' => ['nullable', 'string', 'max:20', 'regex:/^[A-Z][0-9]{9}[A-Z]$/'],
            'email' => ['nullable', 'email', 'max:255'],
            'phone' => ['nullable', 'string', 'max:30'],
            'website' => ['nullable', 'url', 'max:255'],
            'address' => ['nullable', 'string', 'max:255'],
            'city' => ['nullable', 'string', 'max:100'],
            'country' => ['sometimes', 'required', 'string', 'max:100'],
            'currency' => ['sometimes', 'required', 'string', 'size:3', 'alpha'],
            'timezone' => ['sometimes', 'required', 'timezone:all'],
            'prices_include_tax' => ['sometimes', 'boolean'],
            'receipt_prefix' => ['sometimes', 'required', 'string', 'max:10', 'regex:/^[A-Z0-9-]+$/'],
            'receipt_header' => ['nullable', 'string', 'max:255'],
            'receipt_footer' => ['nullable', 'string', 'max:1000'],
            'low_stock_threshold' => ['sometimes', 'integer', 'min:0', 'max:100000'],
        ];
    }

    public function messages(): array
    {
        return [
            'kra_pin.regex' => 'KRA PIN must look like A123456789Z.',
            'receipt_prefix.regex' => 'Use capital letters, numbers and dashes only.',
        ];
    }

    protected function prepareForValidation(): void
    {
        foreach (['kra_pin', 'currency', 'receipt_prefix'] as $field) {
            if ($this->filled($field)) {
                $this->merge([$field => strtoupper(trim((string) $this->input($field)))]);
            }
        }
    }
}
