'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Bell, BookOpen, Boxes, Download, PackagePlus, Plus, Search } from 'lucide-react'
import { api, ApiError, errorMessage } from '../lib/api'
import type { BookshopUser } from '../lib/auth'
import { branchesApi, type Branch } from '../lib/workspace-api'
import { EmptyState, ErrorState, Field, FormAlert, LoadingState, Modal, Pagination } from './ui-kit'

const inputClass = 'text-input'
const primaryButton = 'primary-button'
const secondaryButton = 'secondary-button'

type StockRow = { id: number; book_id: number; branch_id: number; title: string; sku: string; isbn: string | null; quantity: number; reserved: number; reorder_level: number; branch_name: string }
type Book = { id: number; title: string; sku: string; is_active: boolean }
type StockPage = { data: StockRow[]; current_page: number; last_page: number; per_page: number; total: number; from: number | null; to: number | null; summary: { units: number; value: number; stock_lines: number; low: number; out_of_stock: number } }
const money = (value: number) => `KSh ${Number(value).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export function InventoryView({ currentUser, notify }: { currentUser: BookshopUser; notify: (message: string) => void }) {
  const canManage = currentUser.permissions.includes('inventory.manage')
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchError, setBranchError] = useState('')
  const [branch, setBranch] = useState('')
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(30)
  const [result, setResult] = useState<StockPage | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [receipt, setReceipt] = useState<{ book?: Book; branchId?: number } | null>(null)

  const loadBranches = useCallback(async () => {
    setBranchError('')
    try { setBranches(await branchesApi.list()) } catch (e) { setBranchError(errorMessage(e)) }
  }, [])
  useEffect(() => { void loadBranches() }, [loadBranches])
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError('')
    api<StockPage>('/inventory', { query: { branch_id: branch, status, search, page, per_page: perPage } })
      .then(data => { if (!cancelled) setResult(data) })
      .catch(e => { if (!cancelled) setError(errorMessage(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [branch, status, search, page, perPage, reload])

  function exportPage() {
    if (!result) return
    const cell = (value: unknown) => `"${String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`
    const rows = [['Product', 'SKU', 'Branch', 'On hand', 'Reserved', 'Available', 'Reorder level'], ...result.data.map(row => [row.title, row.sku, row.branch_name, row.quantity, row.reserved, row.quantity - row.reserved, row.reorder_level])]
    const url = URL.createObjectURL(new Blob([rows.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = 'hekima-stock-page.csv'; link.click(); URL.revokeObjectURL(url)
  }
  const summary = result?.summary
  return <div className="inventory-page">
    <div className="page-heading compact"><div><div className="eyebrow">OPERATIONS · INVENTORY CONTROL</div><h1 tabIndex={-1}>Inventory & Stock</h1><p>Monitor stock levels, receive deliveries, and keep your shelves ready for customers.</p></div><div className="heading-actions"><button className={secondaryButton} onClick={exportPage} disabled={loading || !!error || !result?.data.length}><Download size={16} /> Export current page</button>{canManage && <button className={primaryButton} onClick={() => setReceipt({ branchId: branch ? Number(branch) : undefined })} disabled={!branches.some(b => b.is_active)}><Plus size={17} /> Receive stock</button>}</div></div>
    {branchError && <div className="mb-5"><ErrorState message={branchError} onRetry={() => void loadBranches()} /></div>}
    <div className="inventory-stats">
      <div className="card catalog-stat"><span>Inventory value</span><strong>{loading || error ? '—' : money(summary?.value ?? 0)}</strong><small>At selling price</small></div>
      <div className="card catalog-stat"><span>Units on hand</span><strong>{loading || error ? '—' : Number(summary?.units ?? 0).toLocaleString()}</strong><small>Across {summary?.stock_lines ?? 0} product / branch balances</small></div>
      <div className="card catalog-stat warning"><span>Low stock</span><strong>{loading || error ? '—' : summary?.low ?? 0}</strong><small>At or below reorder level</small></div>
      <div className="card catalog-stat danger"><span>Out of stock</span><strong>{loading || error ? '—' : summary?.out_of_stock ?? 0}</strong><small>No available units</small></div>
    </div>
    {!loading && !error && Number(summary?.low ?? 0) + Number(summary?.out_of_stock ?? 0) > 0 && <section className="card inventory-alert"><div className="alert-icon"><Bell size={17} /></div><div><strong>Stock attention needed</strong><p>{Number(summary?.low ?? 0) + Number(summary?.out_of_stock ?? 0)} product / branch balances need replenishment.</p></div><button className="secondary-button" onClick={() => { setStatus(Number(summary?.low ?? 0) ? 'low' : 'out'); setPage(1) }}>Review stock</button></section>}
    <section className="card inventory-table-card">
      <div className="card-heading"><div><h2>Stock levels</h2><p>Live quantities by product and branch. Receive a product to create its first balance.</p></div><form className="inventory-search" onSubmit={e => { e.preventDefault(); setPage(1); setSearch(query.trim()) }}><Search size={16} /><input aria-label="Search stock" placeholder="Search title, SKU or ISBN…" maxLength={255} value={query} onChange={e => { setQuery(e.target.value); setPage(1); setSearch(e.target.value.trim()) }} /><button type="submit" className="text-button">Search</button></form></div>
      <div className="stock-filter-bar"><div className="inventory-tabs">{[{ value: '', label: 'All stock' }, { value: 'low', label: 'Low stock' }, { value: 'out', label: 'Out of stock' }].map(tab => <button type="button" key={tab.value} aria-pressed={status === tab.value} className={status === tab.value ? 'selected' : ''} onClick={() => { setStatus(tab.value); setPage(1) }}>{tab.label}{tab.value && <span>{tab.value === 'low' ? summary?.low ?? 0 : summary?.out_of_stock ?? 0}</span>}</button>)}</div><label className="stock-branch-filter">Branch<select value={branch} onChange={e => { setBranch(e.target.value); setPage(1) }}><option value="">All my branches</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}{b.is_active ? '' : ' (inactive)'}</option>)}</select></label></div>
      {loading ? <LoadingState label="Loading inventory" /> : error ? <ErrorState message={error} onRetry={() => setReload(n => n + 1)} /> : !result?.data.length ? <EmptyState icon={<Boxes size={24} />} title="No stock balances found" body="Receive stock for an existing product to create a balance, or change your filters." /> : <>
        <div className="stock-list-scroll"><div className="inventory-list">{result.data.map((row, index) => {
          const available = row.quantity - row.reserved
          const label = available === 0 ? 'Out of stock' : available <= row.reorder_level ? 'Low stock' : 'Healthy'
          return <div className="inventory-row" key={row.id}><div className={`inventory-book ${['teal', 'indigo', 'amber', 'violet', 'rose', 'sky'][index % 6]}`}><BookOpen size={18} /></div><div className="inventory-product"><strong title={row.title}>{row.title}</strong><span>{row.sku} · {row.branch_name}</span></div><div className="inventory-number"><strong>{row.quantity}</strong><span>on hand</span></div><div className="inventory-bar"><div><span>{available} available · {row.reserved} reserved</span><i aria-hidden="true"><b style={{ width: `${Math.min(100, available / Math.max(1, row.reorder_level * 3) * 100)}%` }} /></i><span>Reorder at {row.reorder_level}</span></div></div><span className={`stock-status ${label.toLowerCase().replaceAll(' ', '-')}`}>{label}</span>{canManage && branches.some(b => b.id === row.branch_id && b.is_active) ? <button className="row-action" aria-label={`Restock ${row.title} at ${row.branch_name}`} onClick={() => setReceipt({ book: { id: row.book_id, title: row.title, sku: row.sku, is_active: true }, branchId: row.branch_id })}>Restock</button> : <span />}</div>
        })}</div></div>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',padding:12}}><label>Items per page <select value={perPage} onChange={e=>{setPerPage(Number(e.target.value));setPage(1)}}>{[10,20,30,50,100,200].map(n=><option key={n} value={n}>{n}</option>)}</select></label><button type="button" className="secondary-button" disabled={loading||page>=result.last_page} onClick={()=>setPage(result.last_page)}>Last page »</button></div><Pagination meta={result} onPage={setPage} />
      </>}
    </section>
    {receipt && <ReceiveStockDialog initial={receipt} canCreateProduct={currentUser.permissions.includes('catalog.manage')} branches={branches.filter(b => b.is_active)} onClose={() => setReceipt(null)} onSaved={message => { setReceipt(null); setReload(n => n + 1); notify(message) }} />}
  </div>
}

