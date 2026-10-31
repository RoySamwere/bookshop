import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ClipboardList, Clock3, Download, FileCheck2, FileClock, FilePen, MailWarning, PackageOpen, Plus, Search, ShieldCheck, Truck, WalletCards } from 'lucide-react'
import { errorMessage } from '../../lib/api'
import { hasPermission, type BookshopUser } from '../../lib/auth'
import { EMAIL_LABELS, formatMoney, purchasingApi, STATUS_LABELS, type LaravelPage, type PurchaseOrderRow, type PurchaseTab, type PurchasingReport, type PurchasingSettings, type PurchasingSummary } from '../../lib/purchasing-api'
import { formatDate } from '../ui-kit'
import { downloadBrandedTable, safeCell } from '../../lib/branded-export'
import { OrderDetail } from './order-detail'
import { OrderForm } from './order-form'
import { ReorderSuggestions } from './reorder-suggestions'
import { EmailState, StatusPill, useSuppliers } from './shared'

type Tab = 'overview' | 'suggestions' | PurchaseTab
const TABS: { value: Tab; label: string; count?: (s: PurchasingSummary) => number }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'suggestions', label: 'Reorder suggestions', count: s => s.below_reorder_level },
  { value: 'drafts', label: 'Draft orders', count: s => s.drafts },
  { value: 'pending', label: 'Pending approval', count: s => s.awaiting_approval + s.approved },
  { value: 'sent', label: 'Confirmed / Sent', count: s => s.awaiting_delivery },
  { value: 'partial', label: 'Partially received', count: s => s.partially_received },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled / Failed' },
]

/** Purchase Orders: smart reordering, LPO workflow, supplier delivery and receiving. */
export function PurchaseOrdersView({ currentUser, notify }: { currentUser: BookshopUser; notify: (message: string) => void }) {
  const [tab, setTab] = useState<Tab>(() => {
    const requested = new URLSearchParams(window.location.search).get('po_tab') as Tab | null
    return requested && TABS.some(item => item.value === requested) ? requested : 'overview'
  })
  const [summary, setSummary] = useState<PurchasingSummary | null>(null)
  const [openId, setOpenId] = useState<number | null>(null)
  const [creating, setCreating] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)
  const suppliers = useSuppliers()
  const canManage = hasPermission(currentUser, 'purchases.manage')
  const branches = currentUser.branches
  const currency = summary?.currency || currentUser.bookshop?.currency || 'KES'

  const refresh = useCallback(() => {
    setRefreshKey(key => key + 1)
    purchasingApi.summary().then(result => setSummary(result.data)).catch(() => undefined)
  }, [])
  useEffect(() => { refresh() }, [refresh])

  function choose(next: Tab) {
    setTab(next)
    try { const url = new URL(window.location.href); url.searchParams.set('po_tab', next); window.history.replaceState(window.history.state, '', url) } catch { /* Optional deep link. */ }
  }

  return <main className="mx-auto w-full max-w-[1500px] space-y-5 px-3 pb-10 sm:px-5">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="text-xs font-bold uppercase tracking-widest text-[#087df5]">Procurement</p>
        <h1 tabIndex={-1} className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Purchase Orders</h1>
        <p className="mt-1 text-sm text-slate-500">Reorder what is running low, send Local Purchase Orders to suppliers and receive deliveries into stock.</p></div>
      {canManage && <button type="button" className="primary-button" onClick={() => setCreating(true)}><Plus size={16} /> New purchase order</button>}
    </header>

    <nav aria-label="Purchase order views" className="-mx-1 flex gap-1 overflow-x-auto border-b border-slate-200 px-1">
      {TABS.map(item => {
        const count = summary && item.count ? item.count(summary) : 0
        return <button key={item.value} type="button" aria-pressed={tab === item.value} onClick={() => choose(item.value)}
          className={`flex flex-none items-center gap-2 border-b-[3px] px-3 pb-3 pt-1 text-sm font-semibold transition ${tab === item.value ? 'border-[#087df5] text-[#0a5cc5]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          {item.label}{count > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${tab === item.value ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'}`}>{count}</span>}
        </button>
      })}
    </nav>

    {tab === 'overview' && <Overview summary={summary} currency={currency} currentUser={currentUser} onTab={choose} onOpen={setOpenId} refreshKey={refreshKey} notify={notify} />}
    {tab === 'suggestions' && <ReorderSuggestions bookshopName={currentUser.bookshop?.name} branches={branches} suppliers={suppliers} canManage={canManage} currency={currency} notify={notify}
      onDraftsCreated={ids => { refresh(); if (ids.length === 1) setOpenId(ids[0]); else choose('drafts') }} />}
    {tab !== 'overview' && tab !== 'suggestions' && <OrderList tab={tab} bookshopName={currentUser.bookshop?.name} currency={currency} branches={branches} suppliers={suppliers} refreshKey={refreshKey} onOpen={setOpenId} />}

    {creating && <OrderForm mode="create" branches={branches} suppliers={suppliers} currency={currency} canEditPrices={canManage} onClose={() => setCreating(false)}
      onSaved={(order, message) => { setCreating(false); notify(message); refresh(); setOpenId(order.id) }} />}
    {openId !== null && <OrderDetail id={openId} userName={currentUser.name} branches={branches} suppliers={suppliers} canEditPrices={canManage} notify={notify}
      onClose={() => setOpenId(null)} onChanged={refresh} />}
  </main>
}

