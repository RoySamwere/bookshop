'use client'

import { useEffect, useMemo, useState } from 'react'
import { WorkspaceShell } from '../components/workspace-shell'
import { OverviewDashboard } from '../components/overview-dashboard'
import { login, logout, getCurrentUser, listUsers, createUser, deleteUser, updateUserRole, hasPermission, roleLabel, type BookshopUser, type SystemUser } from '../lib/auth'
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  CalendarDays,
  ChevronDown,
  CircleDollarSign,
  CreditCard,
  FileText,
  FileSpreadsheet,
  Download,
  Upload,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  MoreHorizontal,
  Package,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Sparkles,
  Tags,
  Truck,
  Users,
  UserPlus,
  UserRound,
  WalletCards,
  X,
} from 'lucide-react'

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
    getCurrentUser(token).then(user => { if (hasPermission(user, 'workspace.access')) setCurrentUser(user); else sessionStorage.removeItem('bookshop_token') }).catch(() => sessionStorage.removeItem('bookshop_token')).finally(() => setAuthLoading(false))
  }, [])
  async function signOut() {
    const token = sessionStorage.getItem('bookshop_token')
    sessionStorage.removeItem('bookshop_token')
    setCurrentUser(null)
    setActive('Dashboard')
    setCart([])
    setShowCheckout(false)
    if (token) await logout(token).catch(() => undefined)
  }
  const canManageUsers = currentUser ? hasPermission(currentUser, 'users.manage') : false
  const canManageSettings = currentUser ? hasPermission(currentUser, 'settings.manage') : false
  const canAccessSection = (section: string) => section === 'Users' ? canManageUsers : section === 'Settings' ? canManageSettings : true

  function navigateTo(section: string) {
    if (!canAccessSection(section)) return
    setActive(section)
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

  if (authLoading) return <BrandLoader />
  if (!currentUser) return <LoginPage onLogin={(user) => setCurrentUser(user)} />

  return (
    <WorkspaceShell currentUser={currentUser} active={active} onNavigate={navigateTo} onSignOut={signOut}>
        {!canAccessSection(active) ? <section className="page-placeholder"><h1 tabIndex={-1}>Access restricted</h1><p>Your role does not include access to this section.</p></section> : active === 'Point of Sale' ? <POSView filteredProducts={filteredProducts} query={query} setQuery={setQuery} cart={cart} addToCart={addToCart} updateQuantity={updateQuantity} subtotal={subtotal} tax={tax} total={total} setCart={setCart} setShowCheckout={setShowCheckout} /> : active === 'Products & Books' ? <ProductsBooksView setToast={setToast} /> : active === 'Inventory & Stock' ? <InventoryView setToast={setToast} /> : active === 'Customers' ? <CustomersView setToast={setToast} /> : active === 'Suppliers' ? <SuppliersView setToast={setToast} /> : active === 'Users' ? <UsersView currentUser={currentUser} setToast={setToast} /> : <Dashboard active={active} setActive={navigateTo} userName={currentUser.name} />}


      {showCheckout && <div className="modal-backdrop"><div className="checkout-modal" role="dialog" aria-modal="true" aria-label="Complete sale"><div className="modal-header"><div><div className="eyebrow">CHECKOUT</div><h2>Complete sale</h2></div><button className="icon-button" onClick={() => setShowCheckout(false)}><X size={18} /></button></div><div className="checkout-total"><span>Total due</span><strong>{money(total)}</strong></div><div className="payment-tabs">{['Cash', 'M-Pesa', 'Card', 'Bank transfer'].map((method) => <button key={method} className={payment === method ? 'selected' : ''} onClick={() => setPayment(method)}>{method}</button>)}</div><label className="field-label">{payment === 'M-Pesa' ? 'M-Pesa transaction code' : 'Payment reference'}<input className="text-input" placeholder={payment === 'M-Pesa' ? 'e.g. QKL7H2M1' : 'Optional reference'} /></label><label className="field-label">Amount received<input className="text-input" defaultValue={total.toFixed(2)} /></label><div className="change-row"><span>Change due</span><strong>{money(0)}</strong></div><button className="primary-button full" onClick={() => { setShowCheckout(false); setCart([]); setToast('Sale completed · Receipt #NS-10483') }}>Confirm payment <ArrowUpRight size={16} /></button><p className="secure-note">Demo payment · No external gateway connected</p></div></div>}
      {toast && <div className="toast" role="status"><span className="toast-check">✓</span>{toast}</div>}
    </WorkspaceShell>
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
      if (!hasPermission(result.user, 'workspace.access')) throw new Error('Your account is not authorised to access the system.')
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
      <div className="login-brand"><div className="brand-mark"><img src="/bookshop-emblem.svg" alt="" /></div><div><strong>Bookshop</strong><span>RETAIL WORKSPACE</span></div></div>
      <div className="login-story"><div className="eyebrow">MADE FOR KENYAN BOOKSELLERS</div><h1 tabIndex={-1}>Keep every shelf, sale, and school order moving.</h1><p>One calm workspace for M-Pesa sales, curriculum stock, suppliers, and your regular readers.</p><div className="login-points"><span><i /> KSh-ready checkout with M-Pesa</span><span><i /> KCSE and CBC catalogue tracking</span><span><i /> School account management</span></div></div>
      <small className="login-footer">Bookshop · Kenya</small>
    </section>
    <section className="login-form-panel"><div className="login-form-wrap">
      <div className="mobile-login-logo"><div className="brand-mark"><img src="/bookshop-emblem.svg" alt="" /></div><strong>Bookshop</strong></div>
      <div className="eyebrow">WELCOME BACK</div><h2>Sign in to your shop</h2>
      <p className="login-muted">Sign in with your assigned account. Access follows your role.</p>
      <form onSubmit={submit}>
        <label className="field-label">Work email<input className="text-input" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
        <label className="field-label">Password<div className="password-field"><input className="text-input" type={showPassword ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /><button type="button" onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}</button></div></label>
        {error && <p role="alert" style={{color:'#b91c1c',marginBottom:12}}>{error}</p>}
        <button className="primary-button full" type="submit" disabled={pending}>{pending ? 'Signing in...' : 'Sign in to Bookshop'} <ArrowUpRight size={16} /></button>
      </form>
    </div></section>
  </main>
}

function Dashboard({ active, setActive, userName }: { active: string; setActive: (value: string) => void; userName: string }) {
  if (active !== 'Dashboard') return <section className="page-placeholder"><div className="empty-icon"><Tags size={24} /></div><h1 tabIndex={-1}>{active}</h1><p>This workspace is ready for your daily operations. Use the dashboard or point of sale to get started.</p><button className="primary-button" onClick={() => setActive('Point of Sale')}>Open Point of Sale <ArrowUpRight size={16} /></button></section>
  return <OverviewDashboard userName={userName} products={products} sales={sales} onNavigate={setActive} />
}
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
  return <div className="products-page"><div className="page-heading compact"><div><div className="eyebrow">CATALOGUE · PRODUCTS & BOOKS</div><h1 tabIndex={-1}>Products & Books</h1><p>Add items one by one or import your catalogue in bulk.</p></div><div className="heading-actions"><button className="secondary-button" onClick={downloadTemplate}><Download size={16} /> Excel template</button><button className="primary-button" onClick={() => setShowForm(!showForm)}><Plus size={17} /> Add product</button></div></div><div className="catalog-stats"><div className="card catalog-stat"><span>Total products</span><strong>{bookCount}</strong><small>Across all categories</small></div><div className="card catalog-stat"><span>Low stock</span><strong>12</strong><small>Needs restocking</small></div><div className="card catalog-stat"><span>Catalogue value</span><strong>KSh 2.84M</strong><small>At selling price</small></div></div>{showForm && <section className="card product-form"><div className="card-heading"><div><h2>Add a product</h2><p>Use the same columns as the bulk upload template.</p></div><button className="icon-button" onClick={() => setShowForm(false)}><X size={17} /></button></div><div className="form-grid"><label className="field-label">Product name<input className="text-input" placeholder="e.g. Grade 8 Social Studies" /></label><label className="field-label">Category<select className="text-input" defaultValue="Textbooks"><option>Textbooks</option><option>Revision Books</option><option>Exercise Books</option><option>Stationery</option><option>Novels & Literature</option></select></label><label className="field-label">SKU<input className="text-input" placeholder="TB-G8-SST" /></label><label className="field-label">ISBN (optional)<input className="text-input" placeholder="9789966123456" /></label><label className="field-label">Selling price<input className="text-input" type="number" placeholder="950" /></label><label className="field-label">Cost price<input className="text-input" type="number" placeholder="680" /></label><label className="field-label">Opening stock<input className="text-input" type="number" placeholder="30" /></label><label className="field-label">Reorder level<input className="text-input" type="number" placeholder="8" /></label></div><button className="primary-button" onClick={() => { setShowForm(false); setBookCount((count) => count + 1); setToast('Product added to catalogue') }}>Save product <ArrowUpRight size={16} /></button></section>}<section className="bulk-upload card"><div className="bulk-icon"><FileSpreadsheet size={22} /></div><div className="bulk-copy"><h2>Import products in bulk</h2><p>Upload an Excel or CSV file with product name, category, SKU, prices and opening stock.</p><div className="bulk-actions"><button className="secondary-button" onClick={downloadTemplate}><Download size={15} /> Download template</button><label className="primary-button upload-button"><Upload size={15} /> {imported ? 'Import another file' : 'Choose Excel file'}<input type="file" accept=".csv,.xlsx,.xls" onChange={handleImport} /></label></div></div><div className="bulk-format">.XLSX<br /><span>or .CSV</span></div></section><section className="card catalogue-card"><div className="card-heading"><div><h2>Catalogue preview</h2><p>Showing your latest products and books.</p></div><div className="catalogue-search"><Search size={15} /><input placeholder="Search catalogue" /></div></div><div className="catalogue-table"><div className="catalogue-row catalogue-head"><span>Product</span><span>Category</span><span>SKU</span><span>Price</span><span>Stock</span></div>{demoRows.map((product) => <div className="catalogue-row" key={product.id}><span className="catalogue-product"><span className={`mini-art ${product.tone}`}><BookOpen size={14} /></span><strong>{product.name}</strong></span><span>{product.category}</span><span className="muted-text">{product.sku}</span><span>{money(product.price)}</span><span className={product.stock < 10 ? 'stock-low' : ''}>{product.stock}</span></div>)}</div><button className="text-button" onClick={() => setToast('All catalogue products are ready in the demo')}>View all {bookCount} products <ArrowUpRight size={14} /></button></section></div>
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
  return <div className="inventory-page"><div className="page-heading compact"><div><div className="eyebrow">OPERATIONS · INVENTORY CONTROL</div><h1 tabIndex={-1}>Inventory & Stock</h1><p>Monitor stock levels, identify gaps, and keep your shelves ready for customers.</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => setToast('Stock report exported') }><Download size={16} /> Export report</button><button className="primary-button" onClick={() => setToast('New stock receipt started')}><Plus size={17} /> Receive stock</button></div></div><div className="inventory-stats"><div className="card catalog-stat"><span>Inventory value</span><strong>KSh 2.84M</strong><small>At selling price</small></div><div className="card catalog-stat"><span>Units on hand</span><strong>319</strong><small>Across {products.length} SKUs</small></div><div className="card catalog-stat warning"><span>Low stock</span><strong>{lowStock.length}</strong><small>Reorder soon</small></div><div className="card catalog-stat danger"><span>Out of stock</span><strong>{outOfStock.length}</strong><small>Needs action today</small></div></div><section className="card inventory-alert"><div className="alert-icon"><Bell size={17} /></div><div><strong>Stock attention needed</strong><p>{lowStock.length + outOfStock.length} items need a review before the next school rush.</p></div><button className="secondary-button" onClick={() => setFilter('Low stock')}>Review low stock</button></section><section className="card inventory-table-card"><div className="card-heading"><div><h2>Stock levels</h2><p>Live catalogue quantities by SKU</p></div><div className="inventory-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search stock..." /></div></div><div className="inventory-tabs">{['All stock', 'Low stock', 'Out of stock'].map((item) => <button key={item} className={filter === item ? 'selected' : ''} onClick={() => setFilter(item)}>{item}{item === 'Low stock' && <span>{lowStock.length}</span>}{item === 'Out of stock' && <span>{outOfStock.length}</span>}</button>)}</div><div className="inventory-list">{visibleRows.map((product) => { const isReceived = received.includes(product.id); const status = product.stock === 0 ? 'Out of stock' : product.stock <= 8 ? 'Low stock' : 'Healthy'; return <div className="inventory-row" key={product.id}><div className={`inventory-book ${product.tone}`}><BookOpen size={18} /></div><div className="inventory-product"><strong>{product.name}</strong><span>{product.sku} · {product.category}</span></div><div className="inventory-number"><strong>{isReceived ? product.stock + 10 : product.stock}</strong><span>units</span></div><div className="inventory-bar"><div><span>Stock level</span><i><b style={{ width: `${Math.min(((isReceived ? product.stock + 10 : product.stock) / 100) * 100, 100)}%` }} /></i></div></div><span className={`stock-status ${status.toLowerCase().replace(' ', '-')}`}>{status}</span><button className="row-action" onClick={() => markReceived(product.id)}>{isReceived ? 'Received' : 'Restock'}</button></div> })}{visibleRows.length === 0 && <div className="inventory-empty">No stock items match your search.</div>}</div></section></div>
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
  return <div className="products-page"><div className="page-heading compact"><div><div className="eyebrow">RELATIONSHIPS · CUSTOMER DIRECTORY</div><h1 tabIndex={-1}>Customers</h1><p>Keep customer details organized and make repeat sales more personal.</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => setToast('Customer list exported')}><Download size={16} /> Export list</button><button className="primary-button" onClick={() => setShowForm(true)}><Plus size={17} /> Add customer</button></div></div><div className="catalog-stats"><div className="card catalog-stat"><span>Total customers</span><strong>248</strong><small>18 added this month</small></div><div className="card catalog-stat"><span>Active this month</span><strong>96</strong><small>Returning customers</small></div><div className="card catalog-stat"><span>Customer sales</span><strong>KSh 428K</strong><small>Last 30 days</small></div></div><section className="card inventory-table-card"><div className="card-heading"><div><h2>Customer directory</h2><p>Demo records ready for your first sales</p></div><div className="inventory-search"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search customers..." /></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Customer</th><th>Contact</th><th>Type</th><th>Purchases</th><th>Total spent</th><th /></tr></thead><tbody>{rows.map((customer) => <tr key={customer.name}><td><strong>{customer.name}</strong></td><td><span>{customer.phone}</span><small>{customer.email}</small></td><td><span className="status-chip">{customer.type}</span></td><td>{customer.purchases} orders</td><td><strong>{money(customer.spent)}</strong></td><td><button className="icon-button" aria-label={`More options for ${customer.name}`}><MoreHorizontal size={17} /></button></td></tr>)}</tbody></table></div></section>{showForm && <div className="modal-backdrop"><form className="checkout-modal" onSubmit={saveCustomer}><div className="modal-header"><div><div className="eyebrow">CUSTOMER DIRECTORY</div><h2>Add customer</h2></div><button type="button" className="icon-button" onClick={() => setShowForm(false)} aria-label="Close"><X size={18} /></button></div><div className="form-grid"><label className="field-label">Full name<input className="text-input" required placeholder="e.g. Mary Wanjiku" /></label><label className="field-label">Customer type<select className="text-input" defaultValue="Retail"><option>Retail</option><option>School</option><option>Wholesale</option></select></label><label className="field-label">Phone number<input className="text-input" required placeholder="+254 7XX XXX XXX" /></label><label className="field-label">Email address<input className="text-input" type="email" placeholder="customer@example.com" /></label><label className="field-label full-span">Notes<textarea className="text-input" rows={3} placeholder="Optional notes or billing details" /></label></div><button className="primary-button full" type="submit">Save customer <ArrowUpRight size={16} /></button></form></div>}</div>
}

