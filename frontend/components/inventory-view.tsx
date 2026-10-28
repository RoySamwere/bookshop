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
type Book = { id: number; title: string; sku: string; is_active: boolean; category_name?: string|null; subcategory_name?: string|null; brand?: string|null; page_count?: number|null; ruling_style?: string|null }
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

  const [bulkOpen,setBulkOpen]=useState(false)
  const [bulkRows,setBulkRows]=useState<{title:string;sku:string;cost_price:number;selling_price:number;quantity:number}[]>([])
  const [bulkSupplier,setBulkSupplier]=useState('')
  const [bulkBranch,setBulkBranch]=useState('')
  const [bulkSuppliers,setBulkSuppliers]=useState<{id:number;name:string}[]>([])
  const [bulkError,setBulkError]=useState('')
  const [bulkBusy,setBulkBusy]=useState(false)
  useEffect(()=>{if(!bulkOpen)return;api<{data:{id:number;name:string}[]}>('/suppliers',{query:{per_page:100}}).then(x=>setBulkSuppliers(x.data)).catch(e=>setBulkError(errorMessage(e)))},[bulkOpen])
  function bulkTemplate(){
    const url=URL.createObjectURL(new Blob(['title,sku,cost_price,selling_price,quantity\r\n'],{type:'text/csv;charset=utf-8'}))
    const a=document.createElement('a');a.href=url;a.download='hekima-stock-upload.csv';a.click();URL.revokeObjectURL(url)
  }
  async function readBulk(file:File|undefined){
    setBulkRows([]);setBulkError('');if(!file)return
    try{
      if(file.size>5_000_000)throw new Error('CSV must be under 5 MB')
      const lines=(await file.text()).replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean)
      if(lines.shift()?.trim()!=='title,sku,cost_price,selling_price,quantity')throw new Error('Use the downloaded stock upload template.')
      const rows=lines.map((line,i)=>{
        const parts=line.split(',').map(v=>v.trim().replace(/^"|"$/g,''))
        if(parts.length!==5||!parts[0]||!parts[1]||parts.slice(2).some(v=>v===''||!Number.isFinite(Number(v))||Number(v)<0)||!Number.isInteger(Number(parts[4]))||Number(parts[4])<1)throw new Error(`Invalid row ${i+2}. Avoid commas in product names.`)
        return {title:parts[0],sku:parts[1],cost_price:Number(parts[2]),selling_price:Number(parts[3]),quantity:Number(parts[4])}
      })
      if(!rows.length)throw new Error('CSV has no products')
      if(new Set(rows.map(x=>x.sku.toLowerCase())).size!==rows.length)throw new Error('Duplicate SKU in CSV')
      setBulkRows(rows)
    }catch(e){setBulkError(e instanceof Error?e.message:'Cannot read CSV')}
  }
  async function uploadBulk(){
    if(!bulkRows.length||!bulkSupplier||!bulkBranch||bulkBusy)return
    setBulkBusy(true);setBulkError('');let received=0
    try{
      for(let i=0;i<bulkRows.length;i+=100){
        const result=await api<{received:number}>('/inventory/bulk-receive',{method:'POST',body:{branch_id:Number(bulkBranch),supplier_id:Number(bulkSupplier),rows:bulkRows.slice(i,i+100)}})
        received+=result.received
      }
      setBulkRows([]);setBulkOpen(false);setReload(x=>x+1);notify(`${received} products received and saved to Products & Books and Inventory`)
    }catch(e){setBulkError(`${received} rows already received. ${errorMessage(e)}`)}
    finally{setBulkBusy(false)}
  }
  function exportPage() {
    if (!result) return
    const cell = (value: unknown) => `"${String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`
    const rows = [['Product', 'SKU', 'Branch', 'On hand', 'Reserved', 'Available', 'Reorder level'], ...result.data.map(row => [row.title, row.sku, row.branch_name, row.quantity, row.reserved, row.quantity - row.reserved, row.reorder_level])]
    const url = URL.createObjectURL(new Blob([rows.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = 'hekima-stock-page.csv'; link.click(); URL.revokeObjectURL(url)
  }
  const summary = result?.summary
  return <div className="inventory-page">
    <div className="page-heading compact"><div><div className="eyebrow">OPERATIONS · INVENTORY CONTROL</div><h1 tabIndex={-1}>Inventory & Stock</h1><p>Monitor stock levels, receive deliveries, and keep your shelves ready for customers.</p></div><div className="heading-actions"><button className={secondaryButton} onClick={exportPage} disabled={loading || !!error || !result?.data.length}><Download size={16} /> Export current page</button>{canManage && <button className={secondaryButton} onClick={()=>{setBulkOpen(true);setBulkBranch(branch||String(branches.find(b=>b.is_active)?.id??""))}}>Bulk upload stock CSV</button>}{canManage && <button className={primaryButton} onClick={() => setReceipt({ branchId: branch ? Number(branch) : undefined })} disabled={!branches.some(b => b.is_active)}><Plus size={17} /> Receive stock</button>}</div></div>
    {bulkOpen&&<Modal variant="original" title="Bulk upload stock" description="Add products and stock quantities from a CSV file." icon={<PackagePlus size={21}/>} busy={bulkBusy} onClose={()=>setBulkOpen(false)}>
      <div className="max-h-[70vh] space-y-5 overflow-y-auto p-1">
        <div className="rounded-xl border border-teal-100 bg-teal-50 p-4 text-sm text-teal-900"><strong>How it works</strong><p className="mt-1 text-teal-800">Download the template, enter products with quantities, then choose a branch and supplier. Existing SKUs receive more stock; new SKUs are added to your catalogue.</p></div>
        <button type="button" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50" onClick={bulkTemplate}><Download size={16}/> Download CSV template</button>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-sm font-semibold text-slate-700">Receiving branch<select className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100" value={bulkBranch} onChange={e=>setBulkBranch(e.target.value)}><option value="">Select branch</option>{branches.filter(b=>b.is_active).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></label>
          <label className="space-y-1.5 text-sm font-semibold text-slate-700">Supplier<select className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-normal focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-100" value={bulkSupplier} onChange={e=>setBulkSupplier(e.target.value)}><option value="">Select supplier</option>{bulkSuppliers.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        </div>
        <label className="block space-y-2 text-sm font-semibold text-slate-700">Upload completed CSV<input className="block w-full cursor-pointer rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3 text-sm font-normal text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-teal-700 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-white hover:border-teal-400" type="file" accept=".csv,text/csv" onChange={e=>void readBulk(e.target.files?.[0])}/></label>
        {bulkError&&<div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{bulkError}</div>}
        {bulkRows.length>0&&<div className="flex justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700"><span><strong>{bulkRows.length}</strong> products</span><span><strong>{bulkRows.reduce((n,r)=>n+r.quantity,0).toLocaleString()}</strong> units to receive</span></div>}
        <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-4"><button type="button" className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50" disabled={bulkBusy} onClick={()=>setBulkOpen(false)}>Cancel</button><button type="button" className="rounded-xl bg-teal-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-teal-800 disabled:cursor-not-allowed disabled:opacity-50" disabled={!bulkRows.length||!bulkSupplier||!bulkBranch||bulkBusy} onClick={()=>void uploadBulk()}>{bulkBusy?'Uploading…':'Confirm stock upload'}</button></div>
      </div>
    </Modal>}
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
        <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-5 py-3">Product</th><th className="px-5 py-3">Branch</th><th className="px-5 py-3 text-right">On hand</th><th className="px-5 py-3 text-right">Available</th><th className="px-5 py-3">Stock status</th><th className="px-5 py-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{result.data.map(row=>{
          const available=row.quantity-row.reserved
          const label=available===0?'Out of stock':available<=row.reorder_level?'Low stock':'Healthy'
          return <tr key={`${row.book_id}-${row.branch_id}`} className="hover:bg-slate-50"><td className="px-5 py-4"><div className="font-semibold text-slate-900">{row.title}</div><div className="mt-1 font-mono text-xs text-slate-500">{row.sku}</div></td><td className="px-5 py-4 text-slate-600">{row.branch_name}</td><td className="px-5 py-4 text-right font-semibold tabular-nums text-slate-900">{row.quantity.toLocaleString()}</td><td className="px-5 py-4 text-right tabular-nums text-slate-700">{available.toLocaleString()}</td><td className="px-5 py-4"><span className={label==='Healthy'?'rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700':label==='Low stock'?'rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700':'rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700'}>{label}</span></td><td className="px-5 py-4 text-right">{canManage&&branches.some(b=>b.id===row.branch_id&&b.is_active)&&<button type="button" className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-800 hover:bg-teal-100" onClick={()=>setReceipt({book:{id:row.book_id,title:row.title,sku:row.sku,is_active:true},branchId:row.branch_id})}>Restock</button>}</td></tr>
        })}</tbody></table></div>
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
  const [supplierOpen, setSupplierOpen] = useState(false)
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')
  const [books, setBooks] = useState<Book[]>([])
  const [bookPage, setBookPage] = useState(1)
  const [bookLastPage, setBookLastPage] = useState(1)
  const [bookTotal, setBookTotal] = useState(0)
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
      api<{ data: Book[];last_page:number;total:number }>('/books', { query: { search: term, page:bookPage, per_page:50, receiving_search:1 } })
        .then(data => { if (!cancelled) {setBooks(data.data);setBookLastPage(data.last_page);setBookTotal(data.total)} })
        .catch(e => { if (!cancelled) setSearchError(errorMessage(e)) })
        .finally(() => { if (!cancelled) { setSearching(false); setCompletedSearch(term) } })
    }, 300)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [book, addingProduct, search, retry, bookPage])

  useEffect(() => { if (!book) {setUnits([]);setUnitId('');return};let active=true;api<{id:number;name:string;pieces_per_unit:number}[]>(`/books/${book.id}/units`).then(data=>{if(active)setUnits(data)}).catch(()=>{if(active)setUnits([])});return ()=>{active=false} },[book])

  useEffect(() => { let active=true;api<{data:{id:number;name:string}[]}>('/suppliers',{query:{per_page:100}}).then(r=>{if(active)setSuppliers(r.data)}).catch(()=>undefined);return ()=>{active=false} },[])
  async function save(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    if (!book) { setError(new ApiError('Select a product to receive.', 422)); return }
    if (!supplierId) { setError(new ApiError('Select a supplier from the list.', 422)); return }
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
          <Field label="Find a product" hint="Search the entire Products & Books catalogue by product, SKU, category, subcategory, brand or exercise-book specification. Results appear only after you type a search."><input className={inputClass} value={search} maxLength={255} disabled={addingProduct} onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }} onChange={e => { setSearch(e.target.value); setBookPage(1);setBooks([]); setSearchError(''); setSearching(Boolean(e.target.value.trim())) }} placeholder="Type to find or add a product…" /></Field>
          {!addingProduct && Boolean(search.trim()) && <div className="stock-product-results" aria-live="polite">{searching || completedSearch !== search.trim() ? <p>Searching…</p> : searchError ? <ErrorState message={searchError} onRetry={() => setRetry(n => n + 1)} /> : books.length ? books.map(item => <button type="button" key={item.id} disabled={!item.is_active} className="stock-product-option" onClick={() => { setBook(item); setError(null) }}><strong>{item.title}</strong><span>{[item.category_name,item.subcategory_name,item.brand,item.ruling_style,item.page_count?`${item.page_count} pages`:null,item.sku].filter(Boolean).join(' · ')}{!item.is_active?' · Inactive — activate in Products & Books first':''}</span></button>) : <div className="stock-product-missing"><p>No product matches “{search.trim()}”.</p>{canCreateProduct ? <button type="button" className="secondary-button" onClick={() => { setAddingProduct(true); setError(null) }}><Plus size={15} /> Add “{search.trim()}” as a new product</button> : <p>Ask a catalogue manager to add this product.</p>}</div>}<div className="flex items-center justify-between gap-2 px-3 py-2 text-xs"><span>{bookTotal} matching products · page {bookPage} of {bookLastPage}</span><div className="flex gap-2"><button type="button" className="secondary-button" disabled={bookPage<=1} onClick={()=>setBookPage(p=>p-1)}>Previous</button><button type="button" className="secondary-button" disabled={bookPage>=bookLastPage} onClick={()=>setBookPage(p=>p+1)}>Next</button></div></div></div>}
          {!addingProduct && canCreateProduct && search.trim() && !searching && completedSearch === search.trim() && !searchError && books.length > 0 && !books.some(item => item.title.toLowerCase() === search.trim().toLowerCase() || item.sku.toLowerCase() === search.trim().toLowerCase()) && <button type="button" className="text-button" onClick={() => { setAddingProduct(true); setError(null) }}><Plus size={15} /> Not listed? Add “{search.trim()}”</button>}
          {addingProduct && <AddReceiptProduct initialName={search.trim()} creating={creating} onBusy={setCreating} onCancel={() => setAddingProduct(false)} onCreated={item => { setBook(item); setAddingProduct(false); setError(null); setProductMessage('Product added. Enter the quantity below to receive stock.') }} />}
        </div>}
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Receiving branch" error={error?.field('branch_id')}><select required className={inputClass} value={branch} onChange={e => setBranch(e.target.value)}><option value="">Choose branch</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="Quantity to add" error={error?.field('quantity')}><input required className={inputClass} type="number" min="1" max="2147483647" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="e.g. 25" /></Field></div>
        <Field label="Received as"><select className={inputClass} value={unitId} onChange={e=>setUnitId(e.target.value)}><option value="">Individual piece (×1)</option>{units.map(u=><option key={u.id} value={u.id}>{u.name} (×{u.pieces_per_unit})</option>)}</select></Field>
        <p className="text-sm text-slate-600">Adds {Number(quantity||0)*(units.find(u=>String(u.id)===unitId)?.pieces_per_unit??1)} individual units to stock.</p>
        <div className="relative">
          <Field label="Supplier *" error={error?.field('supplier_id')}>
            <input className={inputClass} role="combobox" aria-expanded={supplierOpen} aria-controls="receipt-supplier-options" aria-autocomplete="list" required value={supplierOpen ? supplierQuery : (suppliers.find(s=>String(s.id)===supplierId)?.name ?? '')} placeholder="Search and select a supplier…" onFocus={()=>{setSupplierOpen(true);setSupplierQuery('')}} onChange={e=>{setSupplierQuery(e.target.value);setSupplierId('');setSupplierOpen(true)}} onBlur={()=>window.setTimeout(()=>setSupplierOpen(false),150)} />
          </Field>
          {supplierOpen&&<div id="receipt-supplier-options" role="listbox" className="absolute z-30 mt-1 max-h-52 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg">
            {suppliers.filter(x=>x.name.toLowerCase().includes(supplierQuery.toLowerCase())).map(x=><button key={x.id} role="option" aria-selected={String(x.id)===supplierId} type="button" className="block w-full px-3 py-2 text-left hover:bg-slate-100" onMouseDown={e=>e.preventDefault()} onClick={()=>{setSupplierId(String(x.id));setSupplierQuery('');setSupplierOpen(false)}}>{x.name}</button>)}
            {!suppliers.some(x=>x.name.toLowerCase().includes(supplierQuery.toLowerCase()))&&<p className="px-3 py-2 text-sm">No matching suppliers. Register one on the Suppliers page.</p>}
          </div>}
        </div>
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
