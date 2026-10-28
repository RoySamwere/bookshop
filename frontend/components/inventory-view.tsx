'use client'

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { Boxes, Download, PackagePlus, Search } from 'lucide-react'
import { api, ApiError, errorMessage } from '../lib/api'
import type { BookshopUser } from '../lib/auth'
import { branchesApi, type Branch } from '../lib/workspace-api'
import { Card, EmptyState, ErrorState, Field, FormAlert, LoadingState, Modal, PageHeader, Pagination, StatCard, inputClass, primaryButton, secondaryButton } from './ui-kit'

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
    api<StockPage>('/inventory', { query: { branch_id: branch, status, search, page } })
      .then(data => { if (!cancelled) setResult(data) })
      .catch(e => { if (!cancelled) setError(errorMessage(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [branch, status, search, page, reload])

  function exportPage() {
    if (!result) return
    const cell = (value: unknown) => `"${String(value ?? '').replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""')}"`
    const rows = [['Product', 'SKU', 'Branch', 'On hand', 'Reserved', 'Available', 'Reorder level'], ...result.data.map(row => [row.title, row.sku, row.branch_name, row.quantity, row.reserved, row.quantity - row.reserved, row.reorder_level])]
    const url = URL.createObjectURL(new Blob([rows.map(row => row.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }))
    const link = document.createElement('a'); link.href = url; link.download = 'hekima-stock-page.csv'; link.click(); URL.revokeObjectURL(url)
  }
  const summary = result?.summary
  return <div className="products-page">
    <PageHeader eyebrow="OPERATIONS · INVENTORY CONTROL" icon={<Boxes size={16} />} title="Inventory & Stock" description="Receive products into your branches and track saved stock balances."
      actions={<><button className={secondaryButton} onClick={exportPage} disabled={loading || !!error || !result?.data.length}><Download size={16} /> Export current page</button>{canManage && <button className={primaryButton} onClick={() => setReceipt({ branchId: branch ? Number(branch) : undefined })} disabled={!branches.some(b => b.is_active)}><PackagePlus size={17} /> Receive stock</button>}</>} />
    {branchError && <div className="mb-5"><ErrorState message={branchError} onRetry={() => void loadBranches()} /></div>}
    <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Inventory value" value={loading || error ? '—' : money(summary?.value ?? 0)} hint="On hand at selling price" icon={<Boxes size={19} />} />
      <StatCard label="Units on hand" value={loading || error ? '—' : Number(summary?.units ?? 0).toLocaleString()} hint={`${summary?.stock_lines ?? 0} product / branch balances`} icon={<Boxes size={19} />} tone="emerald" />
      <StatCard label="Low stock" value={loading || error ? '—' : summary?.low ?? 0} hint="Available units at or below reorder level" icon={<Boxes size={19} />} tone="amber" />
      <StatCard label="Out of stock" value={loading || error ? '—' : summary?.out_of_stock ?? 0} hint="No available units in recorded balances" icon={<Boxes size={19} />} tone="pink" />
    </div>
    <Card title="Stock levels" description="Balances appear after stock is first received. Totals follow the branch and search filters." flush>
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-5">
        <form className="flex flex-1 items-center gap-2" onSubmit={e => { e.preventDefault(); setPage(1); setSearch(query.trim()) }}><Search size={17} className="text-slate-400" /><input className={`${inputClass} mt-0 min-w-32`} aria-label="Search stock" placeholder="Title, SKU or ISBN" maxLength={255} value={query} onChange={e => setQuery(e.target.value)} /><button className={secondaryButton}>Search</button></form>
        <select aria-label="Filter by branch" className={`${inputClass} mt-0 w-auto`} value={branch} onChange={e => { setBranch(e.target.value); setPage(1) }}><option value="">All my branches</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}{b.is_active ? '' : ' (inactive)'}</option>)}</select>
        <select aria-label="Filter by stock status" className={`${inputClass} mt-0 w-auto`} value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}><option value="">All stock</option><option value="low">Low stock</option><option value="out">Out of stock</option></select>
      </div>
      {loading ? <LoadingState label="Loading inventory" /> : error ? <ErrorState message={error} onRetry={() => setReload(n => n + 1)} /> : !result?.data.length ? <EmptyState icon={<Boxes size={24} />} title="No stock balances found" body="Receive stock for an existing product to create a balance, or change your filters." /> : <>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs text-slate-500"><tr>{['Product', 'Branch', 'On hand', 'Reserved', 'Available', 'Status', ''].map((label, i) => <th className="px-5 py-3" key={i}>{label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{result.data.map(row => {
          const available = row.quantity - row.reserved
          const label = available === 0 ? 'Out of stock' : available <= row.reorder_level ? 'Low stock' : 'Healthy'
          return <tr key={row.id}><td className="px-5 py-4"><strong className="block text-slate-800">{row.title}</strong><span className="text-xs text-slate-400">{row.sku}</span></td><td className="px-5 py-4">{row.branch_name}</td><td className="px-5 py-4">{row.quantity}</td><td className="px-5 py-4">{row.reserved}</td><td className="px-5 py-4 font-semibold">{available}</td><td className="px-5 py-4"><span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ${available === 0 ? 'bg-rose-50 text-rose-700' : available <= row.reorder_level ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{label}</span></td><td className="px-5 py-4">{canManage && branches.some(b => b.id === row.branch_id && b.is_active) && <button className={secondaryButton} onClick={() => setReceipt({ book: { id: row.book_id, title: row.title, sku: row.sku, is_active: true }, branchId: row.branch_id })}>Restock</button>}</td></tr>
        })}</tbody></table></div>
        <Pagination meta={result} onPage={setPage} />
      </>}
    </Card>
    {receipt && <ReceiveStockDialog initial={receipt} branches={branches.filter(b => b.is_active)} onClose={() => setReceipt(null)} onSaved={message => { setReceipt(null); setReload(n => n + 1); notify(message) }} />}
  </div>
}

