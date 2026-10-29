<?php

namespace App\Providers;

use App\Models\User;
use App\Support\FrontendUrl;
use Illuminate\Auth\Notifications\ResetPassword;
use Illuminate\Auth\Notifications\VerifyEmail;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // One password policy for registration, resets, profile changes and staff-created accounts.
        Password::defaults(fn () => Password::min(8)->max(128)->letters()->mixedCase()->numbers()->symbols());

        // Shops share one public IP across tills, so limit per account first and only loosely per IP.
        RateLimiter::for('login', fn (Request $request) => [
            Limit::perMinute(5)->by(strtolower((string) $request->input('email')).'|'.$request->ip()),
            Limit::perMinute(30)->by($request->ip()),
        ]);
        RateLimiter::for('register', fn (Request $request) => [
            Limit::perMinute(5)->by('register|'.$request->ip()),
            Limit::perHour(20)->by('register-hour|'.$request->ip()),
        ]);
        RateLimiter::for('verification', fn (Request $request) => [
            Limit::perMinute(3)->by('verify|'.strtolower((string) $request->input('email')).'|'.$request->ip()),
            Limit::perMinute(10)->by('verify-ip|'.$request->ip()),
        ]);
        RateLimiter::for('subscribe', fn (Request $request) => Limit::perMinute(5)->by('subscribe|'.$request->ip()));

        // Emails link to the React frontend, which posts back to the API.
        ResetPassword::createUrlUsing(fn (User $user, string $token) => FrontendUrl::to('/reset-password', [
            'token' => $token, 'email' => $user->getEmailForPasswordReset(),
        ]));
        VerifyEmail::createUrlUsing(fn (User $user) => FrontendUrl::verification($user));
    }
}
