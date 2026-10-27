<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class UserAccessTest extends TestCase
{
    use RefreshDatabase;

    public static function roles(): array
    {
        return [['system_owner'], ['admin'], ['user'], ['staff']];
    }

    #[DataProvider('roles')]
    public function test_all_workspace_roles_can_sign_in_and_restore_their_session(string $role): void
    {
        $user = User::factory()->create(['role' => $role]);
        $response = $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'password']);
        $response->assertOk()->assertJsonPath('user.role', $role)
            ->assertJsonPath('user.permissions', $user->permissions());
        $token = $response->json('token');

        $this->withToken($token)->getJson('/api/auth/me')->assertOk()
            ->assertJsonPath('user.permissions', $user->permissions())
            ->assertJsonPath('user.assignable_roles', $user->assignableRoles());
        $this->withToken($token)->postJson('/api/auth/logout')->assertOk();
        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_unknown_roles_are_denied_even_with_an_existing_token(): void
    {
        $user = User::factory()->create(['role' => 'unknown']);
        $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'password'])->assertForbidden();
        $token = $user->createToken('old-session')->plainTextToken;
        $this->withToken($token)->getJson('/api/auth/me')->assertForbidden();
        $this->withToken($token)->getJson('/api/users')->assertForbidden();
    }

    public function test_guests_and_invalid_credentials_are_denied(): void
    {
        $user = User::factory()->create(['role' => 'admin']);
        $this->getJson('/api/users')->assertUnauthorized();
        $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'incorrect'])->assertUnprocessable();
        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_admin_can_create_list_and_delete_their_own_users(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $other = User::factory()->create(['role' => 'user']);
        $response = $this->actingAs($admin, 'sanctum')->postJson('/api/users', $this->newUser('user'));
        $response->assertCreated();
        $id = $response->json('user.id');
        $this->assertDatabaseHas('users', ['id' => $id, 'created_by' => $admin->id]);
        $this->getJson('/api/users')->assertOk()->assertJsonCount(1, 'users')->assertJsonPath('users.0.id', $id);
        $this->deleteJson('/api/users/'.$other->id)->assertForbidden();
        $this->deleteJson('/api/users/'.$id)->assertOk();
        $this->assertDatabaseMissing('users', ['id' => $id]);
    }

    public function test_admin_cannot_escalate_roles_or_manage_an_account_promoted_to_admin(): void
    {
        $admin = User::factory()->create(['role' => 'admin']);
        $promoted = User::factory()->create(['role' => 'admin', 'created_by' => $admin->id]);
        $this->actingAs($admin, 'sanctum');
        $this->postJson('/api/users', $this->newUser('admin'))->assertUnprocessable();
        $this->postJson('/api/users', $this->newUser('system_owner'))->assertUnprocessable();
        $this->patchJson('/api/users/'.$promoted->id.'/role', ['role' => 'user'])->assertForbidden();
        $this->deleteJson('/api/users/'.$promoted->id)->assertForbidden();
        $this->getJson('/api/users')->assertOk()->assertJsonCount(0, 'users');
    }

    public function test_standard_users_cannot_manage_accounts(): void
    {
        $target = User::factory()->create(['role' => 'user']);
        foreach (['user', 'staff'] as $role) {
            $user = User::factory()->create(['role' => $role]);
            $this->actingAs($user, 'sanctum');
            $this->getJson('/api/users')->assertForbidden();
            $this->postJson('/api/users', $this->newUser('user'))->assertForbidden();
            $this->patchJson('/api/users/'.$target->id.'/role', ['role' => 'admin'])->assertForbidden();
            $this->deleteJson('/api/users/'.$target->id)->assertForbidden();
        }
    }

    public function test_owner_can_assign_roles_but_owner_accounts_are_protected(): void
    {
        $owner = User::factory()->create(['role' => 'system_owner']);
        $otherOwner = User::factory()->create(['role' => 'system_owner']);
        $target = User::factory()->create(['role' => 'user']);
        $target->createToken('existing-session');
        $this->actingAs($owner, 'sanctum');
        $this->postJson('/api/users', $this->newUser('admin'))->assertCreated();
        $this->getJson('/api/users')->assertOk()->assertJsonCount(3, 'users');
        $this->patchJson('/api/users/'.$target->id.'/role', ['role' => 'admin'])->assertOk()->assertJsonPath('user.role', 'admin');
        $this->assertSame(0, $target->tokens()->count());
        $this->patchJson('/api/users/'.$target->id.'/role', ['role' => 'user'])->assertOk();
        $this->patchJson('/api/users/'.$target->id.'/role', ['role' => 'system_owner'])->assertUnprocessable();
        $this->patchJson('/api/users/'.$owner->id.'/role', ['role' => 'user'])->assertUnprocessable();
        $this->patchJson('/api/users/'.$otherOwner->id.'/role', ['role' => 'user'])->assertUnprocessable();
        $this->deleteJson('/api/users/'.$owner->id)->assertUnprocessable();
        $this->deleteJson('/api/users/'.$otherOwner->id)->assertUnprocessable();
        $target->createToken('new-session');
        $this->deleteJson('/api/users/'.$target->id)->assertOk();
        $this->assertSame(0, $target->tokens()->count());
    }

    private function newUser(string $role): array
    {
        return [
            'name' => 'Shop User',
            'email' => 'new-user@example.test',
            'password' => 'a-secure-password',
            'password_confirmation' => 'a-secure-password',
            'role' => $role,
        ];
    }
}
