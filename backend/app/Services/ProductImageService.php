<?php

namespace App\Services;

use App\Models\AuditLog;
use App\Models\ProductImage;
use App\Models\User;
use GdImage;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Turns an uploaded photo into an optimised WebP large image and thumbnail on the private disk,
 * and keeps each product's photo order and primary photo consistent. The product itself is never
 * modified apart from books.primary_image_id.
 */
class ProductImageService
{
    public const MAX_IMAGES = 8;
    public const MAX_KILOBYTES = 10240;
    public const LARGE_EDGE = 1600;
    public const THUMB_EDGE = 400;
    /** Refuse images that would need an unreasonable amount of memory to decode. */
    public const MAX_PIXELS = 60_000_000;

    private const TYPES = [IMAGETYPE_JPEG => 'image/jpeg', IMAGETYPE_PNG => 'image/png', IMAGETYPE_WEBP => 'image/webp'];

    /** @return array{0: ProductImage, 1: bool} the image and whether it was already attached */
    public function add(object $book, UploadedFile $file, User $actor, ?int $position = null): array
    {
        $checksum = hash_file('sha256', $file->getRealPath());
        if ($existing = ProductImage::where('book_id', $book->id)->where('checksum', $checksum)->first()) {
            return [$existing, true];
        }
        // A replacement takes the old photo's place, so it does not count against the limit.
        if ($position === null && ProductImage::where('book_id', $book->id)->count() >= self::MAX_IMAGES) {
            throw ValidationException::withMessages(['image' => 'A product can have up to '.self::MAX_IMAGES.' photos. Remove one first.']);
        }
        $processed = $this->process($file, $book->bookshop_id, $book->id);

        try {
            $image = DB::transaction(function () use ($book, $file, $actor, $checksum, $processed, $position) {
                DB::table('books')->where('id', $book->id)->lockForUpdate()->first();
                $order = $position ?? ((int) ProductImage::where('book_id', $book->id)->max('sort_order') + 1);
                $image = ProductImage::create([
                    'bookshop_id' => $book->bookshop_id, 'book_id' => $book->id,
                    'path' => $processed['path'], 'thumb_path' => $processed['thumb_path'],
                    'original_name' => mb_substr($file->getClientOriginalName() ?: 'photo', 0, 255),
                    'width' => $processed['width'], 'height' => $processed['height'], 'size_bytes' => $processed['size_bytes'],
                    'checksum' => $checksum, 'sort_order' => $order, 'uploaded_by' => $actor->id,
                ]);
                // The first photo of a product becomes its primary photo.
                DB::table('books')->where('id', $book->id)->whereNull('primary_image_id')->update(['primary_image_id' => $image->id, 'updated_at' => now()]);
                AuditLog::record('catalog.image_added', "Added a photo to {$book->title}", null, ['book_id' => $book->id, 'image_id' => $image->id], $actor, $book->bookshop_id);

                return $image;
            });
        } catch (UniqueConstraintViolationException) {
            $this->deleteFiles($processed['path'], $processed['thumb_path']);

            return [ProductImage::where('book_id', $book->id)->where('checksum', $checksum)->firstOrFail(), true];
        } catch (\Throwable $e) {
            $this->deleteFiles($processed['path'], $processed['thumb_path']);
            throw $e;
        }

        return [$image, false];
    }

    /** Swaps a photo for a new one in the same position, keeping it primary if it was. */
    public function replace(object $book, ProductImage $old, UploadedFile $file, User $actor): ProductImage
    {
        [$new, $duplicate] = $this->add($book, $file, $actor, $old->sort_order);
        if ($duplicate) {
            throw ValidationException::withMessages(['image' => 'This photo is already attached to the product.']);
        }
        DB::transaction(function () use ($book, $old, $new) {
            DB::table('books')->where('id', $book->id)->where('primary_image_id', $old->id)->update(['primary_image_id' => $new->id, 'updated_at' => now()]);
            $this->deleteRow($book, $old);
        });

        return $new;
    }

    /** Removes one photo. The product stays; the next photo in order becomes primary if needed. */
    public function delete(object $book, ProductImage $image, User $actor): void
    {
        DB::transaction(function () use ($book, $image, $actor) {
            $this->deleteRow($book, $image);
            AuditLog::record('catalog.image_removed', "Removed a photo from {$book->title}", null, ['book_id' => $book->id, 'image_id' => $image->id], $actor, $book->bookshop_id);
        });
    }

    public function setPrimary(object $book, ProductImage $image, User $actor): void
    {
        DB::table('books')->where('id', $book->id)->update(['primary_image_id' => $image->id, 'updated_at' => now()]);
        AuditLog::record('catalog.image_primary', "Changed the main photo of {$book->title}", null, ['book_id' => $book->id, 'image_id' => $image->id], $actor, $book->bookshop_id);
    }

