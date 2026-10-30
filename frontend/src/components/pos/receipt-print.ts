import { formatKes, includedVat, METHOD_LABELS, toNumber, type PosReceipt } from '../../lib/pos-api'
import type { BusinessProfile } from '../../lib/workspace-api'

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))

export function receiptDate(value: string) {
  // The API stores UTC as "YYYY-MM-DD HH:MM:SS"; show it in the till's local time.
  const parsed = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Responsive receipt for thermal rolls (58/80 mm) and ordinary printer paper. */
export function receiptHtml(receipt: PosReceipt, profile: BusinessProfile | null, details: { shopName: string; branch?: string; cashier?: string }) {
  const { sale, items } = receipt
  const total = toNumber(sale.total)
  const vat = includedVat(total, profile)
  const address = [profile?.address, profile?.city].filter(Boolean).join(', ')
  const subtotal = vat ? total - vat.amount : total
  const lines = items.map(item => `<tr><td>${escape(item.title)}</td><td class="num">${escape(item.quantity)}</td><td class="num">${escape(formatKes(toNumber(item.unit_price)))}</td><td class="num">${escape(formatKes(toNumber(item.line_total)))}</td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>Receipt ${escape(sale.receipt_number)}</title><style>
    @page { margin: 4mm; }
    * { box-sizing: border-box; }
    html,body { max-width:100%; margin:0; padding:0; }
    body { font: 11px/1.45 'Courier New', monospace; color:#111; width:100%; max-width:80mm; margin:0 auto; overflow-wrap:anywhere; }
    @media print { body { max-width:100%; } }
    @media screen { body { padding:12px; } }
    h1 { font-size:16px; margin:0; text-align:center; font-weight:900; }
    .center{text-align:center}.small{font-size:10px}.line{border-top:1px dashed #222;margin:9px 0}
    table{width:100%;border-collapse:collapse;font-size:clamp(8px,2vw,10px);table-layout:fixed}
    th{text-align:left;border-bottom:1px dashed #222;overflow-wrap:anywhere}
    th:first-child,td:first-child{width:43%;text-align:left}
    th:nth-child(2),td:nth-child(2){width:10%}
    th:nth-child(3),td:nth-child(3){width:23%}
    th:nth-child(4),td:nth-child(4){width:24%}
    td{padding:4px 1px;vertical-align:top;overflow-wrap:anywhere}
    .num{text-align:right;white-space:normal;font-variant-numeric:tabular-nums}
    .sum{table-layout:auto}.sum td:first-child{width:auto}.sum td:last-child{text-align:right}
    .sum td{padding:3px 0}.grand td{border-top:1px dashed #222;font-size:14px;font-weight:bold;padding-top:7px}
    .footer{margin-top:18px;text-align:center}
  </style></head><body>
    <h1>${escape(profile?.name || details.shopName).toUpperCase()}</h1>
    <div class="center">${escape(address || details.branch || 'Kenya')}</div>
    ${profile?.phone ? `<div class="center">Tel: ${escape(profile.phone)}</div>` : ''}
    <div class="center">TAX INVOICE / RECEIPT</div><div class="line"></div>
    <div><b>Receipt No:</b> ${escape(sale.receipt_number)}</div>
    <div><b>Date:</b> ${escape(receiptDate(sale.created_at))}</div>
    <div><b>Cashier:</b> ${escape(details.cashier || sale.cashier_name || 'POS')}</div>
    ${details.branch ? `<div><b>Branch:</b> ${escape(details.branch)}</div>` : ''}
    <div class="line"></div>
    <table><thead><tr><th>Item Description</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Total</th></tr></thead><tbody>${lines}</tbody></table>
    <div class="line"></div>
    <table class="sum">
      <tr><td>Subtotal</td><td class="num">${escape(formatKes(subtotal))}</td></tr>
      ${vat ? `<tr><td>${escape(vat.label)} (${escape(vat.rate)}%)</td><td class="num">${escape(formatKes(vat.amount))}</td></tr>` : ''}
      <tr class="grand"><td>TOTAL</td><td class="num">${escape(formatKes(total))}</td></tr>
    </table><div class="line"></div>
    <div><b>Payment Method:</b> ${escape(METHOD_LABELS[sale.payment_method] || sale.payment_method)}</div>
    ${sale.payment_reference ? `<div>Reference: ${escape(sale.payment_reference)}</div>` : ''}
    ${toNumber(sale.change_due)>0 ? `<div>Change: ${escape(formatKes(toNumber(sale.change_due)))}</div>` : ''}
    <div class="line"></div><div class="footer">${escape(profile?.receipt_footer || 'Thank you for shopping with us!')}<br><i>Knowledge is Wisdom</i>${profile?.kra_pin ? `<br>VAT/PIN: ${escape(profile.kra_pin)}` : ''}</div>
  </body></html>`
}

/** Responsive invoice for A4, Letter, A5 and other printer page sizes. */
export function invoiceHtml(receipt: PosReceipt, profile: BusinessProfile | null, customer: { name: string; email?: string; address?: string; phone?: string }) {
  const { sale, items } = receipt
  const total = toNumber(sale.total)
  const vat = includedVat(total, profile)
  const subtotal = vat ? total - vat.amount : total
  const invoiceNumber = 'INV-' + sale.receipt_number
  const rows = items.map(item => `<tr><td>${escape(item.title)}</td><td class="num">${escape(item.quantity)}</td><td class="num">${escape(formatKes(toNumber(item.unit_price)))}</td><td class="num">${escape(formatKes(toNumber(item.line_total)))}</td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(invoiceNumber)}</title><style>
  @page{margin:12mm}
  *{box-sizing:border-box}
  html,body{width:100%;max-width:100%;margin:0;padding:0}
  body{font:13px/1.55 Arial,sans-serif;color:#171717;overflow-wrap:anywhere}
  header{display:flex;flex-wrap:wrap;justify-content:space-between;gap:16px;align-items:start;margin-bottom:28px}
  header>div{flex:1 1 210px;min-width:0}
  @media print{header,footer,.bill,tr{break-inside:avoid}thead{display:table-header-group}}
  @media screen{body{max-width:210mm;margin:auto;padding:18px}}
  @media(max-width:500px){header{display:block}header .right{text-align:left;margin-top:15px}h2{text-align:left!important}}
  
  h1{font-size:24px;margin:0}h2{font-size:27px;font-weight:500;margin:0;text-align:right}
  .muted{color:#555;font-size:12px}.right{text-align:right}.label{font-weight:700;font-size:12px}
  .bill{margin-bottom:38px;border-top:2px solid #222;padding-top:12px;max-width:310px;white-space:pre-line}
  table{width:100%;border-collapse:collapse;table-layout:fixed}
  thead{background:#171717;color:white}
  th{text-align:left;padding:9px 5px;font-size:11px;overflow-wrap:anywhere}
  th:first-child{width:43%}th:nth-child(2){width:10%}th:nth-child(3){width:23%}th:nth-child(4){width:24%}
  td{border-bottom:1px solid #e5e5e5;padding:9px 5px;overflow-wrap:anywhere}
  .num{text-align:right;white-space:normal;font-variant-numeric:tabular-nums}
  .totals{margin:22px 0 0 auto;width:min(100%,320px);table-layout:auto}
  .totals td{padding:7px;border:0}.grand{font-weight:700;font-size:18px;border-top:2px solid #171717}
  footer{margin-top:42px;display:flex;flex-wrap:wrap;justify-content:space-between;align-items:end;gap:16px}
  .paid{display:inline-block;padding:5px 12px;border:2px solid #167044;color:#167044;font-weight:800;letter-spacing:2px}
  </style></head><body><header><div><h1>${escape(profile?.name || 'HEKIMA BOOKSHOP')}</h1><div class="muted">${escape([profile?.address,profile?.city,profile?.country].filter(Boolean).join(', '))}<br>${profile?.email ? `Email: ${escape(profile.email)}<br>` : ''}${profile?.phone ? `Phone: ${escape(profile.phone)}<br>` : ''}${profile?.kra_pin ? `VAT/PIN: ${escape(profile.kra_pin)}` : ''}</div></div>
  <div class="right"><h2>INVOICE</h2><div><b>Invoice No:</b> ${escape(invoiceNumber)}</div><div><b>Date:</b> ${escape(receiptDate(sale.created_at))}</div><div><b>Receipt:</b> ${escape(sale.receipt_number)}</div><span class="paid">PAID</span></div></header>
  <section class="bill"><div class="label">BILL TO</div><b>${escape(customer.name || 'Walk-in customer')}</b><div>${escape(customer.address || '')}</div><div>${escape(customer.phone || '')}</div><div>${escape(customer.email || '')}</div></section>
  <table><thead><tr><th>DESCRIPTION</th><th class="num">QTY</th><th class="num">UNIT PRICE (KES)</th><th class="num">TOTAL (KES)</th></tr></thead><tbody>${rows}</tbody></table>
  <table class="totals"><tr><td>Subtotal</td><td class="num">${escape(formatKes(subtotal))}</td></tr>${vat ? `<tr><td>${escape(vat.label)} (${escape(vat.rate)}%)</td><td class="num">${escape(formatKes(vat.amount))}</td></tr>` : ''}<tr class="grand"><td>TOTAL AMOUNT</td><td class="num">${escape(formatKes(total))}</td></tr></table>
  <footer><div><b>PAYMENT DETAILS</b><br>Paid by ${escape(METHOD_LABELS[sale.payment_method] || sale.payment_method)}${sale.payment_reference ? `<br>Reference: ${escape(sale.payment_reference)}` : ''}<br>Amount due: KSh 0.00</div><i>Knowledge is Wisdom</i></footer>
  </body></html>`
}

/** Prints through a hidden frame, so popup blockers cannot stop it and the till stays in view. */
export function printReceipt(html: string) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  document.body.appendChild(frame)
  const cleanup = () => window.setTimeout(() => frame.remove(), 1000)
  frame.onload = () => {
    try {
      frame.contentWindow?.focus()
      frame.contentWindow?.print()
    } finally {
      // Hand the keyboard back to the till so F2 / Enter work straight after printing.
      window.focus()
      cleanup()
    }
  }
  frame.srcdoc = html
}
