'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { Loader2, PauseCircle, ReceiptText, RefreshCw, X } from 'lucide-react'
import { formatKes, METHOD_LABELS, toNumber, type PosDaySummary, type PosSale } from '../../lib/pos-api'
import { cartTotal, cartUnits, type HeldSale } from '../../lib/pos-store'
import { receiptDate } from './receipt-print'

/** Slide-in panel from the right edge of the till. */
export function Drawer({ title, description, onClose, children }: { title: string; description?: string; onClose: () => void; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose })
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.querySelector<HTMLElement>('button, [href], input')?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current() } }
    window.addEventListener('keydown', onKey, true)
    return () => { window.removeEventListener('keydown', onKey, true); if (previous?.isConnected) previous.focus() }
  }, [])
  return <div className="fixed inset-0 z-50 flex justify-end bg-[#0d1b37]/40 backdrop-blur-[2px]" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="pos-drawer-title" className="pos-drawer flex h-full w-full max-w-md flex-col bg-white shadow-2xl">
      <header className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div><h2 id="pos-drawer-title" className="text-[17px] font-bold text-[#13254a]">{title}</h2>{description && <p className="mt-0.5 text-[13px] text-slate-500">{description}</p>}</div>
        <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close"><X size={18} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
    </div>
  </div>
}

export function HeldSalesPanel({ held, branchName, onResume, onDiscard, onClose }: {
  held: HeldSale[]; branchName: (id: string) => string; onResume: (sale: HeldSale) => void; onDiscard: (sale: HeldSale) => void; onClose: () => void
}) {
  return <Drawer title="Held sales" description="Sales parked on this till. Resume one to finish it." onClose={onClose}>
    {held.length === 0 ? <div className="flex flex-col items-center gap-2 px-8 py-16 text-center">
      <PauseCircle size={26} className="text-slate-300" aria-hidden="true" />
      <p className="text-sm font-semibold text-slate-800">No held sales</p>
      <p className="text-[13px] text-slate-500">Use Hold (F8) to set a sale aside while you serve someone else.</p>
    </div> : <ul className="divide-y divide-slate-100">
      {held.map(sale => <li key={sale.id} className="px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-[#162c4c]">{sale.label}</p>
            <p className="mt-0.5 text-[13px] tabular-nums text-slate-500">{cartUnits(sale.cart)} items · held {new Date(sale.createdAt).toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit' })} · {branchName(sale.branch)}</p>
          </div>
          <p className="shrink-0 text-[15px] font-bold tabular-nums text-[#13254a]">{formatKes(cartTotal(sale.cart))}</p>
        </div>
        <div className="mt-3 flex gap-2">
          <button type="button" onClick={() => onResume(sale)} className="h-10 flex-1 rounded-lg bg-[#087df5] text-[14px] font-semibold text-white hover:bg-[#066cd6]">Resume sale</button>
          <button type="button" onClick={() => onDiscard(sale)} className="h-10 rounded-lg border border-slate-200 px-3.5 text-[14px] font-semibold text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700">Discard</button>
        </div>
      </li>)}
    </ul>}
  </Drawer>
}

export function TodayPanel({ sales, summary, loading, error, onOpen, onRetry, onClose }: {
  sales: PosSale[]; summary: PosDaySummary | null; loading: boolean; error: string
  onOpen: (sale: PosSale) => void; onRetry: () => void; onClose: () => void
}) {
  return <Drawer title="Today's sales" description="Every sale at this branch today. Open one to reprint the receipt." onClose={onClose}>
    {summary && <dl className="grid grid-cols-3 gap-px border-b border-slate-100 bg-slate-100 text-center">
      {([['cash', 'Cash'], ['mpesa', 'M-Pesa'], ['card', 'Card']] as const).map(([key, label]) => <div key={key} className="bg-white px-2 py-3">
        <dt className="text-[12px] text-slate-500">{label}</dt><dd className="text-[14px] font-bold tabular-nums text-[#13254a]">{formatKes(toNumber(summary[key]))}</dd>
      </div>)}
    </dl>}
    {error ? <div className="flex flex-col items-center gap-3 px-8 py-14 text-center" role="alert">
      <p className="text-sm text-slate-600">{error}</p>
      <button type="button" onClick={onRetry} className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"><RefreshCw size={15} /> Try again</button>
    </div> : loading && !sales.length ? <div className="flex justify-center py-14"><Loader2 className="animate-spin text-slate-400" aria-label="Loading" /></div>
      : sales.length === 0 ? <div className="flex flex-col items-center gap-2 px-8 py-16 text-center">
        <ReceiptText size={26} className="text-slate-300" aria-hidden="true" />
        <p className="text-sm font-semibold text-slate-800">No sales yet today</p>
      </div> : <ul className="divide-y divide-slate-100">
        {sales.map(sale => <li key={sale.id}>
          <button type="button" onClick={() => onOpen(sale)} className="flex w-full items-center gap-3 px-5 py-3.5 text-left hover:bg-slate-50 focus-visible:bg-blue-50 focus-visible:outline-none">
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-semibold tabular-nums text-[#162c4c]">{sale.receipt_number}</p>
              <p className="truncate text-[12.5px] text-slate-500">{receiptDate(sale.created_at)} · {METHOD_LABELS[sale.payment_method] || sale.payment_method}{sale.cashier_name ? ` · ${sale.cashier_name}` : ''}</p>
            </div>
            <p className="shrink-0 text-[14px] font-bold tabular-nums text-[#13254a]">{formatKes(toNumber(sale.total))}</p>
          </button>
        </li>)}
      </ul>}
  </Drawer>
}

const SHORTCUTS: [string, string][] = [
  ['F2', 'Jump to the scan and search box'],
  ['Enter', 'Add the scanned or only matching product'],
  ['F9', 'Charge the customer'],
  ['1 / 2 / 3', 'Cash, M-Pesa or card (on the payment screen)'],
  ['F8', 'Hold the sale and start a new one'],
  ['Esc', 'Go back, close a panel or clear the search'],
]

export function ShortcutsPanel({ onClose }: { onClose: () => void }) {
  return <Drawer title="Keyboard shortcuts" description="For tills with a keyboard and barcode scanner." onClose={onClose}>
    <dl className="divide-y divide-slate-100">
      {SHORTCUTS.map(([keys, action]) => <div key={keys} className="flex items-center justify-between gap-4 px-5 py-3.5">
        <dt className="text-[14px] text-slate-700">{action}</dt>
        <dd><kbd className="whitespace-nowrap rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[12px] font-semibold text-slate-700">{keys}</kbd></dd>
      </div>)}
    </dl>
  </Drawer>
}
