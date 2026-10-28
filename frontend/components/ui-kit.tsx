'use client'

import { useEffect, useRef, type ReactNode } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, RefreshCw, X } from 'lucide-react'
import type { Paginated } from '../lib/api'

export const inputClass = 'mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-50 disabled:bg-slate-50 disabled:text-slate-500'
export const buttonClass = 'inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60'
export const primaryButton = `${buttonClass} bg-gradient-to-r from-[#087df5] to-[#376de8] text-white shadow-sm hover:brightness-105 focus:ring-blue-100`
export const secondaryButton = `${buttonClass} border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 focus:ring-slate-100`
export const dangerButton = `${buttonClass} border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 focus:ring-rose-100`

/** Compact version of the Nifunze fish loader for use inside pages and panels. */
export function FishSpinner({ size = 'md' }: { size?: 'sm' | 'md' }) {
  return <span className={`fish-inline fish-inline-${size}`} aria-hidden="true">
    <svg viewBox="0 0 120 72" fill="none"><path d="M16 36 2 18v36l14-18c21-21 48-25 78-1-30 24-57 20-78 1Z" fill="currentColor" /><circle cx="75" cy="30" r="3" fill="#fff" /></svg>
  </span>
}

export function LoadingState({ label = 'Loading', hint = 'This will only take a moment.' }: { label?: string; hint?: string }) {
  return <div className="flex flex-col items-center px-6 py-16 text-center" role="status" aria-live="polite">
    <FishSpinner />
    <p className="mt-3 text-sm font-medium text-slate-700">{label}</p>
    <p className="mt-1 text-xs text-slate-400">{hint}</p>
  </div>
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return <div className="flex flex-col items-center px-6 py-14 text-center">
    <span className="mb-3 grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">{icon}</span>
    <p className="text-sm font-semibold text-slate-700">{title}</p>
    <p className="mt-1 max-w-sm text-xs text-slate-400">{body}</p>
    {action && <div className="mt-4">{action}</div>}
  </div>
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div className="flex flex-col items-center px-6 py-14 text-center" role="alert">
    <span className="mb-3 grid size-12 place-items-center rounded-2xl bg-rose-50 text-rose-500"><AlertTriangle size={22} /></span>
    <p className="text-sm font-semibold text-slate-700">We could not load this</p>
    <p className="mt-1 max-w-sm text-xs text-slate-500">{message}</p>
    {onRetry && <button className={`${secondaryButton} mt-4 h-9`} onClick={onRetry}><RefreshCw size={15} /> Try again</button>}
  </div>
}

export function FormAlert({ message, tone = 'error' }: { message: string; tone?: 'error' | 'success' }) {
  if (!message) return null
  const colors = tone === 'error' ? 'border-rose-100 bg-rose-50 text-rose-700' : 'border-emerald-100 bg-emerald-50 text-emerald-700'
  return <p role={tone === 'error' ? 'alert' : 'status'} className={`mt-4 rounded-xl border px-3.5 py-3 text-sm ${colors}`}>{message}</p>
}

export function Field({ label, error, hint, className = '', children }: { label: string; error?: string; hint?: string; className?: string; children: ReactNode }) {
  return <label className={`block text-sm font-medium text-slate-700 ${className}`}>
    {label}
    {children}
    {error ? <span className="mt-1.5 block text-xs font-normal text-rose-600">{error}</span> : hint && <span className="mt-1.5 block text-xs font-normal text-slate-400">{hint}</span>}
  </label>
}

export function PageHeader({ eyebrow, icon, title, description, actions }: { eyebrow: string; icon: ReactNode; title: string; description: string; actions?: ReactNode }) {
  return <div className="mb-7 flex flex-wrap items-end justify-between gap-5">
    <div>
      <div className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-[0.16em] text-slate-500">
        <span className="grid size-7 place-items-center rounded-lg bg-blue-50 text-[#087df5]">{icon}</span>{eyebrow}
      </div>
      <h1 tabIndex={-1} className="text-3xl font-bold tracking-tight text-slate-900 outline-none">{title}</h1>
      <p className="mt-2 max-w-xl text-sm text-slate-500">{description}</p>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-3">{actions}</div>}
  </div>
}

