'use client'

import { useEffect, useMemo, useState } from 'react'
import { login, logout, getCurrentUser, type BookshopUser } from '../lib/auth'
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  ChevronDown,
  CircleDollarSign,
  CreditCard,
  FileText,
  FileSpreadsheet,
  Download,
  Upload,
  LayoutDashboard,
  LogOut,
  Menu,
  MoreHorizontal,
  Package,
  Plus,
  Search,
  Settings,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Tags,
  Truck,
  Users,
  WalletCards,
  X,
} from 'lucide-react'

const navItems = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Point of Sale', icon: ShoppingCart },
  { label: 'Sales History', icon: FileText },
  { label: 'Products & Books', icon: BookOpen },
  { label: 'Inventory & Stock', icon: Boxes },
  { label: 'Suppliers', icon: Truck },
  { label: 'Customers', icon: Users },
  { label: 'Reports & Analytics', icon: BarChart3 },
]

const products = [
  { id: 1, name: 'Grade 7 Integrated Science', category: 'Textbooks', sku: 'TB-G7-ISC', price: 890, cost: 620, stock: 24, tone: 'teal' },
  { id: 2, name: 'KCSE Mathematics Revision', category: 'Revision Books', sku: 'RB-KCSE-MAT', price: 650, cost: 430, stock: 8, tone: 'indigo' },
  { id: 3, name: 'Primary Exercise Book · 200p', category: 'Exercise Books', sku: 'EX-200P', price: 95, cost: 58, stock: 86, tone: 'amber' },
  { id: 4, name: 'Ballpoint Pen · Blue', category: 'Stationery', sku: 'ST-PEN-BLU', price: 30, cost: 12, stock: 142, tone: 'violet' },
  { id: 5, name: 'Grade 4 English Learner’s Book', category: 'Textbooks', sku: 'TB-G4-ENG', price: 740, cost: 510, stock: 4, tone: 'rose' },
  { id: 6, name: 'Geometry Set · Maped', category: 'Stationery', sku: 'ST-GEO-001', price: 180, cost: 105, stock: 32, tone: 'sky' },
  { id: 7, name: 'A4 Photocopy Paper · 500 Sheets', category: 'Office Supplies', sku: 'OF-A4-500', price: 720, cost: 585, stock: 0, tone: 'slate' },
  { id: 8, name: 'The River Between', category: 'Novels & Literature', sku: 'NV-RIV-001', price: 420, cost: 270, stock: 15, tone: 'emerald' },
]

const sales = [
  { receipt: '#NS-10482', customer: 'Walk-in customer', items: 4, total: 1650, method: 'M-Pesa', time: '10:42 AM', status: 'Paid' },
  { receipt: '#NS-10481', customer: 'Greenfield Academy', items: 18, total: 12840, method: 'Bank transfer', time: '10:18 AM', status: 'Paid' },
  { receipt: '#NS-10480', customer: 'Mary Wanjiku', items: 2, total: 890, method: 'Cash', time: '9:56 AM', status: 'Paid' },
  { receipt: '#NS-10479', customer: 'Walk-in customer', items: 7, total: 2340, method: 'Card', time: '9:31 AM', status: 'Paid' },
]

