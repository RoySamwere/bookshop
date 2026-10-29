'use client'

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent } from 'react'
import { BookOpen, Loader2, PackageX, Plus, RefreshCw, ScanBarcode, Search, X } from 'lucide-react'
import { errorMessage } from '../../lib/api'
import { formatKes, posApi, toNumber, type PosCategory, type PosProduct } from '../../lib/pos-api'
import { available } from '../../lib/pos-store'

// Bookcloth tones from the public website's shelf, one per category so a section is recognisable at a glance.
const SPINES = ['#9e2b3a', '#2f5d50', '#c98a1b', '#2e6f8e', '#5b3a6b', '#7a4b2a', '#3d5a99', '#4b7f3a']
export const spineColour = (categoryId?: number | null) => categoryId ? SPINES[categoryId % SPINES.length] : '#94a3b8'

export type CatalogueHandle = { focusSearch: () => void; refresh: () => void }
type AddSource = 'tap' | 'scan'

export const PosCatalogue = forwardRef<CatalogueHandle, {
  branchId: number | null; categories: PosCategory[]; inCart: Map<number, number>; locked: boolean
  onAdd: (product: PosProduct, source: AddSource) => void
}>(function PosCatalogue({ branchId, categories, inCart, locked, onAdd }, ref) {
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [rows, setRows] = useState<PosProduct[]>([])
  const [page, setPage] = useState(1)
  const [lastPage, setLastPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const [scanNote, setScanNote] = useState('')
  const [reload, setReload] = useState(0)
  const [railEnd, setRailEnd] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const request = useRef(0)

  useImperativeHandle(ref, () => ({
    focusSearch: () => { searchRef.current?.focus(); searchRef.current?.select() },
    refresh: () => setReload(value => value + 1),
  }), [])

  // Search as the cashier types (debounced); a new search starts again from page one.
  useEffect(() => {
    if (!branchId) return
    const id = ++request.current
    setLoading(true); setError('')
    const timer = window.setTimeout(() => {
      posApi.products({ branch_id: branchId, search: query, category_id: categoryId, page: 1 })
        .then(result => { if (id !== request.current) return; setRows(result.data); setPage(result.current_page); setLastPage(result.last_page); setTotal(result.total) })
        .catch(e => { if (id === request.current) setError(errorMessage(e)) })
        .finally(() => { if (id === request.current) setLoading(false) })
    }, query ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [branchId, query, categoryId, reload])

  const loadMore = useCallback(async () => {
    if (!branchId || loadingMore || page >= lastPage) return
    setLoadingMore(true)
    try {
      const result = await posApi.products({ branch_id: branchId, search: query, category_id: categoryId, page: page + 1 })
      setRows(previous => [...previous, ...result.data.filter(row => !previous.some(old => old.id === row.id))])
      setPage(result.current_page); setLastPage(result.last_page)
    } catch (e) { setError(errorMessage(e)) } finally { setLoadingMore(false) }
  }, [branchId, loadingMore, page, lastPage, query, categoryId])

  /** Barcode scanners type the code and press Enter: add an exact SKU/ISBN match straight to the sale. */
  async function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); setScanNote(''); return }
    if (event.key !== 'Enter' || !branchId) return
    event.preventDefault()
    const code = query.trim()
    if (!code) return
    if (locked) { setScanNote('Finish or go back from payment before adding more items.'); return }
    try {
      const result = await posApi.products({ branch_id: branchId, search: code, page: 1 })
      const exact = result.data.find(row => [row.sku, row.isbn].some(value => value?.toLowerCase() === code.toLowerCase()))
      const match = exact ?? (result.data.length === 1 ? result.data[0] : null)
      if (!match) { setScanNote(result.data.length ? `No exact match for “${code}”. Pick from the results.` : `Nothing matches “${code}”.`); return }
      if (available(match) <= 0) { setScanNote(`${match.title} is out of stock at this branch.`); return }
      onAdd(match, 'scan')
      setQuery(''); setScanNote('')
    } catch (e) { setScanNote(errorMessage(e)) }
  }

  const showingAll = !query && !categoryId
  return <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Products">
    <div className="space-y-3 px-4 pb-3 pt-4 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="hidden text-[11px] font-bold uppercase tracking-[.16em] text-[#9e2b3a] sm:block">Hekima · Sales catalogue</p>
          <h1 className="text-[20px] font-extrabold tracking-tight text-[#13254a] sm:mt-0.5 sm:text-[23px]">Find a product</h1>
          <p className="hidden text-[12.5px] text-slate-500 sm:block">Scan, search or tap to add to the current sale.</p>
        </div>
        <div className="hidden items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800 sm:flex"><span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" /> Live inventory</div>
      </div>
      <label className="pos-framed flex h-[62px] items-center gap-3 rounded-2xl border-2 border-[#d9e3f3] bg-white px-4 shadow-[0_8px_25px_-16px_rgba(19,37,74,.35)] transition focus-within:border-[#13254a] focus-within:ring-4 focus-within:ring-blue-100">
        <ScanBarcode size={22} className="shrink-0 text-[#087df5]" aria-hidden="true" />
        <span className="sr-only">Scan a barcode or search products</span>
        <input ref={searchRef} value={query} onChange={event => { setQuery(event.target.value); setScanNote('') }} onKeyDown={event => void onSearchKey(event)}
          className="min-w-0 flex-1 bg-transparent text-[16px] text-[#162c4c] outline-none placeholder:text-slate-400" placeholder="Scan a barcode, or search by title, ISBN or SKU"
          autoComplete="off" spellCheck={false} enterKeyHint="search" data-pos-search aria-describedby="pos-scan-note" />
        {loading && query ? <Loader2 size={18} className="animate-spin text-slate-400" aria-hidden="true" /> : query
          ? <button type="button" onClick={() => { setQuery(''); setScanNote(''); searchRef.current?.focus() }} className="grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Clear search"><X size={17} /></button>
          : <kbd className="hidden rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500 sm:block">F2</kbd>}
      </label>
      <p id="pos-scan-note" role={scanNote ? 'status' : undefined} className={`min-h-[18px] px-1 text-[13px] ${scanNote ? 'text-amber-700' : 'text-slate-500'}`}>
        {scanNote || (loading ? 'Looking…' : `${total.toLocaleString('en-KE')} ${total === 1 ? 'product' : 'products'}${showingAll ? ' at this branch' : ' found'}`)}
      </p>
      {categories.length > 0 && <div className={`pos-rail -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin] ${railEnd ? 'at-end' : ''}`} role="group" aria-label="Filter by category"
        onScroll={event => { const rail = event.currentTarget; setRailEnd(rail.scrollLeft + rail.clientWidth >= rail.scrollWidth - 4) }}>
        {[{ id: null as number | null, name: 'All products' }, ...categories].map(category => {
          const selected = categoryId === category.id
          return <button key={category.id ?? 'all'} type="button" aria-pressed={selected} onClick={() => setCategoryId(category.id)}
            className={`flex h-9 shrink-0 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold transition ${selected ? 'border-[#13254a] bg-[#13254a] text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'}`}>
            {category.id && <span className="h-3.5 w-1 rounded-full" style={{ background: spineColour(category.id) }} aria-hidden="true" />}{category.name}
          </button>
        })}
      </div>}
    </div>

    <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-28 sm:px-6 lg:pb-6">
      {error ? <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-100 bg-white px-6 py-12 text-center" role="alert">
        <p className="text-sm font-semibold text-slate-800">The product list did not load</p>
        <p className="max-w-sm text-sm text-slate-500">{error}</p>
        <button type="button" onClick={() => setReload(value => value + 1)} className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"><RefreshCw size={15} /> Try again</button>
      </div> : !loading && rows.length === 0 ? <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-slate-300 px-6 py-16 text-center">
        <Search size={26} className="text-slate-300" aria-hidden="true" />
        <p className="text-sm font-semibold text-slate-800">{showingAll ? 'No products at this branch yet' : 'No products match'}</p>
        <p className="max-w-xs text-sm text-slate-500">{showingAll ? 'Products appear here once they are added to the catalogue.' : 'Check the spelling, or scan the barcode instead.'}</p>
        {!showingAll && <button type="button" onClick={() => { setQuery(''); setCategoryId(null) }} className="mt-2 text-sm font-semibold text-[#087df5] hover:underline">Show all products</button>}
      </div> : <>
        <ul className={`grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          {rows.map(product => <li key={product.id}>
            <ProductTile product={product} quantity={inCart.get(product.id) ?? 0} locked={locked} onAdd={() => onAdd(product, 'tap')} />
          </li>)}
        </ul>
        {page < lastPage && <div className="flex justify-center pt-5">
          <button type="button" onClick={() => void loadMore()} disabled={loadingMore} className="inline-flex h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60">
            {loadingMore ? <><Loader2 size={16} className="animate-spin" /> Loading…</> : `Show more (${(total - rows.length).toLocaleString('en-KE')} left)`}
          </button>
        </div>}
      </>}
    </div>
  </section>
})

function ProductTile({ product, quantity, locked, onAdd }: { product: PosProduct; quantity: number; locked: boolean; onAdd: () => void }) {
  const stock = available(product)
  const out = stock <= 0
  const left = stock - quantity
  const code = product.isbn || product.sku
  return <button type="button" onClick={onAdd} disabled={out || locked}
    aria-label={`Add ${product.title}, ${formatKes(toNumber(product.selling_price))}${out ? ', out of stock' : `, ${stock} in stock`}${quantity ? `, ${quantity} in this sale` : ''}`}
    className="group relative flex h-full min-h-[172px] w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white py-3.5 pl-4 pr-3 text-left shadow-[0_3px_12px_-7px_rgba(16,38,78,.18)] transition hover:-translate-y-0.5 hover:border-[#9e2b3a]/50 hover:shadow-[0_12px_25px_-12px_rgba(19,37,74,.25)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-100 active:scale-[.985] disabled:cursor-not-allowed disabled:bg-slate-50 disabled:shadow-none disabled:active:scale-100">
    <span className="absolute inset-y-0 left-0 w-1.5" style={{ background: spineColour(product.category_id), opacity: out ? 0.35 : 1 }} aria-hidden="true" />
    {quantity > 0 && <span className="absolute right-2 top-2 rounded-full bg-[#087df5] px-2 py-0.5 text-[11px] font-bold tabular-nums text-white">×{quantity}</span>}
    <span className="mb-2 flex size-9 items-center justify-center rounded-xl bg-[#f3f5fa] text-[#13254a] transition group-hover:bg-[#fbeef0] group-hover:text-[#9e2b3a]"><BookOpen size={18} aria-hidden="true" /></span>
    <span className={`block truncate pr-8 text-[11.5px] ${out ? 'text-slate-400' : 'text-slate-500'}`}>{product.subcategory || product.category || 'Product'}</span>
    <span className={`mt-0.5 line-clamp-2 text-[14px] font-semibold leading-snug ${out ? 'text-slate-400' : 'text-[#162c4c]'}`}>{product.title}</span>
    <span className="mt-1 block truncate text-[11.5px] tabular-nums text-slate-400">{code}</span>
    <span className="mt-auto flex flex-wrap items-end justify-between gap-x-2 gap-y-0.5 pt-2.5">
      <span className={`whitespace-nowrap text-[15px] font-bold tabular-nums ${out ? 'text-slate-400' : 'text-[#13254a]'}`}>{formatKes(toNumber(product.selling_price))}</span>
      {out ? <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11.5px] font-semibold text-rose-600"><PackageX size={13} aria-hidden="true" /> Sold out</span>
        : left <= 5 ? <span className="whitespace-nowrap text-[11.5px] font-semibold tabular-nums text-amber-700">{left <= 0 ? 'All in sale' : `Only ${left} left`}</span>
        : <span className="whitespace-nowrap text-[11.5px] tabular-nums text-slate-500">{stock} in stock</span>}
    </span>
  </button>
}
