<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class SessionInactivityTest extends TestCase
{
    use RefreshDatabase;

    private function requestWithToken(string $token, string $path = '/api/auth/me', string $method = 'GET')
    {
        $this->app['auth']->forgetGuards();
        return $this->withToken($token)->json($method, $path);
    }

    public function test_session_is_revoked_at_exactly_ten_idle_minutes_even_when_remembered(): void
    {
        $user = User::factory()->create();
        $session = $user->createToken('bookshop-web-remembered', ['*'], now()->addDays(7));
        $this->travel(10)->minutes();

        $this->requestWithToken($session->plainTextToken)->assertUnauthorized()->assertJsonPath('reason', 'idle');
        $this->assertDatabaseMissing('personal_access_tokens', ['id' => $session->accessToken->id]);
    }

    public function test_user_activity_extends_the_session_but_background_reads_do_not(): void
    {
        $session = User::factory()->create()->createToken('web');
        $this->travel(9)->minutes();
        $this->requestWithToken($session->plainTextToken, '/api/auth/activity', 'POST')->assertNoContent();
        $this->travel(9)->minutes();
        $this->requestWithToken($session->plainTextToken)->assertOk();
        $this->travel(1)->minutes();
        $this->requestWithToken($session->plainTextToken)->assertUnauthorized()->assertJsonPath('reason', 'idle');
    }

    public function test_background_reads_cannot_keep_an_idle_session_alive(): void
    {
        $session = User::factory()->create()->createToken('web');
        $this->travel(9)->minutes();
        $this->requestWithToken($session->plainTextToken)->assertOk();
        $this->travel(1)->minutes();
        $this->requestWithToken($session->plainTextToken, '/api/auth/activity', 'POST')->assertUnauthorized();
        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_expiring_one_session_does_not_revoke_an_active_session_on_another_device(): void
    {
        $user = User::factory()->create();
        $old = $user->createToken('old');
        $this->travel(9)->minutes();
        $active = $user->createToken('active');
        $this->travel(1)->minutes();
        $this->requestWithToken($old->plainTextToken)->assertUnauthorized();
        $this->requestWithToken($active->plainTextToken)->assertOk();
        $this->assertDatabaseCount('personal_access_tokens', 1);
    }
}
