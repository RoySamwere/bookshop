<?php

namespace App\Support\Pdf;

/**
 * A small, dependency-free PDF writer for business documents (A4, Helvetica, text, lines, filled boxes).
 * Coordinates are in points from the TOP-LEFT of the page, which keeps layout code readable.
 * Text is encoded as Windows-1252, which covers English and the accented characters bookshops use.
 */
class SimplePdf
{
    public const WIDTH = 595.28;
    public const HEIGHT = 841.89;

    /** @var string[] */
    private array $pages = [];
    private string $current = '';
    private string $title = '';

    private const HELVETICA = [
        32 => 278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
        556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
        1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
        667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
        333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
        556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
    ];

    private const HELVETICA_BOLD = [
        32 => 278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
        556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
        975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
        667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
        333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
        611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
    ];

    public function __construct(string $title = '')
    {
        $this->title = $title;
        $this->addPage();
    }

    public function addPage(): void
    {
        if ($this->current !== '') $this->pages[] = $this->current;
        $this->current = ' ';
    }

    public function pageCount(): int
    {
        return count($this->pages) + 1;
    }

    /** Draws text; $align is left, right or center relative to $x (and $width for center/right boxes). */
    public function text(float $x, float $y, string $text, float $size = 10, bool $bold = false, array $rgb = [0.08, 0.13, 0.24], string $align = 'left'): void
    {
        $encoded = $this->encode($text);
        if ($align === 'right') $x -= $this->widthOf($text, $size, $bold);
        if ($align === 'center') $x -= $this->widthOf($text, $size, $bold) / 2;
        $this->current .= sprintf(
            "BT %s rg /%s %.2F Tf %.2F %.2F Td (%s) Tj ET\n",
            $this->color($rgb), $bold ? 'F2' : 'F1', $size, $x, self::HEIGHT - $y, $this->escape($encoded)
        );
    }

    /** Draws wrapped text inside a column and returns the y just below the last line. */
    public function paragraph(float $x, float $y, float $width, string $text, float $size = 10, bool $bold = false, array $rgb = [0.08, 0.13, 0.24], float $leading = 1.35): float
    {
        foreach ($this->wrap($text, $width, $size, $bold) as $line) {
            $this->text($x, $y, $line, $size, $bold, $rgb);
            $y += $size * $leading;
        }

        return $y;
    }

    /** @return string[] */
    public function wrap(string $text, float $width, float $size = 10, bool $bold = false): array
    {
        $lines = [];
        foreach (preg_split('/\r\n|\r|\n/', trim($text)) as $raw) {
            $line = '';
            foreach (preg_split('/\s+/', $raw) as $word) {
                $candidate = $line === '' ? $word : "$line $word";
                if ($line !== '' && $this->widthOf($candidate, $size, $bold) > $width) {
                    $lines[] = $line;
                    $line = $word;
                } else {
                    $line = $candidate;
                }
                // Break single words that are wider than the column (long ISBN lists, URLs).
                while ($this->widthOf($line, $size, $bold) > $width && mb_strlen($line) > 1) {
                    $cut = mb_strlen($line) - 1;
                    while ($cut > 1 && $this->widthOf(mb_substr($line, 0, $cut), $size, $bold) > $width) $cut--;
                    $lines[] = mb_substr($line, 0, $cut);
                    $line = mb_substr($line, $cut);
                }
            }
            $lines[] = $line;
        }

        return $lines;
    }

    public function line(float $x1, float $y1, float $x2, float $y2, array $rgb = [0.85, 0.88, 0.93], float $width = 0.75): void
    {
        $this->current .= sprintf("%s RG %.2F w %.2F %.2F m %.2F %.2F l S\n", $this->color($rgb), $width, $x1, self::HEIGHT - $y1, $x2, self::HEIGHT - $y2);
    }

    public function rect(float $x, float $y, float $w, float $h, array $fill): void
    {
        $this->current .= sprintf("%s rg %.2F %.2F %.2F %.2F re f\n", $this->color($fill), $x, self::HEIGHT - $y - $h, $w, $h);
    }

    public function widthOf(string $text, float $size, bool $bold = false): float
    {
        $table = $bold ? self::HELVETICA_BOLD : self::HELVETICA;
        $sum = 0;
        foreach (str_split($this->encode($text)) as $char) $sum += $table[ord($char)] ?? 556;

        return $sum * $size / 1000;
    }

    /** Truncates text with an ellipsis so it fits a column. */
    public function fit(string $text, float $width, float $size, bool $bold = false): string
    {
        if ($this->widthOf($text, $size, $bold) <= $width) return $text;
        while ($text !== '' && $this->widthOf($text.'...', $size, $bold) > $width) $text = mb_substr($text, 0, -1);

        return rtrim($text).'...';
    }

    public function output(): string
    {
        $pages = [...$this->pages, $this->current];
        $objects = [];
        $objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        $objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
        $objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
        $objects[5] = sprintf('<< /Title (%s) /Producer (Nifunze Bookshop) /Creator (Nifunze Bookshop) /CreationDate (D:%s) >>', $this->escape($this->encode($this->title)), gmdate('YmdHis').'Z');
        $kids = [];
        $next = 6;
        foreach ($pages as $content) {
            $pageId = $next++;
            $contentId = $next++;
            $kids[] = "$pageId 0 R";
            $objects[$pageId] = sprintf('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2F %.2F] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents %d 0 R >>', self::WIDTH, self::HEIGHT, $contentId);
            $objects[$contentId] = sprintf("<< /Length %d >>\nstream\n%s\nendstream", strlen($content), $content);
        }
        $objects[2] = sprintf('<< /Type /Pages /Kids [%s] /Count %d >>', implode(' ', $kids), count($kids));
        ksort($objects);

        $pdf = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
        $offsets = [];
        foreach ($objects as $id => $body) {
            $offsets[$id] = strlen($pdf);
            $pdf .= "$id 0 obj\n$body\nendobj\n";
        }
        $xref = strlen($pdf);
        $pdf .= sprintf("xref\n0 %d\n0000000000 65535 f \n", count($objects) + 1);
        foreach ($offsets as $offset) $pdf .= sprintf("%010d 00000 n \n", $offset);
        $pdf .= sprintf("trailer\n<< /Size %d /Root 1 0 R /Info 5 0 R >>\nstartxref\n%d\n%%%%EOF\n", count($objects) + 1, $xref);

        return $pdf;
    }

    private function encode(string $text): string
    {
        $converted = @iconv('UTF-8', 'Windows-1252//TRANSLIT//IGNORE', $text);

        return $converted === false ? preg_replace('/[^\x20-\x7E]/', '?', $text) : $converted;
    }

    private function escape(string $text): string
    {
        return str_replace(['\\', '(', ')', "\r", "\n"], ['\\\\', '\\(', '\\)', ' ', ' '], $text);
    }

    private function color(array $rgb): string
    {
        return sprintf('%.3F %.3F %.3F', ...$rgb);
    }
}
