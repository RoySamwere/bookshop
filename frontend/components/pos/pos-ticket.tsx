'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowLeft, Banknote, CheckCircle2, CreditCard, Minus, PauseCircle, Plus, Printer, ScanBarcode, Smartphone, Trash2, X } from 'lucide-react'
import { formatKes, includedVat, METHOD_LABELS, toNumber, type PaymentMethod, type PosReceipt } from '../../lib/pos-api'
import { available, cartTotal, cartUnits, lineTotal, MPESA_CODE, quickCashOptions, type CartLine } from '../../lib/pos-store'
import type { BusinessProfile } from '../../lib/workspace-api'
import { receiptDate } from './receipt-print'

/** The paper ticket: a white card with a torn bottom edge. */
export function Ticket({ children, label }: { children: ReactNode; label: string }) {
  return <section aria-label={label} className="pos-ticket relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#e1e8f4] bg-white shadow-[0_8px_35px_-22px_rgba(19,37,74,.3)]">{children}</section>
}

const Kbd = ({ children }: { children: ReactNode }) => <kbd className="rounded border border-current/25 px-1 py-px text-[10.5px] font-semibold opacity-70">{children}</kbd>

/* ---------------------------------------------------------------- sale ---------------------------------------------------------------- */

export function SaleView({ cart, flashId, profile, onQuantity, onRemove, onHold, onClear, onCharge }: {
  cart: CartLine[]; flashId: number | null; profile: BusinessProfile | null
  onQuantity: (productId: number, quantity: number) => void; onRemove: (productId: number) => void
  onHold: () => void; onClear: () => void; onCharge: () => void
}) {
  const total = cartTotal(cart)
  const units = cartUnits(cart)
  const vat = includedVat(total, profile)
  const [confirmClear, setConfirmClear] = useState(false)
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => { if (!confirmClear) return; const timer = window.setTimeout(() => setConfirmClear(false), 3500); return () => window.clearTimeout(timer) }, [confirmClear])
  // Keep the line the cashier just added in view.
  useEffect(() => { if (flashId) listRef.current?.querySelector(`[data-line="${flashId}"]`)?.scrollIntoView({ block: 'nearest' }) }, [flashId, cart])

  return <Ticket label="Current sale">
    <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 pb-4 pt-5">
      <div>
        <h2 className="text-[17px] font-bold text-[#13254a]">Current sale</h2>
        <p className="text-[13px] tabular-nums text-slate-500">{units ? `${units} ${units === 1 ? 'item' : 'items'} · ${cart.length} ${cart.length === 1 ? 'line' : 'lines'}` : 'Nothing added yet'}</p>
      </div>
      {cart.length > 0 && <div className="flex items-center gap-1.5">
        <button type="button" onClick={onHold} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900" title="Hold this sale (F8)">
          <PauseCircle size={16} /> Hold
        </button>
        <button type="button" onClick={() => confirmClear ? (setConfirmClear(false), onClear()) : setConfirmClear(true)}
          className={`inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold transition ${confirmClear ? 'bg-rose-600 text-white' : 'text-slate-500 hover:bg-rose-50 hover:text-rose-700'}`}>
          <Trash2 size={15} /> {confirmClear ? 'Tap again to clear' : 'Clear'}
        </button>
      </div>}
    </header>

    {cart.length === 0 ? <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 py-10 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-slate-100 text-slate-400"><ScanBarcode size={26} aria-hidden="true" /></span>
      <p className="text-[15px] font-semibold text-slate-800">Ready for the next customer</p>
      <p className="max-w-[16rem] text-[13px] leading-relaxed text-slate-500">Scan a barcode or tap a product to start the sale.</p>
    </div> : <ol ref={listRef} className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto px-5">
      {cart.map(line => <TicketLine key={line.product.id} line={line} flash={flashId === line.product.id} onQuantity={onQuantity} onRemove={onRemove} />)}
    </ol>}

    <footer className="border-t border-slate-200 bg-[#fbfcff] px-5 pb-6 pt-5">
      {vat && total > 0 && <div className="mb-1 flex justify-between text-[13px] tabular-nums text-slate-500"><span>Includes {vat.label}</span><span>{formatKes(vat.amount)}</span></div>}
      <div className="flex items-end justify-between gap-3">
        <span className="pb-1 text-[14px] font-semibold text-slate-600">Amount due</span>
        <strong className="text-[34px] font-extrabold leading-none tracking-tight tabular-nums text-[#13254a]" aria-live="polite">{formatKes(total)}</strong>
      </div>
      <button type="button" onClick={onCharge} disabled={!cart.length}
        className="mt-4 flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-[#087df5] text-[17px] font-bold text-white shadow-[0_8px_20px_-8px_rgba(8,125,245,.7)] transition hover:bg-[#066cd6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none">
        Charge {formatKes(total)} <span className="hidden text-white/80 sm:inline"><Kbd>F9</Kbd></span>
      </button>
    </footer>
  </Ticket>
}

