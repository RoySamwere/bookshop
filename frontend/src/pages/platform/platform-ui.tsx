import type { ReactNode } from 'react'
import type { BookshopStatus } from '../../lib/auth'
import { BOOKSHOP_STATUS_LABELS } from '../../lib/tenancy-api'
import { NavLink } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'

/** Shared building blocks for every Platform Owner page, so all of /platform reads as one product. */

export const kes = (value: number | string | null | undefined) => `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
export const fieldClass = 'h-10 w-full rounded-lg border border-[var(--pf-line)] bg-white px-3 text-sm text-[var(--pf-ink)] outline-none transition placeholder:text-slate-400 focus:border-[var(--pf-brand)] focus:ring-4 focus:ring-blue-50'
export const thClass = 'px-4 py-2.5 text-left text-xs font-semibold text-[var(--pf-muted)]'
export const tdClass = 'px-4 py-3 align-middle'

/** Page title (the one serif element), plain-language description and the page's main actions. */
export function PlatformTitle({ title, description, actions, meta }: { title: string; description?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0">
      <h1 className="pf-title text-[28px] text-[var(--pf-ink)] sm:text-[32px]">{title}</h1>
      {description && <p className="mt-2 max-w-[68ch] text-sm leading-6 text-[var(--pf-muted)]">{description}</p>}
      {meta && <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
  </header>
}

/** A white panel with an optional heading row. Tables sit flush; forms and text get padding. */
export function Panel({ title, description, actions, children, flush = false, className = '' }: { title?: string; description?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return <section className={`min-w-0 rounded-2xl border border-[var(--pf-line)] bg-white ${className}`}>
    {(title || actions) && <div className="flex flex-col gap-3 border-b border-[var(--pf-line)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">{title && <h2 className="text-[15px] font-semibold text-[var(--pf-ink)]">{title}</h2>}{description && <p className="mt-0.5 text-sm text-[var(--pf-muted)]">{description}</p>}</div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>}
    <div className={flush ? '' : 'p-5'}>{children}</div>
  </section>
}

export type Tone = 'positive' | 'info' | 'warning' | 'danger' | 'neutral'
const TONES: Record<Tone, string> = {
  positive: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15',
  info: 'bg-blue-50 text-blue-700 ring-blue-600/15',
  warning: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  danger: 'bg-rose-50 text-rose-700 ring-rose-600/15',
  neutral: 'bg-slate-100 text-slate-600 ring-slate-500/15',
}

/** One mapping for every record state on the platform, so "paid", "active" and "expired" always look the same. */
export function toneFor(status: string | null | undefined): Tone {
  switch (status) {
    case 'active': case 'paid': case 'reconciled': case 'confirmed': case 'verified': return 'positive'
    case 'trialing': case 'awaiting_verification': return 'info'
    case 'pending': case 'partially_paid': case 'past_due': case 'grace_period': case 'pending_verification': case 'unknown': case 'requires_review': return 'warning'
    case 'expired': case 'overdue': case 'suspended': case 'unmatched': case 'failed': case 'timed_out': return 'danger'
    default: return 'neutral'
  }
}
export const humanize = (value: string) => value.replaceAll('_', ' ').replace(/^./, c => c.toUpperCase())

export function ShopStatus({ status }: { status: BookshopStatus }) {
  return <StatePill status={status} label={BOOKSHOP_STATUS_LABELS[status]} />
}

/** Label and value pairs for detail panels. */
export function DetailList({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="m-0 grid gap-3 text-sm">{rows.map(([label, value]) => <div key={label} className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-3"><dt className="text-[var(--pf-muted)]">{label}</dt><dd className="m-0 flex min-w-0 flex-wrap items-center gap-2 break-words">{value}</dd></div>)}</dl>
}

/** Status badge: colour plus a written label and a dot, never colour alone. */
export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONES[tone]}`}><span aria-hidden="true" className="size-1.5 rounded-full bg-current" />{children}</span>
}
export function StatePill({ status, label }: { status: string; label?: string }) {
  return <Pill tone={toneFor(status)}>{label ?? humanize(status)}</Pill>
}