export function StatCard({ label, value, hint, icon, tone = 'blue' }: { label: string; value: ReactNode; hint: string; icon: ReactNode; tone?: 'blue' | 'pink' | 'emerald' | 'amber' }) {
  const tones = { blue: 'bg-blue-50 text-[#087df5]', pink: 'bg-pink-50 text-[#d9539f]', emerald: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700' }
  return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex items-start justify-between">
      <div><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{value}</p></div>
      <span className={`grid size-10 place-items-center rounded-xl ${tones[tone]}`}>{icon}</span>
    </div>
    <p className="mt-3 text-xs text-slate-400">{hint}</p>
  </div>
}

export function StatusBadge({ active, activeLabel = 'Active', inactiveLabel = 'Inactive' }: { active: boolean; activeLabel?: string; inactiveLabel?: string }) {
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${active ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/10' : 'bg-slate-100 text-slate-500 ring-slate-500/10'}`}>
    <span className="size-1.5 rounded-full bg-current" />{active ? activeLabel : inactiveLabel}
  </span>
}

export function Card({ title, description, actions, children, flush = false }: { title: string; description?: string; actions?: ReactNode; children: ReactNode; flush?: boolean }) {
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div><h2 className="text-base font-bold text-slate-900">{title}</h2>{description && <p className="mt-1 text-sm text-slate-500">{description}</p>}</div>
      {actions}
    </div>
    <div className={flush ? '' : 'px-5 py-5 sm:px-6'}>{children}</div>
  </section>
}

export function Pagination({ meta, onPage }: { meta: Paginated<unknown>['meta']; onPage: (page: number) => void }) {
  if (!meta.total) return null
  return <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-6 py-3 text-xs text-slate-400">
    <span>Showing {meta.from}–{meta.to} of {meta.total}</span>
    {meta.last_page > 1 && <div className="flex items-center gap-1">
      <button className="grid size-8 place-items-center rounded-lg hover:bg-slate-100 disabled:opacity-40" disabled={meta.current_page <= 1} onClick={() => onPage(meta.current_page - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button>
      <span className="px-2 font-semibold text-slate-600">{meta.current_page} / {meta.last_page}</span>
      <button className="grid size-8 place-items-center rounded-lg hover:bg-slate-100 disabled:opacity-40" disabled={meta.current_page >= meta.last_page} onClick={() => onPage(meta.current_page + 1)} aria-label="Next page"><ChevronRight size={16} /></button>
    </div>}
  </div>
}

/** Accessible modal: traps focus, closes on Escape or backdrop click unless busy. */
export function Modal({ title, description, icon, onClose, busy = false, wide = false, children }: { title: string; description?: string; icon?: ReactNode; onClose: () => void; busy?: boolean; wide?: boolean; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null)
  const closeRef = useRef(onClose)
  const busyRef = useRef(busy)
  useEffect(() => { closeRef.current = onClose; busyRef.current = busy })

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const focusables = () => Array.from(panel.current?.querySelectorAll<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])') || [])
    ;(focusables().find(element => element.tagName !== 'BUTTON') || focusables()[0])?.focus()
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); closeRef.current() }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (!items.length) return
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus() }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus() }
  }, [])

  return <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/45 p-4 backdrop-blur-sm"
    onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section ref={panel} className={`my-auto w-full ${wide ? 'max-w-2xl' : 'max-w-xl'} overflow-hidden rounded-2xl bg-white shadow-2xl shadow-slate-950/20`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5 sm:px-7">
        <div>
          {icon && <span className="mb-3 grid size-10 place-items-center rounded-xl bg-blue-50 text-[#087df5]">{icon}</span>}
          <h2 id="modal-title" className="text-xl font-bold tracking-tight text-slate-900">{title}</h2>
          {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
        </div>
        <button type="button" className="grid size-9 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" onClick={onClose} disabled={busy} aria-label="Close dialog"><X size={18} /></button>
      </div>
      <div className="px-6 py-6 sm:px-7">{children}</div>
    </section>
  </div>
}

export function ModalActions({ busy, submitLabel, busyLabel, onCancel, danger = false }: { busy: boolean; submitLabel: string; busyLabel: string; onCancel: () => void; danger?: boolean }) {
  return <div className="mt-6 flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end">
    <button type="button" className={secondaryButton} onClick={onCancel} disabled={busy}>Cancel</button>
    <button type="submit" className={danger ? `${buttonClass} bg-rose-600 text-white hover:bg-rose-700 focus:ring-rose-100` : primaryButton} disabled={busy}>{busy ? busyLabel : submitLabel}</button>
  </div>
}

export const formatDate = (value: string | null, withTime = false) => value
  ? new Date(value).toLocaleString('en-KE', withTime ? { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' })
  : '—'
