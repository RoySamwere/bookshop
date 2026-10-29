<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\Bookshop;
use App\Models\Branch;
use App\Models\BusinessProfile;
use App\Models\TaxRate;
use App\Models\User;
use App\Support\Roles;
use Illuminate\Support\Facades\DB;

/** Creates a bookshop owner, their bookshop, its main branch and trial in one transaction. */
class BookshopRegistrationService
{
    public function __construct(private SubscriptionService $subscriptions) {}

    /** @param array{owner_name:string,email:string,phone:string,password:string,bookshop_name:string,business_phone:string,business_location:string,country:string,currency:string} $data */
    public function register(array $data): User
    {
        return DB::transaction(function () use ($data) {
            $owner = new User(['name' => $data['owner_name'], 'email' => $data['email'], 'phone' => $data['phone'], 'password' => $data['password']]);
            // Set explicitly, never from input: a public sign-up only ever owns its own new bookshop.
            $owner->forceFill([
                'role' => Roles::BOOKSHOP_OWNER,
                'is_active' => true,
                'email_verified_at' => null,
                'created_by' => null,
                'registration_source' => User::SOURCE_BOOKSHOP_REGISTRATION,
                'terms_accepted_at' => now(),
            ])->save();

            $bookshop = new Bookshop([
                'name' => $data['bookshop_name'],
                'business_email' => $data['email'],
                'phone' => $data['business_phone'],
                'location' => $data['business_location'],
                'country' => $data['country'],
                'currency' => $data['currency'],
            ]);
            $bookshop->forceFill([
                'slug' => Bookshop::uniqueSlug($data['bookshop_name']),
                'owner_user_id' => $owner->id,
                'status' => Bookshop::STATUS_PENDING,
                'registered_at' => now(),
            ])->save();

            $owner->forceFill(['bookshop_id' => $bookshop->id])->save();

            $branch = new Branch(['name' => 'Main branch', 'code' => 'MAIN', 'phone' => $data['business_phone'], 'city' => $data['business_location']]);
            $branch->forceFill(['bookshop_id' => $bookshop->id, 'is_main' => true, 'is_active' => true])->save();
            $owner->branches()->attach($branch->id);

            $profile = new BusinessProfile([
                'name' => $bookshop->name, 'email' => $bookshop->business_email, 'phone' => $bookshop->phone,
                'city' => $bookshop->location, 'country' => $bookshop->country, 'currency' => $bookshop->currency,
                'timezone' => $bookshop->timezone,
            ]);
            $profile->bookshop_id = $bookshop->id;
            $profile->save();

            if (strcasecmp($bookshop->country, 'Kenya') === 0) {
                foreach ([['VAT 16%', 'VAT16', 16, true], ['Zero rated', 'ZERO', 0, false], ['Exempt', 'EXEMPT', 0, false]] as [$name, $code, $rate, $default]) {
                    $tax = new TaxRate(['name' => $name, 'code' => $code, 'rate' => $rate, 'is_default' => $default]);
                    $tax->bookshop_id = $bookshop->id;
                    $tax->save();
                }
            }

            $this->subscriptions->startTrial($bookshop, $owner);

            AuditLog::record('bookshop.registered', "{$owner->name} registered the bookshop {$bookshop->name}", $bookshop, [
                'slug' => $bookshop->slug, 'country' => $bookshop->country, 'currency' => $bookshop->currency,
            ], $owner, $bookshop->id);

            return $owner;
        });
    }
}
