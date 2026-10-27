'use client'

import { ArrowRight, ArrowUpRight, BarChart3, BookOpen, Boxes, CircleDollarSign, FileText, Package, Plus, ShoppingCart, Truck } from 'lucide-react'

type Product = { id: number; name: string; category: string; sku: string; price: number; cost: number; stock: number; tone: string }
type Sale = { receipt: string; customer: string; items: number; total: number; method: string; time: string; status: string }
const money = (value: number) => `KSh ${value.toLocaleString('en-KE', { maximumFractionDigits: 0 })}`
const weeklyRevenue = [22400, 30100, 26700, 38900, 33800, 44200, 48320]
const chartPoints = weeklyRevenue.map((value, index) => `${index * 100},${180 - value / 60000 * 180}`).join(' ')

export function OverviewDashboard({ userName, products, sales, onNavigate }: {
  userName: string; products: Product[]; sales: Sale[]; onNavigate: (section: string) => void
}) {
  const healthy = products.filter(product => product.stock > 8).length
  const low = products.filter(product => product.stock > 0 && product.stock <= 8).length
  const out = products.filter(product => product.stock === 0).length
  const healthyPercent = Math.round(healthy / products.length * 100)
  const stockValue = products.reduce((sum, product) => sum + product.cost * product.stock, 0)
  const units = products.reduce((sum, product) => sum + product.stock, 0)
  const metrics = [
    { label: 'Sales total', value: money(sales.reduce((sum, sale) => sum + sale.total, 0)), caption: 'Across the sample transactions', icon: CircleDollarSign, tone: 'blue' },
    { label: 'Transactions', value: String(sales.length).padStart(2, '0'), caption: 'Completed sample receipts', icon: FileText, tone: 'green' },
    { label: 'Units in stock', value: units.toLocaleString(), caption: `${low + out} products need attention`, icon: Boxes, tone: 'orange' },
    { label: 'Inventory value', value: money(stockValue), caption: `${products.length} products · at cost price`, icon: Package, tone: 'purple' },
  ]

  return <div className="overview-page">
    <div className="overview-heading">
      <div><div className="overview-eyebrow"><span /> YOUR SHOP AT A GLANCE</div><h1 tabIndex={-1}>Welcome back, {userName.split(' ')[0]}<span className="greeting-dot">.</span></h1><p>A clear view of your sales, shelves, and next steps.</p></div>
      <div className="overview-heading-actions"><span className="demo-badge">Demo overview</span><button className="primary-button" onClick={() => onNavigate('Point of Sale')}><Plus size={17} /> New sale</button></div>
    </div>

    <section className="overview-metrics" aria-label="Shop summary">
      {metrics.map(({ label, value, caption, icon: Icon, tone }) => <article className="overview-metric" key={label}><div className="overview-metric-top"><span>{label}</span><span className={`overview-metric-icon ${tone}`}><Icon size={19} /></span></div><strong>{value}</strong><p>{caption}</p></article>)}
    </section>

    <section className="overview-quick-actions" aria-label="Quick actions">
      <span>Quick actions</span>
      {[{ label: 'Open register', section: 'Point of Sale', icon: ShoppingCart }, { label: 'Manage catalogue', section: 'Products & Books', icon: BookOpen }, { label: 'Review stock', section: 'Inventory & Stock', icon: Boxes }, { label: 'Suppliers', section: 'Suppliers', icon: Truck }].map(({ label, section, icon: Icon }) => <button key={section} onClick={() => onNavigate(section)}><Icon size={16} />{label}<ArrowUpRight size={14} /></button>)}
    </section>

    <div className="overview-primary-grid">
      <section className="overview-card revenue-card" aria-labelledby="revenue-title">
        <div className="overview-card-heading"><div><h2 id="revenue-title">Sales performance</h2><p>Sample revenue across the week</p></div><span className="period-label">Last 7 days</span></div>
        <div className="revenue-summary"><strong>{money(weeklyRevenue.reduce((sum, value) => sum + value, 0))}</strong><span><i /> Revenue</span></div>
        <div className="revenue-chart"><div className="revenue-axis"><span>60k</span><span>40k</span><span>20k</span><span>0</span></div><div className="revenue-plot">
          <div className="revenue-grid-lines"><i /><i /><i /><i /></div>
          <svg viewBox="0 0 600 180" preserveAspectRatio="none" role="img" aria-label="Sample weekly revenue rises from KSh 22,400 on Tuesday to KSh 48,320 on Monday.">
            <defs><linearGradient id="revenue-shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#5974c4" stopOpacity=".2" /><stop offset="100%" stopColor="#5974c4" stopOpacity="0" /></linearGradient></defs>
            <polygon points={`0,180 ${chartPoints} 600,180`} fill="url(#revenue-shade)" />
            <polyline points={chartPoints} fill="none" stroke="#506cb7" strokeWidth="3" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
        </div></div>
        <div className="revenue-days">{['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon'].map(day => <span key={day}>{day}</span>)}</div>
        <div className="overview-card-footer"><span><BarChart3 size={15} /> Illustrative weekly data</span><button onClick={() => onNavigate('Reports & Analytics')}>Reports <ArrowRight size={15} /></button></div>
      </section>

      <section className="overview-card health-card" aria-labelledby="health-title">
        <div className="overview-card-heading"><div><h2 id="health-title">Inventory health</h2><p>Keep your best sellers on the shelf</p></div><button className="overview-icon-link" aria-label="View inventory" onClick={() => onNavigate('Inventory & Stock')}><ArrowUpRight size={19} /></button></div>
        <div className="overview-stock-summary"><div className="health-ring" style={{ background: `conic-gradient(#24a995 0 ${healthyPercent}%, #e9b35a ${healthyPercent}% ${(healthy + low) / products.length * 100}%, #df827e 0)` }} role="img" aria-label={`${healthyPercent}% of products have healthy stock`}><div><strong>{healthyPercent}%</strong><span>healthy stock</span></div></div>
          <div className="health-legend"><div><i className="healthy" /><span>Healthy</span><strong>{healthy}</strong></div><div><i className="low" /><span>Low stock</span><strong>{low}</strong></div><div><i className="out" /><span>Out of stock</span><strong>{out}</strong></div></div>
        </div>
        <div className="overview-stock-alert"><span className="stock-alert-symbol"><Boxes size={19} /></span><div><strong>{low + out} products need attention</strong><p>Review low and unavailable stock.</p></div></div>
        <button className="overview-stock-button" onClick={() => onNavigate('Inventory & Stock')}>Review inventory <ArrowRight size={16} /></button>
      </section>
    </div>

    <div className="overview-secondary-grid">
      <section className="overview-card overview-sales" aria-labelledby="recent-sales-title">
        <div className="overview-card-heading"><div><h2 id="recent-sales-title">Recent sales</h2><p>Sample receipts from your register</p></div><button className="overview-text-link" onClick={() => onNavigate('Sales History')}>View all <ArrowUpRight size={15} /></button></div>
        <div className="table-scroll" role="region" aria-label="Recent sales table, scroll horizontally for more columns" tabIndex={0}>
          <table className="overview-sales-table"><thead><tr><th scope="col">Receipt</th><th scope="col">Customer</th><th scope="col">Amount</th><th scope="col">Payment</th><th scope="col">Status</th></tr></thead><tbody>{sales.map(sale => <tr key={sale.receipt}><td><strong>{sale.receipt}</strong><small>{sale.time}</small></td><td>{sale.customer}</td><td className="sale-amount">{money(sale.total)}</td><td><span className={`payment-label ${sale.method === 'M-Pesa' ? 'is-mpesa' : ''}`}>{sale.method}</span></td><td><span className="paid-label"><i />{sale.status}</span></td></tr>)}</tbody></table>
        </div>
      </section>

      <section className="overview-card overview-catalogue" aria-labelledby="catalogue-title">
        <div className="overview-card-heading"><div><h2 id="catalogue-title">On your shelves</h2><p>A look at your product catalogue</p></div><button className="overview-icon-link" aria-label="View catalogue" onClick={() => onNavigate('Products & Books')}><ArrowUpRight size={19} /></button></div>
        <div className="overview-product-list">{products.slice(0, 4).map(product => <div className="overview-product" key={product.id}><span className={`overview-book ${product.tone}`}><BookOpen size={20} /></span><div><strong>{product.name}</strong><span>{product.category}</span></div><span className={`overview-product-stock ${product.stock <= 8 ? 'needs-stock' : ''}`}>{product.stock}<small>in stock</small></span></div>)}</div>
        <button className="overview-catalogue-link" onClick={() => onNavigate('Products & Books')}>Explore catalogue <ArrowRight size={16} /></button>
      </section>
    </div>
    <p className="overview-demo-note">Demo workspace · Figures are sample data, not live trading totals.</p>
  </div>
}
