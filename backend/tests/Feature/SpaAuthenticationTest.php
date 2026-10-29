<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\Roles;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SpaAuthenticationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withHeader('Origin', 'http://localhost:5173');
    }

    public function test_spa_login_uses_a_session_without_creating_or_returning_a_token(): void
    {
        $user = User::factory()->create(['role' => Roles::CASHIER]);
        $this->get('/sanctum/csrf-cookie')->assertNoContent()->assertCookie('XSRF-TOKEN');
        $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])
            ->assertOk()->assertJsonMissingPath('data.token')->assertJsonPath('data.user.id', $user->id);
        $this->assertAuthenticatedAs($user, 'web');
        $this->assertDatabaseCount('personal_access_tokens', 0);
        $this->getJson('/api/v1/auth/me')->assertOk()->assertJsonPath('data.id', $user->id);
        $this->postJson('/api/v1/auth/logout')->assertOk();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/auth/me')->assertUnauthorized();
    }

    public function test_spa_cookie_session_enforces_permissions_and_account_activation(): void
    {
        $user = User::factory()->create(['role' => Roles::CUSTOMER]);
        $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])->assertOk();
        $this->getJson('/api/v1/users')->assertForbidden();
        $user->forceFill(['is_active' => false])->save();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/auth/me')->assertForbidden();
    }

    public function test_background_requests_do_not_extend_cookie_session_inactivity(): void
    {
        $user = User::factory()->create();
        $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])->assertOk();
        $this->travel(9)->minutes();
        $this->getJson('/api/v1/auth/me')->assertOk();
        $this->travel(1)->minutes();
        $this->getJson('/api/v1/auth/me')->assertUnauthorized()->assertJsonPath('reason', 'idle');
    }

    public function test_activity_extends_the_cookie_session(): void
    {
        $user = User::factory()->create();
        $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])->assertOk();
        $this->travel(9)->minutes();
        $this->postJson('/api/v1/auth/activity')->assertNoContent();
        $this->travel(9)->minutes();
        $this->getJson('/api/v1/auth/me')->assertOk();
    }

    public function test_spa_can_change_password_with_a_transient_sanctum_token(): void
    {
        $user = User::factory()->create();
        $this->postJson('/api/v1/auth/login', ['email' => $user->email, 'password' => 'password'])->assertOk();
        $this->putJson('/api/v1/auth/password', [
            'current_password' => 'password', 'password' => 'Another-password-1', 'password_confirmation' => 'Another-password-1',
        ])->assertOk();
        $this->app['auth']->forgetGuards();
        $this->getJson('/api/v1/auth/me')->assertOk();
    }

    public function test_untrusted_origins_cannot_obtain_tokens_from_the_spa_login(): void
    {
        $user = User::factory()->create();
        $this->withHeader('Origin', 'https://untrusted.example')->postJson('/api/v1/auth/login', [
            'email' => $user->email, 'password' => 'password',
        ])->assertStatus(400);
        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_csrf_is_enforced_outside_laravel_test_bypass(): void
    {
        // Laravel skips CSRF in tests; change only the environment binding to exercise the middleware.
        $this->app->instance('env', 'local');
        $this->postJson('/api/v1/auth/login', ['email' => 'test@example.com', 'password' => 'password'])
            ->assertStatus(419);
    }
}
