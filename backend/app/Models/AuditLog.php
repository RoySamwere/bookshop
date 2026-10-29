<?php

namespace App\Models;

use App\Support\Tenancy\Tenant;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use Illuminate\Http\Request;

class AuditLog extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['bookshop_id', 'user_id', 'action', 'subject_type', 'subject_id', 'description', 'metadata', 'ip_address', 'user_agent'];

    protected function casts(): array
    {
        return ['metadata' => 'array'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function subject(): MorphTo
    {
        return $this->morphTo();
    }

    /**
     * The entry belongs to the current bookshop, else the actor's bookshop. Pass $bookshopId to file a
     * platform action against the bookshop it concerns; platform-only actions keep a null bookshop.
     */
    public static function record(string $action, string $description, ?Model $subject = null, array $metadata = [], ?User $actor = null, ?int $bookshopId = null): self
    {
        /** @var Request $request */
        $request = request();
        $actor ??= $request->user();

        return self::create([
            'bookshop_id' => $bookshopId ?? Tenant::id() ?? $actor?->bookshop_id,
            'user_id' => $actor?->id,
            'action' => $action,
            'subject_type' => $subject?->getMorphClass(),
            'subject_id' => $subject?->getKey(),
            'description' => $description,
            'metadata' => $metadata ?: null,
            'ip_address' => $request->ip(),
            'user_agent' => substr((string) $request->userAgent(), 0, 255) ?: null,
        ]);
    }
}
