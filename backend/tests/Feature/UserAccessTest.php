<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\User;
use App\Support\Roles;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class UserAccessTest extends TestCase
{
    use RefreshDatabase;

    private Branch $main;
    private Branch $westlands;

    protected function setUp(): void
    {
        parent::setUp();
        $this->main = Branch::factory()->main()->create(['code' => 'MAIN']);
        $this->westlands = Branch::factory()->create(['code' => 'WEST']);
    }

    public static function roles(): array
    {
        return array_map(fn ($role) => [$role], Roles::all());
    }

    #[DataProvider('roles')]
    public function test_every_role_can_sign_in_restore_the_session_and_sign_out(string $role): void
    {
        $user = User::factory()->inBranches($this->main)->create(['role' => $role]);

        $response = $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'password']);
        $response->assertOk()->assertJsonPath('data.user.role', $role)
            ->assertJsonPath('data.user.permissions', Roles::permissionsFor($role));
        $token = $response->json('data.token');

        $this->withToken($token)->getJson('/api/auth/me')->assertOk()
            ->assertJsonPath('data.assignable_roles', Roles::assignableBy($role))
            ->assertJsonPath('data.branches.0.code', 'MAIN');
        $this->assertNotNull($user->fresh()->last_login_at);

        $this->withToken($token)->postJson('/api/auth/logout')->assertOk();
        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_customers_cannot_reach_workspace_endpoints(): void
    {
        $customer = User::factory()->create(['role' => Roles::CUSTOMER]);
        $this->actingAs($customer, 'sanctum');

        $this->getJson('/api/auth/me')->assertOk();
        $this->getJson('/api/business')->assertForbidden();
        $this->getJson('/api/users')->assertForbidden();
        $this->getJson('/api/branches')->assertForbidden();
    }

    public function test_unknown_roles_are_denied_even_with_an_existing_token(): void
    {
        $user = User::factory()->create(['role' => 'unknown']);
        $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'password'])->assertForbidden();

        $token = $user->createToken('old-session')->plainTextToken;
        $this->withToken($token)->getJson('/api/auth/me')->assertForbidden();
    }

    public function test_guests_get_json_401_even_without_an_accept_header(): void
    {
        $this->get('/api/users')->assertUnauthorized()->assertJson(['message' => 'Unauthenticated.']);
        $this->get('/api/auth/me')->assertUnauthorized();
    }

    public function test_invalid_credentials_are_rejected_and_audited(): void
    {
        $user = User::factory()->create(['role' => Roles::ADMIN]);
        $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'incorrect'])
            ->assertUnprocessable()->assertJsonValidationErrors('email');

        $this->assertDatabaseCount('personal_access_tokens', 0);
        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.login_failed', 'subject_id' => $user->id]);
    }

    public function test_owner_creates_staff_with_branches_and_the_action_is_audited(): void
    {
        $owner = User::factory()->create(['role' => Roles::SYSTEM_OWNER]);
        $this->actingAs($owner, 'sanctum');

        $response = $this->postJson('/api/users', $this->newUser(Roles::STORE_MANAGER, [$this->westlands->id]));
        $response->assertCreated()->assertJsonPath('data.role', Roles::STORE_MANAGER)
            ->assertJsonPath('data.branches.0.code', 'WEST');

        $id = $response->json('data.id');
        $this->assertDatabaseHas('branch_user', ['user_id' => $id, 'branch_id' => $this->westlands->id]);
        $this->assertDatabaseHas('audit_logs', ['action' => 'user.created', 'subject_id' => $id, 'user_id' => $owner->id]);
    }

    public function test_staff_roles_require_a_branch_but_customers_do_not(): void
    {
        $this->actingAs(User::factory()->create(['role' => Roles::SYSTEM_OWNER]), 'sanctum');

        $this->postJson('/api/users', $this->newUser(Roles::CASHIER, []))
            ->assertUnprocessable()->assertJsonValidationErrors('branch_ids');
        $this->postJson('/api/users', $this->newUser(Roles::CUSTOMER, [$this->main->id]))
            ->assertCreated()->assertJsonPath('data.branches', []);
    }

    public function test_admin_is_limited_to_their_branches_and_assignable_roles(): void
    {
        $admin = User::factory()->inBranches($this->main)->create(['role' => Roles::ADMIN]);
        $mainCashier = User::factory()->inBranches($this->main)->create(['role' => Roles::CASHIER]);
        $westCashier = User::factory()->inBranches($this->westlands)->create(['role' => Roles::CASHIER]);
        $otherAdmin = User::factory()->inBranches($this->main)->create(['role' => Roles::ADMIN]);
        $this->actingAs($admin, 'sanctum');

        $this->postJson('/api/users', $this->newUser(Roles::ADMIN, [$this->main->id]))->assertUnprocessable()->assertJsonValidationErrors('role');
        $this->postJson('/api/users', $this->newUser(Roles::SYSTEM_OWNER, [$this->main->id]))->assertUnprocessable();
        $this->postJson('/api/users', $this->newUser(Roles::CASHIER, [$this->westlands->id]))
            ->assertUnprocessable()->assertJsonValidationErrors('branch_ids.0');

        $ids = collect($this->getJson('/api/users')->assertOk()->json('data'))->pluck('id');
        $this->assertTrue($ids->contains($mainCashier->id));
        $this->assertFalse($ids->contains($westCashier->id));
        $this->assertFalse($ids->contains($otherAdmin->id));

        $this->patchJson("/api/users/{$mainCashier->id}", ['name' => 'Renamed'])->assertOk()->assertJsonPath('data.name', 'Renamed');
        $this->patchJson("/api/users/{$westCashier->id}", ['name' => 'Nope'])->assertForbidden();
        $this->patchJson("/api/users/{$otherAdmin->id}/status", ['is_active' => false])->assertForbidden();
        $this->deleteJson("/api/users/{$westCashier->id}")->assertForbidden();
    }

    public function test_admin_branch_edits_keep_branches_outside_their_reach(): void
    {
        $admin = User::factory()->inBranches($this->main)->create(['role' => Roles::ADMIN]);
        $shared = User::factory()->inBranches($this->main, $this->westlands)->create(['role' => Roles::CASHIER]);
        $this->actingAs($admin, 'sanctum');

        $this->patchJson("/api/users/{$shared->id}", ['branch_ids' => [$this->main->id]])->assertOk();
        $this->assertEqualsCanonicalizing([$this->main->id, $this->westlands->id], $shared->branches()->pluck('branches.id')->all());
    }

    public function test_store_manager_can_view_but_not_manage_users(): void
    {
        $manager = User::factory()->inBranches($this->main)->create(['role' => Roles::STORE_MANAGER]);
        $cashier = User::factory()->inBranches($this->main)->create(['role' => Roles::CASHIER]);
        $this->actingAs($manager, 'sanctum');

        $this->getJson('/api/users')->assertOk()->assertJsonPath('data.0.id', $cashier->id)->assertJsonPath('data.0.can_manage', false);
        $this->postJson('/api/users', $this->newUser(Roles::CASHIER, [$this->main->id]))->assertForbidden();
        $this->patchJson("/api/users/{$cashier->id}/status", ['is_active' => false])->assertForbidden();
    }

    public function test_cashiers_and_inventory_officers_cannot_view_users(): void
    {
        foreach ([Roles::CASHIER, Roles::INVENTORY_OFFICER] as $role) {
            $this->actingAs(User::factory()->inBranches($this->main)->create(['role' => $role]), 'sanctum');
            $this->getJson('/api/users')->assertForbidden();
            $this->getJson('/api/roles')->assertForbidden();
        }
    }

    public function test_role_change_revokes_sessions_and_notifies_the_user(): void
    {
        $owner = User::factory()->create(['role' => Roles::SYSTEM_OWNER]);
        $cashier = User::factory()->inBranches($this->main)->create(['role' => Roles::CASHIER]);
        $cashier->createToken('existing-session');
        $this->actingAs($owner, 'sanctum');

        $this->patchJson("/api/users/{$cashier->id}", ['role' => Roles::STORE_MANAGER])->assertOk()->assertJsonPath('data.role', Roles::STORE_MANAGER);
        $this->assertSame(0, $cashier->tokens()->count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'user.role_changed', 'subject_id' => $cashier->id]);
        $this->assertSame(1, $cashier->notifications()->count());
    }

    public function test_owner_accounts_and_self_are_protected(): void
    {
        $owner = User::factory()->create(['role' => Roles::SYSTEM_OWNER]);
        $otherOwner = User::factory()->create(['role' => Roles::SYSTEM_OWNER]);
        $this->actingAs($owner, 'sanctum');

        $this->postJson('/api/users', $this->newUser(Roles::SYSTEM_OWNER, []))->assertUnprocessable();
        $this->patchJson("/api/users/{$otherOwner->id}", ['role' => Roles::CASHIER])->assertForbidden();
        $this->patchJson("/api/users/{$owner->id}/status", ['is_active' => false])->assertStatus(422);
        $this->deleteJson("/api/users/{$owner->id}")->assertStatus(422);
        $this->deleteJson("/api/users/{$otherOwner->id}")->assertStatus(422);
    }

    public function test_users_can_be_searched_and_filtered(): void
    {
        $this->actingAs(User::factory()->create(['role' => Roles::SYSTEM_OWNER]), 'sanctum');
        User::factory()->inBranches($this->main)->create(['role' => Roles::CASHIER, 'name' => 'Jane Muthoni']);
        User::factory()->inBranches($this->westlands)->create(['role' => Roles::INVENTORY_OFFICER, 'is_active' => false]);

        $this->getJson('/api/users?search=muthoni')->assertOk()->assertJsonCount(1, 'data')->assertJsonPath('data.0.name', 'Jane Muthoni');
        $this->getJson('/api/users?role=inventory_officer')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/users?status=inactive')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson("/api/users?branch_id={$this->westlands->id}")->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/users')->assertOk()->assertJsonStructure(['data', 'meta' => ['total', 'current_page'], 'links'])
            ->assertJsonPath('counts', ['active' => 1, 'inactive' => 1, 'pending' => 0, 'unverified' => 0]);
        $this->getJson('/api/users?status=inactive')->assertJsonPath('counts.active', 1);
    }

    public function test_roles_endpoint_marks_what_the_caller_can_assign(): void
    {
        $this->actingAs(User::factory()->inBranches($this->main)->create(['role' => Roles::ADMIN]), 'sanctum');

        $roles = collect($this->getJson('/api/roles')->assertOk()->json('data'))->keyBy('value');
        $this->assertCount(6, $roles);
        $this->assertTrue($roles['cashier']['assignable']);
        $this->assertFalse($roles['admin']['assignable']);
        $this->assertFalse($roles['system_owner']['assignable']);
    }

    private function newUser(string $role, array $branchIds): array
    {
        return [
            'name' => 'Shop User',
            'email' => 'new-user@example.test',
            'phone' => '+254 712 345 678',
            'password' => 'A-secure-passw0rd',
            'password_confirmation' => 'A-secure-passw0rd',
            'role' => $role,
            'branch_ids' => $branchIds,
        ];
    }
}