function ReceiveStockDialog({ initial, branches, onClose, onSaved }: { initial: { book?: Book; branchId?: number }; branches: Branch[]; onClose: () => void; onSaved: (message: string) => void }) {
  const [book, setBook] = useState<Book | null>(initial.book ?? null)
  const [branch, setBranch] = useState(String(initial.branchId ?? branches[0]?.id ?? ''))
  const [quantity, setQuantity] = useState('')
  const [reference, setReference] = useState('')
  const [notes, setNotes] = useState('')
  const [search, setSearch] = useState('')
  const [books, setBooks] = useState<Book[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)

  useEffect(() => {
    if (book) return
    let cancelled = false
    setSearching(true); setSearchError(''); setBooks([])
    const timer = window.setTimeout(() => {
      api<{ data: Book[] }>('/books', { query: { search, active_only: 1 } })
        .then(data => { if (!cancelled) setBooks(data.data) })
        .catch(e => { if (!cancelled) setSearchError(errorMessage(e)) })
        .finally(() => { if (!cancelled) setSearching(false) })
    }, 300)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [book, search, retry])

  async function save(event: FormEvent) {
    event.preventDefault()
    if (submitting.current) return
    if (!book) { setError(new ApiError('Select a product to receive.', 422)); return }
    submitting.current = true; setBusy(true); setError(null)
    try {
      const result = await api<{ quantity: number }>('/inventory/receive', { method: 'POST', body: { book_id: book.id, branch_id: Number(branch), quantity: Number(quantity), reference: reference.trim() || null, notes: notes.trim() || null } })
      onSaved(`${quantity} units received. ${book.title} now has ${result.quantity} units on hand at ${branches.find(b => b.id === Number(branch))?.name}.`)
    } catch (e) { setError(e instanceof ApiError ? e : new ApiError(errorMessage(e), 0)) }
    finally { submitting.current = false; setBusy(false) }
  }
  return <Modal title="Receive stock" description="Add units to an existing product. Each receipt records who received it, the branch, and the resulting balance." icon={<PackagePlus size={21} />} busy={busy} onClose={onClose}>
    <form onSubmit={save}>
      <FormAlert message={error?.message ?? ''} />
      <fieldset disabled={busy} className="space-y-4 disabled:opacity-70">
        {book ? <div className="rounded-xl border border-blue-100 bg-blue-50 p-4"><strong className="block text-sm text-slate-800">{book.title}</strong><span className="text-xs text-slate-500">{book.sku}</span><button type="button" className="ml-3 text-sm font-semibold text-blue-600" onClick={() => setBook(null)}>Change product</button>{error?.field('book_id') && <p className="mt-2 text-xs text-rose-600">{error.field('book_id')}</p>}</div> : <div>
          <Field label="Find a product" hint="Search the catalogue by title, SKU or ISBN. Add new products in Products & Books first."><input className={inputClass} value={search} maxLength={255} onChange={e => setSearch(e.target.value)} placeholder="Search products…" /></Field>
          <div className="mt-2 max-h-48 overflow-y-auto rounded-xl border border-slate-100" aria-live="polite">{searching ? <p className="p-4 text-sm text-slate-500">Searching…</p> : searchError ? <ErrorState message={searchError} onRetry={() => setRetry(n => n + 1)} /> : books.length ? books.map(item => <button type="button" key={item.id} className="block w-full border-b border-slate-100 px-4 py-3 text-left text-sm hover:bg-blue-50 focus:bg-blue-50" onClick={() => setBook(item)}><strong className="block">{item.title}</strong><span className="text-xs text-slate-400">{item.sku}</span></button>) : <p className="p-4 text-sm text-slate-500">No active products found. Try a different search.</p>}</div>
        </div>}
        <div className="grid gap-4 sm:grid-cols-2"><Field label="Receiving branch" error={error?.field('branch_id')}><select required className={inputClass} value={branch} onChange={e => setBranch(e.target.value)}><option value="">Choose branch</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="Quantity to add" error={error?.field('quantity')}><input required className={inputClass} type="number" min="1" max="2147483647" step="1" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="e.g. 25" /></Field></div>
        <Field label="Delivery reference (optional)" error={error?.field('reference')}><input className={inputClass} maxLength={255} value={reference} onChange={e => setReference(e.target.value)} placeholder="Delivery note or invoice number" /></Field>
        <Field label="Notes (optional)" error={error?.field('notes')}><textarea className={`${inputClass} h-20 py-3`} maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Opening stock, delivery details…" /></Field>
      </fieldset>
      <div className="mt-6 flex justify-end gap-3 border-t border-slate-100 pt-5"><button type="button" className={secondaryButton} disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className={primaryButton} disabled={busy || !book}>{busy ? 'Receiving…' : 'Receive stock'}</button></div>
    </form>
  </Modal>
}
