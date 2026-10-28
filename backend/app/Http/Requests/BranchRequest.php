<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class BranchRequest extends FormRequest
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
        $branch = $this->route('branch');
        $required = $branch ? 'sometimes' : 'required';

        return [
            'name' => [$required, 'string', 'max:255'],
            'code' => [$required, 'string', 'max:20', 'regex:/^[A-Z0-9-]+$/', Rule::unique('branches', 'code')->ignore($branch?->id)],
            'email' => ['nullable', 'email', 'max:255'],
            'phone' => ['nullable', 'string', 'max:30'],
            'address' => ['nullable', 'string', 'max:255'],
            'city' => ['nullable', 'string', 'max:100'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    public function messages(): array
    {
        return ['code.regex' => 'Use capital letters, numbers and dashes only.'];
    }
}