/** Key figures as one divided strip rather than a row of separate cards. */
export function MetricStrip({ children, label }: { children: ReactNode; label: string }) {
  return <section aria-label={label} className="grid overflow-hidden rounded-2xl border border-[var(--pf-line)] bg-white sm:grid-cols-2 lg:auto-cols-fr lg:grid-flow-col lg:grid-cols-none [&>*]:border-[var(--pf-line)] [&>*:not(:last-child)]:border-b sm:[&>*:nth-child(odd)]:border-r lg:[&>*:not(:last-child)]:border-b-0 lg:[&>*:not(:last-child)]:border-r">{children}</section>
}
export function Metric({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'owed' | 'alert' }) {
  return <div className="min-w-0 px-5 py-4">
    <p className="text-[13px] font-medium text-[var(--pf-muted)]">{label}</p>
    <p className={`pf-num mt-1 truncate text-2xl font-semibold ${tone === 'owed' ? 'text-amber-700' : tone === 'alert' ? 'text-rose-700' : 'text-[var(--pf-ink)]'}`}>{value}</p>
    {hint && <p className="mt-0.5 text-xs text-[var(--pf-muted)]">{hint}</p>}
  </div>
}

/** Secondary navigation for a workspace with several pages. Links, so every tab is a deep link. */
export function SubNav({ label, items }: { label: string; items: { to: string; label: string; end?: boolean }[] }) {
  return <nav aria-label={label} className="pf-scroll-x -mx-4 mb-6 border-b border-[var(--pf-line)] px-4 sm:mx-0 sm:px-0">
    <ul className="m-0 flex list-none gap-1 p-0">{items.map(item => <li key={item.to} className="shrink-0">
      <NavLink to={item.to} end={item.end} className={({ isActive }) => `relative block px-3 py-2.5 text-sm font-medium transition ${isActive ? 'text-[var(--pf-ink)] after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-[var(--pf-brand)]' : 'text-[var(--pf-muted)] hover:text-[var(--pf-ink)]'}`}>{item.label}</NavLink>
    </li>)}</ul>
  </nav>
}

