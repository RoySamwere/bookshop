<!doctype html>
<html lang="en">
<body style="margin:0;padding:24px;background:#f5f7fc;font-family:Arial,Helvetica,sans-serif;color:#14213d;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
    <tr><td style="height:5px;background:#0071f9;"></td></tr>
    <tr><td style="padding:28px 32px;font-size:15px;line-height:1.6;">
      <p style="margin:0 0 16px;">Dear {{ $supplierName }},</p>
      <p style="margin:0 0 16px;">Please find attached our Local Purchase Order <strong>{{ $lpoNumber }}</strong> for the listed products.</p>
      <p style="margin:0 0 16px;">Kindly review the order and confirm product availability, pricing and expected delivery date.</p>
      <p style="margin:0 0 24px;">We look forward to your confirmation.</p>
      <p style="margin:0 0 4px;">Kind regards,</p>
      <p style="margin:0;font-weight:bold;">{{ $bookshopName }}</p>
      @foreach ($contactLines as $line)
        <p style="margin:0;color:#4a5670;font-size:13px;">{{ $line }}</p>
      @endforeach
    </td></tr>
    <tr><td style="padding:14px 32px;border-top:1px solid #e6eaf2;font-size:12px;color:#0071f9;font-weight:bold;">Generated via Nifunze Bookshop.</td></tr>
  </table>
</body>
</html>
