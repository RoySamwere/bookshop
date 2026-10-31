import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, PackagePlus, Search, Trash2 } from 'lucide-react'
import { ApiError, errorMessage } from '../../lib/api'
import type { BranchSummary } from '../../lib/auth'
import { formatMoney, purchasingApi, type OrderInput, type ProductUnit, type PurchaseOrderDetail, type ReorderRow } from '../../lib/purchasing-api'
import { ReasonDialog, Sheet, today, type SupplierOption } from './shared'

type Line = {
  key: string; id?: number; book_id: number; description: string; sku: string | null
  units: ProductUnit[]; unit_label: string | null; product_unit_id: number | null
  quantity: number; unit_cost: number; discount: number; floor: number; on_order: number
}

type Mode = 'create' | 'edit' | 'amend'

const fieldClass = 'mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50 disabled:bg-slate-50'
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-slate-500'

/** Create or edit a draft, or amend a confirmed order (amendments ask for a reason and are versioned). */
export function OrderForm({ mode, order, branches, suppliers, currency, canEditPrices, onClose, onSaved }: {
  mode: Mode; order?: PurchaseOrderDetail; branches: BranchSummary[]; suppliers: SupplierOption[]; currency: string; canEditPrices: boolean
  onClose: () => void; onSaved: (order: PurchaseOrderDetail, message: string) => void
}) {
  const [supplierId, setSupplierId] = useState<number | ''>(order?.supplier_id ?? '')
  const [branchId, setBranchId] = useState<number>(order?.branch_id ?? branches[0]?.id ?? 0)
  const [orderDate, setOrderDate] = useState(order?.order_date ?? today())
  const [expectedDate, setExpectedDate] = useState(order?.expected_date ?? '')
  const [location, setLocation] = useState(order?.delivery_location ?? '')
  const [terms, setTerms] = useState(order?.payment_terms ?? '')
  const [taxRate, setTaxRate] = useState<number | null>(order ? order.tax_rate : null)
  const [taxIncluded, setTaxIncluded] = useState<boolean | null>(order ? order.prices_include_tax : null)
  const [supplierNotes, setSupplierNotes] = useState(order?.supplier_notes ?? '')
  const [internalNotes, setInternalNotes] = useState(order?.internal_notes ?? '')
  const [lines, setLines] = useState<Line[]>(() => (order?.items ?? []).map(item => ({
    key: `i${item.id}`, id: mode === 'amend' ? item.id : undefined, book_id: item.book_id, description: item.description, sku: item.sku,
    units: [], unit_label: item.unit_label, product_unit_id: item.product_unit_id, quantity: item.quantity, unit_cost: item.unit_cost,
    discount: item.discount, floor: mode === 'amend' ? item.received_quantity + item.cancelled_quantity : 0, on_order: 0,
  })))
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<ReorderRow[]>([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [askReason, setAskReason] = useState(false)

  const supplier = suppliers.find(item => item.id === supplierId)
  useEffect(() => {
    if (mode !== 'create' || !supplier) return
    if (supplier.payment_terms && !terms) setTerms(supplier.payment_terms)
    if (supplier.lead_time_days && !expectedDate) {
      const date = new Date(); date.setDate(date.getDate() + supplier.lead_time_days)
      setExpectedDate(date.toLocaleDateString('en-CA'))
    }
  }, [supplier, mode]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const term = search.trim()
    if (term.length < 2) { setResults([]); return }
    setSearching(true)
    const timer = window.setTimeout(() => {
      purchasingApi.catalogue(term, branchId || undefined).then(result => setResults(result.data)).catch(() => setResults([])).finally(() => setSearching(false))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [search, branchId])

  function addProduct(row: ReorderRow) {
    setLines(current => current.some(line => line.book_id === row.book_id && !line.id) ? current : [...current, {
      key: `n${row.book_id}-${Date.now()}`, book_id: row.book_id, description: row.title, sku: row.sku, units: row.units, unit_label: null,
      product_unit_id: null, quantity: Math.max(1, row.suggested_quantity || 1), unit_cost: row.default_unit_cost, discount: 0, floor: 0,
      on_order: row.outstanding_quantity + row.draft_quantity,
    }])
    setSearch('')
    setResults([])
  }

  const update = (key: string, patch: Partial<Line>) => setLines(current => current.map(line => line.key === key ? { ...line, ...patch } : line))

  const totals = useMemo(() => {
    const gross = lines.reduce((sum, line) => sum + line.quantity * line.unit_cost, 0)
    const discount = lines.reduce((sum, line) => sum + Math.min(line.quantity * line.unit_cost, line.discount || 0), 0)
    const net = gross - discount
    const rate = taxRate ?? 0
    const tax = taxIncluded ? (rate > 0 ? net - net / (1 + rate / 100) : 0) : net * rate / 100
    return { gross, discount, tax, total: taxIncluded ? net : net + tax }
  }, [lines, taxRate, taxIncluded])

  function payload(): OrderInput {
    return {
      supplier_id: Number(supplierId), branch_id: branchId, order_date: orderDate || null, expected_date: expectedDate || null,
      delivery_location: location || null, payment_terms: terms || null, supplier_notes: supplierNotes || null, internal_notes: internalNotes || null,
      ...(taxRate !== null ? { tax_rate: taxRate } : {}), ...(taxIncluded !== null ? { prices_include_tax: taxIncluded } : {}),
      items: lines.map(line => ({ ...(line.id ? { id: line.id } : {}), book_id: line.book_id, quantity: line.quantity, unit_cost: line.unit_cost, discount: line.discount || 0, product_unit_id: line.product_unit_id })),
    }
  }

  async function save(reason?: string) {
    setError('')
    if (!supplierId) return setError('Choose a supplier.')
    if (!lines.length) return setError('Add at least one product.')
    const short = lines.find(line => line.quantity < Math.max(1, line.floor))
    if (short) return setError(`${short.description}: quantity cannot be below ${Math.max(1, short.floor)}.`)
    if (mode === 'amend' && !reason) { setAskReason(true); return }
    setBusy(true)
    try {
      const body = payload()
      const result = mode === 'create' ? await purchasingApi.create(body)
        : mode === 'edit' ? await purchasingApi.update(order!.id, body)
        : await purchasingApi.amend(order!.id, { ...body, reason: reason! })
      onSaved(result.data, mode === 'create' ? 'Draft order saved.' : mode === 'edit' ? 'Draft updated.' : `Order amended (version ${result.data.version}). Resend it to the supplier if needed.`)
    } catch (caught) {
      setError(caught instanceof ApiError && Object.keys(caught.errors).length ? Object.values(caught.errors).flat().join(' ') : errorMessage(caught, 'Unable to save the order.'))
    } finally { setBusy(false); setAskReason(false) }
  }

  const title = mode === 'create' ? 'New purchase order' : mode === 'edit' ? 'Edit draft order' : `Amend ${order?.lpo_number}`
  return <Sheet title={title} subtitle={mode === 'amend' ? 'Changes are versioned and a new LPO document is stored. Quantities cannot go below what has already been received.' : 'One order goes to one supplier. Stock changes only when goods are received.'}
    onClose={onClose} busy={busy}
    footer={<>
      <span className="mr-auto text-sm text-slate-500">Total <strong className="text-base text-slate-900">{formatMoney(totals.total, currency)}</strong></span>
      <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="primary-button" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : mode === 'amend' ? 'Save amendment' : 'Save draft'}</button>
    </>}>
    {error && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
    {order?.rejection_reason && mode === 'edit' && <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><strong>Returned by approver:</strong> {order.rejection_reason}</p>}

    <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2 lg:grid-cols-3">
      <label className={labelClass}>Supplier
        <select className={fieldClass} value={supplierId} disabled={mode === 'amend'} onChange={event => setSupplierId(event.target.value ? Number(event.target.value) : '')}>
          <option value="">Choose supplier…</option>
          {suppliers.map(item => <option key={item.id} value={item.id} disabled={!item.is_active}>{item.name}{item.is_active ? '' : ' (inactive)'}</option>)}
        </select>
        {supplier && !supplier.email && <span className="mt-1 block text-[11px] normal-case tracking-normal text-amber-700">No email on file: you will download and send the LPO yourself.</span>}
      </label>
      <label className={labelClass}>Branch
        <select className={fieldClass} value={branchId} disabled={mode === 'amend'} onChange={event => setBranchId(Number(event.target.value))}>
          {branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <label className={labelClass}>Order date<input type="date" className={fieldClass} value={orderDate ?? ''} disabled={mode === 'amend'} onChange={event => setOrderDate(event.target.value)} /></label>
      <label className={labelClass}>Expected delivery<input type="date" className={fieldClass} value={expectedDate ?? ''} onChange={event => setExpectedDate(event.target.value)} /></label>
      <label className={labelClass}>Delivery location<input className={fieldClass} value={location} maxLength={255} onChange={event => setLocation(event.target.value)} placeholder="Defaults to your shop address" /></label>
      <label className={labelClass}>Payment terms<input className={fieldClass} value={terms} maxLength={120} onChange={event => setTerms(event.target.value)} placeholder="e.g. 30 days after delivery" /></label>
    </section>

    <section className="mt-4 rounded-2xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
        <h3 className="font-semibold text-slate-900">Products <span className="text-sm font-normal text-slate-400">({lines.length})</span></h3>
        <div className="relative w-full sm:w-96">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input aria-label="Search catalogue to add a product" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search title, SKU or ISBN to add…"
            className="h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50" />
          {(results.length > 0 || searching) && <ul className="absolute right-0 z-10 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
            {searching && !results.length && <li className="px-3 py-2 text-sm text-slate-400">Searching…</li>}
            {results.map(row => <li key={row.book_id}><button type="button" onClick={() => addProduct(row)} className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-blue-50">
              <span className="min-w-0"><span className="block truncate font-semibold text-slate-800">{row.title}</span><span className="text-xs text-slate-500">{row.sku}{row.isbn ? ` · ${row.isbn}` : ''}</span></span>
              <span className="flex-none text-right text-xs text-slate-500">{row.available} in stock{row.outstanding_quantity > 0 && <span className="block font-semibold text-amber-700">{row.outstanding_quantity} on order</span>}</span>
            </button></li>)}
          </ul>}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr>
            <th className="px-4 py-2.5">Product</th><th className="px-3 py-2.5">Unit</th><th className="px-3 py-2.5 text-right">Qty</th>
            <th className="px-3 py-2.5 text-right">Unit cost</th><th className="px-3 py-2.5 text-right">Discount</th><th className="px-3 py-2.5 text-right">Line total</th><th className="px-3 py-2.5" />
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {lines.map(line => {
              const lineTotal = line.quantity * line.unit_cost - Math.min(line.quantity * line.unit_cost, line.discount || 0)
              return <tr key={line.key} className="align-top">
                <td className="px-4 py-3"><strong className="block text-slate-900">{line.description}</strong><span className="text-xs text-slate-500">{line.sku}</span>
                  {line.on_order > 0 && <span className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-700"><AlertTriangle size={13} /> {line.on_order} already on order or in drafts</span>}
                  {line.floor > 0 && <span className="mt-1 block text-xs text-slate-500">{line.floor} received or cancelled</span>}</td>
                <td className="px-3 py-3">{line.units.length && !line.id ? <select aria-label={`Unit for ${line.description}`} className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm" value={line.product_unit_id ?? ''} onChange={event => update(line.key, { product_unit_id: event.target.value ? Number(event.target.value) : null })}>
                  <option value="">Piece</option>{line.units.map(unit => <option key={unit.id} value={unit.id}>{unit.name} ({unit.pieces_per_unit})</option>)}</select>
                  : <span className="text-slate-600">{line.unit_label || 'Piece'}</span>}</td>
                <td className="px-3 py-3 text-right"><input aria-label={`Quantity for ${line.description}`} type="number" min={Math.max(1, line.floor)} value={line.quantity} onChange={event => update(line.key, { quantity: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} className="h-9 w-20 rounded-lg border border-slate-200 px-2 text-right" /></td>
                <td className="px-3 py-3 text-right"><input aria-label={`Unit cost for ${line.description}`} type="number" min={0} step="0.01" value={line.unit_cost} disabled={!canEditPrices} onChange={event => update(line.key, { unit_cost: Math.max(0, Number(event.target.value) || 0) })} className="h-9 w-28 rounded-lg border border-slate-200 px-2 text-right disabled:bg-slate-50" /></td>
                <td className="px-3 py-3 text-right"><input aria-label={`Discount for ${line.description}`} type="number" min={0} step="0.01" value={line.discount} disabled={!canEditPrices} onChange={event => update(line.key, { discount: Math.max(0, Number(event.target.value) || 0) })} className="h-9 w-24 rounded-lg border border-slate-200 px-2 text-right disabled:bg-slate-50" /></td>
                <td className="px-3 py-3 text-right font-semibold text-slate-900">{lineTotal.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                <td className="px-3 py-3 text-right"><button type="button" aria-label={`Remove ${line.description}`} disabled={line.floor > 0} onClick={() => setLines(current => current.filter(item => item.key !== line.key))} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:opacity-30"><Trash2 size={16} /></button></td>
              </tr>
            })}
            {!lines.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500"><PackagePlus className="mx-auto mb-2 text-slate-300" size={28} />Search the catalogue above to add products.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="grid gap-4 border-t border-slate-100 p-4 sm:grid-cols-[1fr_300px]">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>Tax rate (%)<input type="number" min={0} max={100} step="0.01" className={fieldClass} value={taxRate ?? ''} placeholder="Bookshop default" onChange={event => setTaxRate(event.target.value === '' ? null : Number(event.target.value))} /></label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-slate-700"><input type="checkbox" checked={taxIncluded ?? false} onChange={event => setTaxIncluded(event.target.checked)} /> Prices include tax</label>
        </div>
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd>{formatMoney(totals.gross, currency)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Discount</dt><dd>− {formatMoney(totals.discount, currency)}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-500">Tax{taxRate === null ? ' (default rate applied on save)' : ''}</dt><dd>{formatMoney(totals.tax, currency)}</dd></div>
          <div className="flex justify-between border-t border-slate-100 pt-1.5 text-base font-bold text-slate-900"><dt>Total</dt><dd>{formatMoney(totals.total, currency)}</dd></div>
        </dl>
      </div>
    </section>

    <section className="mt-4 grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:grid-cols-2">
      <label className={labelClass}>Notes for the supplier (printed on the LPO)
        <textarea rows={3} maxLength={2000} value={supplierNotes} onChange={event => setSupplierNotes(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm normal-case tracking-normal outline-none focus:border-blue-400" placeholder="Delivery hours, contact on arrival, packing instructions…" /></label>
      <label className={labelClass}>Internal notes (not shared)
        <textarea rows={3} maxLength={2000} value={internalNotes} onChange={event => setInternalNotes(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm normal-case tracking-normal outline-none focus:border-blue-400" /></label>
    </section>

    {askReason && <ReasonDialog title="Reason for amendment" label="What changed and why?" submitLabel="Save amendment" busy={busy} onClose={() => setAskReason(false)} onSubmit={reason => void save(reason)} />}
  </Sheet>
}