function ReceiveStockDialog({ initial, branches, canCreateProduct, onClose, onSaved }: { initial: { book?: Book; branchId?: number }; branches: Branch[]; canCreateProduct: boolean; onClose: () => void; onSaved: (message: string) => void }) {
  const [book, setBook] = useState<Book | null>(initial.book ?? null)
  const [branch, setBranch] = useState(String(initial.branchId ?? branches[0]?.id ?? ''))
  const [quantity, setQuantity] = useState('')
  const [unitId, setUnitId] = useState('')
  const [units, setUnits] = useState<{id:number;name:string;pieces_per_unit:number}[]>([])
  const [reference, setReference] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [suppliers, setSuppliers] = useState<{id:number;name:string}[]>([])
  const [supplierQuery, setSupplierQuery] = useState('')
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')
  const [books, setBooks] = useState<Book[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [completedSearch, setCompletedSearch] = useState('')
  const [addingProduct, setAddingProduct] = useState(false)
  const [creating, setCreating] = useState(false)
  const [productMessage, setProductMessage] = useState('')
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)

  useEffect(() => {
    const term = search.trim()
    if (book || addingProduct || !term) {
      setBooks([]); setSearching(false); setSearchError(''); setCompletedSearch('')
      return
    }
    let cancelled = false
    setSearching(true); setSearchError(''); setBooks([])
    const timer = window.setTimeout(() => {
      api<{ data: Book[] }>('/books', { query: { search: term, active_only: 1 } })
        .then(data => { if (!cancelled) setBooks(data.data) })
        .catch(e => { if (!cancelled) setSearchError(errorMessage(e)) })
        .finally(() => { if (!cancelled) { setSearching(false); setCompletedSearch(term) } })
    }, 300)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [book, addingProduct, search, retry])

  useEffect(() => { if (!book) {setUnits([]);setUnitId('');return};let active=true;api<{id:number;name:string;pieces_per_unit:number}[]>(`/books/${book.id}/units`).then(data=>{if(active)setUnits(data)}).catch(()=>{if(active)setUnits([])});return ()=>{active=false} },[book])

  useEffect(() => { let active=true;api<{data:{id:number;name:string}[]}>('/suppliers',{query:{per_page:100}}).then(r=>{if(active)setSuppliers(r.data)}).catch(()=>undefined);return ()=>{active=false} },[])
  async function save(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    if (!book) { setError(new ApiError('Select a product to receive.', 422)); return }
    submitting.current = true; setBusy(true); setError(null)
    try {
      const result = await api<{ quantity: number }>('/inventory/receive', { method: 'POST', body: { book_id: book.id, branch_id: Number(branch), quantity: Number(quantity), product_unit_id:unitId?Number(unitId):null, supplier_id:supplierId?Number(supplierId):null, reference: reference.trim() || null, notes: notes.trim() || null } })
      onSaved(`${Number(quantity)*(units.find(u=>String(u.id)===unitId)?.pieces_per_unit??1)} individual units received. ${book.title} now has ${result.quantity} units on hand at ${branches.find(b => b.id === Number(branch))?.name}.`)
    } catch (e) { setError(e instanceof ApiError ? e : new ApiError(errorMessage(e), 0)) }
    finally { submitting.current = false; setBusy(false) }
  }
  return <Modal variant="original" title="Receive stock" description="Add a delivery or opening stock to a branch." icon={<PackagePlus size={21} />} busy={busy || creating} onClose={onClose}>
    <form onSubmit={save}>
      <FormAlert message={error?.message ?? ''} />
      <FormAlert tone="success" message={productMessage} />
      <fieldset disabled={busy || creating} className="space-y-4 disabled:opacity-70">
        {book ? <div className="stock-product-selected"><strong>{book.title}</strong><span>{book.sku}</span><button type="button" className="text-button" onClick={() => { setBook(null); setSearch(''); setAddingProduct(false); setProductMessage(''); setError(null) }}>Change product</button>{error?.field('book_id') && <p className="mt-2 text-xs text-rose-600">{error.field('book_id')}</p>}</div> : <div>
          <Field label="Find a product" hint="Start typing a name, SKU or ISBN. If there’s no match, you can add the product here."><input className={inputClass} value={search} maxLength={255} disabled={addingProduct} onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }} onChange={e => { setSearch(e.target.value); setBooks([]); setSearchError(''); setSearching(Boolean(e.target.value.trim())) }} placeholder="Type to find or add a product…" /></Field>
          {!addingProduct && search.trim() && <div className="stock-product-results" aria-live="polite">{searching || completedSearch !== search.trim() ? <p>Searching…</p> : searchError ? <ErrorState message={searchError} onRetry={() => setRetry(n => n + 1)} /> : books.length ? books.map(item => <button type="button" key={item.id} className="stock-product-option" onClick={() => { setBook(item); setError(null) }}><strong>{item.title}</strong><span>{item.sku}</span></button>) : <div className="stock-product-missing"><p>No product matches “{search.trim()}”.</p>{canCreateProduct ? <button type="button" className="secondary-button" onClick={() => { setAddingProduct(true); setError(null) }}><Plus size={15} /> Add “{search.trim()}” as a new product</button> : <p>Ask a catalogue manager to add this product.</p>}</div>}</div>}
          {!addingProduct && canCreateProduct && search.trim() && !searching && completedSearch === search.trim() && !searchError && books.length > 0 && !books.some(item => item.title.toLowerCase() === search.trim().toLowerCase() || item.sku.toLowerCase() === search.trim().toLowerCase()) && <button type="button" className="text-button" onClick={() => { setAddingProduct(true); setError(null) }}><Plus size={15} /> Not listed? Add “{search.trim()}”</button>}
          {addingProduct && <AddReceiptProduct initialName={search.trim()} creating={creating} onBusy={setCreating} onCancel={() => setAddingProduct(false)} onCreated={item => { setBook(item); setAddingProduct(false); setError(null); setProductMessage('Product added. Enter the quantity below to receive stock.') }} />}
        </div>}
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Receiving branch" error={error?.field('branch_id')}><select required className={inputClass} value={branch} onChange={e => setBranch(e.target.value)}><option value="">Choose branch</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="Quantity to add" error={error?.field('quantity')}><input required className={inputClass} type="number" min="1" max="2147483647" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="e.g. 25" /></Field></div>
        <Field label="Received as"><select className={inputClass} value={unitId} onChange={e=>setUnitId(e.target.value)}><option value="">Individual piece (×1)</option>{units.map(u=><option key={u.id} value={u.id}>{u.name} (×{u.pieces_per_unit})</option>)}</select></Field>
        <p className="text-sm text-slate-600">Adds {Number(quantity||0)*(units.find(u=>String(u.id)===unitId)?.pieces_per_unit??1)} individual units to stock.</p>
        <Field label="Supplier (optional for opening stock)" error={error?.field('supplier_id')}><input className={inputClass} placeholder="Filter suppliers…" value={supplierQuery} onChange={e=>setSupplierQuery(e.target.value)}/><select className={inputClass} value={supplierId} onChange={e=>setSupplierId(e.target.value)}><option value="">Opening stock / no supplier</option>{suppliers.filter(s=>s.name.toLowerCase().includes(supplierQuery.toLowerCase())||String(s.id)===supplierId).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label="Delivery note or invoice number (optional)" error={error?.field('reference')}><input className={inputClass} maxLength={255} value={reference} onChange={e => setReference(e.target.value)} placeholder="Delivery note or invoice number" /></Field>
        <Field label="Notes (optional)" error={error?.field('notes')}><textarea className={`${inputClass} h-20 py-3`} maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Opening stock, delivery details…" /></Field>
      </fieldset>
      <div className="mt-6 flex justify-end gap-3 border-t border-slate-100 pt-5"><button type="button" className={secondaryButton} disabled={busy || creating} onClick={onClose}>Cancel</button><button type="submit" className={primaryButton} disabled={busy || creating || !book}>{busy ? 'Receiving…' : 'Receive stock'}</button></div>
    </form>
  </Modal>
}

