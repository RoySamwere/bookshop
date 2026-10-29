import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, BookOpen, RefreshCw, UserRoundCheck } from 'lucide-react'
import { api } from '../lib/api'
import { hasPermission, type BookshopUser } from '../lib/auth'
import { BrandMark } from './brand-mark'

export type DashboardData = {
  branches: { id: number; name: string }[]; timezone: string
  summary: { revenue: number | string; transactions: number; items: number; average: number; payments: Record<string, number | string> } | null
  hourly: { hour: number; label: string; revenue: number }[]
  top_sellers: { book_id: number; title: string; units: number; revenue: number | string }[]
  recent_sales: { id: number; receipt_number: string; created_at: string; payment_method: string; total: number | string; cashier_name: string; units: number }[]
  stock: { low: number; out_of_stock: number; reorder: { id: number; title: string; branch_name: string; reorder_level: number; available: number }[] } | null
  staff_requests: number | null
}
const money = (value: number | string) => `KSh ${Number(value).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`
const methods = [{ key: 'mpesa', label: 'M-Pesa' }, { key: 'cash', label: 'Cash' }, { key: 'card', label: 'Card' }]
const saleDate = (value: string) => new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`)

export function OverviewDashboard({ currentUser, onNavigate }: { userName: string; currentUser: BookshopUser; onNavigate: (section: string) => void }) {
  const [branch, setBranch] = useState('')
  const [period, setPeriod] = useState<'today' | 'week'>('today')
  const { data, isPending, error, refetch, isFetching } = useQuery({
    queryKey: ['dashboard', currentUser.id, branch, period],
    queryFn: async () => (await api<{ data: DashboardData }>('/dashboard', { query: { branch_id: branch || undefined, period } })).data,
    refetchInterval: 60_000,
  })
  const summary = data?.summary
  const stock = data?.stock
  const label = data?.branches.find(item => String(item.id) === branch)?.name || (data?.branches.length === 1 ? data.branches[0].name : 'all branches')
  const hours = data?.hourly.filter(item => item.revenue > 0 || (item.hour >= 8 && item.hour <= 19)) || []
  const maxSeller = Math.max(1, ...(data?.top_sellers.map(item => Number(item.revenue)) || []))
  const value = (value: number | string | undefined | null) => isPending ? '…' : value == null ? '—' : Number(value).toLocaleString('en-KE')

  return <div className="shop-dashboard" aria-busy={isPending}>
    <div className="dashboard-filters"><label><span className="sr-only">Dashboard branch</span><select aria-label="Dashboard branch" value={branch} onChange={event => setBranch(event.target.value)}><option value="">All accessible branches</option>{data?.branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button onClick={() => void refetch()} disabled={isFetching} className="dashboard-link"><RefreshCw size={14} className={isFetching ? 'animate-spin' : ''} /> Refresh</button></div>
    {error && <div role="alert" className="dashboard-error">{error.message} <button onClick={() => void refetch()}>Try again</button></div>}
    <section className="dashboard-summary-grid" aria-label="Business summary">
      <article className="dashboard-hero"><div className="hero-watermark" aria-hidden="true"><BrandMark size={270} /></div><p>{period === 'today' ? 'Today' : 'This week'} at {label}</p><div className="hero-amount">{summary ? money(Math.trunc(Number(summary.revenue))) : isPending ? 'Loading…' : '—'}<span>{summary ? `.${Number(summary.revenue).toFixed(2).split('.')[1]}` : ''}</span></div><p className="hero-caption">{summary ? `${Number(summary.transactions).toLocaleString()} sales · average ${money(summary.average)}` : 'Sales from your shop records'}</p><div className="payment-split" aria-hidden="true">{methods.map(method => <span key={method.key} className={`payment-${method.key}`} style={{ flex: Number(summary?.payments[method.key] || 0) || 0.001 }} />)}</div><div className="payment-legend">{methods.map(method => <span key={method.key}><i className={`payment-${method.key}`} />{method.label} <strong>{summary ? money(summary.payments[method.key] || 0) : '—'}</strong></span>)}</div></article>
      <div className="dashboard-stat-stack">
        {hasPermission(currentUser, 'sales.view') && <article className="dashboard-stat"><span className="stat-symbol"><BookOpen size={22} /></span><div><p>Items sold</p><strong>{value(summary?.items)}</strong></div><small>across<br />{value(summary?.transactions)} sales</small></article>}
        {hasPermission(currentUser, 'inventory.view') && <article className="dashboard-stat"><span className="stat-symbol pink"><AlertTriangle size={22} /></span><div><p>Stock alerts</p><strong>{value(stock ? Number(stock.low) + Number(stock.out_of_stock) : null)}</strong></div><small>{value(stock?.low)} running low<br />{value(stock?.out_of_stock)} sold out</small></article>}
        {hasPermission(currentUser, 'users.view') && <article className="dashboard-stat"><span className="stat-symbol"><UserRoundCheck size={22} /></span><div><p>Staff requests</p><strong>{value(data?.staff_requests)}</strong></div><button className="dashboard-link" onClick={() => onNavigate('Users')}>Review</button></article>}
      </div>
    </section>
    <div className="dashboard-detail-grid">
      {hasPermission(currentUser, 'sales.view') && <>
        <section className="dashboard-card sales-chart-card"><div className="dashboard-card-heading"><div><h2>Sales by hour</h2><p>{period === 'today' ? 'Today’s sales' : 'Sales across the last 7 days'}, in {data?.timezone || 'your shop timezone'}.</p></div><div className="chart-period" role="group" aria-label="Sales chart period"><button aria-pressed={period === 'today'} onClick={() => setPeriod('today')}>Today</button><button aria-pressed={period === 'week'} onClick={() => setPeriod('week')}>This week</button></div></div>
          <div className="dashboard-chart" role="img" aria-label={`Hourly revenue chart. ${summary ? money(summary.revenue) : 'No data'} in the selected period.`}><ResponsiveContainer width="100%" height="100%"><BarChart data={hours} margin={{ top: 18, right: 0, left: -24, bottom: 0 }}><CartesianGrid vertical={false} stroke="#edf0f8" /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: '#8390ad', fontSize: 11 }} interval="preserveStartEnd" /><YAxis axisLine={false} tickLine={false} tick={{ fill: '#8390ad', fontSize: 11 }} tickFormatter={value => Number(value) >= 1000 ? `${Number(value) / 1000}k` : String(value)} /><Tooltip cursor={{ fill: '#eaf1ff' }} formatter={value => [money(Number(value)), 'Revenue']} contentStyle={{ borderRadius: 10, border: 'none', background: '#172440', color: '#fff' }} labelStyle={{ color: '#fff' }} itemStyle={{ color: '#fff' }} /><Bar dataKey="revenue" radius={[8, 8, 0, 0]} maxBarSize={40}>{hours.map(item => <Cell key={item.hour} fill={item.hour === Number(new Intl.DateTimeFormat('en-GB', { timeZone: data?.timezone || 'UTC', hour: '2-digit', hourCycle: 'h23' }).format(new Date())) ? '#f67fbb' : '#087df5'} />)}</Bar></BarChart></ResponsiveContainer></div>
          {!isPending && summary && Number(summary.transactions) === 0 && <p className="dashboard-empty">No sales recorded in this period yet.</p>}
        </section>
        <section className="dashboard-card"><div className="dashboard-card-heading"><h2>Top sellers {period === 'today' ? 'today' : 'this week'}</h2><button className="dashboard-link" onClick={() => onNavigate('Sales History')}>Sales history</button></div><ol className="top-sellers">{data?.top_sellers.map((item, index) => <li key={item.book_id}><span className="seller-rank">{index + 1}</span><div><div className="seller-title"><strong>{item.title}</strong><span>{money(item.revenue)}</span></div><div className="seller-progress"><span><i style={{ width: `${Number(item.revenue) / maxSeller * 100}%` }} /></span><small>{Number(item.units).toLocaleString()} sold</small></div></div></li>)}</ol>{!data?.top_sellers.length && <p className="dashboard-empty">{isPending ? 'Loading products…' : 'Top sellers appear after your first sale.'}</p>}</section>
        <section className="dashboard-card latest-sales"><div className="dashboard-card-heading"><h2>Latest sales</h2><button className="dashboard-link" onClick={() => onNavigate('Sales History')}>Sales history</button></div><div className="dashboard-table-scroll"><table><thead><tr><th>Receipt</th><th>Time</th><th>Items</th><th>Paid by</th><th>Served by</th><th>Total</th></tr></thead><tbody>{data?.recent_sales.map(sale => <tr key={sale.id}><td><button className="dashboard-link" onClick={() => onNavigate('Sales History')}>{sale.receipt_number}</button></td><td>{saleDate(sale.created_at).toLocaleTimeString('en-KE', { timeZone: data.timezone, hour: 'numeric', minute: '2-digit' })}</td><td>{sale.units}</td><td><span className={`method-badge ${sale.payment_method}`}>{methods.find(item => item.key === sale.payment_method)?.label || sale.payment_method}</span></td><td>{sale.cashier_name || '—'}</td><td>{money(sale.total)}</td></tr>)}</tbody></table></div>{!data?.recent_sales.length && <p className="dashboard-empty">{isPending ? 'Loading sales…' : 'No sales recorded in this period.'}</p>}</section>
      </>}
      {hasPermission(currentUser, 'inventory.view') && <section className="dashboard-card reorder-card"><div className="dashboard-card-heading"><h2>Reorder soon</h2><button className="dashboard-link" onClick={() => onNavigate('Inventory & Stock')}>Inventory</button></div><ul>{stock?.reorder.map((item, index) => <li key={`${item.id}-${index}`}><div><strong>{item.title}</strong><small>{item.available} left · reorder at {item.reorder_level}{data && data.branches.length > 1 && !branch ? ` · ${item.branch_name}` : ''}</small></div><span className={`stock-pill ${Number(item.available) <= 0 ? 'sold-out' : ''}`}>{Number(item.available) <= 0 ? 'Sold out' : 'Low'}</span><button onClick={() => onNavigate('Inventory & Stock')}>Review</button></li>)}</ul>{!stock?.reorder.length && <p className="dashboard-empty">{isPending ? 'Checking stock…' : 'Stock levels are looking good.'}</p>}</section>}
    </div>
  </div>
}