/** Segmented control for views inside one tab. */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return <div role="group" aria-label={label} className="pf-scroll-x inline-flex w-fit max-w-full gap-1 justify-self-start rounded-xl bg-slate-200/60 p-1">
    {options.map(option => <button key={option.value} type="button" aria-pressed={value === option.value} onClick={() => onChange(option.value)}
      className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition ${value === option.value ? 'bg-white text-[var(--pf-ink)] shadow-sm' : 'text-[var(--pf-muted)] hover:text-[var(--pf-ink)]'}`}>{option.label}</button>)}
  </div>
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 border-b border-[var(--pf-line)] px-5 py-3 sm:flex-row sm:flex-wrap sm:items-end">{children}</div>
}
export function SearchField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string }) {
  return <label className="relative block min-w-0 sm:w-72"><span className="sr-only">{label}</span>
    <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
    <input className={`${fieldClass} pl-9`} type="search" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} /></label>
}
export function SelectField({ label, value, onChange, children, hideLabel = false }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode; hideLabel?: boolean }) {
  return <label className="block text-xs font-medium text-[var(--pf-muted)] sm:w-48"><span className={hideLabel ? 'sr-only' : 'mb-1 block'}>{label}</span>
    <select className={fieldClass} value={value} onChange={e => onChange(e.target.value)}>{children}</select></label>
}

/** Pager for Laravel paginator payloads ({ current_page, last_page, total }). */
export function PageControls({ page, onPage }: { page: { current_page: number; last_page: number; total: number }; onPage: (page: number) => void }) {
  if (page.last_page <= 1) return <p className="px-5 py-3 text-xs text-[var(--pf-muted)]">{page.total} {page.total === 1 ? 'record' : 'records'}</p>
  return <div className="flex items-center justify-between gap-3 px-5 py-3 text-xs text-[var(--pf-muted)]">
    <span>Page {page.current_page} of {page.last_page}, {page.total} records</span>
    <span className="flex gap-1">
      <button type="button" className="grid size-8 place-items-center rounded-lg border border-[var(--pf-line)] bg-white hover:bg-slate-50 disabled:opacity-40" disabled={page.current_page <= 1} onClick={() => onPage(page.current_page - 1)} aria-label="Previous page"><ChevronLeft size={15} /></button>
      <button type="button" className="grid size-8 place-items-center rounded-lg border border-[var(--pf-line)] bg-white hover:bg-slate-50 disabled:opacity-40" disabled={page.current_page >= page.last_page} onClick={() => onPage(page.current_page + 1)} aria-label="Next page"><ChevronRight size={15} /></button>
    </span>
  </div>
}

/**
 * Single-series horizontal bars: one hue, direct value labels, and a tooltip per bar. The labelled rows double as
 * the table view, so no value is carried by colour or length alone.
 */
export function BarList({ label, rows, format = String }: { label: string; rows: { key: string; label: string; value: number }[]; format?: (value: number) => string }) {
  const max = Math.max(1, ...rows.map(row => row.value))
  const total = rows.reduce((sum, row) => sum + row.value, 0)
  return <ul aria-label={label} className="m-0 grid list-none gap-3 p-0">{rows.map(row => {
    const share = total ? Math.round((row.value / total) * 100) : 0
    return <li key={row.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
      <span className="truncate text-[var(--pf-muted)]">{row.label}</span>
      <span className="pf-bar block h-2.5 rounded bg-slate-100 outline-none" tabIndex={0} aria-label={`${row.label}: ${format(row.value)}, ${share}%`}>
        <span className="block h-full rounded bg-[var(--pf-brand)]" style={{ width: row.value ? `max(4px, ${(row.value / max) * 100}%)` : 0 }} />
        <span role="tooltip" className="rounded-md bg-[var(--pf-ink)] px-2 py-1 text-xs text-white">{row.label}: {format(row.value)} ({share}%)</span>
      </span>
      <span className="pf-num text-right font-semibold text-[var(--pf-ink)]">{format(row.value)}</span>
    </li>
  })}</ul>
}

/** Collected vs outstanding as one two-part bar with a labelled legend; blue is received money, amber is owed. */
export function SplitBar({ collected, outstanding }: { collected: number; outstanding: number }) {
  const total = collected + outstanding
  const collectedShare = total ? (collected / total) * 100 : 0
  return <div>
    <div className="flex h-3 gap-0.5 overflow-hidden rounded" role="img" aria-label={`Collected ${kes(collected)}, outstanding ${kes(outstanding)}`}>
      {total === 0 ? <span className="block h-full w-full rounded bg-slate-100" /> : <>
        {collected > 0 && <span className="pf-bar block h-full rounded-l bg-[var(--pf-brand)]" style={{ width: `${collectedShare}%` }} title={`Collected ${kes(collected)}`} />}
        {outstanding > 0 && <span className="pf-bar block h-full flex-1 rounded-r bg-[var(--pf-owed)]" title={`Outstanding ${kes(outstanding)}`} />}
      </>}
    </div>
    <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
      <div className="flex items-center gap-2"><span aria-hidden="true" className="size-2.5 rounded-sm bg-[var(--pf-brand)]" /><dt className="text-[var(--pf-muted)]">Collected</dt><dd className="pf-num m-0 font-semibold">{kes(collected)}</dd></div>
      <div className="flex items-center gap-2"><span aria-hidden="true" className="size-2.5 rounded-sm bg-[var(--pf-owed)]" /><dt className="text-[var(--pf-muted)]">Outstanding</dt><dd className="pf-num m-0 font-semibold">{kes(outstanding)}</dd></div>
    </dl>
  </div>
}
