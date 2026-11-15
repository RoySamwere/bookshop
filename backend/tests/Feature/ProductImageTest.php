<?php

namespace Tests\Feature;

use App\Models\Bookshop;
use App\Models\Branch;
use App\Models\ProductImage;
use App\Models\User;
use App\Support\Roles;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ProductImageTest extends TestCase
{
    use RefreshDatabase;

    private Branch $branch;
    private User $owner;
    private User $cashier;
    private int $book;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake(ProductImage::DISK);
        $this->branch = Branch::factory()->create();
        $this->owner = User::factory()->inBranches($this->branch)->create(['role' => Roles::SYSTEM_OWNER]);
        $this->cashier = User::factory()->inBranches($this->branch)->create(['role' => Roles::CASHIER]);
        $this->book = $this->book('Grade 7 Integrated Science');
    }

    private function book(string $title, ?int $bookshopId = null): int
    {
        $id = DB::table('books')->insertGetId(['bookshop_id' => $bookshopId ?? $this->tenantId(), 'title' => $title, 'sku' => uniqid('SKU-'), 'selling_price' => 890,
            'reorder_level' => 5, 'cover_url' => null, 'created_at' => now(), 'updated_at' => now()]);
        if (! $bookshopId) {
            DB::table('inventory_balances')->insert(['bookshop_id' => $this->tenantId(), 'book_id' => $id, 'branch_id' => $this->branch->id, 'quantity' => 12, 'reserved' => 0, 'created_at' => now(), 'updated_at' => now()]);
        }

        return $id;
    }

    /** A real encoded photo; the colour makes each file's contents (and checksum) different. */
    private function photo(string $name = 'cover.jpg', int $width = 2400, int $height = 1800, int $shade = 120): UploadedFile
    {
        $image = imagecreatetruecolor($width, $height);
        imagefill($image, 0, 0, imagecolorallocate($image, $shade, 60, 200 - $shade % 100));
        ob_start();
        match (pathinfo($name, PATHINFO_EXTENSION)) {
            'png' => imagepng($image),
            'webp' => imagewebp($image),
            default => imagejpeg($image, null, 90),
        };
        $path = tempnam(sys_get_temp_dir(), 'img');
        file_put_contents($path, ob_get_clean());

        return new UploadedFile($path, $name, null, null, true);
    }

    private function upload(UploadedFile $file, ?int $book = null)
    {
        return $this->post('/api/books/'.($book ?? $this->book).'/images', ['image' => $file], ['Accept' => 'application/json']);
    }

    public function test_an_uploaded_photo_is_optimised_stored_privately_and_becomes_primary(): void
    {
        $this->actingAs($this->owner, 'sanctum');
        $response = $this->upload($this->photo())->assertCreated()->assertJsonPath('data.0.is_primary', true);

        $image = ProductImage::sole();
        $this->assertSame($image->id, (int) DB::table('books')->where('id', $this->book)->value('primary_image_id'));
        $this->assertSame(1600, max($image->width, $image->height), 'Large copy is limited to 1600 px.');
        Storage::disk(ProductImage::DISK)->assertExists([$image->path, $image->thumb_path]);
        $this->assertStringStartsWith("product-images/{$this->tenantId()}/{$this->book}/", $image->path);
        [$thumbWidth] = getimagesizefromstring(Storage::disk(ProductImage::DISK)->get($image->thumb_path));
        $this->assertSame(400, $thumbWidth);
        $this->assertSame(IMAGETYPE_WEBP, getimagesizefromstring(Storage::disk(ProductImage::DISK)->get($image->path))[2]);
        $this->assertFalse(Storage::disk('public')->exists($image->path), 'Photos never go on the public disk.');

        // The signed URL serves the WebP without a session; tampering or no signature is refused.
        $url = $response->json('data.0.thumb_url');
        $this->assertStringStartsWith('/api/product-images/', $url);
        auth()->forgetGuards();
        $this->app['auth']->guard('sanctum')->forgetUser();
        $this->get($url)->assertOk()->assertHeader('Content-Type', 'image/webp');
        $this->get(preg_replace('/signature=\w+/', 'signature=forged', $url))->assertForbidden();
        $this->get("/api/product-images/{$image->id}/large")->assertForbidden();
        $this->travel(3)->days();
        $this->get($url)->assertForbidden();
    }

    public function test_the_same_photo_is_not_attached_twice(): void
    {
        $this->actingAs($this->owner, 'sanctum');
        $photo = $this->photo();
        $this->upload($photo)->assertCreated();
        $this->upload(new UploadedFile($photo->getRealPath(), 'again.jpg', null, null, true))->assertOk()->assertJsonPath('duplicate', true);
        $this->assertSame(1, ProductImage::count());
    }

    public function test_multiple_photos_can_be_reordered_made_primary_replaced_and_removed(): void
    {
        $this->actingAs($this->owner, 'sanctum');
        $this->upload($this->photo('front.jpg', shade: 10))->assertCreated();
        $this->upload($this->photo('back.png', 900, 1200, shade: 40))->assertCreated();
        $this->upload($this->photo('spine.webp', 600, 600, shade: 80))->assertCreated();
        [$front, $back, $spine] = ProductImage::orderBy('id')->pluck('id')->all();

        $this->putJson("/api/books/{$this->book}/images/order", ['ids' => [$spine, $front, $back]])->assertOk()
            ->assertJsonPath('data.0.id', $spine)->assertJsonPath('data.1.is_primary', true);
        $this->putJson("/api/books/{$this->book}/images/order", ['ids' => [$spine, $front]])->assertUnprocessable();

        $this->postJson("/api/books/{$this->book}/images/{$back}/primary")->assertOk();
        $this->assertSame($back, (int) DB::table('books')->where('id', $this->book)->value('primary_image_id'));

        // Replacing the primary photo keeps its place and its primary status, and removes the old files.
        $old = ProductImage::find($back);
        $replaced = $this->post("/api/books/{$this->book}/images/{$back}/replace", ['image' => $this->photo('new-back.jpg', shade: 160)], ['Accept' => 'application/json'])->assertOk();
        $newId = (int) DB::table('books')->where('id', $this->book)->value('primary_image_id');
        $this->assertNotSame($back, $newId);
        $this->assertSame([$spine, $front, $newId], collect($replaced->json('data'))->pluck('id')->all());
        Storage::disk(ProductImage::DISK)->assertMissing([$old->path, $old->thumb_path]);

        // Removing the primary photo promotes the next one; the product itself is untouched.
        $this->deleteJson("/api/books/{$this->book}/images/{$newId}")->assertOk();
        $this->assertSame($spine, (int) DB::table('books')->where('id', $this->book)->value('primary_image_id'));
        $this->deleteJson("/api/books/{$this->book}/images/{$spine}")->assertOk();
        $this->deleteJson("/api/books/{$this->book}/images/{$front}")->assertOk();
        $this->assertNull(DB::table('books')->where('id', $this->book)->value('primary_image_id'));
        $this->assertDatabaseHas('books', ['id' => $this->book, 'title' => 'Grade 7 Integrated Science']);
        $this->assertSame(0, ProductImage::count());
        $this->assertDatabaseHas('audit_logs', ['action' => 'catalog.image_removed']);
    }

    public function test_uploads_are_validated_on_the_server(): void
    {
        $this->actingAs($this->owner, 'sanctum');
        $text = tempnam(sys_get_temp_dir(), 'txt');
        file_put_contents($text, 'not an image at all');
        $this->upload(new UploadedFile($text, 'cover.jpg', 'image/jpeg', null, true))->assertUnprocessable()->assertJsonValidationErrors('image');
        $this->upload(UploadedFile::fake()->create('scan.pdf', 100, 'application/pdf'))->assertUnprocessable();
        $gif = imagecreatetruecolor(300, 300);
        ob_start(); imagegif($gif);
        $gifPath = tempnam(sys_get_temp_dir(), 'gif');
        file_put_contents($gifPath, ob_get_clean());
        $this->upload(new UploadedFile($gifPath, 'cover.gif', null, null, true))->assertUnprocessable();
        $this->upload(UploadedFile::fake()->create('huge.jpg', 11000, 'image/jpeg'))->assertUnprocessable();
        $this->upload($this->photo('tiny.jpg', 20, 20))->assertUnprocessable();

        for ($i = 0; $i < 8; $i++) {
            $this->upload($this->photo("p{$i}.jpg", 300, 300, shade: $i * 20))->assertCreated();
        }
        $this->upload($this->photo('ninth.jpg', 300, 300, shade: 250))->assertUnprocessable()->assertJsonValidationErrors('image');
        $this->assertSame(8, ProductImage::count());
        $this->assertSame([], Storage::disk(ProductImage::DISK)->allFiles('tmp'));
    }

    public function test_staff_without_catalogue_management_can_view_but_not_change_photos(): void
    {
        $this->actingAs($this->owner, 'sanctum');
        $this->upload($this->photo())->assertCreated();
        $image = ProductImage::sole();

        $this->actingAs($this->cashier, 'sanctum');
        $this->getJson("/api/books/{$this->book}/images")->assertOk()->assertJsonCount(1, 'data');
        $this->upload($this->photo(shade: 30))->assertForbidden();
        $this->deleteJson("/api/books/{$this->book}/images/{$image->id}")->assertForbidden();
        $this->postJson("/api/books/{$this->book}/images/{$image->id}/primary")->assertForbidden();
        $this->assertSame(1, ProductImage::count());
    }

    public function test_other_bookshops_cannot_see_or_change_photos(): void
    {
        $this->actingAs($this->owner, 'sanctum');
        $this->upload($this->photo())->assertCreated();
        $image = ProductImage::sole();

        $other = Bookshop::factory()->create();
        $otherBranch = Branch::factory()->create(['bookshop_id' => $other->id]);
        $intruder = User::factory()->forBookshop($other)->inBranches($otherBranch)->create(['role' => Roles::BOOKSHOP_OWNER]);
        $theirBook = $this->book('Their book', $other->id);
        $this->actingAs($intruder, 'sanctum');

        $this->getJson("/api/books/{$this->book}/images")->assertNotFound();
        $this->upload($this->photo(shade: 90))->assertNotFound();
        $this->deleteJson("/api/books/{$this->book}/images/{$image->id}")->assertNotFound();
        // Pairing our image id with their own book id does not reach our photo either.
        $this->deleteJson("/api/books/{$theirBook}/images/{$image->id}")->assertNotFound();
        $this->postJson("/api/books/{$theirBook}/images/{$image->id}/primary")->assertNotFound();
        $this->getJson('/api/books')->assertOk()->assertJsonMissing(['image_id' => $image->id]);
        $this->assertSame(1, ProductImage::count());
        $this->assertNull(DB::table('books')->where('id', $theirBook)->value('primary_image_id'));
    }

    public function test_the_primary_photo_appears_in_catalogue_pos_inventory_stocktake_and_receipts(): void
    {
        $this->actingAs($this->owner, 'sanctum');
        $this->upload($this->photo())->assertCreated();
        $id = ProductImage::sole()->id;
        $thumb = fn (?string $url) => $url && str_contains($url, "/product-images/{$id}/thumb?");

        $this->assertTrue($thumb($this->getJson('/api/books')->json('data.0.thumb_url')));
        $this->assertTrue($thumb($this->getJson("/api/inventory?branch_id={$this->branch->id}")->json('data.0.thumb_url')));
        $this->assertTrue($thumb($this->getJson('/api/inventory/stocktake-snapshot')->json('rows.0.thumb_url')));

        $this->actingAs($this->cashier, 'sanctum');
        $pos = $this->getJson("/api/pos/products?branch_id={$this->branch->id}")->assertOk();
        $this->assertTrue($thumb($pos->json('data.0.thumb_url')), 'POS tiles use the product photo thumbnail.');
        $this->assertStringContainsString("/product-images/{$id}/large?", $pos->json('data.0.image_url'));
        $sale = $this->postJson('/api/pos/checkout', ['branch_id' => $this->branch->id, 'payment_method' => 'cash', 'amount_received' => 1000,
            'idempotency_key' => 'sale-photo-1', 'items' => [['book_id' => $this->book, 'quantity' => 1]]])->assertCreated();
        $this->assertTrue($thumb($sale->json('items.0.thumb_url')));
        $this->actingAs($this->owner, 'sanctum');
        $this->assertTrue($thumb($this->getJson('/api/pos/sales/'.$sale->json('sale.id'))->assertOk()->json('items.0.thumb_url')), 'Sales records show the product photo.');
    }

    public function test_products_without_photos_keep_their_external_cover_url(): void
    {
        DB::table('books')->where('id', $this->book)->update(['cover_url' => 'https://covers.example.test/g7.jpg']);
        $this->actingAs($this->cashier, 'sanctum');
        $this->assertSame('https://covers.example.test/g7.jpg', $this->getJson("/api/pos/products?branch_id={$this->branch->id}")->json('data.0.image_url'));
        $this->actingAs($this->owner, 'sanctum');
        $this->assertSame('https://covers.example.test/g7.jpg', $this->getJson('/api/books')->json('data.0.image_url'));
    }
}
