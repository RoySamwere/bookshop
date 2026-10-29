<?php

namespace App\Http\Requests;

use App\Models\Bookshop;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;

class RegisterRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $this->merge([
            'name' => is_string($this->input('name')) ? trim(preg_replace('/\s+/', ' ', $this->input('name'))) : $this->input('name'),
            'email' => is_string($this->input('email')) ? strtolower(trim($this->input('email'))) : $this->input('email'),
            'phone' => is_string($this->input('phone')) && trim($this->input('phone')) !== '' ? trim($this->input('phone')) : null,
            'bookshop' => is_string($this->input('bookshop')) && trim($this->input('bookshop')) !== '' ? strtolower(trim($this->input('bookshop'))) : null,
        ]);
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'min:2', 'max:255'],
            'email' => ['required', 'string', 'email:rfc', 'max:255', 'unique:users,email'],
            'phone' => ['nullable', 'string', 'max:30', 'regex:/^[0-9+()\s-]{7,30}$/'],
            'password' => ['required', 'string', 'confirmed', Password::defaults()],
            'terms' => ['accepted'],
            'request_staff_access' => ['sometimes', 'boolean'],
            // The bookshop (by its public code) a customer shops at or asks to work for.
            'bookshop' => ['nullable', 'string', 'max:80', 'required_if_accepted:request_staff_access',
                Rule::exists('bookshops', 'slug')->where('status', Bookshop::STATUS_ACTIVE)],
            // Anything that tries to choose its own access is rejected outright.
            'role' => ['prohibited'],
            'is_active' => ['prohibited'],
            'branch_ids' => ['prohibited'],
            'bookshop_id' => ['prohibited'],
        ];
    }

    public function messages(): array
    {
        return [
            'email.unique' => 'An account with this email address already exists. Sign in or reset your password instead.',
            'phone.regex' => 'Enter a valid phone number.',
            'terms.accepted' => 'You need to accept the terms of use to create an account.',
            'role.prohibited' => 'You cannot choose a role when registering.',
            'is_active.prohibited' => 'This field cannot be set when registering.',
            'branch_ids.prohibited' => 'This field cannot be set when registering.',
            'bookshop_id.prohibited' => 'This field cannot be set when registering.',
            'bookshop.required_if_accepted' => 'Enter the code of the bookshop you work at.',
            'bookshop.exists' => 'We could not find an active bookshop with that code.',
        ];
    }
}
