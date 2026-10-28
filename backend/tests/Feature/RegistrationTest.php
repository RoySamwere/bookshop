<?php

namespace Tests\Feature;

use App\Models\AuditLog;
use App\Models\Branch;
use App\Models\User;
use App\Notifications\AccountNotification;
use App\Support\FrontendUrl;
use App\Support\Roles;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Notification;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

class RegistrationTest extends TestCase
{
    use RefreshDatabase;

    private const PASSWORD = 'Strong-pass1';

    private function payload(array $overrides = []): array
    {
        return [
            'name' => 'Amina Otieno',
            'email' => 'amina@example.test',
            'phone' => '+254 712 345 678',
            'password' => self::PASSWORD,
            'password_confirmation' => self::PASSWORD,
            'terms' => true,
            ...$overrides,
        ];
    }

    public function test_registration_creates_an_unverified_customer_with_a_hashed_password(): void
    {
        Notification::fake();

        $this->postJson('/api/auth/register', $this->payload(['email' => '  Amina@Example.TEST ']))
            ->assertCreated()
            ->assertJsonPath('data.email', 'amina@example.test')
            ->assertJsonPath('data.verification_email_sent', true)
            ->assertJsonMissingPath('data.token');

        $user = User::where('email', 'amina@example.test')->firstOrFail();
        $this->assertSame(Roles::CUSTOMER, $user->role);
        $this->assertTrue($user->is_active);
        $this->assertNull($user->email_verified_at);
        $this->assertNull($user->staff_access_status);
        $this->assertSame(User::SOURCE_PUBLIC, $user->registration_source);
        $this->assertNotNull($user->terms_accepted_at);
        $this->assertNotSame(self::PASSWORD, $user->getRawOriginal('password'));
        $this->assertTrue(Hash::check(self::PASSWORD, $user->password));
        $this->assertFalse($user->canAccessWorkspace());
        $this->assertDatabaseHas('audit_logs', ['action' => 'auth.registered', 'subject_id' => $user->id]);

        Notification::assertSentTo($user, VerifyEmail::class);
    }

    public function test_duplicate_emails_are_rejected_regardless_of_case(): void
    {
        User::factory()->create(['email' => 'amina@example.test']);

        $this->postJson('/api/auth/register', $this->payload(['email' => 'AMINA@example.test']))
            ->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->assertSame(1, User::count());
    }

    public static function invalidPayloads(): array
    {
        return [
            'missing name' => [['name' => ''], 'name'],
            'bad email' => [['email' => 'not-an-email'], 'email'],
            'bad phone' => [['phone' => 'call me'], 'phone'],
            'too short' => [['password' => 'Ab1!', 'password_confirmation' => 'Ab1!'], 'password'],
            'no symbol' => [['password' => 'Strongpass1', 'password_confirmation' => 'Strongpass1'], 'password'],
            'no uppercase' => [['password' => 'strong-pass1', 'password_confirmation' => 'strong-pass1'], 'password'],
            'no number' => [['password' => 'Strong-pass', 'password_confirmation' => 'Strong-pass'], 'password'],
            'mismatch' => [['password_confirmation' => 'Other-pass1'], 'password'],
            'terms not accepted' => [['terms' => false], 'terms'],
        ];
    }

    #[DataProvider('invalidPayloads')]
    public function test_registration_validates_input(array $overrides, string $field): void
    {
        $this->postJson('/api/auth/register', $this->payload($overrides))
            ->assertUnprocessable()->assertJsonValidationErrors($field);
        $this->assertSame(0, User::count());
    }

    public function test_phone_is_optional(): void
    {
        Notification::fake();
        $this->postJson('/api/auth/register', $this->payload(['phone' => '']))->assertCreated();
        $this->assertNull(User::firstOrFail()->phone);
    }

    public static function privilegeFields(): array
    {
        return [
            'role owner' => [['role' => Roles::SYSTEM_OWNER]],
            'role admin' => [['role' => Roles::ADMIN]],
            'is_active' => [['is_active' => true]],
            'branches' => [['branch_ids' => [1]]],
        ];
    }

    #[DataProvider('privilegeFields')]
    public function test_public_registration_cannot_create_privileged_users(array $extra): void
    {
        $this->postJson('/api/auth/register', $this->payload($extra))->assertUnprocessable();
        $this->assertSame(0, User::count());
    }

