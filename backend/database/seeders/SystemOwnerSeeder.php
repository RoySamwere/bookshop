<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;
use RuntimeException;

class SystemOwnerSeeder extends Seeder
{
    public function run(): void
    {
        $email = env('SYSTEM_OWNER_EMAIL');
        $password = env('SYSTEM_OWNER_PASSWORD');
        $name = env('SYSTEM_OWNER_NAME', 'System Owner');

        if (! $email || ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new RuntimeException('Set a valid SYSTEM_OWNER_EMAIL in backend/.env.');
        }

        $user = User::where('email', $email)->first();

        if (! $user && (! $password || strlen($password) < 12)) {
            throw new RuntimeException('Set SYSTEM_OWNER_PASSWORD to at least 12 characters in backend/.env.');
        }

        if ($user && $user->role !== 'system_owner') {
            throw new RuntimeException('This email already belongs to a non-owner account. Choose another email.');
        }

        if (! $user) {
            $user = new User();
            $user->email = $email;
            $user->password = Hash::make($password);
        }

        $user->name = $name;
        $user->role = 'system_owner';
        $user->is_active = true;
        $user->email_verified_at ??= now();
        $user->save();
    }
}
