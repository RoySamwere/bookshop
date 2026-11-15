<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\URL;

/** One photograph of a product, stored privately as an optimised large image and a thumbnail. */
class ProductImage extends Model
{
    public const DISK = 'local';
    public const SIZES = ['large', 'thumb'];

    protected $guarded = ['id'];

    protected function casts(): array
    {
        return ['width' => 'integer', 'height' => 'integer', 'size_bytes' => 'integer', 'sort_order' => 'integer'];
    }

    /**
     * Signed, relative URLs for an image id. The expiry is rounded to a day boundary so the URL stays
     * the same all day (letting browsers cache it) and stops working within two days.
     *
     * @return array{image_url: ?string, thumb_url: ?string}
     */
    public static function urls(?int $id): array
    {
        if (! $id) {
            return ['image_url' => null, 'thumb_url' => null];
        }
        $expires = now()->startOfDay()->addDays(2);

        return [
            'image_url' => URL::temporarySignedRoute('product-images.show', $expires, ['image' => $id, 'size' => 'large'], absolute: false),
            'thumb_url' => URL::temporarySignedRoute('product-images.show', $expires, ['image' => $id, 'size' => 'thumb'], absolute: false),
        ];
    }

    /** Adds image_url and thumb_url to a query row that has image_id (or primary_image_id). */
    public static function decorate(object $row, ?string $fallbackUrl = null): object
    {
        $id = $row->image_id ?? $row->primary_image_id ?? null;
        $urls = self::urls($id ? (int) $id : null);
        $row->image_id = $id ? (int) $id : null;
        $row->image_url = $urls['image_url'] ?? $fallbackUrl;
        $row->thumb_url = $urls['thumb_url'] ?? $fallbackUrl;

        return $row;
    }

    public function toApi(?int $primaryId): array
    {
        return [
            'id' => $this->id,
            'book_id' => $this->book_id,
            'is_primary' => $this->id === $primaryId,
            'sort_order' => $this->sort_order,
            'width' => $this->width,
            'height' => $this->height,
            'size_bytes' => $this->size_bytes,
            'original_name' => $this->original_name,
            ...self::urls($this->id),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
