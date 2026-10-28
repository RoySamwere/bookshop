<?php

namespace App\Http\Requests;

use App\Models\User;
use App\Support\Roles;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\Validator;

/** Validates creating (POST /users) and editing (PATCH /users/{user}) accounts. */
class UserRequest extends FormRequest
{
    public function authorize(): bool
    {
        $target = $this->route('user');

        return ! $target || $this->user()->canManageUser($target);
    }

    public function rules(): array
    {
        /** @var User|null $target */
        $target = $this->route('user');
        $creating = $target === null;
        $caller = $this->user();

        return [
            'name' => [$creating ? 'required' : 'sometimes', 'string', 'max:255'],
            'email' => [$creating ? 'required' : 'sometimes', 'email', 'max:255', Rule::unique('users', 'email')->ignore($target?->id)],
            'phone' => ['nullable', 'string', 'max:30', 'regex:/^[0-9+()\s-]{7,30}$/'],
            'password' => $creating ? ['required', 'confirmed', Password::min(8)] : ['prohibited'],
            'role' => [$creating ? 'required' : 'sometimes', Rule::in($caller->assignableRoles())],
            'is_active' => ['sometimes', 'boolean'],
            'branch_ids' => ['sometimes', 'array'],
            'branch_ids.*' => ['integer', 'distinct', Rule::in($caller->branchIds())],
        ];
    }

    public function messages(): array
    {
        return [
            'role.in' => 'You cannot assign this role.',
            'branch_ids.*.in' => 'You can only assign branches you have access to.',
            'phone.regex' => 'Enter a valid phone number.',
        ];
    }

    public function after(): array
    {
        return [function (Validator $validator) {
            /** @var User|null $target */
            $target = $this->route('user');
            $role = $this->input('role', $target?->role);
            $branchIds = $this->input('branch_ids', $target ? $target->branches()->pluck('branches.id')->all() : []);

            if (in_array($role, Roles::BRANCH_ROLES, true) && empty($branchIds)) {
                $validator->errors()->add('branch_ids', 'Assign at least one branch to staff accounts.');
            }
        }];
    }

    /** Branch ids to sync, or null when unchanged; customers never belong to branches. */
    public function branchIds(): ?array
    {
        if (($this->input('role', $this->route('user')?->role)) === Roles::CUSTOMER) {
            return [];
        }

        return $this->has('branch_ids') ? array_map('intval', $this->input('branch_ids')) : null;
    }
}