const money = (value: number) => `KSh ${value.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function Page() {
  const [active, setActive] = useState('Dashboard')
  const [collapsed, setCollapsed] = useState(false)
  const [query, setQuery] = useState('')
  const [cart, setCart] = useState<{ product: typeof products[number]; quantity: number }[]>([])
  const [showCheckout, setShowCheckout] = useState(false)
  const [payment, setPayment] = useState('M-Pesa')
  const [toast, setToast] = useState('')
  const [currentUser, setCurrentUser] = useState<BookshopUser | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  useEffect(() => {
    const token = sessionStorage.getItem('bookshop_token')
    if (!token) { setAuthLoading(false); return }
    getCurrentUser(token).then(user => { if (user.role === 'system_owner') setCurrentUser(user); else sessionStorage.removeItem('bookshop_token') }).catch(() => sessionStorage.removeItem('bookshop_token')).finally(() => setAuthLoading(false))
  }, [])
  async function signOut() {
    const token = sessionStorage.getItem('bookshop_token')
    sessionStorage.removeItem('bookshop_token')
    setCurrentUser(null)
    setShowQuickSettings(false)
    if (token) await logout(token).catch(() => undefined)
  }
  const [showQuickSettings, setShowQuickSettings] = useState(false)
  const [compactMode, setCompactMode] = useState(false)
  const isPosMode = active === 'Point of Sale'

  function navigateTo(section: string) {
    setActive(section)
    setCollapsed(section === 'Point of Sale')
  }

  const filteredProducts = useMemo(() => products.filter((p) => `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(query.toLowerCase())), [query])
  const subtotal = cart.reduce((sum, item) => sum + item.product.price * item.quantity, 0)
  const tax = subtotal * 0.16
  const total = subtotal + tax

  function addToCart(product: typeof products[number]) {
    if (product.stock === 0) return
    setCart((current) => {
      const found = current.find((item) => item.product.id === product.id)
      if (found) return current.map((item) => item.product.id === product.id ? { ...item, quantity: Math.min(item.quantity + 1, product.stock) } : item)
      return [...current, { product, quantity: 1 }]
    })
    setToast(`${product.name} added to cart`)
    setTimeout(() => setToast(''), 2200)
  }

  function updateQuantity(id: number, delta: number) {
    setCart((current) => current.flatMap((item) => {
      if (item.product.id !== id) return [item]
      const quantity = Math.min(item.product.stock, item.quantity + delta)
      return quantity > 0 ? [{ ...item, quantity }] : []
    }))
  }

  if (authLoading) return <main className="login-screen" style={{alignItems:'center',justifyContent:'center'}}>Checking your session...</main>
  if (!currentUser) return <LoginPage onLogin={(user) => setCurrentUser(user)} />

  return (
    <div className={`app-shell ${compactMode ? 'compact-mode' : ''} ${isPosMode ? 'pos-mode' : ''}`}>
      <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <div className="brand-row">
          <div className="brand-mark"><BookOpen size={19} /></div>
          {!collapsed && <div><div className="brand-name">Nifunze</div><div className="brand-sub">BOOKSHOP OS</div></div>}
          <button className="icon-button sidebar-toggle" onClick={() => setCollapsed(!collapsed)} aria-label="Toggle sidebar"><Menu size={18} /></button>
        </div>
        {!collapsed && <div className="workspace-pill"><span className="status-dot" /> Main shop <ChevronDown size={14} /></div>}
        <nav className="nav-list">
          {navItems.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${active === label ? 'active' : ''}`} onClick={() => navigateTo(label)} title={collapsed ? label : undefined}><Icon size={18} /> {!collapsed && <span>{label}</span>}{label === 'Point of Sale' && !collapsed && <span className="nav-badge">⌘P</span>}</button>)}
        </nav>
        {!collapsed && <div className="sidebar-section-label">WORKSPACE</div>}
        <nav className="nav-list">
          {[['Expenses', WalletCards], ['Staff & Users', Users], ['Settings', Settings]].map(([label, Icon]) => <button key={label as string} className={`nav-item ${active === label ? 'active' : ''}`} onClick={() => navigateTo(label as string)}><Icon size={18} /> {!collapsed && <span>{label as string}</span>}</button>)}
        </nav>
        <div className="sidebar-bottom">{!collapsed && <div className="help-card"><Sparkles size={16} /><div><strong>Need a hand?</strong><span>View the quick guide</span></div><ChevronDown size={14} /></div>}<div className="user-row"><div className="avatar">{currentUser.name.split(' ').map(n => n[0]).slice(0,2).join('').toUpperCase()}</div>{!collapsed && <div className="user-copy"><strong>{currentUser.name}</strong><span>Administrator</span></div>} {!collapsed && <MoreHorizontal size={17} />}</div></div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div className="crumb"><span className="crumb-muted">Nifunze Bookshop</span><span>/</span><strong>{active}</strong></div><div className="top-actions"><div className="global-search"><Search size={17} /><input placeholder="Search anything..." /><kbd>⌘ K</kbd></div><button className="icon-button notification"><Bell size={18} /><i /></button><div className="date-label">Mon, 14 Oct 2024 <span>•</span> 11:04 AM</div><button className="quick-pos" onClick={() => navigateTo('Point of Sale')}><ShoppingCart size={16} /> Open POS</button><div className="account-menu-wrap"><button className="account-trigger" onClick={() => setShowQuickSettings(!showQuickSettings)} aria-expanded={showQuickSettings}><span className="avatar top-avatar">{currentUser.name.split(' ').map(n => n[0]).slice(0,2).join('').toUpperCase()}</span><span className="account-trigger-copy"><strong>{currentUser.name}</strong><small>Admin</small></span><ChevronDown size={15} /></button>{showQuickSettings && <div className="account-menu"><div className="account-menu-heading"><span className="avatar">{currentUser.name.split(' ').map(n => n[0]).slice(0,2).join('').toUpperCase()}</span><div><strong>{currentUser.name}</strong><small>Administrator · Main shop</small></div></div><div className="menu-divider" /><button className="menu-action" onClick={() => { setActive('Settings'); setShowQuickSettings(false) }}><Settings size={16} /> Quick settings</button><label className="menu-toggle"><span>Compact mode</span><input type="checkbox" checked={compactMode} onChange={(event) => setCompactMode(event.target.checked)} /></label><div className="menu-divider" /><button className="menu-action danger" onClick={() => { void signOut() }}><LogOut size={16} /> Log out</button></div>}</div></div></header>

        {active === 'Point of Sale' ? <POSView filteredProducts={filteredProducts} query={query} setQuery={setQuery} cart={cart} addToCart={addToCart} updateQuantity={updateQuantity} subtotal={subtotal} tax={tax} total={total} setCart={setCart} setShowCheckout={setShowCheckout} /> : active === 'Products & Books' ? <ProductsBooksView setToast={setToast} /> : active === 'Inventory & Stock' ? <InventoryView setToast={setToast} /> : active === 'Customers' ? <CustomersView setToast={setToast} /> : active === 'Suppliers' ? <SuppliersView setToast={setToast} /> : <Dashboard active={active} setActive={setActive} />}
      </main>

      {showCheckout && <div className="modal-backdrop"><div className="checkout-modal"><div className="modal-header"><div><div className="eyebrow">CHECKOUT</div><h2>Complete sale</h2></div><button className="icon-button" onClick={() => setShowCheckout(false)}><X size={18} /></button></div><div className="checkout-total"><span>Total due</span><strong>{money(total)}</strong></div><div className="payment-tabs">{['Cash', 'M-Pesa', 'Card', 'Bank transfer'].map((method) => <button key={method} className={payment === method ? 'selected' : ''} onClick={() => setPayment(method)}>{method}</button>)}</div><label className="field-label">{payment === 'M-Pesa' ? 'M-Pesa transaction code' : 'Payment reference'}<input className="text-input" placeholder={payment === 'M-Pesa' ? 'e.g. QKL7H2M1' : 'Optional reference'} /></label><label className="field-label">Amount received<input className="text-input" defaultValue={total.toFixed(2)} /></label><div className="change-row"><span>Change due</span><strong>{money(0)}</strong></div><button className="primary-button full" onClick={() => { setShowCheckout(false); setCart([]); setToast('Sale completed · Receipt #NS-10483') }}>Confirm payment <ArrowUpRight size={16} /></button><p className="secure-note">Demo payment · No external gateway connected</p></div></div>}
      {toast && <div className="toast"><span className="toast-check">✓</span>{toast}</div>}
    </div>
  )
}

function LoginPage({ onLogin }: { onLogin: (user: BookshopUser) => void }) {
  const [showPassword, setShowPassword] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError('')
    try {
      const result = await login(email, password)
      if (result.user.role !== 'system_owner') throw new Error('System Owner access required.')
      sessionStorage.setItem('bookshop_token', result.token)
      onLogin(result.user)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to sign in.')
    } finally {
      setPending(false)
    }
  }
  return <main className="login-screen">
    <section className="login-brand-panel">
      <div className="login-brand"><div className="brand-mark"><BookOpen size={22} /></div><div><strong>Nifunze</strong><span>BOOKSHOP OS</span></div></div>
      <div className="login-story"><div className="eyebrow">MADE FOR KENYAN BOOKSELLERS</div><h1>Keep every shelf, sale, and school order moving.</h1><p>One calm workspace for M-Pesa sales, curriculum stock, suppliers, and your regular readers.</p><div className="login-points"><span><i /> KSh-ready checkout with M-Pesa</span><span><i /> KCSE and CBC catalogue tracking</span><span><i /> School account management</span></div></div>
      <small className="login-footer">Nifunze Bookshop · Kenya</small>
    </section>
    <section className="login-form-panel"><div className="login-form-wrap">
      <div className="mobile-login-logo"><div className="brand-mark"><BookOpen size={20} /></div><strong>Nifunze</strong></div>
      <div className="eyebrow">WELCOME BACK</div><h2>Sign in to your shop</h2>
      <p className="login-muted">Sign in using your System Owner account.</p>
      <form onSubmit={submit}>
        <label className="field-label">Work email<input className="text-input" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label className="field-label">Password<div className="password-field"><input className="text-input" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /><button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}</button></div></label>
        {error && <p role="alert" style={{color:'#b91c1c',marginBottom:12}}>{error}</p>}
        <button className="primary-button full" type="submit" disabled={pending}>{pending ? 'Signing in...' : 'Sign in to Nifunze'} <ArrowUpRight size={16} /></button>
      </form>
    </div></section>
  </main>
}

function Dashboard({ active, setActive }: { active: string; setActive: (value: string) => void }) {
  if (active !== 'Dashboard') return <section className="page-placeholder"><div className="empty-icon"><Tags size={24} /></div><h1>{active}</h1><p>This workspace is ready for your daily operations. Use the dashboard or point of sale to get started.</p><button className="primary-button" onClick={() => setActive('Point of Sale')}>Open Point of Sale <ArrowUpRight size={16} /></button></section>
  return <div className="dashboard-page"><div className="page-heading"><div><div className="eyebrow">MONDAY, 14 OCTOBER 2024</div><h1>Welcome back, {currentUser.name.split(' ')[0]} <span className="wave">✦</span></h1><p>Here’s what’s happening at your bookshop today.</p></div><div className="heading-actions"><button className="secondary-button"><SlidersHorizontal size={16} /> Last 7 days <ChevronDown size={15} /></button><button className="primary-button" onClick={() => setActive('Point of Sale')}><Plus size={17} /> New sale</button></div></div><div className="metric-grid"><Metric label="Today’s sales" value="KSh 48,320" change="18.4%" up icon={CircleDollarSign} /><Metric label="Transactions" value="126" change="12.8%" up icon={FileText} /><Metric label="Gross profit" value="KSh 16,875" change="8.2%" up icon={BarChart3} /><Metric label="Inventory value" value="KSh 2.84M" change="3.1%" icon={Package} /></div><div className="dashboard-grid"><section className="card chart-card"><div className="card-heading"><div><h2>Sales overview</h2><p>Revenue performance across the week</p></div><div className="legend"><span><i className="legend-dot sales" /> Sales</span><span><i className="legend-dot profit" /> Gross profit</span></div></div><div className="chart"><div className="y-labels"><span>60k</span><span>40k</span><span>20k</span><span>0</span></div><div className="chart-area"><div className="grid-line l1" /><div className="grid-line l2" /><div className="grid-line l3" /><svg viewBox="0 0 600 190" preserveAspectRatio="none" aria-label="Sales chart"><path className="chart-fill" d="M0,148 C45,132 63,125 102,136 S155,92 198,104 S245,67 290,92 S340,50 382,72 S430,84 466,50 S530,65 600,25 L600,190 L0,190Z" /><path className="chart-line" d="M0,148 C45,132 63,125 102,136 S155,92 198,104 S245,67 290,92 S340,50 382,72 S430,84 466,50 S530,65 600,25" /><path className="profit-line" d="M0,164 C45,151 68,143 102,150 S155,123 198,130 S245,99 290,117 S340,91 382,106 S430,117 466,95 S530,99 600,71" /></svg><div className="x-labels"><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span><span>Mon</span></div></div></div></section><section className="card stock-card"><div className="card-heading"><div><h2>Inventory health</h2><p>Attention needed</p></div><button className="more-button">View all <ArrowUpRight size={14} /></button></div><div className="stock-donut"><div className="donut"><div><strong>84%</strong><span>healthy</span></div></div><div className="stock-legend"><div><i className="dot healthy" /><span>Healthy stock</span><strong>324</strong></div><div><i className="dot low" /><span>Low stock</span><strong>28</strong></div><div><i className="dot out" /><span>Out of stock</span><strong>12</strong></div></div></div><div className="alert-row"><div className="alert-icon"><ArrowDownRight size={15} /></div><div><strong>12 products</strong><span>are currently out of stock</span></div><button onClick={() => setActive('Inventory & Stock')}>Review</button></div></section></div><div className="bottom-grid"><section className="card recent-card"><div className="card-heading"><div><h2>Recent sales</h2><p>Your latest transactions</p></div><button className="more-button" onClick={() => setActive('Sales History')}>View all <ArrowUpRight size={14} /></button></div><div className="sales-table"><div className="table-head"><span>Receipt</span><span>Customer</span><span>Items</span><span>Amount</span><span>Method</span><span /></div>{sales.map((sale) => <div className="table-row" key={sale.receipt}><span className="receipt">{sale.receipt}<small>{sale.time}</small></span><span>{sale.customer}</span><span>{sale.items}</span><strong>{money(sale.total)}</strong><span><span className={`method ${sale.method === 'M-Pesa' ? 'mpesa' : ''}`}>{sale.method}</span></span><button className="more-button"><MoreHorizontal size={16} /></button></div>)}</div></section><section className="card best-card"><div className="card-heading"><div><h2>Best sellers</h2><p>This month</p></div><button className="more-button">•••</button></div>{products.slice(0, 4).map((product, index) => <div className="best-row" key={product.id}><div className={`book-thumb ${product.tone}`}>{index === 0 ? 'SCIENCE' : index === 1 ? 'KCSE' : index === 2 ? '200' : 'PEN'}</div><div><strong>{product.name}</strong><span>{product.category}</span></div><b>{[184, 142, 98, 86][index]} sold</b></div>)}</section></div></div>
}

function Metric({ label, value, change, up, icon: Icon }: { label: string; value: string; change: string; up?: boolean; icon: typeof CircleDollarSign }) { return <div className="metric card"><div className="metric-top"><span>{label}</span><div className="metric-icon"><Icon size={18} /></div></div><strong>{value}</strong><div className={`metric-change ${up ? 'positive' : ''}`}>{up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />} {change} <span>vs last week</span></div></div> }

function ProductsBooksView({ setToast }: { setToast: (value: string) => void }) {
  const [showForm, setShowForm] = useState(false)
  const [imported, setImported] = useState(false)
  const [bookCount, setBookCount] = useState(products.length)
  const demoRows = products.slice(0, 5)
  function downloadTemplate() {
    const csv = 'name,category,sku,isbn,selling_price,cost_price,opening_stock,reorder_level\nGrade 8 Social Studies,Textbooks,TB-G8-SST,9789966123456,950,680,30,8\n'
    const link = document.createElement('a')
    link.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
    link.download = 'nifunze-products-template.csv'
    link.click()
    setToast('Bulk upload template downloaded')
  }
  function handleImport(event: React.ChangeEvent<HTMLInputElement>) {
    if (!event.target.files?.length) return
    setImported(true)
    setBookCount((count) => count + 12)
    setToast('12 products imported successfully')
  }
  return <div className="products-page"><div className="page-heading compact"><div><div className="eyebrow">CATALOGUE · PRODUCTS & BOOKS</div><h1>Products & Books</h1><p>Add items one by one or import your catalogue in bulk.</p></div><div className="heading-actions"><button className="secondary-button" onClick={downloadTemplate}><Download size={16} /> Excel template</button><button className="primary-button" onClick={() => setShowForm(!showForm)}><Plus size={17} /> Add product</button></div></div><div className="catalog-stats"><div className="card catalog-stat"><span>Total products</span><strong>{bookCount}</strong><small>Across all categories</small></div><div className="card catalog-stat"><span>Low stock</span><strong>12</strong><small>Needs restocking</small></div><div className="card catalog-stat"><span>Catalogue value</span><strong>KSh 2.84M</strong><small>At selling price</small></div></div>{showForm && <section className="card product-form"><div className="card-heading"><div><h2>Add a product</h2><p>Use the same columns as the bulk upload template.</p></div><button className="icon-button" onClick={() => setShowForm(false)}><X size={17} /></button></div><div className="form-grid"><label className="field-label">Product name<input className="text-input" placeholder="e.g. Grade 8 Social Studies" /></label><label className="field-label">Category<select className="text-input" defaultValue="Textbooks"><option>Textbooks</option><option>Revision Books</option><option>Exercise Books</option><option>Stationery</option><option>Novels & Literature</option></select></label><label className="field-label">SKU<input className="text-input" placeholder="TB-G8-SST" /></label><label className="field-label">ISBN (optional)<input className="text-input" placeholder="9789966123456" /></label><label className="field-label">Selling price<input className="text-input" type="number" placeholder="950" /></label><label className="field-label">Cost price<input className="text-input" type="number" placeholder="680" /></label><label className="field-label">Opening stock<input className="text-input" type="number" placeholder="30" /></label><label className="field-label">Reorder level<input className="text-input" type="number" placeholder="8" /></label></div><button className="primary-button" onClick={() => { setShowForm(false); setBookCount((count) => count + 1); setToast('Product added to catalogue') }}>Save product <ArrowUpRight size={16} /></button></section>}<section className="bulk-upload card"><div className="bulk-icon"><FileSpreadsheet size={22} /></div><div className="bulk-copy"><h2>Import products in bulk</h2><p>Upload an Excel or CSV file with product name, category, SKU, prices and opening stock.</p><div className="bulk-actions"><button className="secondary-button" onClick={downloadTemplate}><Download size={15} /> Download template</button><label className="primary-button upload-button"><Upload size={15} /> {imported ? 'Import another file' : 'Choose Excel file'}<input type="file" accept=".csv,.xlsx,.xls" onChange={handleImport} /></label></div></div><div className="bulk-format">.XLSX<br /><span>or .CSV</span></div></section><section className="card catalogue-card"><div className="card-heading"><div><h2>Catalogue preview</h2><p>Showing your latest products and books.</p></div><div className="catalogue-search"><Search size={15} /><input placeholder="Search catalogue" /></div></div><div className="catalogue-table"><div className="catalogue-row catalogue-head"><span>Product</span><span>Category</span><span>SKU</span><span>Price</span><span>Stock</span></div>{demoRows.map((product) => <div className="catalogue-row" key={product.id}><span className="catalogue-product"><span className={`mini-art ${product.tone}`}><BookOpen size={14} /></span><strong>{product.name}</strong></span><span>{product.category}</span><span className="muted-text">{product.sku}</span><span>{money(product.price)}</span><span className={product.stock < 10 ? 'stock-low' : ''}>{product.stock}</span></div>)}</div><button className="text-button" onClick={() => setToast('All catalogue products are ready in the demo')}>View all {bookCount} products <ArrowUpRight size={14} /></button></section></div>
}

function InventoryView({ setToast }: { setToast: (value: string) => void }) {
  const [filter, setFilter] = useState('All stock')
  const [search, setSearch] = useState('')
  const [received, setReceived] = useState<number[]>([])
  const inventoryRows = products.filter((product) => `${product.name} ${product.sku} ${product.category}`.toLowerCase().includes(search.toLowerCase()))
  const lowStock = products.filter((product) => product.stock > 0 && product.stock <= 8)
  const outOfStock = products.filter((product) => product.stock === 0)
  const visibleRows = inventoryRows.filter((product) => filter === 'All stock' || (filter === 'Low stock' ? product.stock > 0 && product.stock <= 8 : product.stock === 0))
  function markReceived(id: number) {
    setReceived((current) => current.includes(id) ? current : [...current, id])
    setToast('Stock receipt recorded · 10 units added')
  }
  return <div className="inventory-page"><div className="page-heading compact"><div><div className="eyebrow">OPERATIONS · INVENTORY CONTROL</div><h1>Inventory & Stock</h1><p>Monitor stock levels, identify gaps, and keep your shelves ready for customers.</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => setToast('Stock report exported') }><Download size={16} /> Export report</button><button className="primary-button" onClick={() => setToast('New stock receipt started')}><Plus size={17} /> Receive stock</button></div></div><div className="inventory-stats"><div className="card catalog-stat"><span>Inventory value</span><strong>KSh 2.84M</strong><small>At selling price</small></div><div className="card catalog-stat"><span>Units on hand</span><strong>319</strong><small>Across {products.length} SKUs</small></div><div className="card catalog-stat warning"><span>Low stock</span><strong>{lowStock.length}</strong><small>Reorder soon</small></div><div className="card catalog-stat danger"><span>Out of stock</span><strong>{outOfStock.length}</strong><small>Needs action today</small></div></div><section className="card inventory-alert"><div className="alert-icon"><Bell size={17} /></div><div><strong>Stock attention needed</strong><p>{lowStock.length + outOfStock.length} items need a review before the next school rush.</p></div><button className="secondary-button" onClick={() => setFilter('Low stock')}>Review low stock</button></section><section className="card inventory-table-card"><div className="card-heading"><div><h2>Stock levels</h2><p>Live catalogue quantities by SKU</p></div><div className="inventory-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search stock..." /></div></div><div className="inventory-tabs">{['All stock', 'Low stock', 'Out of stock'].map((item) => <button key={item} className={filter === item ? 'selected' : ''} onClick={() => setFilter(item)}>{item}{item === 'Low stock' && <span>{lowStock.length}</span>}{item === 'Out of stock' && <span>{outOfStock.length}</span>}</button>)}</div><div className="inventory-list">{visibleRows.map((product) => { const isReceived = received.includes(product.id); const status = product.stock === 0 ? 'Out of stock' : product.stock <= 8 ? 'Low stock' : 'Healthy'; return <div className="inventory-row" key={product.id}><div className={`inventory-book ${product.tone}`}><BookOpen size={18} /></div><div className="inventory-product"><strong>{product.name}</strong><span>{product.sku} · {product.category}</span></div><div className="inventory-number"><strong>{isReceived ? product.stock + 10 : product.stock}</strong><span>units</span></div><div className="inventory-bar"><div><span>Stock level</span><i><b style={{ width: `${Math.min(((isReceived ? product.stock + 10 : product.stock) / 100) * 100, 100)}%` }} /></i></div></div><span className={`stock-status ${status.toLowerCase().replace(' ', '-')}`}>{status}</span><button className="row-action" onClick={() => markReceived(product.id)}>{isReceived ? 'Received' : 'Restock'}</button></div> })}{visibleRows.length === 0 && <div className="inventory-empty">No stock items match your search.</div>}</div></section></div>
}

const demoCustomers = [
  { name: 'Mary Wanjiku', phone: '+254 712 345 678', email: 'mary@example.com', purchases: 12, spent: 18450, type: 'Retail' },
  { name: 'Greenfield Academy', phone: '+254 720 118 402', email: 'accounts@greenfield.ac.ke', purchases: 28, spent: 128400, type: 'School' },
  { name: 'Peter Otieno', phone: '+254 701 884 210', email: 'peter@example.com', purchases: 6, spent: 6420, type: 'Retail' },
  { name: 'Bright Stars Primary', phone: '+254 733 900 115', email: 'procurement@brightstars.ac.ke', purchases: 19, spent: 76400, type: 'School' },
]

const demoSuppliers = [
  { name: 'Longhorn Publishers', contact: 'Kevin Mwangi', phone: '+254 709 445 210', items: 86, balance: 0, status: 'Active' },
  { name: 'East African Educational Publishers', contact: 'Anne Njeri', phone: '+254 722 800 145', items: 54, balance: 24500, status: 'Active' },
  { name: 'Text Book Centre Wholesale', contact: 'David Kamau', phone: '+254 711 342 908', items: 31, balance: 0, status: 'Active' },
]

function CustomersView({ setToast }: { setToast: (value: string) => void }) {
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const rows = demoCustomers.filter((customer) => `${customer.name} ${customer.phone} ${customer.email}`.toLowerCase().includes(search.toLowerCase()))
  function saveCustomer(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setShowForm(false); setToast('Customer added successfully') }
  return <div className="products-page"><div className="page-heading compact"><div><div className="eyebrow">RELATIONSHIPS · CUSTOMER DIRECTORY</div><h1>Customers</h1><p>Keep customer details organized and make repeat sales more personal.</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => setToast('Customer list exported')}><Download size={16} /> Export list</button><button className="primary-button" onClick={() => setShowForm(true)}><Plus size={17} /> Add customer</button></div></div><div className="catalog-stats"><div className="card catalog-stat"><span>Total customers</span><strong>248</strong><small>18 added this month</small></div><div className="card catalog-stat"><span>Active this month</span><strong>96</strong><small>Returning customers</small></div><div className="card catalog-stat"><span>Customer sales</span><strong>KSh 428K</strong><small>Last 30 days</small></div></div><section className="card inventory-table-card"><div className="card-heading"><div><h2>Customer directory</h2><p>Demo records ready for your first sales</p></div><div className="inventory-search"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customers..." /></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Customer</th><th>Contact</th><th>Type</th><th>Purchases</th><th>Total spent</th><th /></tr></thead><tbody>{rows.map((customer) => <tr key={customer.name}><td><strong>{customer.name}</strong></td><td><span>{customer.phone}</span><small>{customer.email}</small></td><td><span className="status-chip">{customer.type}</span></td><td>{customer.purchases} orders</td><td><strong>{money(customer.spent)}</strong></td><td><button className="icon-button" aria-label={`More options for ${customer.name}`}><MoreHorizontal size={17} /></button></td></tr>)}</tbody></table></div></section>{showForm && <div className="modal-backdrop"><form className="checkout-modal" onSubmit={saveCustomer}><div className="modal-header"><div><div className="eyebrow">CUSTOMER DIRECTORY</div><h2>Add customer</h2></div><button type="button" className="icon-button" onClick={() => setShowForm(false)} aria-label="Close"><X size={18} /></button></div><div className="form-grid"><label className="field-label">Full name<input className="text-input" required placeholder="e.g. Mary Wanjiku" /></label><label className="field-label">Customer type<select className="text-input" defaultValue="Retail"><option>Retail</option><option>School</option><option>Wholesale</option></select></label><label className="field-label">Phone number<input className="text-input" required placeholder="+254 7XX XXX XXX" /></label><label className="field-label">Email address<input className="text-input" type="email" placeholder="customer@example.com" /></label><label className="field-label full-span">Notes<textarea className="text-input" rows={3} placeholder="Optional notes or billing details" /></label></div><button className="primary-button full" type="submit">Save customer <ArrowUpRight size={16} /></button></form></div>}</div>
}

function SuppliersView({ setToast }: { setToast: (value: string) => void }) {
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const rows = demoSuppliers.filter((supplier) => `${supplier.name} ${supplier.contact} ${supplier.phone}`.toLowerCase().includes(search.toLowerCase()))
  function saveSupplier(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setShowForm(false); setToast('Supplier added successfully') }
  return <div className="products-page"><div className="page-heading compact"><div><div className="eyebrow">PROCUREMENT · SUPPLIER DIRECTORY</div><h1>Suppliers</h1><p>Manage your publishing partners, contacts, and outstanding balances.</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => setToast('Supplier list exported')}><Download size={16} /> Export list</button><button className="primary-button" onClick={() => setShowForm(true)}><Plus size={17} /> Add supplier</button></div></div><div className="catalog-stats"><div className="card catalog-stat"><span>Active suppliers</span><strong>18</strong><small>Across all categories</small></div><div className="card catalog-stat"><span>Products supplied</span><strong>171</strong><small>Linked catalogue items</small></div><div className="card catalog-stat warning"><span>Outstanding balance</span><strong>KSh 24,500</strong><small>Due to suppliers</small></div></div><section className="card inventory-table-card"><div className="card-heading"><div><h2>Supplier directory</h2><p>Contacts and purchasing overview</p></div><div className="inventory-search"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search suppliers..." /></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Supplier</th><th>Contact person</th><th>Phone</th><th>Products</th><th>Balance</th><th>Status</th></tr></thead><tbody>{rows.map((supplier) => <tr key={supplier.name}><td><strong>{supplier.name}</strong></td><td>{supplier.contact}</td><td>{supplier.phone}</td><td>{supplier.items} items</td><td className={supplier.balance ? 'warning-text' : ''}><strong>{money(supplier.balance)}</strong></td><td><span className="status-chip">{supplier.status}</span></td></tr>)}</tbody></table></div></section>{showForm && <div className="modal-backdrop"><form className="checkout-modal" onSubmit={saveSupplier}><div className="modal-header"><div><div className="eyebrow">SUPPLIER DIRECTORY</div><h2>Add supplier</h2></div><button type="button" className="icon-button" onClick={() => setShowForm(false)} aria-label="Close"><X size={18} /></button></div><div className="form-grid"><label className="field-label">Company name<input className="text-input" required placeholder="e.g. Longhorn Publishers" /></label><label className="field-label">Contact person<input className="text-input" required placeholder="e.g. Kevin Mwangi" /></label><label className="field-label">Phone number<input className="text-input" required placeholder="+254 7XX XXX XXX" /></label><label className="field-label">Email address<input className="text-input" type="email" placeholder="orders@supplier.co.ke" /></label><label className="field-label full-span">Notes<textarea className="text-input" rows={3} placeholder="Payment terms or delivery notes" /></label></div><button className="primary-button full" type="submit">Save supplier <ArrowUpRight size={16} /></button></form></div>}</div>
}

function POSView({ filteredProducts, query, setQuery, cart, addToCart, updateQuantity, subtotal, tax, total, setCart, setShowCheckout }: any) { return <div className="pos-page"><div className="page-heading compact"><div><div className="eyebrow">SALES TERMINAL · REGISTER 01</div><h1>Point of Sale</h1><p>Serve customers quickly and keep your records accurate.</p></div><div className="register-actions"><button className="secondary-button" onClick={() => { const demoItems = products.filter((product) => [1, 3, 4].includes(product.id)).map((product, index) => ({ product, quantity: index === 0 ? 1 : index === 1 ? 2 : 3 })); setCart(demoItems); }}>Load demo sale</button><div className="register-status"><span className="status-dot" /> Register open</div></div></div><div className="pos-layout"><section className="product-panel card"><div className="pos-search"><Search size={18} /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by product, ISBN or SKU..." /><kbd>/</kbd></div><div className="category-tabs"><button className="selected">All products</button><button>Textbooks</button><button>Stationery</button><button>Exercise books</button><button>Revision</button></div><div className="product-grid">{filteredProducts.map((product: typeof products[number]) => <button className="product-card" key={product.id} onClick={() => addToCart(product)} disabled={product.stock === 0}><div className={`product-art ${product.tone}`}><BookOpen size={24} /><span>{product.category === 'Stationery' ? 'STATIONERY' : product.category.toUpperCase()}</span></div><div className="product-info"><strong>{product.name}</strong><span>{product.sku} · {product.stock === 0 ? 'Out of stock' : `${product.stock} in stock`}</span><b>{money(product.price)}</b></div><Plus className="add-icon" size={17} /></button>)}</div></section><aside className="cart-panel card"><div className="cart-heading"><div><h2>Current sale</h2><span>{cart.reduce((s: number, i: any) => s + i.quantity, 0)} items</span></div>{cart.length > 0 && <button className="clear-button" onClick={() => setCart([])}>Clear</button>}</div><div className="customer-select"><Users size={16} /><span>Walk-in customer</span><ChevronDown size={15} /></div><div className="cart-items">{cart.length === 0 ? <div className="cart-empty"><ShoppingCart size={27} /><strong>Your cart is empty</strong><span>Select a product to start a sale</span></div> : cart.map((item: any) => <div className="cart-item" key={item.product.id}><div className={`mini-art ${item.product.tone}`}><BookOpen size={15} /></div><div className="cart-item-info"><strong>{item.product.name}</strong><span>{money(item.product.price)} each</span><div className="qty"><button onClick={() => updateQuantity(item.product.id, -1)}>−</button><b>{item.quantity}</b><button onClick={() => updateQuantity(item.product.id, 1)}>+</button></div></div><strong>{money(item.product.price * item.quantity)}</strong></div>)}</div><div className="totals"><div><span>Subtotal</span><b>{money(subtotal)}</b></div><div><span>Tax <small>(16%)</small></span><b>{money(tax)}</b></div><div className="total-line"><span>Total due</span><strong>{money(total)}</strong></div></div><button className="primary-button full checkout-button" disabled={!cart.length} onClick={() => setShowCheckout(true)}>Charge {money(total)} <ArrowUpRight size={17} /></button><div className="payment-hint"><CreditCard size={15} /> Payment collected at checkout</div></aside></div></div> }