function Metric({ label, value, hint, icon, tone = 'blue', onClick }: { label: string; value: string | number; hint?: string; icon: React.ReactNode; tone?: 'blue' | 'pink' | 'amber' | 'emerald' | 'slate'; onClick?: () => void }) {
  const tones = { blue: 'bg-blue-50 text-[#087df5]', pink: 'bg-pink-50 text-pink-600', amber: 'bg-amber-50 text-amber-600', emerald: 'bg-emerald-50 text-emerald-600', slate: 'bg-slate-100 text-slate-600' }
  const body = <>
    <span className={`grid size-10 flex-none place-items-center rounded-xl ${tones[tone]}`}>{icon}</span>
    <span className="min-w-0"><span className="block text-xs font-semibold text-slate-500">{label}</span><span className="block truncate text-xl font-bold text-slate-900">{value}</span>{hint && <span className="block text-[11px] text-slate-400">{hint}</span>}</span>
  </>
  const frame = 'flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left'
  return onClick ? <button type="button" onClick={onClick} className={`${frame} transition hover:border-blue-200 hover:shadow-sm`}>{body}</button> : <div className={frame}>{body}</div>
}

function Overview({ summary, currency, currentUser, onTab, onOpen, refreshKey, notify }: { summary: PurchasingSummary | null; currency: string; currentUser: BookshopUser; onTab: (tab: Tab) => void; onOpen: (id: number) => void; refreshKey: number; notify: (message: string) => void }) {
  const [report, setReport] = useState<PurchasingReport | null>(null)
  const [from, setFrom] = useState(() => { const date = new Date(); date.setDate(date.getDate() - 90); return date.toLocaleDateString('en-CA') })
  const [to, setTo] = useState('')
  const [settings, setSettings] = useState<PurchasingSettings | null>(null)
  const [savingSettings, setSavingSettings] = useState(false)
  const canSettings = hasPermission(currentUser, 'settings.manage')

  useEffect(() => { purchasingApi.reports({ from: from || undefined, to: to || undefined }).then(result => setReport(result.data)).catch(() => setReport(null)) }, [from, to, refreshKey])
  useEffect(() => { purchasingApi.settings().then(result => setSettings(result.data)).catch(() => undefined) }, [])

  async function saveSettings(patch: Partial<PurchasingSettings>) {
    setSavingSettings(true)
    try { setSettings((await purchasingApi.updateSettings(patch)).data); notify('Purchasing settings saved.') } catch (caught) { notify(errorMessage(caught)) } finally { setSavingSettings(false) }
  }

  const s = summary
  return <div className="space-y-5">
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Metric label="Below reorder level" value={s?.below_reorder_level ?? '—'} hint="Products to review" icon={<AlertTriangle size={19} />} tone="pink" onClick={() => onTab('suggestions')} />
      <Metric label="Draft orders" value={s?.drafts ?? '—'} icon={<FilePen size={19} />} tone="slate" onClick={() => onTab('drafts')} />
      <Metric label="Awaiting approval" value={s ? s.awaiting_approval + s.approved : '—'} hint={s?.approved ? `${s.approved} approved, not yet confirmed` : undefined} icon={<ShieldCheck size={19} />} tone="amber" onClick={() => onTab('pending')} />
      <Metric label="Sent to suppliers" value={s?.sent ?? '—'} hint={s?.email_failed ? `${s.email_failed} email(s) failed` : undefined} icon={<Truck size={19} />} onClick={() => onTab('sent')} />
      <Metric label="Awaiting delivery" value={s?.awaiting_delivery ?? '—'} hint={s?.overdue ? `${s.overdue} overdue` : 'Confirmed and sent'} icon={<Clock3 size={19} />} tone={s?.overdue ? 'amber' : 'blue'} onClick={() => onTab('sent')} />
      <Metric label="Partially received" value={s?.partially_received ?? '—'} icon={<PackageOpen size={19} />} tone="pink" onClick={() => onTab('partial')} />
      <Metric label="Completed" value={s?.completed ?? '—'} icon={<FileCheck2 size={19} />} tone="emerald" onClick={() => onTab('completed')} />
      <Metric label="Outstanding purchase value" value={s ? formatMoney(s.outstanding_value, currency) : '—'} hint={s ? `${s.outstanding_quantity} unit(s) still to arrive` : undefined} icon={<WalletCards size={19} />} />
    </section>

    {(s?.email_failed ?? 0) > 0 && <button type="button" onClick={() => onTab('sent')} className="flex w-full items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-left text-sm text-rose-800"><MailWarning size={18} /> {s!.email_failed} order(s) could not be emailed. Open them to retry sending or send manually.</button>}

    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-100 p-4">
        <div><h2 className="font-semibold text-slate-900">Purchasing report</h2><p className="text-xs text-slate-500">Confirmed orders by order date. Purchase orders are commitments, not expenses or payments.</p></div>
        <div className="flex gap-2 text-xs font-semibold text-slate-500">
          <label>From<input type="date" value={from} onChange={event => setFrom(event.target.value)} className="mt-1 block h-9 rounded-lg border border-slate-200 px-2 text-sm font-normal" /></label>
          <label>To<input type="date" value={to} onChange={event => setTo(event.target.value)} className="mt-1 block h-9 rounded-lg border border-slate-200 px-2 text-sm font-normal" /></label>
        </div>
      </div>
      {report && <>
        <div className="grid gap-px bg-slate-100 sm:grid-cols-4">{[
          ['Orders', report.totals.orders], ['Purchase value', formatMoney(report.totals.purchase_value, currency)],
          ['Received vs ordered', `${report.totals.received_quantity} / ${report.totals.ordered_quantity}`], ['Outstanding units', report.totals.outstanding_quantity],
        ].map(([label, value]) => <div key={label as string} className="bg-white p-4"><p className="text-xs text-slate-500">{label}</p><p className="text-lg font-bold text-slate-900">{value}</p></div>)}</div>
        <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2.5">Supplier</th><th className="px-3 py-2.5 text-right">Orders</th><th className="px-3 py-2.5 text-right">Value</th><th className="px-3 py-2.5 text-right">Ordered</th><th className="px-3 py-2.5 text-right">Received</th><th className="px-3 py-2.5 text-right">Outstanding</th><th className="px-3 py-2.5 text-right">Fill rate</th><th className="px-3 py-2.5 text-right">On time</th><th className="px-3 py-2.5 text-right">Avg lead</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{report.by_supplier.map(row => <tr key={row.supplier_id}>
            <td className="px-4 py-2.5 font-semibold text-slate-800">{row.supplier}</td><td className="px-3 py-2.5 text-right">{row.orders}</td><td className="px-3 py-2.5 text-right">{formatMoney(row.value, currency)}</td>
            <td className="px-3 py-2.5 text-right">{row.ordered_quantity}</td><td className="px-3 py-2.5 text-right">{row.received_quantity}</td><td className="px-3 py-2.5 text-right">{row.outstanding_quantity}</td>
            <td className="px-3 py-2.5 text-right">{row.fill_rate === null ? '—' : `${row.fill_rate}%`}</td><td className="px-3 py-2.5 text-right">{row.on_time_rate === null ? '—' : `${row.on_time_rate}%`}</td><td className="px-3 py-2.5 text-right">{row.average_lead_days === null ? '—' : `${row.average_lead_days} d`}</td>
          </tr>)}{!report.by_supplier.length && <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-500">No confirmed orders in this period.</td></tr>}</tbody>
        </table></div>
      </>}
    </section>

    <section className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">Overdue deliveries</h2>
        <ul className="divide-y divide-slate-100">{report?.overdue.slice(0, 8).map(row => <li key={row.id}><button type="button" className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm hover:bg-slate-50" onClick={() => onOpen(row.id)}>
          <span><strong className="text-slate-800">{row.lpo_number}</strong> <span className="text-slate-500">· {row.supplier}</span></span><span className="text-xs font-semibold text-amber-700">{row.days_late} day(s) late</span></button></li>)}
          {report && !report.overdue.length && <li className="px-4 py-6 text-center text-sm text-slate-500">No overdue deliveries.</li>}</ul>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">Purchase price changes</h2>
        <ul className="divide-y divide-slate-100">{report?.price_changes.slice(0, 8).map(row => <li key={row.book_id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
          <span className="min-w-0"><strong className="block truncate text-slate-800">{row.title}</strong><span className="text-xs text-slate-500">{row.supplier} · {formatDate(row.date)}</span></span>
          <span className="flex-none text-right"><span className="block text-slate-700">{row.previous_cost.toFixed(2)} → {row.latest_cost.toFixed(2)}</span>{row.change_percent !== null && <span className={`text-xs font-semibold ${row.change_percent > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{row.change_percent > 0 ? '+' : ''}{row.change_percent}%</span>}</span></li>)}
          {report && !report.price_changes.length && <li className="px-4 py-6 text-center text-sm text-slate-500">No price changes recorded.</li>}</ul>
      </div>
    </section>

    {settings && <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="font-semibold text-slate-900">Purchasing settings</h2>
      <p className="text-xs text-slate-500">Defaults for every product without its own reorder settings.{!canSettings && ' Only users who manage settings can change these.'}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex items-start gap-2 rounded-xl border border-slate-200 p-3 text-sm"><input type="checkbox" className="mt-0.5" disabled={!canSettings || savingSettings} checked={settings.approval_required} onChange={event => void saveSettings({ approval_required: event.target.checked })} />
          <span><strong className="block text-slate-800">Require approval</strong><span className="text-xs text-slate-500">Drafts must be approved before they can be confirmed.</span></span></label>
        <SettingNumber label="Default reorder level" value={settings.default_reorder_level} disabled={!canSettings || savingSettings} onSave={value => void saveSettings({ default_reorder_level: value })} />
        <SettingNumber label="Default target stock" value={settings.default_target_stock} disabled={!canSettings || savingSettings} onSave={value => void saveSettings({ default_target_stock: value })} />
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Default payment terms
          <input key={settings.default_payment_terms ?? ''} defaultValue={settings.default_payment_terms ?? ''} disabled={!canSettings || savingSettings} maxLength={120} onBlur={event => { if (event.target.value !== (settings.default_payment_terms ?? '')) void saveSettings({ default_payment_terms: event.target.value || null }) }} className="mt-1.5 block h-10 w-full rounded-lg border border-slate-200 px-3 text-sm normal-case tracking-normal" placeholder="e.g. 30 days" /></label>
      </div>
    </section>}
  </div>
}

function SettingNumber({ label, value, disabled, onSave }: { label: string; value: number; disabled: boolean; onSave: (value: number) => void }) {
  return <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}
    <input key={value} type="number" min={0} defaultValue={value} disabled={disabled} onBlur={event => { const next = Math.max(0, Math.floor(Number(event.target.value) || 0)); if (next !== value) onSave(next) }} className="mt-1.5 block h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" /></label>
}

function OrderList({ tab, bookshopName, currency, branches, suppliers, refreshKey, onOpen }: { tab: PurchaseTab; bookshopName?: string | null; currency: string; branches: BookshopUser['branches']; suppliers: ReturnType<typeof useSuppliers>; refreshKey: number; onOpen: (id: number) => void }) {
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [branchId, setBranchId] = useState('')
  const [createdBy, setCreatedBy] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [result, setResult] = useState<(LaravelPage<PurchaseOrderRow> & { creators?: { id: number; name: string }[] }) | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => { const timer = window.setTimeout(() => setQuery(search.trim()), 300); return () => window.clearTimeout(timer) }, [search])
  useEffect(() => { setPage(1) }, [tab, query, supplierId, branchId, createdBy, from, to])
  useEffect(() => {
    let live = true
    setLoading(true)
    purchasingApi.list({ tab, page, search: query || undefined, supplier_id: supplierId || undefined, branch_id: branchId || undefined, created_by: createdBy || undefined, from: from || undefined, to: to || undefined })
      .then(data => { if (live) { setResult(data); setError('') } })
      .catch(caught => { if (live) setError(errorMessage(caught, 'Unable to load purchase orders.')) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [tab, page, query, supplierId, branchId, createdBy, from, to, refreshKey])

  const select = 'mt-1 block h-10 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-normal normal-case tracking-normal'
  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
    <div className="grid gap-3 border-b border-slate-100 p-4 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1.4fr)_repeat(5,minmax(0,1fr))]">
      <label className="relative">Search<Search size={15} className="absolute bottom-3 left-3 text-slate-400" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="LPO number, supplier or product" className={`${select} pl-9`} /></label>
      <label>Supplier<select className={select} value={supplierId} onChange={event => setSupplierId(event.target.value)}><option value="">All suppliers</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Branch<select className={select} value={branchId} onChange={event => setBranchId(event.target.value)}><option value="">All branches</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
      <label>Created by<select className={select} value={createdBy} onChange={event => setCreatedBy(event.target.value)}><option value="">Anyone</option>{result?.creators?.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
      <label>From<input type="date" className={select} value={from} onChange={event => setFrom(event.target.value)} /></label>
      <label>To<input type="date" className={select} value={to} onChange={event => setTo(event.target.value)} /></label>
    </div>
    {error && <p role="alert" className="m-4 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
    {result && result.data.length > 0 && <div className="flex justify-end px-4 pt-3"><button type="button" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => void downloadBrandedTable({
      filename: `purchase-orders-${tab}-page-${page}.xlsx`, sheetName: 'Purchase orders', title: 'Purchase orders', bookshopName,
      columns: [{ header: 'LPO', width: 20 }, { header: 'Status', width: 18 }, { header: 'Supplier', width: 30 }, { header: 'Branch', width: 22 }, { header: 'Order date', width: 14 }, { header: 'Expected', width: 14 }, { header: 'Ordered', width: 10, numFmt: '0' }, { header: 'Received', width: 10, numFmt: '0' }, { header: 'Outstanding', width: 12, numFmt: '0' }, { header: 'Total', width: 16, numFmt: '#,##0.00' }, { header: 'Supplier delivery', width: 16 }, { header: 'Created by', width: 20 }],
      rows: result.data.map(order => [order.lpo_number || `Draft #${order.id}`, STATUS_LABELS[order.status], safeCell(order.supplier.name), safeCell(order.branch.name), order.order_date, order.expected_date, order.ordered_quantity, order.received_quantity, order.outstanding_quantity, order.total, order.delivery_method === 'manual' ? 'Sent manually' : EMAIL_LABELS[order.email_status], safeCell(order.created_by_name)]),
    }).catch(caught => setError(errorMessage(caught)))}><Download size={14} /> Export page</button></div>}
    <div className="overflow-x-auto"><table className="w-full min-w-[980px] text-left text-sm">
      <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr>
        <th className="px-4 py-2.5">LPO</th><th className="px-3 py-2.5">Supplier</th><th className="px-3 py-2.5">Branch</th><th className="px-3 py-2.5">Order date</th><th className="px-3 py-2.5">Expected</th>
        <th className="px-3 py-2.5 text-right">Items</th><th className="px-3 py-2.5 text-right">Received</th><th className="px-3 py-2.5 text-right">Total</th><th className="px-3 py-2.5">Status</th><th className="px-3 py-2.5">Supplier delivery</th>
      </tr></thead>
      <tbody className="divide-y divide-slate-100">
        {result?.data.map(order => <tr key={order.id} className="cursor-pointer hover:bg-blue-50/40" onClick={() => onOpen(order.id)}>
          <td className="px-4 py-3"><button type="button" className="text-left font-semibold text-slate-900 hover:text-[#087df5]" onClick={event => { event.stopPropagation(); onOpen(order.id) }}>{order.lpo_number || <span className="text-slate-500">Draft #{order.id}</span>}</button>
            <span className="block text-xs text-slate-500">by {order.created_by_name || '—'}{order.version > 1 ? ` · v${order.version}` : ''}</span></td>
          <td className="px-3 py-3 text-slate-700">{order.supplier.name}</td>
          <td className="px-3 py-3 text-slate-600">{order.branch.name}</td>
          <td className="px-3 py-3 text-slate-600">{formatDate(order.order_date || order.created_at)}</td>
          <td className={`px-3 py-3 ${order.is_overdue ? 'font-semibold text-amber-700' : 'text-slate-600'}`}>{formatDate(order.expected_date)}{order.is_overdue && <span className="block text-[11px]">Overdue</span>}</td>
          <td className="px-3 py-3 text-right">{order.line_count}</td>
          <td className="px-3 py-3 text-right text-slate-600">{order.received_quantity}/{order.ordered_quantity}</td>
          <td className="px-3 py-3 text-right font-semibold text-slate-900">{formatMoney(order.total, order.currency || currency)}</td>
          <td className="px-3 py-3"><StatusPill status={order.status} /></td>
          <td className="px-3 py-3">{order.lpo_number ? (order.delivery_method === 'manual' ? <span className="text-xs font-semibold text-slate-600">Sent manually</span> : <EmailState status={order.email_status} />) : <span className="text-xs text-slate-400">—</span>}</td>
        </tr>)}
        {!loading && result && !result.data.length && <tr><td colSpan={10} className="px-4 py-14 text-center text-slate-500"><ClipboardList className="mx-auto mb-2 text-slate-300" size={28} />No purchase orders here yet.</td></tr>}
        {loading && !result && <tr><td colSpan={10} className="px-4 py-10 text-center text-slate-400"><FileClock className="mx-auto mb-2" size={22} />Loading purchase orders…</td></tr>}
      </tbody>
    </table></div>
    {result && result.total > 0 && <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
      <span>Showing {result.from}–{result.to} of {result.total}</span>
      <div className="flex gap-2"><button type="button" className="rounded-lg border px-3 py-1.5 disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</button><button type="button" className="rounded-lg border px-3 py-1.5 disabled:opacity-40" disabled={page >= result.last_page} onClick={() => setPage(p => p + 1)}>Next</button></div>
    </div>}
  </section>
}
