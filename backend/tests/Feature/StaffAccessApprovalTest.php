<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\LaunchSubscriber;
use App\Models\User;
use App\Notifications\StaffAccessDecision;
use App\Support\Roles;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

class StaffAccessApprovalTest extends TestCase
{
    use RefreshDatabase;

    private Branch $main;
    private Branch $westlands;
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        $this->main = Branch::factory()->main()->create(['code' => 'MAIN']);
        $this->westlands = Branch::factory()->create(['code' => 'WEST']);
        $this->owner = User::factory()->create(['role' => Roles::SYSTEM_OWNER]);
    }

    private function applicant(array $attributes = []): User
    {
        return User::factory()->create([
            'role' => Roles::CUSTOMER,
            'registration_source' => User::SOURCE_PUBLIC,
            'staff_access_status' => User::ACCESS_PENDING,
            'staff_access_requested_at' => now(),
            ...$attributes,
        ]);
    }

    public function test_pending_registrations_are_listed_with_status_details(): void
    {
        $applicant = $this->applicant();
        User::factory()->unverified()->create(['role' => Roles::CUSTOMER]);

        $this->actingAs($this->owner, 'sanctum');
        $response = $this->getJson('/api/users?status=pending')->assertOk()->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $applicant->id)
            ->assertJsonPath('data.0.staff_access_status', 'pending')
            ->assertJsonPath('data.0.email_verified', true)
            ->assertJsonPath('data.0.registration_source', 'public')
            ->assertJsonPath('data.0.can_review', true);
        $this->assertNotNull($response->json('data.0.created_at'));
        $this->getJson('/api/users')->assertJsonPath('counts.pending', 1)->assertJsonPath('counts.unverified', 1);
        $this->getJson('/api/users?status=unverified')->assertJsonCount(1, 'data');
    }

    public function test_owner_approves_a_request_with_a_role_and_branches(): void
    {
        Notification::fake();
        $applicant = $this->applicant();
        $applicant->createToken('customer-session');

        $this->actingAs($this->owner, 'sanctum')->postJson("/api/users/{$applicant->id}/approve", [
            'role' => Roles::CASHIER, 'branch_ids' => [$this->westlands->id],
        ])->assertOk()->assertJsonPath('data.role', Roles::CASHIER)->assertJsonPath('data.staff_access_status', 'approved');

        $applicant->refresh();
        $this->assertTrue($applicant->canAccessWorkspace());
        $this->assertSame([$this->westlands->id], $applicant->branches()->pluck('branches.id')->all());
        $this->assertSame($this->owner->id, $applicant->staff_access_reviewed_by);
        $this->assertSame(0, $applicant->tokens()->count(), 'the customer session is revoked');
        $this->assertDatabaseHas('audit_logs', ['action' => 'user.staff_access_approved', 'subject_id' => $applicant->id, 'user_id' => $this->owner->id]);
        Notification::assertSentTo($applicant, StaffAccessDecision::class);

        // The new staff member signs in to the workspace.
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/auth/login', ['email' => $applicant->email, 'password' => 'password'])
            ->assertOk()->assertJsonPath('data.user.permissions', Roles::permissionsFor(Roles::CASHIER));
    }

    public function test_approval_requires_a_verified_email_and_valid_choices(): void
    {
        $unverified = $this->applicant(['email_verified_at' => null]);
        $this->actingAs($this->owner, 'sanctum');

        $this->postJson("/api/users/{$unverified->id}/approve", ['role' => Roles::CASHIER, 'branch_ids' => [$this->main->id]])
            ->assertUnprocessable();
        $this->assertSame(Roles::CUSTOMER, $unverified->fresh()->role);

        $applicant = $this->applicant();
        $this->postJson("/api/users/{$applicant->id}/approve", ['role' => Roles::SYSTEM_OWNER, 'branch_ids' => [$this->main->id]])
            ->assertUnprocessable()->assertJsonValidationErrors('role');
        $this->postJson("/api/users/{$applicant->id}/approve", ['role' => Roles::CUSTOMER, 'branch_ids' => [$this->main->id]])
            ->assertUnprocessable()->assertJsonValidationErrors('role');
        $this->postJson("/api/users/{$applicant->id}/approve", ['role' => Roles::CASHIER, 'branch_ids' => []])
            ->assertUnprocessable()->assertJsonValidationErrors('branch_ids');
        $this->assertSame(Roles::CUSTOMER, $applicant->fresh()->role);
    }

    public function test_admins_review_within_their_assignable_roles_and_branches(): void
    {
        Notification::fake();
        $admin = User::factory()->inBranches($this->main)->create(['role' => Roles::ADMIN]);
        $applicant = $this->applicant();
        $this->actingAs($admin, 'sanctum');

        $this->postJson("/api/users/{$applicant->id}/approve", ['role' => Roles::ADMIN, 'branch_ids' => [$this->main->id]])
            ->assertUnprocessable()->assertJsonValidationErrors('role');
        $this->postJson("/api/users/{$applicant->id}/approve", ['role' => Roles::CASHIER, 'branch_ids' => [$this->westlands->id]])
            ->assertUnprocessable()->assertJsonValidationErrors('branch_ids.0');
        $this->postJson("/api/users/{$applicant->id}/approve", ['role' => Roles::INVENTORY_OFFICER, 'branch_ids' => [$this->main->id]])
            ->assertOk();
    }

    public function test_staff_without_user_management_cannot_review_requests(): void
    {
        $applicant = $this->applicant();
        foreach ([Roles::STORE_MANAGER, Roles::CASHIER, Roles::CUSTOMER] as $role) {
            $caller = User::factory()->inBranches($this->main)->create(['role' => $role]);
            $this->actingAs($caller, 'sanctum');
            $this->postJson("/api/users/{$applicant->id}/approve", ['role' => Roles::CASHIER, 'branch_ids' => [$this->main->id]])->assertForbidden();
            $this->postJson("/api/users/{$applicant->id}/reject")->assertForbidden();
        }
        $this->assertTrue($applicant->fresh()->hasPendingStaffRequest());
    }

    public function test_reject_keeps_the_customer_account_and_records_the_reason(): void
    {
        Notification::fake();
        $applicant = $this->applicant();

        $this->actingAs($this->owner, 'sanctum')->postJson("/api/users/{$applicant->id}/reject", ['note' => 'Please apply through HR.'])
            ->assertOk()->assertJsonPath('data.staff_access_status', 'rejected');

        $applicant->refresh();
        $this->assertSame(Roles::CUSTOMER, $applicant->role);
        $this->assertTrue($applicant->is_active);
        $this->assertSame('Please apply through HR.', $applicant->staff_access_note);
        Notification::assertSentTo($applicant, StaffAccessDecision::class);

        // A decided request cannot be approved afterwards without a new request.
        $this->postJson("/api/users/{$applicant->id}/approve", ['role' => Roles::CASHIER, 'branch_ids' => [$this->main->id]])->assertForbidden();

        // The applicant sees the outcome when they sign in.
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/auth/login', ['email' => $applicant->email, 'password' => 'password'])
            ->assertOk()->assertJsonPath('data.user.staff_access_status', 'rejected')
            ->assertJsonPath('data.user.staff_access_note', 'Please apply through HR.');
    }

    public function test_accounts_can_be_deactivated_and_reactivated(): void
    {
        $customer = User::factory()->create(['role' => Roles::CUSTOMER]);
        $token = $customer->createToken('web')->plainTextToken;

        $this->actingAs($this->owner, 'sanctum')->patchJson("/api/users/{$customer->id}/status", ['is_active' => false])->assertOk();
        $this->app['auth']->forgetGuards();
        $this->withToken($token)->getJson('/api/auth/me')->assertUnauthorized();
        $this->postJson('/api/auth/login', ['email' => $customer->email, 'password' => 'password'])->assertForbidden();

        $this->actingAs($this->owner, 'sanctum')->patchJson("/api/users/{$customer->id}/status", ['is_active' => true])->assertOk();
        $this->app['auth']->forgetGuards();
        $this->postJson('/api/auth/login', ['email' => $customer->email, 'password' => 'password'])->assertOk();
    }

    public function test_managers_can_resend_verification_emails(): void
    {
        Notification::fake();
        $unverified = $this->applicant(['email_verified_at' => null]);
        $verified = $this->applicant();
        $this->actingAs($this->owner, 'sanctum');

        $this->postJson("/api/users/{$unverified->id}/resend-verification")->assertOk();
        Notification::assertSentTo($unverified, VerifyEmail::class);
        $this->postJson("/api/users/{$verified->id}/resend-verification")->assertUnprocessable();

        $cashier = User::factory()->inBranches($this->main)->create(['role' => Roles::CASHIER]);
        $this->actingAs($cashier, 'sanctum')->postJson("/api/users/{$unverified->id}/resend-verification")->assertForbidden();
    }

    public function test_account_history_requires_audit_access(): void
    {
        Notification::fake();
        $applicant = $this->applicant();
        $this->actingAs($this->owner, 'sanctum')->postJson("/api/users/{$applicant->id}/reject")->assertOk();

        $this->getJson("/api/users/{$applicant->id}/audit-logs")->assertOk()
            ->assertJsonPath('data.0.action', 'user.staff_access_rejected');

        $manager = User::factory()->inBranches($this->main)->create(['role' => Roles::STORE_MANAGER]);
        $this->actingAs($manager, 'sanctum')->getJson("/api/users/{$applicant->id}/audit-logs")->assertForbidden();
    }

    public function test_launch_signup_is_stored_once_and_answers_the_same_way(): void
    {
        $first = $this->postJson('/api/public/launch-subscribers', ['email' => 'Reader@Example.test'])->assertOk()->json('message');
        $second = $this->postJson('/api/public/launch-subscribers', ['email' => 'reader@example.test'])->assertOk()->json('message');

        $this->assertSame($first, $second);
        $this->assertSame(1, LaunchSubscriber::count());
        $this->assertSame('reader@example.test', LaunchSubscriber::first()->email);

        $this->postJson('/api/public/launch-subscribers', ['email' => 'nope'])->assertUnprocessable();
        $this->postJson('/api/public/launch-subscribers', ['email' => 'bot@example.test', 'website' => 'spam.example'])->assertOk();
        $this->assertSame(1, LaunchSubscriber::count());

        $this->actingAs($this->owner, 'sanctum')->getJson('/api/launch-subscribers')->assertOk()->assertJsonPath('meta.total', 1);
        $cashier = User::factory()->inBranches($this->main)->create(['role' => Roles::CASHIER]);
        $this->actingAs($cashier, 'sanctum')->getJson('/api/launch-subscribers')->assertForbidden();
    }

    public function test_guests_cannot_reach_management_endpoints(): void
    {
        $applicant = $this->applicant();
        $this->getJson('/api/users')->assertUnauthorized();
        $this->postJson("/api/users/{$applicant->id}/approve")->assertUnauthorized();
        $this->getJson('/api/launch-subscribers')->assertUnauthorized();
    }
}