function TicketLine({ line, flash, onQuantity, onRemove }: { line: CartLine; flash: boolean; onQuantity: (id: number, quantity: number) => void; onRemove: (id: number) => void }) {
  const { product, quantity } = line
  const limit = available(product)
  const [draft, setDraft] = useState(String(quantity))
  useEffect(() => setDraft(String(quantity)), [quantity])
  const commit = () => {
    const next = Number.parseInt(draft, 10)
    if (Number.isFinite(next) && next !== quantity) onQuantity(product.id, next)
    else setDraft(String(quantity))
  }

  return <li data-line={product.id} className={`py-3 transition-colors duration-700 ${flash ? 'bg-blue-50/80' : ''}`}>
    <div className="flex items-start gap-3">
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-[14px] font-semibold leading-snug text-[#162c4c]">{product.title}</p>
        <p className="mt-0.5 truncate text-[12px] tabular-nums text-slate-400">{product.isbn || product.sku}</p>
      </div>
      <p className="shrink-0 pt-px text-[14px] font-bold tabular-nums text-[#13254a]">{formatKes(lineTotal(line))}</p>
    </div>
    <div className="mt-2 flex items-center gap-2">
      <div className="flex h-9 items-center rounded-lg border border-slate-200 bg-white">
        <button type="button" onClick={() => onQuantity(product.id, quantity - 1)} className="grid h-full w-9 place-items-center rounded-l-lg text-slate-600 hover:bg-slate-100" aria-label={`One fewer ${product.title}`}><Minus size={15} /></button>
        <input value={draft} onChange={event => setDraft(event.target.value.replace(/\D/g, '').slice(0, 5))} onBlur={commit}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); (event.target as HTMLInputElement).blur() } }}
          inputMode="numeric" aria-label={`Quantity of ${product.title}`} className="pos-framed h-full w-11 border-x border-slate-200 text-center text-[14px] font-bold tabular-nums text-[#162c4c] outline-none focus:bg-blue-50" />
        <button type="button" onClick={() => onQuantity(product.id, quantity + 1)} disabled={quantity >= limit} className="grid h-full w-9 place-items-center rounded-r-lg text-slate-600 hover:bg-slate-100 disabled:opacity-35" aria-label={`One more ${product.title}`}><Plus size={15} /></button>
      </div>
      <span className="text-[12.5px] tabular-nums text-slate-500">× {formatKes(toNumber(product.selling_price))}</span>
      {quantity >= limit && <span className="text-[12px] font-semibold text-amber-700">All {limit} in stock</span>}
      <button type="button" onClick={() => onRemove(product.id)} className="ml-auto grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`Remove ${product.title}`}><X size={16} /></button>
    </div>
  </li>
}

/* --------------------------------------------------------------- tender --------------------------------------------------------------- */

const METHODS: { value: PaymentMethod; icon: typeof Banknote; hint: string }[] = [
  { value: 'cash', icon: Banknote, hint: '1' },
  { value: 'mpesa', icon: Smartphone, hint: '2' },
  { value: 'card', icon: CreditCard, hint: '3' },
]

export function tenderIsValid(total: number, method: PaymentMethod, received: string, reference: string) {
  if (method === 'cash') return toNumber(received) + 1e-9 >= total
  if (method === 'mpesa') return MPESA_CODE.test(reference.trim())
  return reference.trim().length >= 4
}