    /** @param int[] $ids every photo of the product, in the new order */
    public function reorder(object $book, array $ids): void
    {
        $current = ProductImage::where('book_id', $book->id)->pluck('id')->map(fn ($id) => (int) $id)->sort()->values()->all();
        $given = collect($ids)->map(fn ($id) => (int) $id)->sort()->values()->all();
        if ($current !== $given) {
            throw ValidationException::withMessages(['ids' => 'List every photo of this product exactly once.']);
        }
        DB::transaction(function () use ($ids) {
            foreach (array_values($ids) as $index => $id) {
                ProductImage::whereKey($id)->update(['sort_order' => $index + 1]);
            }
        });
    }

    private function deleteRow(object $book, ProductImage $image): void
    {
        $wasPrimary = (int) DB::table('books')->where('id', $book->id)->value('primary_image_id') === $image->id;
        $image->delete();
        if ($wasPrimary) {
            $next = ProductImage::where('book_id', $book->id)->orderBy('sort_order')->orderBy('id')->value('id');
            DB::table('books')->where('id', $book->id)->update(['primary_image_id' => $next, 'updated_at' => now()]);
        }
        DB::afterCommit(fn () => $this->deleteFiles($image->path, $image->thumb_path));
    }

    /** @return array{path: string, thumb_path: string, width: int, height: int, size_bytes: int} */
    private function process(UploadedFile $file, int $bookshopId, int $bookId): array
    {
        $info = @getimagesize($file->getRealPath());
        if (! $info || ! isset(self::TYPES[$info[2]])) {
            throw ValidationException::withMessages(['image' => 'The file is not a JPEG, PNG or WebP image.']);
        }
        [$width, $height] = $info;
        if ($width < 50 || $height < 50 || $width * $height > self::MAX_PIXELS) {
            throw ValidationException::withMessages(['image' => 'The photo must be between 50×50 pixels and 60 megapixels.']);
        }
        $source = match ($info[2]) {
            IMAGETYPE_JPEG => @imagecreatefromjpeg($file->getRealPath()),
            IMAGETYPE_PNG => @imagecreatefrompng($file->getRealPath()),
            IMAGETYPE_WEBP => @imagecreatefromwebp($file->getRealPath()),
        };
        if (! $source instanceof GdImage) {
            throw ValidationException::withMessages(['image' => 'The photo could not be read. Try another photo.']);
        }
        if ($info[2] === IMAGETYPE_JPEG) {
            $source = $this->applyOrientation($source, $file->getRealPath());
        }
        $large = $this->resize($source, self::LARGE_EDGE);
        $thumb = $this->resize($source, self::THUMB_EDGE);
        imagedestroy($source);

        $base = "product-images/{$bookshopId}/{$bookId}/".Str::uuid();
        $largeBytes = $this->encode($large, 82);
        $thumbBytes = $this->encode($thumb, 74);
        $dimensions = [imagesx($large), imagesy($large)];
        imagedestroy($large);
        imagedestroy($thumb);
        $disk = Storage::disk(ProductImage::DISK);
        if (! $disk->put("{$base}.webp", $largeBytes) || ! $disk->put("{$base}-thumb.webp", $thumbBytes)) {
            $this->deleteFiles("{$base}.webp", "{$base}-thumb.webp");
            throw new \RuntimeException('The photo could not be saved.');
        }

        return ['path' => "{$base}.webp", 'thumb_path' => "{$base}-thumb.webp", 'width' => $dimensions[0], 'height' => $dimensions[1], 'size_bytes' => strlen($largeBytes)];
    }

    /** Phone cameras store rotation in EXIF instead of rotating the pixels. */
    private function applyOrientation(GdImage $image, string $path): GdImage
    {
        if (! function_exists('exif_read_data')) {
            return $image;
        }
        $orientation = (int) (@exif_read_data($path)['Orientation'] ?? 1);
        $rotated = match ($orientation) {
            3 => imagerotate($image, 180, 0),
            6 => imagerotate($image, -90, 0),
            8 => imagerotate($image, 90, 0),
            default => $image,
        };
        if ($rotated !== $image && $rotated instanceof GdImage) {
            imagedestroy($image);

            return $rotated;
        }

        return $image;
    }

    private function resize(GdImage $source, int $edge): GdImage
    {
        $width = imagesx($source);
        $height = imagesy($source);
        $scale = min(1, $edge / max($width, $height));
        $targetWidth = max(1, (int) round($width * $scale));
        $targetHeight = max(1, (int) round($height * $scale));
        $target = imagecreatetruecolor($targetWidth, $targetHeight);
        imagealphablending($target, false);
        imagesavealpha($target, true);
        imagefill($target, 0, 0, imagecolorallocatealpha($target, 255, 255, 255, 127));
        imagecopyresampled($target, $source, 0, 0, 0, 0, $targetWidth, $targetHeight, $width, $height);

        return $target;
    }

    private function encode(GdImage $image, int $quality): string
    {
        ob_start();
        imagewebp($image, null, $quality);

        return (string) ob_get_clean();
    }

    private function deleteFiles(string ...$paths): void
    {
        Storage::disk(ProductImage::DISK)->delete($paths);
    }
}