    public function test_requesting_staff_access_files_a_pending_request_without_granting_access(): void
    {
        Notification::fake();
        Branch::factory()->main()->create();
        $owner = User::factory()->create(['role' => Roles::SYSTEM_OWNER]);

        $this->postJson('/api/auth/register', $this->payload(['request_staff_access' => true]))
            ->assertCreated()->assertJsonPath('data.staff_access_status', User::ACCESS_PENDING);

        $user = User::where('email', 'amina@example.test')->firstOrFail();
        $this->assertSame(Roles::CUSTOMER, $user->role);
        $this->assertTrue($user->hasPendingStaffRequest());
        $this->assertFalse($user->canAccessWorkspace());
        Notification::assertSentTo($owner, AccountNotification::class);

        // A pending applicant can sign in but cannot reach any management endpoint.
        $token = $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => self::PASSWORD])
            ->assertOk()->assertJsonPath('data.user.staff_access_status', 'pending')
            ->assertJsonPath('data.user.permissions', ['storefront.access'])->json('data.token');
        $this->withToken($token)->getJson('/api/users')->assertForbidden();
        $this->withToken($token)->getJson('/api/business')->assertForbidden();
    }

    public function test_registration_is_rate_limited(): void
    {
        Notification::fake();
        foreach (range(1, 5) as $attempt) {
            $this->postJson('/api/auth/register', $this->payload(['email' => "user{$attempt}@example.test"]))->assertCreated();
        }
        $this->postJson('/api/auth/register', $this->payload(['email' => 'user6@example.test']))->assertTooManyRequests();
    }

    public function test_registration_still_succeeds_when_mail_cannot_be_sent(): void
    {
        config(['mail.default' => 'smtp', 'mail.mailers.smtp.host' => '127.0.0.1', 'mail.mailers.smtp.port' => 1, 'mail.mailers.smtp.timeout' => 1]);

        $this->postJson('/api/auth/register', $this->payload())
            ->assertCreated()->assertJsonPath('data.verification_email_sent', false);
        $this->assertSame(1, User::count());
    }

    public function test_verification_link_points_to_the_frontend_and_verifies_the_email(): void
    {
        Notification::fake();
        $this->postJson('/api/auth/register', $this->payload())->assertCreated();
        $user = User::firstOrFail();

        $link = null;
        Notification::assertSentTo($user, VerifyEmail::class, function (VerifyEmail $notification) use ($user, &$link) {
            $link = $notification->toMail($user)->actionUrl;

            return str_starts_with($link, config('app.frontend_url').'/verify-email?');
        });
        parse_str(parse_url($link, PHP_URL_QUERY), $query);

        $verifyUrl = "/api/auth/email/verify/{$query['id']}/{$query['hash']}?expires={$query['expires']}&signature={$query['signature']}";
        $this->getJson($verifyUrl)->assertOk()->assertJsonPath('status', 'verified');
        $this->assertTrue($user->fresh()->hasVerifiedEmail());
        $this->getJson($verifyUrl)->assertOk()->assertJsonPath('status', 'already_verified');
    }

    public function test_tampered_or_expired_verification_links_are_rejected(): void
    {
        $user = User::factory()->unverified()->create();
        parse_str(parse_url(FrontendUrl::verification($user), PHP_URL_QUERY), $query);
        $base = "/api/auth/email/verify/{$query['id']}/{$query['hash']}";

        $this->getJson("{$base}?expires={$query['expires']}&signature=forged")->assertForbidden()->assertJsonPath('status', 'invalid');
        $other = User::factory()->unverified()->create();
        $this->getJson("/api/auth/email/verify/{$other->id}/{$query['hash']}?expires={$query['expires']}&signature={$query['signature']}")->assertForbidden();

        $this->travel(config('auth.verification.expire') + 1)->minutes();
        $this->getJson("{$base}?expires={$query['expires']}&signature={$query['signature']}")->assertForbidden();
        $this->assertFalse($user->fresh()->hasVerifiedEmail());
    }

    public function test_public_resend_never_reveals_whether_an_account_exists(): void
    {
        Notification::fake();
        $unverified = User::factory()->unverified()->create(['role' => Roles::CUSTOMER]);
        $verified = User::factory()->create(['role' => Roles::CUSTOMER]);

        $missing = $this->postJson('/api/auth/email/resend', ['email' => 'nobody@example.test'])->assertOk()->json('message');
        $this->assertSame($missing, $this->postJson('/api/auth/email/resend', ['email' => $unverified->email])->assertOk()->json('message'));
        $this->assertSame($missing, $this->postJson('/api/auth/email/resend', ['email' => $verified->email])->assertOk()->json('message'));

        Notification::assertSentTo($unverified, VerifyEmail::class);
        Notification::assertNotSentTo($verified, VerifyEmail::class);
    }

    public function test_signed_in_users_can_request_a_new_verification_link(): void
    {
        Notification::fake();
        $user = User::factory()->unverified()->create(['role' => Roles::CUSTOMER]);

        $this->actingAs($user, 'sanctum')->postJson('/api/auth/email/verification-notification')->assertOk();
        Notification::assertSentTo($user, VerifyEmail::class);
    }

    public function test_password_reset_works_for_registered_customers_and_uses_the_reset_page(): void
    {
        Notification::fake();
        $this->postJson('/api/auth/register', $this->payload())->assertCreated();
        $user = User::firstOrFail();

        $this->postJson('/api/auth/forgot-password', ['email' => $user->email])->assertOk();
        $token = null;
        Notification::assertSentTo($user, ResetPassword::class, function (ResetPassword $notification) use ($user, &$token) {
            $token = $notification->token;

            return str_starts_with($notification->toMail($user)->actionUrl, config('app.frontend_url').'/reset-password?token=');
        });

        // Weak passwords are refused even with a valid token.
        $this->postJson('/api/auth/reset-password', ['token' => $token, 'email' => $user->email, 'password' => 'weakpass', 'password_confirmation' => 'weakpass'])
            ->assertUnprocessable()->assertJsonValidationErrors('password');

        $this->postJson('/api/auth/reset-password', ['token' => $token, 'email' => $user->email, 'password' => 'Fresh-pass22', 'password_confirmation' => 'Fresh-pass22'])->assertOk();
        // The token is single-use.
        $this->postJson('/api/auth/reset-password', ['token' => $token, 'email' => $user->email, 'password' => 'Again-pass33', 'password_confirmation' => 'Again-pass33'])
            ->assertUnprocessable()->assertJsonValidationErrors('token');
        $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'Fresh-pass22'])->assertOk();
    }

    public function test_remember_me_issues_a_longer_lived_token(): void
    {
        config(['sanctum.token_lifetime' => 60, 'sanctum.remember_lifetime' => 600, 'sanctum.expiration' => 600]);
        $user = User::factory()->create(['role' => Roles::CASHIER]);

        $short = $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'password'])->json('data.token');
        $long = $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'password', 'remember' => true])->json('data.token');

        $this->travel(61)->minutes();
        $this->app['auth']->forgetGuards();
        $this->withToken($short)->getJson('/api/auth/me')->assertUnauthorized();
        $this->app['auth']->forgetGuards();
        $this->withToken($long)->getJson('/api/auth/me')->assertOk();

        $this->travel(540)->minutes();
        $this->app['auth']->forgetGuards();
        $this->withToken($long)->getJson('/api/auth/me')->assertUnauthorized();
    }

    public function test_login_reports_deactivated_accounts_clearly(): void
    {
        $user = User::factory()->create(['role' => Roles::CUSTOMER, 'is_active' => false]);

        $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'password'])
            ->assertForbidden()->assertJsonPath('message', 'Your account has been deactivated. Contact your administrator.');
        $this->assertSame(0, AuditLog::where('action', 'auth.login')->count());
    }

    public function test_login_is_case_insensitive_for_email(): void
    {
        $user = User::factory()->create(['email' => 'cashier@example.test', 'role' => Roles::CASHIER]);
        $this->postJson('/api/auth/login', ['email' => 'Cashier@Example.test', 'password' => 'password'])
            ->assertOk()->assertJsonPath('data.user.id', $user->id);
    }

    public function test_system_owner_can_still_sign_in(): void
    {
        $owner = User::factory()->create(['role' => Roles::SYSTEM_OWNER]);

        $this->postJson('/api/auth/login', ['email' => $owner->email, 'password' => 'password'])
            ->assertOk()->assertJsonPath('data.user.role', Roles::SYSTEM_OWNER)
            ->assertJsonPath('data.user.permissions', Roles::permissionsFor(Roles::SYSTEM_OWNER));
    }
}
