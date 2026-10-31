<?php

namespace App\Services\Purchasing;

use App\Support\Pdf\SimplePdf;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

/**
 * Renders the LPO document. A PDF is stored when an order is confirmed and again for each amendment,
 * so the copy a supplier received never changes afterwards; downloads serve the stored file.
 */
class PurchaseOrderPdfService
{
    private const INK = [0.078, 0.129, 0.239];
    private const MUTED = [0.36, 0.41, 0.5];
    private const BLUE = [0.0, 0.443, 0.976];
    private const PINK = [0.973, 0.506, 0.729];
    private const SOFT = [0.953, 0.965, 0.988];
    private const LEFT = 40.0;
    private const RIGHT = 555.28;

    public function store(int $bookshopId, int $orderId): string
    {
        $order = DB::table('purchase_orders')->where('bookshop_id', $bookshopId)->where('id', $orderId)->first();
        $path = sprintf('purchase-orders/%d/%s-v%d.pdf', $bookshopId, $order->lpo_number ?? "draft-$orderId", (int) $order->version);
        Storage::disk('local')->put($path, $this->render($bookshopId, $orderId));
        DB::table('purchase_orders')->where('id', $orderId)->update(['pdf_path' => $path, 'pdf_generated_at' => now()]);

        return $path;
    }

    /** The stored PDF, regenerated only if the file has gone missing. */
    public function contents(int $bookshopId, int $orderId): string
    {
        $path = DB::table('purchase_orders')->where('bookshop_id', $bookshopId)->where('id', $orderId)->value('pdf_path');
        if (! $path || ! Storage::disk('local')->exists($path)) $path = $this->store($bookshopId, $orderId);

        return Storage::disk('local')->get($path);
    }

