<?php

namespace Database\Factories;

use App\Models\Bookshop;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/** @extends Factory<Bookshop> */
class BookshopFactory extends Factory
{
    public function definition(): array
    {
        $name = fake()->unique()->company().' Books';

        return [
            'name' => $name,
            'slug' => Str::slug($name).'-'.Str::lower(Str::random(4)),
            'business_email' => fake()->unique()->companyEmail(),
            'phone' => '+254 700 000 000',
            'location' => fake()->city(),
            'status' => Bookshop::STATUS_ACTIVE,
            'registered_at' => now(),
            'verified_at' => now(),
        ];
    }

    public function suspended(): static
    {
        return $this->state(fn () => ['status' => Bookshop::STATUS_SUSPENDED, 'suspended_at' => now(), 'suspension_reason' => 'Test suspension']);
    }

    public function pending(): static
    {
        return $this->state(fn () => ['status' => Bookshop::STATUS_PENDING, 'verified_at' => null]);
    }

    /** The bookshop existing single-shop tests run in when they do not name one. */
    public static function defaultId(): int
    {
        return Bookshop::query()->oldest('id')->value('id') ?? Bookshop::factory()->create()->id;
    }
}
