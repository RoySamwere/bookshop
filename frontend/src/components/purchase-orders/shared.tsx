import { useEffect, useRef, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { api } from '../../lib/api'
import { EMAIL_LABELS, STATUS_LABELS, type EmailStatus, type PurchaseOrderStatus } from '../../lib/purchasing-api'

export type SupplierOption = { id: number; name: string; email: string | null; is_active: boolean; payment_terms?: string | null; lead_time_days?: number | null }

const statusTone: Record<PurchaseOrderStatus, string> = {
  draft: 'bg-slate-100 text-slate-700',
  pending_approval: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  approved: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  confirmed: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  sent: 'bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200',
  partially_received: 'bg-pink-50 text-pink-700 ring-1 ring-pink-200',
  completed: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  cancelled: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
}

const emailTone: Record<EmailStatus, string> = {
  not_sent: 'text-slate-500', queued: 'text-amber-700', sending: 'text-amber-700', sent: 'text-emerald-700', failed: 'text-rose-700',
}

export function StatusPill({ status }: { status: PurchaseOrderStatus }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${statusTone[status]}`}>{STATUS_LABELS[status]}</span>
}

export function EmailState({ status }: { status: EmailStatus }) {
  return <span className={`whitespace-nowrap text-xs font-semibold ${emailTone[status]}`}>{EMAIL_LABELS[status]}</span>
}

/** Every supplier in the bookshop (active first), loaded once per screen. */
export function useSuppliers() {
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([])
  useEffect(() => {
    let live = true
    api<{ data: SupplierOption[] }>('/suppliers', { query: { per_page: 200 } })
      .then(result => { if (live) setSuppliers([...result.data].sort((a, b) => Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name))) })
      .catch(() => undefined)
    return () => { live = false }
  }, [])
  return suppliers
}

/** A large right-hand panel for order details and forms; Escape closes it unless busy. */
export function Sheet({ title, subtitle, onClose, busy = false, children, footer }: { title: ReactNode; subtitle?: ReactNode; onClose: () => void; busy?: boolean; children: ReactNode; footer?: ReactNode }) {
  const panel = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  useEffect(() => { closeRef.current = onClose; busyRef.current = busy })
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    panel.current?.focus()
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busyRef.current && !document.querySelector('[role="dialog"][data-nested]')) closeRef.current() }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus() }
  }, [])
  return <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/40 backdrop-blur-[2px]" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="sheet-title" className="flex h-full w-full max-w-5xl flex-col bg-[#f7f9fd] shadow-2xl outline-none">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4 sm:px-7">
        <div className="min-w-0"><h2 id="sheet-title" className="truncate text-lg font-bold tracking-tight text-slate-900">{title}</h2>{subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}</div>
        <button type="button" onClick={onClose} disabled={busy} aria-label="Close" className="grid size-9 flex-none place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"><X size={18} /></button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-7">{children}</div>
      {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white px-5 py-3 sm:px-7">{footer}</footer>}
    </section>
  </div>
}

/** Small prompt for a reason or note (reject, cancel, amend, manual send). */
export function ReasonDialog({ title, label, submitLabel, danger, optional, busy, onSubmit, onClose, children }: { title: string; label: string; submitLabel: string; danger?: boolean; optional?: boolean; busy: boolean; onSubmit: (reason: string) => void; onClose: () => void; children?: ReactNode }) {
  const [reason, setReason] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { input.current?.focus() }, [])
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/45 p-4" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <form role="dialog" data-nested aria-modal="true" aria-label={title} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
      onSubmit={event => { event.preventDefault(); if (optional || reason.trim()) onSubmit(reason.trim()) }}
      onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose() } }}>
      <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      {children}
      <label className="mt-4 block text-sm font-semibold text-slate-700">{label}{optional && <span className="font-normal text-slate-400"> (optional)</span>}
        <textarea ref={input} value={reason} onChange={event => setReason(event.target.value)} maxLength={500} rows={3} required={!optional}
          className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50" />
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Back</button>
        <button type="submit" className={danger ? 'inline-flex h-11 items-center rounded-xl bg-rose-600 px-4 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-60' : 'primary-button'} disabled={busy || (!optional && !reason.trim())}>{busy ? 'Working…' : submitLabel}</button>
      </div>
    </form>
  </div>
}

export const today = () => new Date().toLocaleDateString('en-CA')
export const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`)