function SuppliersView({ setToast }: { setToast: (value: string) => void }) {
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const rows = demoSuppliers.filter((supplier) => `${supplier.name} ${supplier.contact} ${supplier.phone}`.toLowerCase().includes(search.toLowerCase()))
  function saveSupplier(event: React.FormEvent<HTMLFormElement>) { event.preventDefault(); setShowForm(false); setToast('Supplier added successfully') }
  return <div className="products-page"><div className="page-heading compact"><div><div className="eyebrow">PROCUREMENT · SUPPLIER DIRECTORY</div><h1 tabIndex={-1}>Suppliers</h1><p>Manage your publishing partners, contacts, and outstanding balances.</p></div><div className="heading-actions"><button className="secondary-button" onClick={() => setToast('Supplier list exported')}><Download size={16} /> Export list</button><button className="primary-button" onClick={() => setShowForm(true)}><Plus size={17} /> Add supplier</button></div></div><div className="catalog-stats"><div className="card catalog-stat"><span>Active suppliers</span><strong>18</strong><small>Across all categories</small></div><div className="card catalog-stat"><span>Products supplied</span><strong>171</strong><small>Linked catalogue items</small></div><div className="card catalog-stat warning"><span>Outstanding balance</span><strong>KSh 24,500</strong><small>Due to suppliers</small></div></div><section className="card inventory-table-card"><div className="card-heading"><div><h2>Supplier directory</h2><p>Contacts and purchasing overview</p></div><div className="inventory-search"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search suppliers..." /></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>Supplier</th><th>Contact person</th><th>Phone</th><th>Products</th><th>Balance</th><th>Status</th></tr></thead><tbody>{rows.map((supplier) => <tr key={supplier.name}><td><strong>{supplier.name}</strong></td><td>{supplier.contact}</td><td>{supplier.phone}</td><td>{supplier.items} items</td><td className={supplier.balance ? 'warning-text' : ''}><strong>{money(supplier.balance)}</strong></td><td><span className="status-chip">{supplier.status}</span></td></tr>)}</tbody></table></div></section>{showForm && <div className="modal-backdrop"><form className="checkout-modal" onSubmit={saveSupplier}><div className="modal-header"><div><div className="eyebrow">SUPPLIER DIRECTORY</div><h2>Add supplier</h2></div><button type="button" className="icon-button" onClick={() => setShowForm(false)} aria-label="Close"><X size={18} /></button></div><div className="form-grid"><label className="field-label">Company name<input className="text-input" required placeholder="e.g. Longhorn Publishers" /></label><label className="field-label">Contact person<input className="text-input" required placeholder="e.g. Kevin Mwangi" /></label><label className="field-label">Phone number<input className="text-input" required placeholder="+254 7XX XXX XXX" /></label><label className="field-label">Email address<input className="text-input" type="email" placeholder="orders@supplier.co.ke" /></label><label className="field-label full-span">Notes<textarea className="text-input" rows={3} placeholder="Payment terms or delivery notes" /></label></div><button className="primary-button full" type="submit">Save supplier <ArrowUpRight size={16} /></button></form></div>}</div>
}

