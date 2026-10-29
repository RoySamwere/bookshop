'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowRight, ArrowUpRight, BookOpen, Boxes, CircleDollarSign, FileText, Package, RefreshCw, ShoppingCart, Truck } from 'lucide-react'
import { api } from '../lib/api'
import { hasPermission, type BookshopUser } from '../lib/auth'

type Sale = { id: number; receipt_number: string; total: string | number; payment_method: string; created_at: string; branch_name?: string | null }
type SalesResponse = { data: Sale[]; summary: { transactions: number | string; revenue: number | string } }
type InventoryResponse = { summary: { units: number | string; value: number | string; stock_lines: number | string; low: number | string; out_of_stock: number | string } }
type Book = { id: number; title: string; sku: string; selling_price: number | string; category_name?: string | null }
type BooksResponse = { data: Book[]; total: number }
type Period = 'today' | '7days' | '30days'
const money = (value: number) => `KSh ${value.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`
const number = (value: number | string | undefined) => Number(value || 0)
const localDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const dates = (period: Period) => {
  const now = new Date()
  const from = new Date(now)
  from.setDate(from.getDate() - (period === 'today' ? 0 : period === '7days' ? 6 : 29))
  return { from: localDate(from), to: localDate(now) }
}

export function OverviewDashboard({ userName, currentUser, onNavigate }: {
  userName: string; currentUser: BookshopUser; onNavigate: (section: string) => void
}) {
  const [period, setPeriod] = useState<Period>('7days')
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(true)
  const [sales, setSales] = useState<SalesResponse | null>(null)
  const [inventory, setInventory] = useState<InventoryResponse | null>(null)
  const [books, setBooks] = useState<BooksResponse | null>(null)
  const [errors, setErrors] = useState<string[]>([])
  const canSales = hasPermission(currentUser, 'sales.view')
  const canInventory = hasPermission(currentUser, 'inventory.view')
  const canCatalogue = hasPermission(currentUser, 'catalog.view')
  const canPos = hasPermission(currentUser, 'pos.access')
  const canSuppliers = hasPermission(currentUser, 'suppliers.view')

  const load = useCallback(async () => {
    setLoading(true)
    const requests: { key: string; run: Promise<unknown> }[] = []
    if (canSales) requests.push({ key: 'sales', run: api<SalesResponse>('/pos/sales', { query: { ...dates(period), page: 1 } }) })
    if (canInventory) requests.push({ key: 'inventory', run: api<InventoryResponse>('/inventory', { query: { per_page: 10 } }) })
    if (canCatalogue) requests.push({ key: 'books', run: api<BooksResponse>('/books', { query: { per_page: 10 } }) })
    const results = await Promise.allSettled(requests.map(request => request.run))
    const failures: string[] = []
    results.forEach((result, index) => {
      const key = requests[index].key
      if (result.status === 'rejected') {
        failures.push(`${key}: ${result.reason instanceof Error ? result.reason.message : 'Unable to load'}`)
        if (key === 'sales') setSales(null)
        if (key === 'inventory') setInventory(null)
        if (key === 'books') setBooks(null)
      } else {
        if (key === 'sales') setSales(result.value as SalesResponse)
        if (key === 'inventory') setInventory(result.value as InventoryResponse)
        if (key === 'books') setBooks(result.value as BooksResponse)
      }
    })
    setErrors(failures)
    setLoading(false)
  }, [canSales, canInventory, canCatalogue, period])

  useEffect(() => { void load() }, [load, revision])

  const totals = inventory?.summary
  const stockLines = number(totals?.stock_lines)
  const low = number(totals?.low)
  const out = number(totals?.out_of_stock)
  const healthy = Math.max(0, stockLines - low - out)
  const healthyPercent = stockLines ? Math.round(healthy / stockLines * 100) : 0
  const metrics = useMemo(() => [
    ...(canSales ? [
      { label: 'Revenue', value: sales ? money(number(sales.summary.revenue)) : '—', caption: period === 'today' ? 'Today' : period === '7days' ? 'Last 7 days' : 'Last 30 days', icon: CircleDollarSign, tone: 'blue' },
      { label: 'Transactions', value: sales ? number(sales.summary.transactions).toLocaleString('en-KE') : '—', caption: 'Recorded POS sales', icon: FileText, tone: 'green' },
    ] : []),
    ...(canInventory ? [
      { label: 'Units in stock', value: totals ? number(totals.units).toLocaleString('en-KE') : '—', caption: `${low + out} stock lines need attention`, icon: Boxes, tone: 'orange' },
      { label: 'Inventory value', value: totals ? money(number(totals.value)) : '—', caption: 'At selling price · all accessible branches', icon: Package, tone: 'purple' },
    ] : []),
  ], [canSales, canInventory, sales, totals, period, low, out])

  return <div className="overview-page">
    <div className="overview-heading">
      <div><div className="overview-eyebrow"><span /> LIVE SHOP OVERVIEW</div><h1 tabIndex={-1}>Welcome back, {userName.split(' ')[0]}<span className="greeting-dot">.</span></h1><p>Sales, stock and daily operations from your shop records.</p></div>
      <div className="overview-heading-actions">
        <select aria-label="Sales period" value={period} onChange={event => setPeriod(event.target.value as Period)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          <option value="today">Today</option><option value="7days">Last 7 days</option><option value="30days">Last 30 days</option>
        </select>
        <button className="overview-text-link" onClick={() => setRevision(value => value + 1)} disabled={loading}><RefreshCw size={16} /> {loading ? 'Loading…' : 'Refresh'}</button>
        {canPos && <button className="primary-button" onClick={() => onNavigate('Point of Sale')}><ShoppingCart size={17} /> New sale</button>}
      </div>
    </div>
    {errors.length > 0 && <div role="alert" className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Some live data could not be loaded: {errors.join('; ')}. <button className="font-semibold underline" onClick={() => setRevision(value => value + 1)}>Retry</button></div>}
    {metrics.length > 0 && <section className="overview-metrics" aria-label="Live shop summary">{metrics.map(({ label, value, caption, icon: Icon, tone }) => <article className="overview-metric" key={label}><div className="overview-metric-top"><span>{label}</span><span className={`overview-metric-icon ${tone}`}><Icon size={19} /></span></div><strong>{loading && !sales && !inventory ? 'Loading…' : value}</strong><p>{caption}</p></article>)}</section>}
    <section className="overview-quick-actions" aria-label="Quick actions"><span>Quick actions</span>
      {[
        { label: 'Open register', section: 'Point of Sale', icon: ShoppingCart, allowed: canPos },
        { label: 'Manage catalogue', section: 'Products & Books', icon: BookOpen, allowed: canCatalogue },
        { label: 'Review stock', section: 'Inventory & Stock', icon: Boxes, allowed: canInventory },
        { label: 'Suppliers', section: 'Suppliers', icon: Truck, allowed: canSuppliers },
      ].filter(item => item.allowed).map(({ label, section, icon: Icon }) => <button key={section} onClick={() => onNavigate(section)}><Icon size={16} />{label}<ArrowUpRight size={14} /></button>)}
    </section>
    <div className="overview-primary-grid">
      {canSales && <section className="overview-card revenue-card" aria-labelledby="revenue-title">
        <div className="overview-card-heading"><div><h2 id="revenue-title">Sales performance</h2><p>Recorded transactions for the selected period</p></div><span className="period-label">{period === 'today' ? 'Today' : period === '7days' ? '7 days' : '30 days'}</span></div>
        <div className="revenue-summary"><strong>{sales ? money(number(sales.summary.revenue)) : '—'}</strong><span><i /> Revenue</span></div>
        <div className="px-5 pb-5 text-sm text-slate-500">{sales ? `${number(sales.summary.transactions).toLocaleString('en-KE')} transactions recorded` : loading ? 'Loading sales…' : 'Sales data unavailable'}</div>
        <div className="overview-card-footer"><span>Live POS records</span><button onClick={() => onNavigate('Sales History')}>Sales history <ArrowRight size={15} /></button></div>
      </section>}
      {canInventory && <section className="overview-card health-card" aria-labelledby="health-title">
        <div className="overview-card-heading"><div><h2 id="health-title">Inventory health</h2><p>Stock across accessible branches</p></div><button className="overview-icon-link" aria-label="View inventory" onClick={() => onNavigate('Inventory & Stock')}><ArrowUpRight size={19} /></button></div>
        <div className="overview-stock-summary"><div className="health-ring" style={{ background: `conic-gradient(#24a995 0 ${healthyPercent}%, #e9b35a ${healthyPercent}% ${stockLines ? (healthy + low) / stockLines * 100 : 0}%, #df827e 0)` }} role="img" aria-label={`${healthyPercent}% of stock lines have healthy stock`}><div><strong>{totals ? `${healthyPercent}%` : '—'}</strong><span>healthy stock</span></div></div>
          <div className="health-legend"><div><i className="healthy" /><span>Healthy</span><strong>{healthy}</strong></div><div><i className="low" /><span>Low stock</span><strong>{low}</strong></div><div><i className="out" /><span>Out of stock</span><strong>{out}</strong></div></div></div>
        <div className="overview-stock-alert"><span className="stock-alert-symbol"><Boxes size={19} /></span><div><strong>{low + out} stock lines need attention</strong><p>Based on product reorder levels and available stock.</p></div></div>
        <button className="overview-stock-button" onClick={() => onNavigate('Inventory & Stock')}>Review inventory <ArrowRight size={16} /></button>
      </section>}
    </div>
    <div className="overview-secondary-grid">
      {canSales && <section className="overview-card overview-sales" aria-labelledby="recent-sales-title">
        <div className="overview-card-heading"><div><h2 id="recent-sales-title">Recent sales</h2><p>Latest transactions in the selected period</p></div><button className="overview-text-link" onClick={() => onNavigate('Sales History')}>View all <ArrowUpRight size={15} /></button></div>
        <div className="table-scroll" role="region" aria-label="Recent sales" tabIndex={0}><table className="overview-sales-table"><thead><tr><th>Receipt</th><th>Branch</th><th>Amount</th><th>Payment</th><th>Date</th></tr></thead><tbody>
          {(sales?.data || []).slice(0, 6).map(sale => <tr key={sale.id}><td><strong>{sale.receipt_number}</strong></td><td>{sale.branch_name || '—'}</td><td className="sale-amount">{money(number(sale.total))}</td><td>{sale.payment_method?.toUpperCase()}</td><td>{new Date(sale.created_at).toLocaleDateString('en-KE')}</td></tr>)}
          {!sales?.data?.length && <tr><td colSpan={5}>{loading ? 'Loading sales…' : 'No sales recorded for this period.'}</td></tr>}
        </tbody></table></div>
      </section>}
      {canCatalogue && <section className="overview-card overview-catalogue" aria-labelledby="catalogue-title">
        <div className="overview-card-heading"><div><h2 id="catalogue-title">Product catalogue</h2><p>{books ? `${books.total} registered products` : 'Live catalogue records'}</p></div><button className="overview-icon-link" aria-label="View catalogue" onClick={() => onNavigate('Products & Books')}><ArrowUpRight size={19} /></button></div>
        <div className="overview-product-list">{(books?.data || []).slice(0, 4).map(book => <div className="overview-product" key={book.id}><span className="overview-book teal"><BookOpen size={20} /></span><div><strong>{book.title}</strong><span>{book.sku}</span></div><span className="text-sm font-semibold">{money(number(book.selling_price))}</span></div>)}
          {!books?.data?.length && <p className="p-4 text-sm text-slate-500">{loading ? 'Loading products…' : 'No products available.'}</p>}
        </div><button className="overview-catalogue-link" onClick={() => onNavigate('Products & Books')}>Explore catalogue <ArrowRight size={16} /></button>
      </section>}
    </div>
    <p className="overview-demo-note">Live data · Figures reflect recorded transactions and accessible inventory. Inventory value is calculated at selling price.</p>
  </div>
}
