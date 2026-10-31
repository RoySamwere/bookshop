import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Download, History, Lightbulb, PackagePlus, RefreshCw, Search, Settings2, Trash2 } from 'lucide-react'
import { ApiError, errorMessage } from '../../lib/api'
import type { BranchSummary } from '../../lib/auth'
import { formatMoney, purchasingApi, suggestedQuantity, type ReorderRow } from '../../lib/purchasing-api'
import { formatDate } from '../ui-kit'
import type { SupplierOption } from './shared'
import { downloadBrandedTable, safeCell } from '../../lib/branded-export'

type Line = ReorderRow & { quantity: number; supplier_id: number | ''; unit_cost: number; manual?: boolean }

const toLine = (row: ReorderRow, manual = false): Line => ({
  ...row, manual, quantity: manual ? Math.max(1, row.suggested_quantity) : row.suggested_quantity,
  supplier_id: row.preferred_supplier?.is_active ? row.preferred_supplier.id : '', unit_cost: row.default_unit_cost,
})

/**
 * Low-stock products with a suggested quantity: target stock - available - already on order,
 * rounded to packs. Staff review and adjust, then create one draft order per supplier.
 */
export function ReorderSuggestions({ branches, suppliers, canManage, currency, bookshopName, onDraftsCreated, notify }: {
  bookshopName?: string | null; branches: BranchSummary[]; suppliers: SupplierOption[]; canManage: boolean; currency: string
  onDraftsCreated: (ids: number[]) => void; notify: (message: string) => void
}) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? 0)
  const [lines, setLines] = useState<Line[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<ReorderRow[]>([])
  const [busy, setBusy] = useState(false)
  const [outstanding, setOutstanding] = useState('')
  const [history, setHistory] = useState<{ row: Line; items: Awaited<ReturnType<typeof purchasingApi.priceHistory>>['data'] } | null>(null)
  const [settingsFor, setSettingsFor] = useState<Line | null>(null)

  const load = useCallback(() => {
    setLoading(true); setError('')
    purchasingApi.suggestions({ branch_id: branchId || undefined })
      .then(result => setLines(result.data.map(row => toLine(row))))
      .catch(caught => setError(errorMessage(caught, 'Unable to load reorder suggestions.')))
      .finally(() => setLoading(false))
  }, [branchId])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    const term = search.trim()
    if (term.length < 2) { setResults([]); return }
    const timer = window.setTimeout(() => purchasingApi.catalogue(term, branchId).then(result => setResults(result.data)).catch(() => setResults([])), 250)
    return () => window.clearTimeout(timer)
  }, [search, branchId])

  const update = (bookId: number, patch: Partial<Line>) => setLines(current => current.map(line => line.book_id === bookId ? { ...line, ...patch } : line))
  const visible = lines.filter(line => `${line.title} ${line.sku} ${line.isbn} ${line.preferred_supplier?.name ?? ''}`.toLowerCase().includes(filter.toLowerCase()))
  const ready = lines.filter(line => line.quantity > 0)
  const groups = useMemo(() => {
    const map = new Map<number, { name: string; lines: number; value: number }>()
    for (const line of ready) {
      if (!line.supplier_id) continue
      const entry = map.get(line.supplier_id) ?? { name: suppliers.find(s => s.id === line.supplier_id)?.name ?? 'Supplier', lines: 0, value: 0 }
      entry.lines += 1; entry.value += line.quantity * line.unit_cost
      map.set(line.supplier_id, entry)
    }
    return [...map.values()]
  }, [ready, suppliers])
  const missingSupplier = ready.filter(line => !line.supplier_id).length

  async function generate(allow = false) {
    setBusy(true); setError('')
    try {
      const result = await purchasingApi.generate({ branch_id: branchId, allow_outstanding: allow, items: ready.map(line => ({ book_id: line.book_id, supplier_id: Number(line.supplier_id), quantity: line.quantity, unit_cost: line.unit_cost })) })
      setOutstanding('')
      notify(result.message)
      onDraftsCreated(result.data.ids)
      load()
    } catch (caught) {
      const warning = caught instanceof ApiError ? caught.field('outstanding') : undefined
      if (warning) setOutstanding(warning)
      else setError(caught instanceof ApiError && Object.keys(caught.errors).length ? Object.values(caught.errors).flat().join(' ') : errorMessage(caught, 'Unable to create draft orders.'))
    } finally { setBusy(false) }
  }

  async function showHistory(row: Line) {
    try { setHistory({ row, items: (await purchasingApi.priceHistory(row.book_id)).data }) } catch (caught) { setError(errorMessage(caught)) }
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      {branches.length > 1 && <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Branch
        <select className="mt-1.5 block h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm" value={branchId} onChange={event => setBranchId(Number(event.target.value))}>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
      <label className="relative min-w-56 flex-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Filter suggestions
        <Search size={15} className="absolute bottom-3 left-3 text-slate-400" />
        <input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Title, SKU or supplier" className="mt-1.5 block h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm normal-case tracking-normal" /></label>
      {canManage && <label className="relative min-w-64 flex-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Add a product manually
        <PackagePlus size={15} className="absolute bottom-3 left-3 text-slate-400" />
        <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search the whole catalogue…" className="mt-1.5 block h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm normal-case tracking-normal" />
        {results.length > 0 && <ul className="absolute left-0 right-0 z-10 mt-1 max-h-64 overflow-auto rounded-xl border border-slate-200 bg-white py-1 normal-case tracking-normal shadow-xl">{results.map(row => <li key={row.book_id}>
          <button type="button" className="flex w-full justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-blue-50" onClick={() => { setLines(current => current.some(line => line.book_id === row.book_id) ? current : [toLine(row, true), ...current]); setSearch(''); setResults([]) }}>
            <span className="min-w-0 truncate font-semibold text-slate-800">{row.title}<span className="block text-xs font-normal text-slate-500">{row.sku}</span></span>
            <span className="flex-none text-right text-xs text-slate-500">{row.available} available{row.outstanding_quantity > 0 && <span className="block font-semibold text-amber-700">{row.outstanding_quantity} on order</span>}</span>
          </button></li>)}</ul>}
      </label>}
      <button type="button" className="secondary-button" onClick={load} disabled={loading}><RefreshCw size={16} /> Refresh</button>
      <button type="button" className="secondary-button" disabled={!lines.length} onClick={() => void downloadBrandedTable({
        filename: `reorder-suggestions-${new Date().toLocaleDateString('en-CA')}.xlsx`, sheetName: 'Reorder', title: 'Reorder suggestions', bookshopName,
        subtitle: branches.find(branch => branch.id === branchId)?.name,
        columns: [{ header: 'Product', width: 44 }, { header: 'SKU', width: 18 }, { header: 'Available', width: 11, numFmt: '0' }, { header: 'Reorder level', width: 13, numFmt: '0' }, { header: 'Target', width: 10, numFmt: '0' }, { header: 'On order', width: 10, numFmt: '0' }, { header: 'Order qty', width: 11, numFmt: '0' }, { header: 'Supplier', width: 28 }, { header: 'Unit cost', width: 12, numFmt: '#,##0.00' }, { header: 'Line value', width: 14, numFmt: '#,##0.00' }],
        rows: lines.map(line => [safeCell(line.title), safeCell(line.sku), line.available, line.reorder_level, line.target_stock, line.outstanding_quantity, line.quantity, safeCell(suppliers.find(s => s.id === line.supplier_id)?.name ?? ''), line.unit_cost, line.quantity * line.unit_cost]),
      }).catch(caught => setError(errorMessage(caught)))}><Download size={16} /> Export</button>
    </div>

    {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}

    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="overflow-x-auto"><table className="w-full min-w-[1080px] text-left text-sm">
        <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr>
          <th className="px-4 py-2.5">Product</th><th className="px-3 py-2.5 text-right">Available</th><th className="px-3 py-2.5 text-right">Reorder at</th><th className="px-3 py-2.5 text-right">Target</th>
          <th className="px-3 py-2.5 text-right">On order</th><th className="px-3 py-2.5 text-right">Order qty</th><th className="px-3 py-2.5">Supplier</th><th className="px-3 py-2.5 text-right">Unit cost</th><th className="px-3 py-2.5" />
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {visible.map(line => <tr key={line.book_id} className={line.quantity === 0 ? 'opacity-60' : ''}>
            <td className="px-4 py-2.5"><strong className="block text-slate-900">{line.title}</strong>
              <span className="text-xs text-slate-500">{line.sku}{line.last_purchase_date ? ` · last bought ${formatDate(line.last_purchase_date)}` : ''}{line.pack_size ? ` · packs of ${line.pack_size}` : ''}{line.minimum_order_quantity ? ` · min ${line.minimum_order_quantity}` : ''}</span>
              {line.manual && <span className="ml-2 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">Added manually</span>}
              {line.draft_quantity > 0 && <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-700"><AlertTriangle size={13} /> {line.draft_quantity} already in a draft order</span>}</td>
            <td className={`px-3 py-2.5 text-right font-semibold ${line.available < line.reorder_level ? 'text-rose-600' : 'text-slate-800'}`}>{line.available}</td>
            <td className="px-3 py-2.5 text-right text-slate-600">{line.reorder_level}</td>
            <td className="px-3 py-2.5 text-right text-slate-600">{line.target_stock}</td>
            <td className="px-3 py-2.5 text-right text-slate-600">{line.outstanding_quantity || '—'}</td>
            <td className="px-3 py-2.5 text-right"><input aria-label={`Order quantity for ${line.title}`} type="number" min={0} disabled={!canManage} value={line.quantity} onChange={event => update(line.book_id, { quantity: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} className="h-9 w-20 rounded-lg border border-blue-200 bg-blue-50/40 px-2 text-right font-semibold" />
              {line.quantity !== line.suggested_quantity && !line.manual && <button type="button" className="mt-0.5 block w-full text-right text-[11px] text-blue-600 hover:underline" onClick={() => update(line.book_id, { quantity: line.suggested_quantity })}>Suggested {line.suggested_quantity}</button>}</td>
            <td className="px-3 py-2.5"><select aria-label={`Supplier for ${line.title}`} disabled={!canManage} value={line.supplier_id} onChange={event => update(line.book_id, { supplier_id: event.target.value ? Number(event.target.value) : '' })} className={`h-9 w-48 rounded-lg border bg-white px-2 text-sm ${line.supplier_id ? 'border-slate-200' : 'border-amber-300'}`}>
              <option value="">Choose supplier…</option>{suppliers.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></td>
            <td className="px-3 py-2.5 text-right"><input aria-label={`Unit cost for ${line.title}`} type="number" min={0} step="0.01" disabled={!canManage} value={line.unit_cost} onChange={event => update(line.book_id, { unit_cost: Math.max(0, Number(event.target.value) || 0) })} className="h-9 w-24 rounded-lg border border-slate-200 px-2 text-right" />
              {line.last_unit_cost !== null && line.last_unit_cost !== line.unit_cost && <span className="block text-[11px] text-slate-500">last {line.last_unit_cost}</span>}</td>
            <td className="px-3 py-2.5"><div className="flex justify-end gap-1">
              <button type="button" title="Previous purchase prices" aria-label={`Previous prices for ${line.title}`} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => void showHistory(line)}><History size={16} /></button>
              {canManage && <button type="button" title="Reorder settings" aria-label={`Reorder settings for ${line.title}`} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => setSettingsFor(line)}><Settings2 size={16} /></button>}
              {canManage && <button type="button" title="Remove from this order" aria-label={`Remove ${line.title}`} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => setLines(current => current.filter(item => item.book_id !== line.book_id))}><Trash2 size={16} /></button>}
            </div></td>
          </tr>)}
          {!loading && !visible.length && <tr><td colSpan={9} className="px-4 py-14 text-center text-slate-500"><Lightbulb className="mx-auto mb-2 text-slate-300" size={28} />Nothing needs reordering right now. Products appear here when available stock falls below their reorder level and is not already on order.</td></tr>}
          {loading && <tr><td colSpan={9} className="px-4 py-10 text-center text-slate-400">Working out what to reorder…</td></tr>}
        </tbody>
      </table></div>
    </section>

    {canManage && ready.length > 0 && <section className="sticky bottom-3 z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-blue-100 bg-white/95 p-4 shadow-lg backdrop-blur">
      <div className="mr-auto text-sm text-slate-600">
        <strong className="text-slate-900">{ready.length} product(s)</strong> → {groups.length} draft order(s){groups.length > 0 && <>: {groups.map(group => `${group.name} (${group.lines}, ${formatMoney(group.value, currency)})`).join(' · ')}</>}
        {missingSupplier > 0 && <span className="block text-amber-700">Choose a supplier for {missingSupplier} product(s).</span>}
      </div>
      <button type="button" className="primary-button" disabled={busy || missingSupplier > 0} onClick={() => void generate()}>{busy ? 'Creating…' : `Create ${groups.length || ''} draft order${groups.length === 1 ? '' : 's'}`}</button>
    </section>}

    {outstanding && <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/45 p-4"><div role="alertdialog" aria-modal="true" aria-labelledby="dup-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
      <h3 id="dup-title" className="flex items-center gap-2 text-lg font-bold text-slate-900"><AlertTriangle className="text-amber-500" size={20} /> Already on order</h3>
      <p className="mt-2 text-sm text-slate-600">{outstanding}</p>
      <div className="mt-5 flex justify-end gap-2"><button type="button" className="secondary-button" onClick={() => setOutstanding('')}>Review quantities</button><button type="button" className="primary-button" disabled={busy} onClick={() => void generate(true)}>Order extra anyway</button></div>
    </div></div>}

    {history && <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/45 p-4" onMouseDown={event => { if (event.target === event.currentTarget) setHistory(null) }}><div role="dialog" aria-modal="true" aria-label="Previous purchase prices" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onKeyDown={event => { if (event.key === 'Escape') setHistory(null) }}>
      <h3 className="text-lg font-bold text-slate-900">Previous prices · {history.row.title}</h3>
      {history.items.length ? <table className="mt-3 w-full text-sm"><thead className="text-left text-[11px] uppercase text-slate-500"><tr><th className="py-1.5">Date</th><th>Supplier</th><th>LPO</th><th className="text-right">Per piece</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{history.items.map(item => <tr key={`${item.purchase_order_id}-${item.date}`}><td className="py-1.5">{formatDate(item.date)}</td><td>{item.supplier}</td><td className="text-slate-500">{item.lpo_number || '—'}</td>
          <td className="text-right font-semibold"><button type="button" className="hover:text-blue-600 hover:underline" onClick={() => { update(history.row.book_id, { unit_cost: item.cost_per_piece }); setHistory(null) }}>{item.cost_per_piece.toFixed(2)}</button></td></tr>)}</tbody></table>
        : <p className="mt-3 text-sm text-slate-500">No purchases recorded yet. The catalogue cost price is used.</p>}
      <div className="mt-5 flex justify-end"><button type="button" className="secondary-button" autoFocus onClick={() => setHistory(null)}>Close</button></div>
    </div></div>}

    {settingsFor && <ReorderSettingsDialog line={settingsFor} suppliers={suppliers} onClose={() => setSettingsFor(null)} onSaved={patch => {
      const line = { ...settingsFor, ...patch }
      update(line.book_id, { ...patch, quantity: suggestedQuantity(line.available, line.target_stock, line.outstanding_quantity, line.minimum_order_quantity, line.pack_size) })
      setSettingsFor(null); notify('Reorder settings saved.')
    }} />}
  </div>
}

function ReorderSettingsDialog({ line, suppliers, onClose, onSaved }: { line: Line; suppliers: SupplierOption[]; onClose: () => void; onSaved: (patch: Partial<Line>) => void }) {
  const [form, setForm] = useState({ reorder_level: String(line.reorder_level), target_stock: String(line.target_stock), minimum_order_quantity: line.minimum_order_quantity ? String(line.minimum_order_quantity) : '', pack_size: line.pack_size ? String(line.pack_size) : '', preferred_supplier_id: line.preferred_supplier?.id ? String(line.preferred_supplier.id) : '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const number = (value: string) => value.trim() === '' ? null : Math.max(0, Math.floor(Number(value)))
  async function save() {
    setBusy(true); setError('')
    const body = { reorder_level: number(form.reorder_level), target_stock: number(form.target_stock), minimum_order_quantity: number(form.minimum_order_quantity) || null, pack_size: number(form.pack_size) || null, preferred_supplier_id: form.preferred_supplier_id ? Number(form.preferred_supplier_id) : null }
    try {
      await purchasingApi.updateReorderSettings(line.book_id, body)
      const supplier = suppliers.find(s => s.id === body.preferred_supplier_id)
      onSaved({ reorder_level: body.reorder_level ?? line.reorder_level, target_stock: body.target_stock ?? line.target_stock, minimum_order_quantity: body.minimum_order_quantity, pack_size: body.pack_size,
        preferred_supplier: supplier ? { id: supplier.id, name: supplier.name, email: supplier.email, is_active: supplier.is_active } : line.preferred_supplier, ...(supplier ? { supplier_id: supplier.id } : {}) })
    } catch (caught) { setError(errorMessage(caught)); setBusy(false) }
  }
  const field = (key: keyof typeof form, label: string, hint?: string) => <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}
    <input type="number" min={0} value={form[key]} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} className="mt-1.5 block h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" />{hint && <span className="mt-1 block text-[11px] normal-case tracking-normal text-slate-400">{hint}</span>}</label>
  return <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/45 p-4" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <form role="dialog" aria-modal="true" aria-label="Reorder settings" className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl" onSubmit={event => { event.preventDefault(); void save() }} onKeyDown={event => { if (event.key === 'Escape' && !busy) onClose() }}>
      <h3 className="text-lg font-bold text-slate-900">Reorder settings</h3><p className="text-sm text-slate-500">{line.title} · applies to every branch</p>
      {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</p>}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {field('reorder_level', 'Reorder level', 'Suggest when available stock falls below this')}
        {field('target_stock', 'Target stock', 'Order up to this level')}
        {field('minimum_order_quantity', 'Minimum order qty')}
        {field('pack_size', 'Pack size', 'Round orders up to whole packs')}
        <label className="text-xs font-semibold uppercase tracking-wide text-slate-500 sm:col-span-2">Preferred supplier
          <select className="mt-1.5 block h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm" value={form.preferred_supplier_id} onChange={event => setForm(current => ({ ...current, preferred_supplier_id: event.target.value }))}>
            <option value="">Use the last supplier</option>{suppliers.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      </div>
      <div className="mt-5 flex justify-end gap-2"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" className="primary-button" disabled={busy}>{busy ? 'Saving…' : 'Save settings'}</button></div>
    </form>
  </div>
}
