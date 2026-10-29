<?php

namespace Database\Factories;

use App\Models\User;
use App\Support\Roles;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * @extends Factory<User>
 */
class UserFactory extends Factory
{
    /**
     * The current password being used by the factory.
     */
    protected static ?string $password;

    /**
     * Define the model's default state.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'name' => fake()->name(),
            'email' => fake()->unique()->safeEmail(),
            'email_verified_at' => now(),
            'password' => static::$password ??= Hash::make('password'),
            'remember_token' => Str::random(10),
            'role' => 'cashier',
            'is_active' => true,
            // Bookshop accounts join the default test bookshop unless one is given; platform staff never belong to one.
            'bookshop_id' => fn (array $attributes) => Roles::isPlatform($attributes['role'] ?? null) ? null : BookshopFactory::defaultId(),
        ];
    }

    /** A member of the given bookshop. */
    public function forBookshop(\App\Models\Bookshop|int $bookshop): static
    {
        return $this->state(fn () => ['bookshop_id' => $bookshop instanceof \App\Models\Bookshop ? $bookshop->id : $bookshop]);
    }

    /** Staff account working in the given branches. */
    public function inBranches(\App\Models\Branch ...$branches): static
    {
        return $this->afterCreating(fn ($user) => $user->branches()->attach(collect($branches)->pluck('id')));
    }

    /**
     * Indicate that the model's email address should be unverified.
     */
    public function unverified(): static
    {
        return $this->state(fn (array $attributes) => [
            'email_verified_at' => null,
        ]);
    }
}
