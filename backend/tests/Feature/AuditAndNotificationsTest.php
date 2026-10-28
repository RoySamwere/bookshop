<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\User;
use App\Notifications\AccountNotification;
use App\Support\Roles;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AuditAndNotificationsTest extends TestCase
{
    use RefreshDatabase;

    public function test_owner_sees_all_audit_entries_and_can_filter_them(): void
    {
        $owner = User::factory()->create(['role' => Roles::SYSTEM_OWNER]);
        AuditLog::record('user.created', 'Created Jane', actor: $owner);
        AuditLog::record('branch.created', 'Created Westlands', actor: $owner);

        $this->actingAs($owner, 'sanctum')->getJson('/api/audit-logs')->assertOk()
            ->assertJsonCount(2, 'data')->assertJsonPath('data.0.user.id', $owner->id);
        $this->getJson('/api/audit-logs?action=branch')->assertOk()->assertJsonCount(1, 'data');
        $this->getJson('/api/audit-logs?search=jane')->assertOk()->assertJsonCount(1, 'data');
    }

    public function test_admin_only_sees_activity_of_accounts_they_can_see(): void
    {
        $main = Branch::factory()->main()->create();
        $west = Branch::factory()->create();
        $admin = User::factory()->inBranches($main)->create(['role' => Roles::ADMIN]);
        $mainCashier = User::factory()->inBranches($main)->create(['role' => Roles::CASHIER]);
        $westCashier = User::factory()->inBranches($west)->create(['role' => Roles::CASHIER]);
        AuditLog::record('auth.login', 'Main cashier signed in', actor: $mainCashier);
        AuditLog::record('auth.login', 'West cashier signed in', actor: $westCashier);

        $this->actingAs($admin, 'sanctum')->getJson('/api/audit-logs')->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.description', 'Main cashier signed in');
    }

    public function test_roles_without_audit_access_are_denied(): void
    {
        foreach ([Roles::STORE_MANAGER, Roles::CASHIER, Roles::INVENTORY_OFFICER, Roles::CUSTOMER] as $role) {
            $this->actingAs(User::factory()->create(['role' => $role]), 'sanctum')->getJson('/api/audit-logs')->assertForbidden();
        }
    }

    public function test_users_read_and_clear_their_own_notifications(): void
    {
        $user = User::factory()->create(['role' => Roles::CASHIER]);
        $other = User::factory()->create(['role' => Roles::CASHIER]);
        $user->notify(new AccountNotification('First', 'Hello', 'info'));
        $user->notify(new AccountNotification('Second', 'Hello again', 'warning'));
        $other->notify(new AccountNotification('Private', 'Not yours'));
        $this->actingAs($user, 'sanctum');

        $response = $this->getJson('/api/notifications')->assertOk()->assertJsonCount(2, 'data')->assertJsonPath('meta.unread', 2);
        $first = $response->json('data.0.id');

        $this->postJson("/api/notifications/{$first}/read")->assertOk();
        $this->getJson('/api/notifications')->assertJsonPath('meta.unread', 1);
        $this->postJson('/api/notifications/'.$other->notifications()->first()->id.'/read')->assertNotFound();

        $this->postJson('/api/notifications/read-all')->assertOk();
        $this->getJson('/api/notifications')->assertJsonPath('meta.unread', 0);
    }

    public function test_owners_are_notified_when_an_admin_adds_a_team_member(): void
    {
        $main = Branch::factory()->main()->create();
        $owner = User::factory()->create(['role' => Roles::SYSTEM_OWNER]);
        $admin = User::factory()->inBranches($main)->create(['role' => Roles::ADMIN]);

        $this->actingAs($admin, 'sanctum')->postJson('/api/users', [
            'name' => 'New Cashier', 'email' => 'cashier@example.test', 'password' => 'A-secure-passw0rd',
            'password_confirmation' => 'A-secure-passw0rd', 'role' => Roles::CASHIER, 'branch_ids' => [$main->id],
        ])->assertCreated();

        $this->assertSame('New team member', $owner->notifications()->first()->data['title']);
    }
}
