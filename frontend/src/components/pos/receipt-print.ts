import { formatKes, includedVat, METHOD_LABELS, toNumber, type PosReceipt } from '../../lib/pos-api'
import type { BusinessProfile } from '../../lib/workspace-api'

const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))

export function receiptDate(value: string) {
  // The API stores UTC as "YYYY-MM-DD HH:MM:SS"; show it in the till's local time.
  const parsed = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`)
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Plain HTML sized for an 80 mm thermal roll; also prints legibly on A4. */
export function receiptHtml(receipt: PosReceipt, profile: BusinessProfile | null, details: { shopName: string; branch?: string; cashier?: string }) {
  const { sale, items } = receipt
  const total = toNumber(sale.total)
  const vat = includedVat(total, profile)
  const address = [profile?.address, profile?.city].filter(Boolean).join(', ')
  const lines = items.map(item => `<tr><td>${escape(item.title)}<br><span>${item.quantity} × ${escape(formatKes(toNumber(item.unit_price)))}</span></td><td>${escape(formatKes(toNumber(item.line_total)))}</td></tr>`).join('')

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(sale.receipt_number)}</title><style>
    @page { size: 80mm auto; margin: 4mm; }
    body { font: 12px/1.45 ui-monospace, 'Courier New', monospace; color: #000; width: 72mm; margin: 0 auto; }
    h1 { font-size: 15px; margin: 0 0 2px; text-align: center; }
    .center { text-align: center; } .muted { color: #333; }
    hr { border: 0; border-top: 1px dashed #000; margin: 8px 0; }
    table { width: 100%; border-collapse: collapse; } td { vertical-align: top; padding: 2px 0; }
    td:last-child { text-align: right; white-space: nowrap; padding-left: 8px; } td span { color: #333; }
    .total td { font-size: 15px; font-weight: 700; padding-top: 4px; }
  </style></head><body>
    <h1>${escape(profile?.name || details.shopName)}</h1>
    ${profile?.receipt_header ? `<p class="center">${escape(profile.receipt_header)}</p>` : ''}
    <p class="center muted">${[address, profile?.phone ? `Tel ${profile.phone}` : '', profile?.kra_pin ? `PIN ${profile.kra_pin}` : ''].filter(Boolean).map(escape).join('<br>')}</p>
    <hr>
    <p>Receipt ${escape(sale.receipt_number)}<br>${escape(receiptDate(sale.created_at))}${details.branch ? `<br>Branch: ${escape(details.branch)}` : ''}${details.cashier ? `<br>Served by: ${escape(details.cashier)}` : ''}</p>
    <hr>
    <table>${lines}</table>
    <hr>
    <table>
      <tr class="total"><td>Total</td><td>${escape(formatKes(total))}</td></tr>
      ${vat ? `<tr><td>Includes ${escape(vat.label)}</td><td>${escape(formatKes(vat.amount))}</td></tr>` : ''}
      <tr><td>Paid by ${escape(METHOD_LABELS[sale.payment_method] || sale.payment_method)}</td><td>${escape(formatKes(toNumber(sale.amount_received)))}</td></tr>
      ${sale.payment_reference ? `<tr><td>Reference</td><td>${escape(sale.payment_reference)}</td></tr>` : ''}
      ${toNumber(sale.change_due) > 0 ? `<tr><td>Change</td><td>${escape(formatKes(toNumber(sale.change_due)))}</td></tr>` : ''}
    </table>
    <hr>
    <p class="center">${escape(profile?.receipt_footer || 'Thank you for shopping with us.')}</p>
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