    public function render(int $bookshopId, int $orderId): string
    {
        $order = DB::table('purchase_orders')->where('bookshop_id', $bookshopId)->where('id', $orderId)->first();
        $items = DB::table('purchase_order_items')->where('purchase_order_id', $orderId)->orderBy('position')->orderBy('id')->get();
        $supplier = DB::table('suppliers')->where('id', $order->supplier_id)->first();
        $branch = DB::table('branches')->where('id', $order->branch_id)->first();
        $bookshop = DB::table('bookshops')->where('id', $bookshopId)->first();
        $profile = DB::table('business_profiles')->where('bookshop_id', $bookshopId)->first();
        $authorizedBy = DB::table('users')->where('id', $order->confirmed_by ?? $order->approved_by ?? $order->created_by)->value('name');
        $currency = $order->currency ?: ($profile->currency ?? $bookshop->currency ?? 'KES');
        $shopName = $profile->name ?? $bookshop->name;
        $money = fn ($value) => $currency.' '.number_format((float) $value, 2);

        $pdf = new SimplePdf(($order->lpo_number ?? 'Purchase order')." - $shopName");

        // Header: bookshop identity on the left, document identity on the right.
        $pdf->rect(0, 0, SimplePdf::WIDTH, 6, self::BLUE);
        $pdf->rect(SimplePdf::WIDTH * 0.72, 0, SimplePdf::WIDTH * 0.28, 6, self::PINK);
        $pdf->text(self::LEFT, 46, $pdf->fit($shopName, 300, 18, true), 18, true, self::INK);
        $y = 62;
        $contact = array_filter([
            $profile->legal_name ?? null,
            trim(implode(', ', array_filter([$profile->address ?? null, $profile->city ?? $bookshop->location ?? null, $profile->country ?? null]))),
            trim(implode('  |  ', array_filter([$profile->phone ?? $bookshop->phone ?? null, $profile->email ?? $bookshop->business_email ?? null]))),
            ($profile->kra_pin ?? null) ? 'KRA PIN: '.$profile->kra_pin : null,
        ]);
        foreach ($contact as $line) {
            $pdf->text(self::LEFT, $y, $pdf->fit($line, 300, 9), 9, false, self::MUTED);
            $y += 12;
        }

        $pdf->text(self::RIGHT, 40, 'LOCAL PURCHASE ORDER', 11, true, self::BLUE, 'right');
        $pdf->text(self::RIGHT, 58, $order->lpo_number ?? 'DRAFT - NOT ISSUED', 15, true, self::INK, 'right');
        $meta = [
            'Order date' => $this->date($order->order_date ?? $order->created_at),
            'Expected delivery' => $this->date($order->expected_date) ?: 'To be confirmed',
            'Branch' => $branch->name ?? '',
        ];
        if ((int) $order->version > 1) $meta['Revision'] = 'Amendment '.((int) $order->version - 1);
        $my = 76;
        foreach ($meta as $label => $value) {
            $pdf->text(self::RIGHT - 110, $my, $label, 8.5, false, self::MUTED, 'right');
            $pdf->text(self::RIGHT, $my, $pdf->fit((string) $value, 100, 8.5, true), 8.5, true, self::INK, 'right');
            $my += 12;
        }

        // Supplier and delivery boxes.
        $y = max($y, $my) + 14;
        $boxWidth = (self::RIGHT - self::LEFT - 14) / 2;
        $pdf->rect(self::LEFT, $y, $boxWidth, 92, self::SOFT);
        $pdf->rect(self::LEFT + $boxWidth + 14, $y, $boxWidth, 92, self::SOFT);
        $pdf->text(self::LEFT + 12, $y + 18, 'SUPPLIER', 8, true, self::BLUE);
        $sy = $y + 34;
        foreach (array_filter([$supplier->name ?? '', $supplier->contact_person ?? null, $supplier->phone ?? null, $supplier->email ?? null, ($supplier->tax_pin ?? null) ? 'PIN: '.$supplier->tax_pin : null]) as $index => $line) {
            $pdf->text(self::LEFT + 12, $sy, $pdf->fit($line, $boxWidth - 24, $index === 0 ? 10 : 9, $index === 0), $index === 0 ? 10 : 9, $index === 0, $index === 0 ? self::INK : self::MUTED);
            $sy += 12;
        }
        $dx = self::LEFT + $boxWidth + 26;
        $pdf->text($dx, $y + 18, 'DELIVER TO', 8, true, self::BLUE);
        $pdf->text($dx, $y + 34, $pdf->fit($shopName.($branch ? ' - '.$branch->name : ''), $boxWidth - 24, 10, true), 10, true, self::INK);
        $pdf->paragraph($dx, $y + 46, $boxWidth - 24, $order->delivery_location ?: ($branch->name ?? ''), 9, false, self::MUTED);
        $pdf->text($dx, $y + 82, $pdf->fit('Payment terms: '.($order->payment_terms ?: 'As agreed'), $boxWidth - 24, 9, true), 9, true, self::INK);

        // Items table.
        $y += 112;
        $columns = [['#', 20, 'left'], ['Description', 205, 'left'], ['Unit', 60, 'left'], ['Qty', 40, 'right'], ['Unit cost', 70, 'right'], ['Discount', 55, 'right'], ['Line total', 65.28, 'right']];
        $header = function (float $y) use ($pdf, $columns) {
            $pdf->rect(self::LEFT, $y, self::RIGHT - self::LEFT, 22, self::INK);
            $x = self::LEFT + 6;
            foreach ($columns as [$label, $width, $align]) {
                $pdf->text($align === 'right' ? $x + $width - 12 : $x, $y + 14.5, $label, 8.5, true, [1, 1, 1], $align);
                $x += $width;
            }

            return $y + 22;
        };
        $y = $header($y);
        foreach ($items as $index => $item) {
            $codes = trim(implode('  ', array_filter([$item->sku ? 'SKU '.$item->sku : null, $item->isbn ? 'ISBN '.$item->isbn : null])));
            $titleLines = array_slice($pdf->wrap($item->description ?? '', 192, 9.5, true), 0, 2);
            $rowHeight = 10 + count($titleLines) * 12 + ($codes ? 11 : 0) + 4;
            if ($y + $rowHeight > SimplePdf::HEIGHT - 60) {
                $this->footer($pdf);
                $pdf->addPage();
                $y = $header(40);
            }
            if ($index % 2 === 1) $pdf->rect(self::LEFT, $y, self::RIGHT - self::LEFT, $rowHeight, [0.98, 0.985, 0.995]);
            $ty = $y + 14;
            $x = self::LEFT + 6;
            $pdf->text($x, $ty, (string) ($index + 1), 9, false, self::MUTED);
            $x += $columns[0][1];
            foreach ($titleLines as $n => $line) $pdf->text($x, $ty + $n * 12, $line, 9.5, true, self::INK);
            if ($codes) $pdf->text($x, $ty + count($titleLines) * 12, $pdf->fit($codes, 195, 8), 8, false, self::MUTED);
            $x += $columns[1][1];
            $unit = $item->unit_label.((int) $item->units_per_package > 1 ? ' x'.$item->units_per_package : '');
            $pdf->text($x, $ty, $pdf->fit($unit, 56, 9), 9, false, self::INK);
            $x += $columns[2][1];
            foreach ([[(string) $item->quantity, 3], [number_format((float) $item->unit_cost, 2), 4], [(float) $item->discount > 0 ? number_format((float) $item->discount, 2) : '-', 5], [number_format((float) $item->line_total, 2), 6]] as [$value, $column]) {
                $pdf->text($x + $columns[$column][1] - 12, $ty, $value, 9, $column === 6, self::INK, 'right');
                $x += $columns[$column][1];
            }
            $y += $rowHeight;
            $pdf->line(self::LEFT, $y, self::RIGHT, $y);
        }

        // Totals.
        if ($y > SimplePdf::HEIGHT - 260) {
            $this->footer($pdf);
            $pdf->addPage();
            $y = 40;
        }
        $y += 24;
        $tx = self::RIGHT - 200;
        $rows = [['Subtotal', $money($order->subtotal)]];
        if ((float) $order->discount_total > 0) $rows[] = ['Discount', '- '.$money($order->discount_total)];
        $rows[] = [sprintf('Tax (%s%%%s)', rtrim(rtrim(number_format((float) $order->tax_rate, 2), '0'), '.'), $order->prices_include_tax ? ', included' : ''), $money($order->tax_total)];
        foreach ($rows as [$label, $value]) {
            $pdf->text($tx, $y, $label, 9.5, false, self::MUTED);
            $pdf->text(self::RIGHT, $y, $value, 9.5, false, self::INK, 'right');
            $y += 15;
        }
        $pdf->rect($tx - 10, $y - 4, self::RIGHT - $tx + 10, 26, self::BLUE);
        $pdf->text($tx, $y + 13, 'TOTAL', 10.5, true, [1, 1, 1]);
        $pdf->text(self::RIGHT - 8, $y + 13, $money($order->total), 11.5, true, [1, 1, 1], 'right');
        $notesTop = $y - 15 * count($rows) - 6;

        // Delivery instructions and notes to the supplier, beside the totals.
        $ny = $notesTop;
        $pdf->text(self::LEFT, $ny, 'DELIVERY INSTRUCTIONS', 8, true, self::BLUE);
        $ny = $pdf->paragraph(self::LEFT, $ny + 14, 270, $order->supplier_notes ?: 'Please deliver with a delivery note quoting this LPO number. Confirm availability, pricing and delivery date before dispatch.', 9, false, self::INK);

        // Authorization.
        $y = max($y + 50, $ny + 30);
        $pdf->text(self::LEFT, $y, 'Authorized by', 8.5, false, self::MUTED);
        $pdf->text(self::LEFT, $y + 14, $authorizedBy ?: '', 10, true, self::INK);
        $pdf->text(self::LEFT, $y + 27, $order->confirmed_at ? 'Confirmed '.$this->date($order->confirmed_at) : 'Not yet confirmed', 8.5, false, self::MUTED);
        $pdf->line(self::LEFT + 290, $y + 22, self::RIGHT, $y + 22, self::MUTED, 0.6);
        $pdf->text(self::LEFT + 290, $y + 34, 'Signature & stamp', 8, false, self::MUTED);

        $this->footer($pdf);

        return $pdf->output();
    }

    private function footer(SimplePdf $pdf): void
    {
        $y = SimplePdf::HEIGHT - 30;
        $pdf->line(self::LEFT, $y - 14, self::RIGHT, $y - 14);
        $pdf->text(self::LEFT, $y, 'Generated using Nifunze Bookshop', 8, true, self::BLUE);
        $pdf->text(self::RIGHT, $y, 'Page '.$pdf->pageCount(), 8, false, self::MUTED, 'right');
    }

    private function date(?string $value): string
    {
        return $value ? date('d M Y', strtotime($value)) : '';
    }
}
