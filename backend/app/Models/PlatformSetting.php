<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** Global platform settings managed by the Platform Owner. */
class PlatformSetting extends Model
{
    protected $primaryKey = 'key';
    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = ['key', 'value', 'updated_by'];

    /** Known settings and their defaults; anything else is rejected. */
    public const DEFAULTS = [
        'bookshop_registration_open' => true,
        'support_email' => null,
        'trial_days' => null,
    ];

    protected function casts(): array
    {
        return ['value' => 'json'];
    }

    public static function get(string $key): mixed
    {
        $row = self::find($key);

        return $row ? $row->value : (self::DEFAULTS[$key] ?? null);
    }

    public static function values(): array
    {
        $stored = self::whereIn('key', array_keys(self::DEFAULTS))->pluck('value', 'key')->all();

        return array_merge(self::DEFAULTS, $stored);
    }
}
