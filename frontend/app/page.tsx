'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import BrandLoader from '../components/brand-loader'
import { WorkspaceShell, PROFILE_SECTION, canOpenSection, firstSection } from '../components/workspace-shell'
import { OverviewDashboard } from '../components/overview-dashboard'
import { LoginPage, type ResetLink } from '../components/auth-screens'
import { UsersView } from '../components/users-view'
import { SettingsView } from '../components/settings-view'
import { AuditView } from '../components/audit-view'
import { CustomerHome, ProfileView } from '../components/profile-view'
import { ErrorState } from '../components/ui-kit'
import { ApiError, UNAUTHORIZED_EVENT, tokenStore } from '../lib/api'
import { getCurrentUser, hasPermission, logout, type BookshopUser } from '../lib/auth'
import {
  ArrowUpRight,
  Bell,
  BookOpen,
  ChevronDown,
  CreditCard,
  FileSpreadsheet,
  Download,
  Info,
  Upload,
  MoreHorizontal,
  Plus,
  Search,
  ShoppingCart,
  Tags,
  Users,
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

// Modules below still run on sample data; they connect to live records in later phases.
const PREVIEW_MODULES: Record<string, string> = {
  'Dashboard': 'Phase 5', 'Point of Sale': 'Phase 3', 'Sales History': 'Phase 3', 'Products & Books': 'Phase 2',
  'Inventory & Stock': 'Phase 2', 'Suppliers': 'Phase 2', 'Customers': 'Phase 4', 'Reports & Analytics': 'Phase 5', 'Expenses': 'Phase 5',
}

function PreviewNotice({ section }: { section: string }) {
  return <div className="mx-[34px] mt-5 flex items-start gap-2.5 rounded-xl border border-pink-200 bg-pink-50/70 px-4 py-3 text-[13px] text-[#8a3a6a] max-sm:mx-4" role="note">
    <Info size={16} className="mt-0.5 shrink-0" /><span><strong>Preview with sample data.</strong> {section} connects to live shop records in {PREVIEW_MODULES[section]}; changes here are not saved.</span>
  </div>
}

function readResetLink(): ResetLink | null {
  const params = new URLSearchParams(window.location.search)
  const token = params.get('reset_token')
  const email = params.get('email')
  return token && email ? { token, email } : null
}

export default function Page() {
  const [active, setActive] = useState('Dashboard')
  const [query, setQuery] = useState('')
  const [cart, setCart] = useState<{ product: typeof products[number]; quantity: number }[]>([])
  const [showCheckout, setShowCheckout] = useState(false)
  const [payment, setPayment] = useState('M-Pesa')
  const [toast, setToast] = useState('')
  const [currentUser, setCurrentUser] = useState<BookshopUser | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [bootError, setBootError] = useState('')
  const [resetLink, setResetLink] = useState<ResetLink | null>(null)

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(current => current === message ? '' : current), 3500)
  }, [])

  const enterWorkspace = useCallback((user: BookshopUser) => {
    setCurrentUser(user)
    setActive(previous => canOpenSection(user, previous) ? previous : firstSection(user))
  }, [])

  const restoreSession = useCallback(() => {
    setBootError('')
    if (!tokenStore.get()) { setAuthLoading(false); return }
    setAuthLoading(true)
    getCurrentUser()
      .then(enterWorkspace)
      .catch((error: unknown) => {
        // Network failures keep the token so a retry can restore the session.
        if (error instanceof ApiError && error.status === 0) setBootError(error.message)
        else tokenStore.clear()
      })
      .finally(() => setAuthLoading(false))
  }, [enterWorkspace])

  useEffect(() => {
    setResetLink(readResetLink())
    restoreSession()
    function expired() {
      setCurrentUser(null)
      notify('Your session has ended. Please sign in again.')
    }
    window.addEventListener(UNAUTHORIZED_EVENT, expired)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, expired)
  }, [restoreSession, notify])

  async function signOut() {
    setCurrentUser(null)
    setActive('Dashboard')
    setCart([])
    setShowCheckout(false)
    await logout().catch(() => undefined)
  }

  function clearResetLink() {
    setResetLink(null)
    window.history.replaceState(null, '', window.location.pathname)
  }

  function navigateTo(section: string) {
    if (currentUser && canOpenSection(currentUser, section)) setActive(section)
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
    notify(`${product.name} added to cart`)
  }

  function updateQuantity(id: number, delta: number) {
    setCart((current) => current.flatMap((item) => {
      if (item.product.id !== id) return [item]
      const quantity = Math.min(item.product.stock, item.quantity + delta)
      return quantity > 0 ? [{ ...item, quantity }] : []
    }))
  }

  if (authLoading) return <BrandLoader />
  if (bootError) return <main className="brand-loading-screen"><div className="w-full max-w-md rounded-2xl bg-white shadow-sm"><ErrorState message={bootError} onRetry={restoreSession} /></div></main>
  if (!currentUser) return <>
    <LoginPage onLogin={enterWorkspace} resetLink={resetLink} onResetHandled={clearResetLink} />
    {toast && <div className="toast" role="status">{toast}</div>}
  </>

  const toastNode = toast && <div className="toast" role="status"><span className="toast-check">✓</span>{toast}</div>
  if (!hasPermission(currentUser, 'workspace.access')) return <>
    <CustomerHome currentUser={currentUser} onUpdated={setCurrentUser} notify={notify} onSignOut={() => void signOut()} />
    {toastNode}
  </>

  const view = !canOpenSection(currentUser, active)
    ? <section className="page-placeholder"><h1 tabIndex={-1}>Access restricted</h1><p>Your role does not include access to this section.</p></section>
    : active === 'Users' ? <UsersView currentUser={currentUser} notify={notify} />
    : active === 'Settings' ? <SettingsView currentUser={currentUser} notify={notify} />
    : active === 'Audit Log' ? <AuditView />
    : active === PROFILE_SECTION ? <ProfileView currentUser={currentUser} onUpdated={setCurrentUser} notify={notify} />
    : active === 'Point of Sale' ? <POSView filteredProducts={filteredProducts} query={query} setQuery={setQuery} cart={cart} addToCart={addToCart} updateQuantity={updateQuantity} subtotal={subtotal} tax={tax} total={total} setCart={setCart} setShowCheckout={setShowCheckout} />
    : active === 'Products & Books' ? <ProductsBooksView setToast={notify} />
    : active === 'Inventory & Stock' ? <InventoryView setToast={notify} />
    : active === 'Customers' ? <CustomersView setToast={notify} />
    : active === 'Suppliers' ? <SuppliersView setToast={notify} />
    : <Dashboard active={active} setActive={navigateTo} userName={currentUser.name} />

  return (
    <WorkspaceShell currentUser={currentUser} active={active} onNavigate={navigateTo} onSignOut={signOut}>
      {PREVIEW_MODULES[active] && canOpenSection(currentUser, active) && <PreviewNotice section={active} />}
      {view}

      {showCheckout && <div className="modal-backdrop"><div className="checkout-modal" role="dialog" aria-modal="true" aria-label="Complete sale"><div className="modal-header"><div><div className="eyebrow">CHECKOUT</div><h2>Complete sale</h2></div><button className="icon-button" onClick={() => setShowCheckout(false)}><X size={18} /></button></div><div className="checkout-total"><span>Total due</span><strong>{money(total)}</strong></div><div className="payment-tabs">{['Cash', 'M-Pesa', 'Card', 'Bank transfer'].map((method) => <button key={method} className={payment === method ? 'selected' : ''} onClick={() => setPayment(method)}>{method}</button>)}</div><label className="field-label">{payment === 'M-Pesa' ? 'M-Pesa transaction code' : 'Payment reference'}<input className="text-input" placeholder={payment === 'M-Pesa' ? 'e.g. QKL7H2M1' : 'Optional reference'} /></label><label className="field-label">Amount received<input className="text-input" defaultValue={total.toFixed(2)} /></label><div className="change-row"><span>Change due</span><strong>{money(0)}</strong></div><button className="primary-button full" onClick={() => { setShowCheckout(false); setCart([]); notify('Sale completed · Receipt #NS-10483') }}>Confirm payment <ArrowUpRight size={16} /></button><p className="secure-note">Demo payment · No external gateway connected</p></div></div>}
      {toastNode}
    </WorkspaceShell>
  )
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

