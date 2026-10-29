<?php

namespace Database\Factories;

use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<\App\Models\Branch> */
class BranchFactory extends Factory
{
    public function definition(): array
    {
        return [
            'name' => fake()->city().' Shop',
            'code' => strtoupper(fake()->unique()->bothify('BR-###')),
            'city' => fake()->city(),
            'is_active' => true,
            'bookshop_id' => fn () => BookshopFactory::defaultId(),
        ];
    }

    public function main(): static
    {
        return $this->afterMaking(fn ($branch) => $branch->is_main = true);
    }
}
