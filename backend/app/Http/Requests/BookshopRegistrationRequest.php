<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Password;

/** Public bookshop-owner sign-up. Access, ownership and tenancy fields can never be chosen by the client. */
class BookshopRegistrationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function prepareForValidation(): void
    {
        $clean = fn (string $key) => is_string($this->input($key)) ? (trim(preg_replace('/\s+/', ' ', $this->input($key))) ?: null) : $this->input($key);

        $this->merge([
            'owner_name' => $clean('owner_name'),
            'email' => is_string($this->input('email')) ? strtolower(trim($this->input('email'))) : $this->input('email'),
            'phone' => $clean('phone'),
            'bookshop_name' => $clean('bookshop_name'),
            'business_phone' => $clean('business_phone'),
            'business_location' => $clean('business_location'),
            'country' => $clean('country'),
            'currency' => is_string($this->input('currency')) ? strtoupper(trim($this->input('currency'))) : $this->input('currency'),
        ]);
    }

    public function rules(): array
    {
        $phone = ['string', 'max:30', 'regex:/^[0-9+()\s-]{7,30}$/'];

        return [
            'owner_name' => ['required', 'string', 'min:2', 'max:255'],
            'email' => ['required', 'string', 'email:rfc', 'max:255', 'unique:users,email'],
            'phone' => ['required', ...$phone],
            'password' => ['required', 'string', 'confirmed', Password::defaults()],
            'bookshop_name' => ['required', 'string', 'min:2', 'max:120'],
            'business_phone' => ['required', ...$phone],
            'business_location' => ['required', 'string', 'max:255'],
            'country' => ['required', 'string', 'max:100'],
            'currency' => ['required', 'string', 'size:3', 'alpha'],
            'terms' => ['accepted'],
            // Anything that tries to pick its own access or tenant is rejected outright.
            'role' => ['prohibited'],
            'is_active' => ['prohibited'],
            'branch_ids' => ['prohibited'],
            'bookshop_id' => ['prohibited'],
            'status' => ['prohibited'],
            'owner_user_id' => ['prohibited'],
            'permissions' => ['prohibited'],
        ];
    }

    public function messages(): array
    {
        return [
            'email.unique' => 'An account with this email address already exists. Sign in or reset your password instead.',
            'phone.regex' => 'Enter a valid phone number.',
            'business_phone.regex' => 'Enter a valid phone number.',
            'terms.accepted' => 'You need to accept the terms of use to register a bookshop.',
            'currency.size' => 'Use a three-letter currency code such as KES.',
            '*.prohibited' => 'This field cannot be set when registering.',
        ];
    }
}
