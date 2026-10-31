Dear {{ $supplierName }},

Please find attached our Local Purchase Order {{ $lpoNumber }} for the listed products.

Kindly review the order and confirm product availability, pricing and expected delivery date.

We look forward to your confirmation.

Kind regards,

{{ $bookshopName }}
@foreach ($contactLines as $line)
{{ $line }}
@endforeach

Generated via Nifunze Bookshop.