export function TenderView({ cart, method, received, reference, busy, error, onMethod, onReceived, onReference, onBack, onComplete }: {
  cart: CartLine[]; method: PaymentMethod; received: string; reference: string; busy: boolean; error: string
  onMethod: (method: PaymentMethod) => void; onReceived: (value: string) => void; onReference: (value: string) => void
  onBack: () => void; onComplete: () => void
}) {
  const total = cartTotal(cart)
  const cash = toNumber(received)
  const change = cash - total
  const valid = tenderIsValid(total, method, received, reference)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select() }, [method])

  return <Ticket label="Take payment">
    <header className="flex items-center gap-2 border-b border-dashed border-slate-200 px-3 pb-3 pt-3">
      <button type="button" onClick={onBack} disabled={busy} className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
        <ArrowLeft size={16} /> Back to sale
      </button>
      <span className="ml-auto pr-2 text-[13px] tabular-nums text-slate-500">{cartUnits(cart)} items</span>
    </header>

    <form className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pb-6 pt-5" onSubmit={event => { event.preventDefault(); if (valid && !busy) onComplete() }}>
      <p className="text-[14px] font-semibold text-slate-600">Amount due</p>
      <p className="text-[40px] font-extrabold leading-tight tracking-tight tabular-nums text-[#13254a]">{formatKes(total)}</p>

      <fieldset className="mt-5">
        <legend className="mb-2 text-[13px] font-semibold text-slate-600">Payment method</legend>
        <div className="grid grid-cols-3 gap-2">
          {METHODS.map(({ value, icon: Icon, hint }) => <button key={value} type="button" onClick={() => onMethod(value)} aria-pressed={method === value}
            className={`relative flex h-[72px] flex-col items-center justify-center gap-1 rounded-xl border-2 text-[14px] font-bold transition ${method === value ? 'border-[#087df5] bg-blue-50 text-[#0a5fc2]' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}>
            <Icon size={21} aria-hidden="true" />{METHOD_LABELS[value]}
            <span className="absolute right-1.5 top-1 hidden text-[10.5px] font-semibold text-slate-400 sm:block" aria-hidden="true">{hint}</span>
          </button>)}
        </div>
      </fieldset>

      {method === 'cash' ? <div className="mt-5">
        <label htmlFor="pos-cash" className="text-[13px] font-semibold text-slate-600">Cash received</label>
        <div className="pos-framed mt-1.5 flex h-14 items-center rounded-xl border-2 border-slate-200 bg-white px-4 focus-within:border-[#087df5] focus-within:ring-4 focus-within:ring-blue-100">
          <span className="text-[15px] font-semibold text-slate-400">KSh</span>
          <input id="pos-cash" ref={inputRef} value={received} onChange={event => onReceived(event.target.value.replace(/[^\d.]/g, ''))} inputMode="decimal" autoComplete="off"
            className="min-w-0 flex-1 bg-transparent pl-2 text-right text-[24px] font-bold tabular-nums text-[#162c4c] outline-none" aria-describedby="pos-change" />
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          <QuickAmount label="Exact" active={Math.abs(cash - total) < 0.005} onClick={() => onReceived(total.toFixed(2))} />
          {quickCashOptions(total).slice(0, 3).map(amount => <QuickAmount key={amount} label={amount.toLocaleString('en-KE')} active={Math.abs(cash - amount) < 0.005} onClick={() => onReceived(String(amount))} />)}
        </div>
        <div id="pos-change" className={`mt-4 flex items-center justify-between rounded-xl px-4 py-3 ${change >= -0.005 ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`} aria-live="polite">
          <span className="text-[14px] font-semibold">{change >= -0.005 ? 'Change to give' : 'Still to pay'}</span>
          <strong className="text-[22px] font-extrabold tabular-nums">{formatKes(Math.abs(change) < 0.005 ? 0 : Math.abs(change))}</strong>
        </div>
      </div> : <div className="mt-5">
        <label htmlFor="pos-reference" className="text-[13px] font-semibold text-slate-600">{method === 'mpesa' ? 'M-Pesa confirmation code' : 'Card approval or slip number'}</label>
        <input id="pos-reference" ref={inputRef} value={reference} autoComplete="off" spellCheck={false}
          onChange={event => onReference(method === 'mpesa' ? event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12) : event.target.value.slice(0, 100))}
          placeholder={method === 'mpesa' ? 'e.g. SJK7H2M1QX' : 'e.g. 482915'}
          className="pos-framed mt-1.5 h-14 w-full rounded-xl border-2 border-slate-200 bg-white px-4 text-[20px] font-bold tracking-[0.12em] text-[#162c4c] outline-none placeholder:font-normal placeholder:tracking-normal placeholder:text-slate-300 focus:border-[#087df5] focus:ring-4 focus:ring-blue-100" />
        <p className="mt-2 text-[13px] leading-relaxed text-slate-500">
          {method === 'mpesa' ? <>Check the customer&apos;s M-Pesa SMS shows <strong className="tabular-nums text-slate-700">{formatKes(total)}</strong> to the shop, then type the 10-character code.</>
            : <>Charge <strong className="tabular-nums text-slate-700">{formatKes(total)}</strong> on the card machine first, then enter the approval number from the slip.</>}
        </p>
      </div>}

      {error && <p role="alert" className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-[14px] text-rose-700">{error}</p>}

      <div className="mt-auto pt-6">
        <button type="submit" disabled={!valid || busy}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-[#0f8a5f] text-[17px] font-bold text-white shadow-[0_8px_20px_-8px_rgba(15,138,95,.7)] transition hover:bg-[#0c7550] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-emerald-200 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none">
          {busy ? 'Completing sale…' : `Complete ${METHOD_LABELS[method]} sale`}
        </button>
        <p className="mt-2.5 text-center text-[12px] leading-relaxed text-slate-500">M-Pesa and card payments are confirmed by you at the till, not through a payment gateway.</p>
      </div>
    </form>
  </Ticket>
}

function QuickAmount({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`h-11 rounded-lg border text-[14px] font-semibold tabular-nums transition ${active ? 'border-[#087df5] bg-blue-50 text-[#0a5fc2]' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'}`}>{label}</button>
}

/* -------------------------------------------------------------- receipt --------------------------------------------------------------- */

export function ReceiptView({ receipt, expectedTotal, profile, reprint, onPrint, onNewSale }: {
  receipt: PosReceipt; expectedTotal: number | null; profile: BusinessProfile | null; reprint?: boolean
  onPrint: () => void; onNewSale: () => void
}) {
  const { sale, items } = receipt
  const total = toNumber(sale.total)
  const change = toNumber(sale.change_due)
  const vat = includedVat(total, profile)
  const priceMoved = expectedTotal !== null && Math.abs(expectedTotal - total) >= 0.005
  const newSaleRef = useRef<HTMLButtonElement>(null)
  useEffect(() => { newSaleRef.current?.focus() }, [])

  return <Ticket label={reprint ? 'Receipt' : 'Sale complete'}>
    <header className="border-b border-dashed border-slate-200 px-5 pb-4 pt-5">
      {!reprint && <p role="status" className="flex items-center gap-2 text-[15px] font-bold text-[#0f8a5f]"><CheckCircle2 size={20} aria-hidden="true" /> Sale complete<span className="sr-only">, receipt {sale.receipt_number}{change > 0 ? `, give change ${formatKes(change)}` : ''}</span></p>}
      <p className={`${reprint ? '' : 'mt-1 '}text-[20px] font-bold tabular-nums text-[#13254a]`}>{sale.receipt_number}</p>
      <p className="text-[13px] text-slate-500">{receiptDate(sale.created_at)}{sale.cashier_name ? ` · ${sale.cashier_name}` : ''}</p>
    </header>

    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
      {!reprint && change > 0 && <div className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-emerald-800" role="status">
        <p className="text-[13px] font-semibold">Give change</p>
        <p className="text-[30px] font-extrabold leading-tight tabular-nums">{formatKes(change)}</p>
      </div>}
      {priceMoved && <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800" role="status">A price changed while this sale was open. The receipt shows the price that was charged.</p>}
      <ol className="space-y-2.5">
        {items.map((item, index) => <li key={index} className="flex justify-between gap-3 text-[13.5px]">
          <span className="min-w-0"><span className="line-clamp-2 font-medium text-[#162c4c]">{item.title}</span><span className="tabular-nums text-slate-500">{item.quantity} × {formatKes(toNumber(item.unit_price))}</span></span>
          <span className="shrink-0 font-semibold tabular-nums text-[#13254a]">{formatKes(toNumber(item.line_total))}</span>
        </li>)}
      </ol>
      <dl className="mt-4 space-y-1.5 border-t border-dashed border-slate-300 pt-3 text-[13.5px] tabular-nums">
        <div className="flex justify-between text-[16px] font-bold text-[#13254a]"><dt>Total</dt><dd>{formatKes(total)}</dd></div>
        {vat && <div className="flex justify-between text-slate-500"><dt>Includes {vat.label}</dt><dd>{formatKes(vat.amount)}</dd></div>}
        <div className="flex justify-between text-slate-600"><dt>Paid by {METHOD_LABELS[sale.payment_method] || sale.payment_method}</dt><dd>{formatKes(toNumber(sale.amount_received))}</dd></div>
        {sale.payment_reference && <div className="flex justify-between text-slate-600"><dt>Reference</dt><dd className="tracking-wide">{sale.payment_reference}</dd></div>}
        {change > 0 && <div className="flex justify-between text-slate-600"><dt>Change</dt><dd>{formatKes(change)}</dd></div>}
      </dl>
    </div>

    <footer className="grid grid-cols-2 gap-2 border-t border-slate-100 px-5 pb-6 pt-4">
      <button type="button" onClick={() => { onPrint(); window.setTimeout(() => newSaleRef.current?.focus(), 0) }} className="flex h-14 items-center justify-center gap-2 rounded-xl border-2 border-slate-200 bg-white text-[15px] font-bold text-slate-700 hover:border-slate-300 hover:bg-slate-50">
        <Printer size={18} aria-hidden="true" /> Print receipt
      </button>
      <button ref={newSaleRef} type="button" onClick={onNewSale} className="flex h-14 items-center justify-center rounded-xl bg-[#087df5] text-[15px] font-bold text-white hover:bg-[#066cd6] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200">
        {reprint ? 'Back to sale' : 'Next customer'}
      </button>
    </footer>
  </Ticket>
}