function POSView({ filteredProducts, query, setQuery, cart, addToCart, updateQuantity, subtotal, tax, total, setCart, setShowCheckout }: any) { return <div className="pos-page"><div className="page-heading compact"><div><div className="eyebrow">SALES TERMINAL · REGISTER 01</div><h1 tabIndex={-1}>Point of Sale</h1><p>Serve customers quickly and keep your records accurate.</p></div><div className="register-actions"><button className="secondary-button" onClick={() => { const demoItems = products.filter((product) => [1, 3, 4].includes(product.id)).map((product, index) => ({ product, quantity: index === 0 ? 1 : index === 1 ? 2 : 3 })); setCart(demoItems); }}>Load demo sale</button><div className="register-status"><span className="status-dot" /> Register open</div></div></div><div className="pos-layout"><section className="product-panel card"><div className="pos-search"><Search size={18} /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by product, ISBN or SKU..." /><kbd>/</kbd></div><div className="category-tabs"><button className="selected">All products</button><button>Textbooks</button><button>Stationery</button><button>Exercise books</button><button>Revision</button></div><div className="product-grid">{filteredProducts.map((product: typeof products[number]) => <button className="product-card" key={product.id} onClick={() => addToCart(product)} disabled={product.stock === 0}><div className={`product-art ${product.tone}`}><BookOpen size={24} /><span>{product.category === 'Stationery' ? 'STATIONERY' : product.category.toUpperCase()}</span></div><div className="product-info"><strong>{product.name}</strong><span>{product.sku} · {product.stock === 0 ? 'Out of stock' : `${product.stock} in stock`}</span><b>{money(product.price)}</b></div><Plus className="add-icon" size={17} /></button>)}</div></section><aside className="cart-panel card"><div className="cart-heading"><div><h2>Current sale</h2><span>{cart.reduce((s: number, i: any) => s + i.quantity, 0)} items</span></div>{cart.length > 0 && <button className="clear-button" onClick={() => setCart([])}>Clear</button>}</div><div className="customer-select"><Users size={16} /><span>Walk-in customer</span><ChevronDown size={15} /></div><div className="cart-items">{cart.length === 0 ? <div className="cart-empty"><ShoppingCart size={27} /><strong>Your cart is empty</strong><span>Select a product to start a sale</span></div> : cart.map((item: any) => <div className="cart-item" key={item.product.id}><div className={`mini-art ${item.product.tone}`}><BookOpen size={15} /></div><div className="cart-item-info"><strong>{item.product.name}</strong><span>{money(item.product.price)} each</span><div className="qty"><button onClick={() => updateQuantity(item.product.id, -1)}>−</button><b>{item.quantity}</b><button onClick={() => updateQuantity(item.product.id, 1)}>+</button></div></div><strong>{money(item.product.price * item.quantity)}</strong></div>)}</div><div className="totals"><div><span>Subtotal</span><b>{money(subtotal)}</b></div><div><span>Tax <small>(16%)</small></span><b>{money(tax)}</b></div><div className="total-line"><span>Total due</span><strong>{money(total)}</strong></div></div><button className="primary-button full checkout-button" disabled={!cart.length} onClick={() => setShowCheckout(true)}>Charge {money(total)} <ArrowUpRight size={17} /></button><div className="payment-hint"><CreditCard size={15} /> Payment collected at checkout</div></aside></div></div> }


// ─── Users Management ───────────────────────────────────────────────────────

function UsersView({ currentUser, setToast }: { currentUser: BookshopUser; setToast: (msg: string) => void }) {
  const isOwner = hasPermission(currentUser, 'users.assign_roles')

  const [users, setUsers] = useState<SystemUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [updatingId, setUpdatingId] = useState<number | null>(null)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [passwordConfirm, setPasswordConfirm] = useState('')
  const [role, setRole] = useState(isOwner ? 'admin' : 'user')

  // Roles this caller is allowed to assign
  const allowedRoles = currentUser.assignable_roles

  function resetForm() {
    setName(''); setEmail(''); setPassword(''); setPasswordConfirm('')
    setRole(isOwner ? 'admin' : 'user')
    setFormError('')
  }

  function closeForm() {
    setShowForm(false)
    resetForm()
  }

  function loadUsers() {
    const token = sessionStorage.getItem('bookshop_token')
    if (!token) return
    setLoading(true)
    listUsers(token)
      .then(setUsers)
      .catch((e: Error) => setToast(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadUsers() }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (password !== passwordConfirm) { setFormError('Passwords do not match.'); return }
    const token = sessionStorage.getItem('bookshop_token')
    if (!token) return
    setSubmitting(true); setFormError('')
    try {
      const created = await createUser(token, { name, email, password, password_confirmation: passwordConfirm, role })
      setUsers(prev => [created, ...prev])
      setToast(`${created.name} created successfully.`)
      setShowForm(false); resetForm()
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to create user.')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDelete(id: number, userName: string) {
    if (!confirm(`Delete ${userName}? This cannot be undone.`)) return
    const token = sessionStorage.getItem('bookshop_token')
    if (!token) return
    setDeletingId(id)
    try {
      await deleteUser(token, id)
      setUsers(prev => prev.filter(u => u.id !== id))
      setToast(`${userName} was deleted.`)
    } catch (e) {
      setToast(e instanceof Error ? e.message : 'Failed to delete user.')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleRoleChange(user: SystemUser, nextRole: string) {
    if (nextRole === user.role || !confirm(`Change ${user.name}'s role to ${roleLabel(nextRole)}? They will need to sign in again.`)) return
    const token = sessionStorage.getItem('bookshop_token')
    if (!token) return
    setUpdatingId(user.id)
    try {
      const updated = await updateUserRole(token, user.id, nextRole)
      setUsers(previous => previous.map(item => item.id === user.id ? updated : item))
      setToast(`${user.name}'s access updated.`)
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Failed to update role.')
    } finally {
      setUpdatingId(null)
    }
  }
  const filteredUsers = users.filter(user =>
    `${user.name} ${user.email} ${roleLabel(user.role)}`.toLowerCase().includes(userSearch.toLowerCase()),
  )

  return (
    <div className="products-page">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-5">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-[0.16em] text-slate-500">
            <span className="grid size-7 place-items-center rounded-lg bg-teal-50 text-teal-700"><Users size={15} /></span>
            WORKSPACE <span className="text-slate-300">/</span> TEAM
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Users</h1>
          <p className="mt-2 max-w-xl text-sm text-slate-500">
            {isOwner
              ? 'Manage your bookshop team and keep access in the right hands.'
              : 'Manage the user accounts you have created for your bookshop.'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 sm:flex">
            <span className="size-2 rounded-full bg-emerald-500" /> Team access
          </span>
          <button
            className="inline-flex items-center gap-2 rounded-xl bg-[#243b80] px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1b2b58] focus:outline-none focus:ring-4 focus:ring-blue-100"
            onClick={() => { resetForm(); setShowForm(true) }}
          >
            <UserPlus size={17} /> Add user
          </button>
        </div>
      </div>

      <section className="card mb-5 p-5" aria-label="User access rights">
        <h2 className="font-semibold text-slate-900">Roles and access rights</h2>
        <p className="mt-2 text-sm text-slate-500">All assigned roles can sign in and use shop operations. Account administration follows these rules.</p>
        <div className="table-wrap mt-3">
          <table className="data-table">
            <thead><tr><th>Role</th><th>Shop workspace</th><th>User accounts</th><th>Assign roles</th></tr></thead>
            <tbody>
              <tr><td>System Owner</td><td>Full access</td><td>All non-owner accounts</td><td>Administrator or User</td></tr>
              <tr><td>Administrator</td><td>Full access</td><td>Create and remove own users</td><td>User only on creation</td></tr>
              <tr><td>User / Staff</td><td>Shop operations</td><td>No account administration</td><td>No</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <div className={`mb-5 grid gap-4 ${isOwner ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Team members</p>
              <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{users.length}</p>
            </div>
            <span className="grid size-10 place-items-center rounded-xl bg-blue-50 text-blue-700"><Users size={19} /></span>
          </div>
          <p className="mt-3 text-xs text-slate-400">Your account is not included</p>
        </div>
        {isOwner && (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">Administrators</p>
                <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{users.filter(u => u.role === 'admin').length}</p>
              </div>
              <span className="grid size-10 place-items-center rounded-xl bg-violet-50 text-violet-700"><ShieldCheck size={19} /></span>
            </div>
            <p className="mt-3 text-xs text-slate-400">Can manage standard users</p>
          </div>
        )}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Standard users</p>
              <p className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{users.filter(u => u.role === 'user').length}</p>
            </div>
            <span className="grid size-10 place-items-center rounded-xl bg-teal-50 text-teal-700"><UserRound size={19} /></span>
          </div>
          <p className="mt-3 text-xs text-slate-400">Standard workspace access</p>
        </div>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">Team directory</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{users.length}</span>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {isOwner ? 'Everyone with access to your bookshop workspace.' : 'Users you have added to your workspace.'}
            </p>
          </div>
          <label className="flex h-10 w-full items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-slate-400 transition focus-within:border-blue-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-50 sm:max-w-xs">
            <Search size={16} />
            <input
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
              type="search"
              value={userSearch}
              onChange={e => setUserSearch(e.target.value)}
              placeholder="Search name, email or role"
              aria-label="Search users"
            />
          </label>
        </div>

        {loading ? (
          <div className="flex flex-col items-center px-6 py-16 text-center" role="status">
            <span className="mb-3 size-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-700" />
            <p className="text-sm font-medium text-slate-700">Loading your team</p>
            <p className="mt-1 text-xs text-slate-400">This will only take a moment.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-left">
              <thead className="bg-slate-50/80">
                <tr className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">
                  <th scope="col" className="px-6 py-3.5">Team member</th>
                  <th scope="col" className="px-5 py-3.5">Role</th>
                  <th scope="col" className="px-5 py-3.5">Date added</th>
                  <th scope="col" className="px-5 py-3.5 text-right">Manage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredUsers.map(u => {
                  const initials = u.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()
                  const roleTone = u.role === 'admin'
                    ? 'bg-violet-50 text-violet-700 ring-violet-600/10'
                    : u.role === 'system_owner'
                      ? 'bg-amber-50 text-amber-700 ring-amber-600/10'
                      : 'bg-teal-50 text-teal-700 ring-teal-600/10'

                  return (
                    <tr key={u.id} className="transition-colors hover:bg-slate-50/70">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-100 to-teal-100 text-xs font-bold text-[#243b80]">
                            {initials || <UserRound size={17} />}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-800">{u.name}</p>
                            <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-slate-400"><Mail size={12} />{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        {isOwner && u.role !== 'system_owner' ? <select
                          aria-label={`Role for ${u.name}`}
                          className="text-input"
                          value={u.role}
                          disabled={updatingId === u.id || deletingId === u.id}
                          onChange={event => { void handleRoleChange(u, event.target.value) }}
                        >
                          {u.role === 'staff' && <option value="staff">Staff</option>}
                          {allowedRoles.map(value => <option key={value} value={value}>{roleLabel(value)}</option>)}
                        </select> : <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${roleTone}`}>
                          <span className="size-1.5 rounded-full bg-current" />{roleLabel(u.role)}
                        </span>}
                      </td>
                      <td className="px-5 py-4 text-sm text-slate-500">
                        <span className="inline-flex items-center gap-2"><CalendarDays size={14} className="text-slate-400" />
                          {new Date(u.created_at).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        <button
                          className="rounded-lg px-3 py-2 text-xs font-semibold text-rose-600 transition hover:bg-rose-50 focus:outline-none focus:ring-4 focus:ring-rose-100"
                          disabled={deletingId === u.id || updatingId === u.id || u.role === 'system_owner'}
                          onClick={() => handleDelete(u.id, u.name)}
                          aria-label={`Delete ${u.name}`}
                        >
                          {deletingId === u.id ? 'Deleting…' : 'Remove'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {filteredUsers.length === 0 && (
              <div className="flex flex-col items-center px-6 py-14 text-center">
                <span className="mb-3 grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-400"><Users size={22} /></span>
                <p className="text-sm font-semibold text-slate-700">{users.length ? 'No matching users' : 'No team members yet'}</p>
                <p className="mt-1 max-w-sm text-xs text-slate-400">
                  {users.length ? 'Try another name, email address, or role.' : 'Add your first user to start building your team.'}
                </p>
              </div>
            )}
          </div>
        )}
        {!loading && users.length > 0 && (
          <div className="border-t border-slate-100 px-6 py-3 text-xs text-slate-400">
            Showing {filteredUsers.length} of {users.length} {users.length === 1 ? 'member' : 'members'}
          </div>
        )}
      </section>

      {showForm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/45 p-4 backdrop-blur-sm"
          onMouseDown={event => { if (event.target === event.currentTarget && !submitting) closeForm() }}
        >
          <section
            className="my-auto w-full max-w-xl overflow-hidden rounded-2xl bg-white shadow-2xl shadow-slate-950/20"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-user-title"
          >
            <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5 sm:px-7">
              <div>
                <span className="mb-3 grid size-10 place-items-center rounded-xl bg-blue-50 text-[#243b80]"><UserPlus size={19} /></span>
                <h2 id="add-user-title" className="text-xl font-bold tracking-tight text-slate-900">Add a team member</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {isOwner ? 'Create an account and choose their level of access.' : 'Create a standard user account for your team.'}
                </p>
              </div>
              <button
                type="button"
                className="grid size-9 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-4 focus:ring-slate-100"
                onClick={closeForm}
                disabled={submitting}
                aria-label="Close add user dialog"
              >
                <X size={18} />
              </button>
            </div>
            <form onSubmit={handleCreate} className="px-6 py-6 sm:px-7">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block text-sm font-medium text-slate-700">
                  Full name
                  <input className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-50" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Jane Muthoni" required autoFocus />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Email address
                  <input className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-50" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="jane@example.com" required />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Password
                  <input className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-50" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="At least 8 characters" required minLength={8} />
                </label>
                <label className="block text-sm font-medium text-slate-700">
                  Confirm password
                  <input className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-blue-400 focus:ring-4 focus:ring-blue-50" type="password" value={passwordConfirm} onChange={e => setPasswordConfirm(e.target.value)} placeholder="Enter password again" required minLength={8} />
                </label>
                <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
                  Role
                  <select className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-800 outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-50" value={role} onChange={e => setRole(e.target.value)}>
                    {allowedRoles.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}
                  </select>
                  <span className="mt-2 block text-xs text-slate-400">
                    {role === 'admin' ? 'Admins can sign in and create standard user accounts.' : 'Users can sign in with standard workspace access.'}
                  </span>
                </label>
              </div>
              {formError && <p role="alert" className="mt-4 rounded-xl border border-rose-100 bg-rose-50 px-3.5 py-3 text-sm text-rose-700">{formError}</p>}
              <div className="mt-6 flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end">
                <button type="button" className="h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-100" onClick={closeForm} disabled={submitting}>
                  Cancel
                </button>
                <button type="submit" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#243b80] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1b2b58] focus:outline-none focus:ring-4 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-60" disabled={submitting}>
                  {submitting ? 'Creating account…' : 'Create user'} {!submitting && <ArrowUpRight size={16} />}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  )
}