function AddReceiptProduct({ initialName, creating, onBusy, onCancel, onCreated }: { initialName: string; creating: boolean; onBusy: (busy: boolean) => void; onCancel: () => void; onCreated: (book: Book) => void }) {
  const [form, setForm] = useState({ title: initialName, sku: '', isbn: '', cost_price: '', selling_price: '', reorder_level: '10' })
  const [error, setError] = useState<ApiError | null>(null)
  const fields = useRef<HTMLFieldSetElement>(null)
  const submitting = useRef(false)

  async function create() {
    if (submitting.current) return
    // Validate product fields without requiring the stock quantity yet.
    for (const input of fields.current?.querySelectorAll<HTMLInputElement>('input') ?? []) {
      if (!input.reportValidity()) return
    }
    submitting.current = true; onBusy(true); setError(null)
    try {
      const product = await api<Book>('/books', { method: 'POST', body: { ...form, title: form.title.trim(), sku: form.sku.trim(), isbn: form.isbn.trim() || null, cost_price: Number(form.cost_price), selling_price: Number(form.selling_price), reorder_level: Number(form.reorder_level) } })
      onCreated(product)
    } catch (e) { setError(e instanceof ApiError ? e : new ApiError(errorMessage(e), 0)) }
    finally { submitting.current = false; onBusy(false) }
  }

  return <section className="stock-add-product" aria-label="Add a missing product" onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) { event.preventDefault(); void create() } }}>
    <h3>Add a new product</h3><p>Save its catalogue details, then receive stock below.</p>
    <FormAlert message={error?.message ?? ''} />
    <fieldset ref={fields} disabled={creating} className="grid gap-4 sm:grid-cols-2">
      <Field label="Product name" className="sm:col-span-2" error={error?.field('title')}><input className={inputClass} required autoFocus maxLength={255} value={form.title} onChange={e => setForm(previous => ({ ...previous, title: e.target.value }))} /></Field>
      <Field label="SKU" error={error?.field('sku')}><input className={inputClass} required maxLength={100} value={form.sku} onChange={e => setForm(previous => ({ ...previous, sku: e.target.value }))} placeholder="Unique product code" /></Field>
      <Field label="ISBN (optional)" error={error?.field('isbn')}><input className={inputClass} maxLength={20} value={form.isbn} onChange={e => setForm(previous => ({ ...previous, isbn: e.target.value }))} /></Field>
      <Field label="Cost price (KES)" error={error?.field('cost_price')}><input className={inputClass} required type="number" min="0" step="0.01" value={form.cost_price} onChange={e => setForm(previous => ({ ...previous, cost_price: e.target.value }))} /></Field>
      <Field label="Selling price (KES)" error={error?.field('selling_price')}><input className={inputClass} required type="number" min="0" step="0.01" value={form.selling_price} onChange={e => setForm(previous => ({ ...previous, selling_price: e.target.value }))} /></Field>
      <Field label="Reorder level" error={error?.field('reorder_level')}><input className={inputClass} required type="number" min="0" step="1" value={form.reorder_level} onChange={e => setForm(previous => ({ ...previous, reorder_level: e.target.value }))} /></Field>
    </fieldset>
    <div className="stock-add-product-actions"><button type="button" className="secondary-button" disabled={creating} onClick={onCancel}>Back to search</button><button type="button" className="primary-button" disabled={creating} onClick={() => void create()}>{creating ? 'Adding…' : 'Save product & select'}</button></div>
  </section>
}
