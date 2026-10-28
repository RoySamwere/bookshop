<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\User;
use App\Support\Roles;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

class AuthenticationTest extends TestCase
{
    use RefreshDatabase;

    public function test_passwords_are_stored_hashed(): void
    {
        $user = User::factory()->create(['password' => 'plain-text-secret']);

        $this->assertNotSame('plain-text-secret', $user->getRawOriginal('password'));
        $this->assertTrue(Hash::check('plain-text-secret', $user->password));
    }

    public function test_deactivated_accounts_cannot_sign_in_and_lose_existing_sessions(): void
    {
        $branch = Branch::factory()->main()->create();
        $owner = User::factory()->create(['role' => Roles::SYSTEM_OWNER]);
        $cashier = User::factory()->inBranches($branch)->create(['role' => Roles::CASHIER]);
        $token = $cashier->createToken('till')->plainTextToken;

        $this->actingAs($owner, 'sanctum')->patchJson("/api/users/{$cashier->id}/status", ['is_active' => false])
            ->assertOk()->assertJsonPath('data.is_active', false);
        $this->assertSame(0, $cashier->tokens()->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'user.deactivated', 'subject_id' => $cashier->id]);

        $this->app['auth']->forgetGuards();
        $this->postJson('/api/auth/login', ['email' => $cashier->email, 'password' => 'password'])
            ->assertForbidden()->assertJsonPath('message', 'Your account has been deactivated. Contact your administrator.');
        $this->withToken($token)->getJson('/api/auth/me')->assertUnauthorized();

        $this->actingAs($owner, 'sanctum')->patchJson("/api/users/{$cashier->id}/status", ['is_active' => true])->assertOk();
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/auth/login', ['email' => $cashier->email, 'password' => 'password'])->assertOk();
    }

    public function test_a_token_for_an_account_deactivated_directly_in_the_database_stops_working(): void
    {
        $user = User::factory()->create(['role' => Roles::CASHIER]);
        $token = $user->createToken('till')->plainTextToken;
        $user->forceFill(['is_active' => false])->save();

        $this->withToken($token)->getJson('/api/auth/me')->assertForbidden();
        $this->assertSame(0, $user->tokens()->count());
    }

    public function test_users_can_update_their_profile(): void
    {
        $user = User::factory()->create(['role' => Roles::CASHIER]);

        $this->actingAs($user, 'sanctum')->patchJson('/api/auth/profile', ['name' => 'Mary W.', 'phone' => '+254 700 000 001'])
            ->assertOk()->assertJsonPath('data.name', 'Mary W.')->assertJsonPath('data.phone', '+254 700 000 001');
        $this->patchJson('/api/auth/profile', ['role' => Roles::SYSTEM_OWNER])->assertOk();
        $this->assertSame(Roles::CASHIER, $user->fresh()->role);
    }

    public function test_change_password_requires_the_current_password_and_signs_out_other_devices(): void
    {
        $user = User::factory()->create(['role' => Roles::CASHIER]);
        $current = $user->createToken('this-device')->plainTextToken;
        $user->createToken('other-device');

        $this->withToken($current)->putJson('/api/auth/password', [
            'current_password' => 'wrong', 'password' => 'New-password-1', 'password_confirmation' => 'New-password-1',
        ])->assertUnprocessable()->assertJsonValidationErrors('current_password');

        $this->withToken($current)->putJson('/api/auth/password', [
            'current_password' => 'password', 'password' => 'New-password-1', 'password_confirmation' => 'New-password-1',
        ])->assertOk();

        $this->assertTrue(Hash::check('New-password-1', $user->fresh()->password));
        $this->assertSame(1, $user->tokens()->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.password_changed', 'user_id' => $user->id]);
    }

    public function test_forgot_and_reset_password_flow(): void
    {
        Notification::fake();
        $user = User::factory()->create(['role' => Roles::CASHIER]);
        $user->createToken('old-session');

        $this->postJson('/api/auth/forgot-password', ['email' => 'nobody@example.test'])->assertOk();
        $this->postJson('/api/auth/forgot-password', ['email' => $user->email])->assertOk();

        $token = null;
        Notification::assertSentTo($user, ResetPassword::class, function (ResetPassword $notification) use ($user, &$token) {
            $token = $notification->token;
            $url = $notification->toMail($user)->actionUrl;

            return str_starts_with($url, config('app.frontend_url').'/reset-password?token=');
        });

        $this->postJson('/api/auth/reset-password', [
            'token' => 'invalid', 'email' => $user->email, 'password' => 'Brand-new-pass1', 'password_confirmation' => 'Brand-new-pass1',
        ])->assertUnprocessable();

        $this->postJson('/api/auth/reset-password', [
            'token' => $token, 'email' => $user->email, 'password' => 'Brand-new-pass1', 'password_confirmation' => 'Brand-new-pass1',
        ])->assertOk();

        $this->assertTrue(Hash::check('Brand-new-pass1', $user->fresh()->password));
        $this->assertSame(0, $user->tokens()->count());
        $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'Brand-new-pass1'])->assertOk();
    }

    public function test_deactivated_accounts_do_not_receive_reset_links(): void
    {
        Notification::fake();
        $user = User::factory()->create(['is_active' => false]);

        $this->postJson('/api/auth/forgot-password', ['email' => $user->email])->assertOk();
        Notification::assertNothingSent();
    }

    public function test_admin_can_reset_a_team_members_password(): void
    {
        $branch = Branch::factory()->main()->create();
        $admin = User::factory()->inBranches($branch)->create(['role' => Roles::ADMIN]);
        $cashier = User::factory()->inBranches($branch)->create(['role' => Roles::CASHIER]);
        $cashier->createToken('till');

        $this->actingAs($admin, 'sanctum')->postJson("/api/users/{$cashier->id}/reset-password", [
            'password' => 'Temporary-pass1', 'password_confirmation' => 'Temporary-pass1',
        ])->assertOk();

        $this->assertTrue(Hash::check('Temporary-pass1', $cashier->fresh()->password));
        $this->assertSame(0, $cashier->tokens()->count());
        $this->assertSame(1, $cashier->unreadNotifications()->count());
    }

    public function test_login_is_rate_limited_per_account_not_per_shop(): void
    {
        $locked = User::factory()->create(['role' => Roles::CASHIER]);
        $colleague = User::factory()->create(['role' => Roles::CASHIER]);

        for ($attempt = 0; $attempt < 5; $attempt++) {
            $this->postJson('/api/auth/login', ['email' => $locked->email, 'password' => 'wrong'])->assertUnprocessable();
        }
        $this->postJson('/api/auth/login', ['email' => $locked->email, 'password' => 'password'])->assertTooManyRequests();
        // Another till on the same shop IP can still sign in.
        $this->postJson('/api/auth/login', ['email' => $colleague->email, 'password' => 'password'])->assertOk();
    }

    public function test_tokens_expire_after_the_configured_lifetime(): void
    {
        config(['sanctum.expiration' => 60]);
        $user = User::factory()->create(['role' => Roles::CASHIER]);
        $token = $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'password'])->json('data.token');

        $this->travel(61)->minutes();
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/auth/me')->assertUnauthorized();
    }
}
