<?php

namespace App\Http\Controllers;

use App\Models\ProductImage;
use App\Services\ProductImageService;
use App\Support\Tenancy\Tenant;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\Response;

/**
 * Product photos for the current bookshop. Every lookup is scoped to the signed-in bookshop, so an id
 * from another bookshop behaves exactly like one that does not exist.
 */
class ProductImageController extends Controller
{
    public function __construct(private readonly ProductImageService $images) {}

    public function index(int $book): JsonResponse
    {
        $row = $this->book($book);

        return response()->json(['data' => $this->list($row)]);
    }

    public function store(Request $request, int $book): JsonResponse
    {
        $row = $this->book($book);
        $request->validate(['image' => $this->fileRules(), 'make_primary' => ['sometimes', 'boolean']]);
        [$image, $duplicate] = $this->images->add($row, $request->file('image'), $request->user());
        if ($request->boolean('make_primary')) {
            $this->images->setPrimary($row, $image, $request->user());
        }

        return response()->json([
            'message' => $duplicate ? 'This photo is already attached to the product.' : 'Photo added.',
            'duplicate' => $duplicate,
            'data' => $this->list($this->book($book)),
        ], $duplicate ? 200 : 201);
    }

    public function replace(Request $request, int $book, int $image): JsonResponse
    {
        $row = $this->book($book);
        $request->validate(['image' => $this->fileRules()]);
        $this->images->replace($row, $this->image($row, $image), $request->file('image'), $request->user());

        return response()->json(['message' => 'Photo replaced.', 'data' => $this->list($this->book($book))]);
    }

    public function primary(Request $request, int $book, int $image): JsonResponse
    {
        $row = $this->book($book);
        $this->images->setPrimary($row, $this->image($row, $image), $request->user());

        return response()->json(['message' => 'Main photo updated.', 'data' => $this->list($this->book($book))]);
    }

    public function reorder(Request $request, int $book): JsonResponse
    {
        $row = $this->book($book);
        $data = $request->validate(['ids' => ['required', 'array', 'min:1', 'max:'.ProductImageService::MAX_IMAGES], 'ids.*' => ['integer', 'distinct']]);
        $this->images->reorder($row, $data['ids']);

        return response()->json(['message' => 'Photo order saved.', 'data' => $this->list($row)]);
    }

    public function destroy(Request $request, int $book, int $image): JsonResponse
    {
        $row = $this->book($book);
        $this->images->delete($row, $this->image($row, $image), $request->user());

        return response()->json(['message' => 'Photo removed. The product was not changed.', 'data' => $this->list($this->book($book))]);
    }

    /** Streams a stored photo. Access is granted by the signed URL that only the owning bookshop receives. */
    public function show(int $image, string $size): Response
    {
        $row = ProductImage::find($image);
        abort_unless($row && in_array($size, ProductImage::SIZES, true), 404);
        $path = $size === 'thumb' ? $row->thumb_path : $row->path;
        $disk = Storage::disk(ProductImage::DISK);
        abort_unless($disk->exists($path), 404);

        return response()->file($disk->path($path), [
            'Content-Type' => 'image/webp',
            'Cache-Control' => 'private, max-age=86400, immutable',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    private function fileRules(): array
    {
        return ['required', 'file', 'image', 'mimes:jpeg,jpg,png,webp', 'mimetypes:image/jpeg,image/png,image/webp', 'max:'.ProductImageService::MAX_KILOBYTES];
    }

    private function book(int $book): object
    {
        $row = DB::table('books')->where('bookshop_id', Tenant::requireId())->where('id', $book)->first(['id', 'bookshop_id', 'title', 'primary_image_id']);
        abort_unless($row, 404);

        return $row;
    }

    private function image(object $book, int $image): ProductImage
    {
        return ProductImage::where('book_id', $book->id)->where('bookshop_id', $book->bookshop_id)->findOrFail($image);
    }

    private function list(object $book): array
    {
        return ProductImage::where('book_id', $book->id)->orderBy('sort_order')->orderBy('id')->get()
            ->map(fn (ProductImage $image) => $image->toApi($book->primary_image_id ? (int) $book->primary_image_id : null))->all();
    }
}
