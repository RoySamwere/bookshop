'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from '@/lib/navigation'
import BrandLoader from './brand-loader'
import { WorkspaceShell, PROFILE_SECTION, canOpenSection, firstSection } from './workspace-shell'
import { OverviewDashboard } from './overview-dashboard'
import { UsersView } from './users-view'
import { InventoryView } from './inventory-view'
import { StockTakingView } from './stock-taking-view'
import { PosTerminal } from './pos/pos-terminal'
import { SalesHistoryView } from './sales-history-view'
import { SettingsView } from './settings-view'
import { AuditView } from './audit-view'
import { ProfileView } from './profile-view'
import { BookshopAdminView } from './bookshop-admin-view'
import { SuspendedNotice } from './onboarding'
import { AuthShell } from './auth/auth-shell'
import { ErrorState } from './ui-kit'
import { API_BASE, ApiError, UNAUTHORIZED_EVENT, sessionStore, api } from '../lib/api'
import { getCurrentUser, hasPermission, homeFor, logout, needsOnboarding, type BookshopUser } from '../lib/auth'
import { sessionLoginUrl } from '../lib/session'
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
  'Customers': 'Phase 4', 'Reports & Analytics': 'Phase 5', 'Expenses': 'Phase 5',
}

function PreviewNotice({ section }: { section: string }) {
  return <div className="mx-[34px] mt-5 flex items-start gap-2.5 rounded-xl border border-pink-200 bg-pink-50/70 px-4 py-3 text-[13px] text-[#8a3a6a] max-sm:mx-4" role="note">
    <Info size={16} className="mt-0.5 shrink-0" /><span><strong>Preview with sample data.</strong> {section} connects to live shop records in {PREVIEW_MODULES[section]}; changes here are not saved.</span>
  </div>
}

/** The protected management system at /dashboard. Visitors without a valid staff session are sent to sign in. */
export function WorkspaceApp() {
  const router = useRouter()
  const [active, setActive] = useState('Dashboard')
  const [stockSelection, setStockSelection] = useState<{ id: number; title: string; sku: string; is_active: boolean } | null>(null)
  const [query, setQuery] = useState('')
  const [cart, setCart] = useState<{ product: typeof products[number]; quantity: number }[]>([])
  const [showCheckout, setShowCheckout] = useState(false)
  const [payment, setPayment] = useState('M-Pesa')
  const [toast, setToast] = useState('')
  const [currentUser, setCurrentUser] = useState<BookshopUser | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [bootError, setBootError] = useState('')

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(current => current === message ? '' : current), 3500)
  }, [])

  const enterWorkspace = useCallback((user: BookshopUser) => {
    // Customers, applicants, platform staff and owners still verifying have no workspace here.
    if ((user.account_type === 'platform' && !user.management_context) || !hasPermission(user, 'workspace.access') || needsOnboarding(user)) { router.replace(homeFor(user)); return }
    setCurrentUser(user)
    const requested = new URLSearchParams(window.location.search).get('section')
    setActive(previous => requested && canOpenSection(user, requested) ? requested : canOpenSection(user, previous) ? previous : firstSection(user))
  }, [router])

  const restoreSession = useCallback(() => {
    setBootError('')
    setAuthLoading(true)
    getCurrentUser()
      .then(user => { enterWorkspace(user); setAuthLoading(false) })
      .catch((error: unknown) => {
        // Network failures keep the token so a retry can restore the session.
        if (error instanceof ApiError && error.status === 0) { setBootError(error.message); setAuthLoading(false); return }
        sessionStore.clear()
        router.replace(sessionLoginUrl('expired', window.location))
      })
  }, [enterWorkspace, router])

  useEffect(() => {
    restoreSession()
    function expired(event: Event) {
      setCurrentUser(null)
      router.replace(sessionLoginUrl((event as CustomEvent).detail?.reason === 'idle' ? 'idle' : 'expired', window.location))
    }
    window.addEventListener(UNAUTHORIZED_EVENT, expired)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, expired)
  }, [restoreSession, router])

  async function signOut() {
    try {
      await logout()
      setCart([])
      setShowCheckout(false)
      router.replace('/login?signed_out=1')
    } catch (error) { notify(error instanceof Error ? error.message : 'Unable to sign out. Try again.') }
  }

  function navigateTo(section: string) {
    if (currentUser && canOpenSection(currentUser, section)) {
      setActive(section)
      const url = new URL(window.location.href)
      url.searchParams.set('section', section)
      window.history.replaceState(null, '', url.pathname + url.search + url.hash)
    }
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

  if (bootError) return <main className="brand-loading-screen"><div className="w-full max-w-md rounded-2xl bg-white shadow-sm"><ErrorState message={bootError} onRetry={restoreSession} /></div></main>
  if (authLoading || !currentUser) return <BrandLoader />

  const toastNode = toast && <div className="toast" role="status"><span className="toast-check">✓</span>{toast}</div>

  // The server refuses every workspace request in these states; explain instead of showing failing screens.
  const blocked = currentUser.bookshop?.status === 'suspended' ? <SuspendedNotice reason={currentUser.bookshop.suspension_reason} />
    : !currentUser.bookshop ? <><h2 tabIndex={-1}>Not linked to a bookshop</h2><p className="hk-auth-lede">Your account is not part of a bookshop yet. Ask your administrator to finish moving your shop to the new bookshop setup.</p></>
    : null
  if (blocked) return <AuthShell story={{ title: 'Workspace unavailable.', body: 'Your records are kept safe while access is paused.' }}>{blocked}<p className="hk-auth-alt"><button type="button" className="hk-auth-link" onClick={() => void signOut()}>Sign out</button></p></AuthShell>

  const view = !canOpenSection(currentUser, active)
    ? <section className="page-placeholder"><h1 tabIndex={-1}>Access restricted</h1><p>Your role does not include access to this section.</p></section>
    : active === 'Users' ? <UsersView currentUser={currentUser} notify={notify} />
    : active === 'Settings' ? <SettingsView currentUser={currentUser} notify={notify} />
    : active === 'Audit Log' ? <AuditView />
    : active === 'My Bookshop' ? <BookshopAdminView currentUser={currentUser} notify={notify} onNavigate={navigateTo} />
    : active === PROFILE_SECTION ? <ProfileView currentUser={currentUser} onUpdated={setCurrentUser} notify={notify} />
    : active === 'Point of Sale' ? <PosTerminal currentUser={currentUser} notify={notify} onExit={() => navigateTo(canOpenSection(currentUser, 'Dashboard') ? 'Dashboard' : firstSection(currentUser))} onNavigate={navigateTo} />
    : active === 'Sales History' ? <SalesHistoryView />
    : active === 'Products & Books' ? <ProductsBooksView setToast={notify} onAssign={book => { setStockSelection(book); navigateTo('Inventory & Stock') }} canAssign={hasPermission(currentUser, 'inventory.manage') && canOpenSection(currentUser, 'Inventory & Stock')} canEdit={hasPermission(currentUser, 'catalog.manage')} />
    : active === 'Inventory & Stock' ? <InventoryView currentUser={currentUser} notify={notify} stockSelection={stockSelection} onSelectionConsumed={() => setStockSelection(null)} />
    : active === 'Stock Taking' ? <StockTakingView currentUser={currentUser} notify={notify} />
    : active === 'Customers' ? <CustomersView setToast={notify} />
    : active === 'Suppliers' ? <SuppliersView setToast={notify} />
    : <Dashboard active={active} setActive={navigateTo} currentUser={currentUser} />

  return (
    <WorkspaceShell currentUser={currentUser} active={active} onNavigate={navigateTo} onSignOut={signOut}>
      {PREVIEW_MODULES[active] && canOpenSection(currentUser, active) && <PreviewNotice section={active} />}
      {view}

      {showCheckout && <div className="modal-backdrop"><div className="checkout-modal" role="dialog" aria-modal="true" aria-label="Complete sale"><div className="modal-header"><div><div className="eyebrow">CHECKOUT</div><h2>Complete sale</h2></div><button className="icon-button" onClick={() => setShowCheckout(false)}><X size={18} /></button></div><div className="checkout-total"><span>Total due</span><strong>{money(total)}</strong></div><div className="payment-tabs">{['Cash', 'M-Pesa', 'Card', 'Bank transfer'].map((method) => <button key={method} className={payment === method ? 'selected' : ''} onClick={() => setPayment(method)}>{method}</button>)}</div><label className="field-label">{payment === 'M-Pesa' ? 'M-Pesa transaction code' : 'Payment reference'}<input className="text-input" placeholder={payment === 'M-Pesa' ? 'e.g. QKL7H2M1' : 'Optional reference'} /></label><label className="field-label">Amount received<input className="text-input" defaultValue={total.toFixed(2)} /></label><div className="change-row"><span>Change due</span><strong>{money(0)}</strong></div><button className="primary-button full" onClick={() => { setShowCheckout(false); setCart([]); notify('Sale completed · Receipt #NS-10483') }}>Confirm payment <ArrowUpRight size={16} /></button><p className="secure-note">Demo payment · No external gateway connected</p></div></div>}
      {toastNode}
    </WorkspaceShell>
  )
}

function Dashboard({ active, setActive, currentUser }: { active: string; setActive: (value: string) => void; currentUser: BookshopUser }) {
  if (active !== 'Dashboard') return <section className="page-placeholder"><div className="empty-icon"><Tags size={24} /></div><h1 tabIndex={-1}>{active}</h1><p>This workspace is ready for your daily operations. Use the dashboard or point of sale to get started.</p><button className="primary-button" onClick={() => setActive('Point of Sale')}>Open Point of Sale <ArrowUpRight size={16} /></button></section>
  return <OverviewDashboard userName={currentUser.name} currentUser={currentUser} onNavigate={setActive} />
}
function ProductsBooksView({ setToast, onAssign, canAssign, canEdit }: { setToast: (message: string) => void; onAssign: (book: { id: number; title: string; sku: string; is_active: boolean }) => void; canAssign: boolean; canEdit: boolean }) {
  type BookRow={id:number;title:string;sku:string;isbn:string|null;selling_price:string|number;cost_price?:string|number;reorder_level?:number;cover_url?:string|null;category_name?:string|null;subcategory_name?:string|null;is_active?:boolean}
  const [books,setBooks]=useState<BookRow[]>([])
  const [stockTotals,setStockTotals]=useState<Record<number,{quantity:number;reserved:number;stock_locations:number}>>({})
  const [stockLoading,setStockLoading]=useState(false)
  const [stockError,setStockError]=useState('')
  const [uploadOpen,setUploadOpen]=useState(false)
  const [uploadBusy,setUploadBusy]=useState(false)
  const [uploadError,setUploadError]=useState('')
  const [uploadRows,setUploadRows]=useState<{title:string;sku:string;product_subcategory_id:number;cost_price:number;selling_price:number}[]>([])
  const [hierarchy,setHierarchy]=useState<{id:number;name:string;subcategories:{id:number;name:string}[]}[]>([])
  const [editing,setEditing]=useState<BookRow|null>(null)
  const [saving,setSaving]=useState(false)
  const [editError,setEditError]=useState('')
  const [count,setCount]=useState(0)
  const [page,setPage]=useState(1)
  const [lastPage,setLastPage]=useState(1)
  const [query,setQuery]=useState('')
  const [search,setSearch]=useState('')
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  useEffect(()=>{if(!uploadOpen)return;api<{id:number;name:string;subcategories:{id:number;name:string}[]}[]>('/product-hierarchy').then(setHierarchy).catch(e=>setUploadError(e instanceof Error?e.message:'Could not load categories'))},[uploadOpen])
  async function downloadTemplate(){const headers=['Category','Subcategory','Product Name','SKU','Cost Price','Selling Price'];const csv=[headers.join(','),[hierarchy[0]?.name??'',hierarchy[0]?.subcategories[0]?.name??'','Example Product','EXAMPLE-001','25','40'].map(v=>'"'+v.replaceAll('"','""')+'"').join(',')].join('\r\n');const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='hekima-products-template.csv';link.click();URL.revokeObjectURL(url)}
  async function readProducts(file:File|undefined){setUploadRows([]);setUploadError('');if(!file)return;try{
    if(!/\.csv$/i.test(file.name))throw Error(`Choose a .csv file. Selected: ${file.name}`)
    if(file.size>5_000_000)throw Error('CSV file must be no larger than 5 MB')
    const text=(await file.text()).replace(/^\uFEFF/,'')
    const records:string[][]=[];let row:string[]=[],cell='',quoted=false
    for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(ch===','&&!quoted){row.push(cell.trim());cell=''}else if((ch==='\n'||ch==='\r')&&!quoted){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell.trim());if(row.some(v=>v))records.push(row);row=[];cell=''}else cell+=ch}
    if(quoted)throw Error('Invalid CSV: unclosed quoted field')
    row.push(cell.trim());if(row.some(v=>v))records.push(row)
    if(records.length<2)throw Error('CSV contains no product rows')
    const normalized=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'')
    const header=records[0].map(normalized)
    const keys=['Category','Subcategory','Product Name','SKU','Cost Price','Selling Price'].map(normalized)
    const indexes=keys.map(k=>header.indexOf(k))
    if(indexes.some(i=>i<0))throw Error('CSV columns must be: Category, Subcategory, Product Name, SKU, Cost Price, Selling Price')
    const rows:typeof uploadRows=[],errors:string[]=[]
    const clean=(value:string)=>value.trim().replace(/\s+/g,' ').toLowerCase()
    records.slice(1).forEach((record,i)=>{
      const line=i+2
      const [cat,sub,title,sku,cost,selling]=indexes.map(n=>record[n]?.trim()??'')
      const problems:string[]=[]
      const group=hierarchy.find(c=>clean(c.name)===clean(cat))
      const match=group?.subcategories.find(x=>clean(x.name)===clean(sub))
      if(!cat)problems.push('Category is blank')
      else if(!group)problems.push('Category "'+cat+'" not found. Available: '+hierarchy.map(x=>x.name).slice(0,10).join(', '))
      if(!sub)problems.push('Subcategory is blank')
      else if(group&&!match)problems.push('Subcategory "'+sub+'" does not belong to "'+group.name+'". Available: '+group.subcategories.map(x=>x.name).slice(0,10).join(', '))
      if(!title)problems.push('Product Name is blank')
      if(!sku)problems.push('SKU is blank')
      for(const [label,value] of [['Cost Price',cost],['Selling Price',selling]]){
        if(!value)problems.push(label+' is blank')
        else if(!Number.isFinite(Number(value))||Number(value)<0)problems.push(label+' "'+value+'" is invalid; enter a number like 150.50 without KES or commas')
      }
      if(problems.length){errors.push('Row '+line+': '+problems.join('; '));return}
      rows.push({title,sku,product_subcategory_id:match!.id,cost_price:Number(cost),selling_price:Number(selling)})
    })
    if(errors.length)throw Error('Correct these rows before uploading:\n'+errors.slice(0,40).join('\n')+(errors.length>40?'\n...and '+(errors.length-40)+' more rows.':''))
    if(rows.length>200)throw Error('Upload up to 200 products per batch')
    if(new Set(rows.map(r=>r.sku.toLowerCase())).size!==rows.length)throw Error('Duplicate SKU found in CSV')
    setUploadRows(rows)
  }catch(e){setUploadError(e instanceof Error?e.message:'Could not read CSV')}}
    async function submitProducts(){if(!uploadRows.length||uploadBusy)return;setUploadBusy(true);setUploadError('');try{await api('/books-bulk-create',{method:'POST',body:{rows:uploadRows}});setToast(`${uploadRows.length} products added to your catalogue`);setUploadOpen(false);setUploadRows([]);setPage(1);await load()}catch(e){setUploadError(e instanceof Error?e.message:'Upload failed')}finally{setUploadBusy(false)}}
  async function saveProduct(event: React.FormEvent) { event.preventDefault(); if (!editing || saving) return; setSaving(true);setEditError('');try { await api(`/books/${editing.id}`,{method:'PATCH',body:{title:editing.title,sku:editing.sku,isbn:editing.isbn||null,cover_url:editing.cover_url||null,cost_price:Number(editing.cost_price??0),selling_price:Number(editing.selling_price),reorder_level:Number(editing.reorder_level??10)}});setEditing(null);setToast('Product details saved');await load() }catch(e){setEditError(e instanceof Error?e.message:'Unable to save product')}finally{setSaving(false)} }
  const load=useCallback(async()=>{
    setLoading(true)
    try{const r=await api<{data:BookRow[];total:number;last_page:number}>('/books',{query:{page,per_page:30,search}})
      setBooks(r.data);setCount(r.total);setLastPage(Math.max(1,r.last_page));setError('')
    }catch(e){setError(e instanceof Error?e.message:'Unable to load products')}finally{setLoading(false)}
  },[page,search])
  useEffect(()=>{void load()},[load])
  useEffect(()=>{
    if(!books.length){setStockTotals({});setStockError('');return}
    let active=true
    setStockLoading(true);setStockError('')
    api<{book_id:number;quantity:number;reserved:number;stock_locations:number}[]>('/inventory/catalogue-stock-summary',{method:'POST',body:{book_ids:books.map(b=>b.id)}})
      .then(rows=>{if(active)setStockTotals(Object.fromEntries(rows.map(row=>[row.book_id,{quantity:Number(row.quantity),reserved:Number(row.reserved),stock_locations:Number(row.stock_locations)}])))})
      .catch(e=>{if(active){setStockTotals({});setStockError(e instanceof Error?e.message:'Stock quantities unavailable')}})
      .finally(()=>{if(active)setStockLoading(false)})
    return()=>{active=false}
  },[books])

  useEffect(()=>{const t=window.setTimeout(()=>{setPage(1);setSearch(query.trim())},250);return()=>window.clearTimeout(t)},[query])
  return <main className="mx-auto w-full min-w-0 max-w-[1600px] space-y-4 px-2 pb-8 sm:px-4">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-widest text-teal-700">Catalogue</p><h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Products &amp; Books</h1><p className="mt-1 text-sm text-slate-500">Your shop's registered products, all in one place.</p></div>
      <div className="rounded-xl border border-slate-200 bg-white px-5 py-3 shadow-sm"><p className="text-xs font-medium text-slate-500">Total products</p><p className="text-2xl font-bold tabular-nums text-slate-900">{count.toLocaleString('en-KE')}</p></div>
    </div>
    {canEdit && <div className="flex flex-wrap items-center justify-end gap-2"><button type="button" onClick={()=>{setUploadError('');setUploadOpen(true)}} className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white hover:bg-teal-800"><Upload size={15}/> Upload products</button></div>}
    <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 md:flex-row md:items-center md:justify-between">
        <div><h2 className="text-base font-semibold text-slate-900">All products</h2><p className="text-xs text-slate-500">View product details and selling prices</p></div>
        <div className="relative w-full md:max-w-sm"><Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input aria-label="Search products" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search by name, SKU or ISBN" className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-10 pr-14 text-sm text-slate-900 outline-none focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-100"/>{query&&<button type="button" onClick={()=>setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-teal-700">Clear</button>}</div>
      </div>
      {error?<div role="alert" className="p-8 text-center text-sm text-red-700"><p>{error}</p><button type="button" onClick={()=>void load()} className="mt-3 rounded-lg border border-red-200 px-4 py-2 font-semibold hover:bg-red-50">Retry</button></div>:loading?<div className="space-y-3 p-5">{[1,2,3,4].map(n=><div key={n} className="h-12 animate-pulse rounded-lg bg-slate-100"/>)}</div>:books.length===0?<div className="flex flex-col items-center px-6 py-16 text-center"><div className="rounded-2xl bg-slate-100 p-4 text-slate-400"><BookOpen size={28}/></div><h3 className="mt-4 font-semibold text-slate-900">{search?'No products found':'No products yet'}</h3><p className="mt-1 max-w-sm text-sm text-slate-500">{search?'Try another product name or SKU.':'Products you receive or bulk upload in Inventory & Stock will appear here automatically.'}</p></div>:<div className="overflow-x-auto"><table className="w-full min-w-[640px] border-collapse text-left text-xs sm:text-sm"><thead><tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold uppercase tracking-wide text-slate-500"><th scope="col" className="px-3 py-2.5">Product</th><th scope="col" className="px-5 py-3.5">SKU</th><th scope="col" className="px-5 py-3.5">Category</th><th scope="col" className="px-5 py-3.5 text-right">Selling price</th><th scope="col" className="px-5 py-3.5">Status</th>{(canAssign||canEdit) && <th scope="col" className="px-5 py-3.5">Action</th>}</tr></thead><tbody className="divide-y divide-slate-100">{books.map(book=><tr key={book.id} className="hover:bg-teal-50/40"><td className="px-3 py-2.5"><div className="font-semibold text-slate-900">{book.title}</div>{book.isbn&&<div className="mt-1 text-xs text-slate-400">ISBN: {book.isbn}</div>}</td><td className="px-5 py-4 font-mono text-xs text-slate-600">{book.sku}</td><td className="px-5 py-4 text-slate-600">{book.subcategory_name||book.category_name||'—'}</td><td className="px-5 py-4 text-right font-semibold tabular-nums text-slate-900">{money(Number(book.selling_price))}</td><td className="px-5 py-4"><span className={book.is_active===false?'inline-flex rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600':'inline-flex rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700'}>{book.is_active===false?'Inactive':'Active'}</span></td>{(canAssign||canEdit) && <td className="px-5 py-4"><div className="flex flex-wrap gap-1.5">{canEdit && <button type="button" onClick={() => { setEditing({...book});setEditError('') }} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-semibold">Edit</button>}{stockTotals[book.id]?.stock_locations>0 ? <span className="inline-flex flex-col rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800"><span>In stock · {stockTotals[book.id].quantity.toLocaleString('en-KE')} units</span><span className="font-normal text-emerald-700">{(stockTotals[book.id].quantity-stockTotals[book.id].reserved).toLocaleString('en-KE')} available</span></span> : stockLoading ? <span className="text-xs text-slate-500">Checking stock…</span> : stockError ? <span className="text-xs text-amber-700" title={stockError}>Stock unavailable</span> : canAssign && <button type="button" disabled={book.is_active===false} onClick={() => onAssign({ id: book.id, title: book.title, sku: book.sku, is_active: book.is_active !== false })} className="rounded-lg bg-teal-700 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-teal-800 disabled:opacity-50">Assign to stock</button>}</div></td>}</tr>)}</tbody></table></div>}
      {!error&&!loading&&books.length>0&&<footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4"><span className="text-xs text-slate-500">Page {page} of {lastPage} · {count.toLocaleString('en-KE')} products</span><div className="flex gap-2"><button type="button" disabled={page<=1} onClick={()=>setPage(p=>p-1)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Previous</button><button type="button" disabled={page>=lastPage} onClick={()=>setPage(p=>p+1)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">Next</button></div></footer>}
    </section>
    {uploadOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3"><section role="dialog" aria-modal="true" aria-label="Upload catalogue products" className="w-full max-w-lg space-y-4 rounded-xl bg-white p-5 shadow-2xl"><div><h2 className="text-lg font-bold">Upload products to catalogue</h2><p className="mt-1 text-xs text-slate-500">Upload initial products without adding stock. Shop owners can find them and use Assign to stock to receive quantities separately.</p></div><button type="button" onClick={()=>void downloadTemplate()} disabled={!hierarchy.length} className="rounded-lg border border-teal-300 px-3 py-2 text-xs font-semibold text-teal-800">Download CSV template</button><label className="block space-y-1 text-xs font-semibold">Select completed CSV file (.csv)<input type="file" accept=".csv,text/csv" onChange={e=>void readProducts(e.target.files?.[0])} className="block w-full rounded-lg border border-slate-200 p-2 text-xs"/></label>{uploadRows.length>0&&<p className="text-xs text-emerald-700">{uploadRows.length} valid products ready. Existing SKUs will be rejected; no stock quantities will change.</p>}{uploadError&&<p role="alert" className="text-xs text-rose-700">{uploadError}</p>}<div className="flex justify-end gap-2"><button type="button" disabled={uploadBusy} onClick={()=>setUploadOpen(false)} className="rounded-lg border px-4 py-2 text-xs">Cancel</button><button type="button" disabled={uploadBusy||!uploadRows.length} onClick={()=>void submitProducts()} className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">{uploadBusy?'Uploading…':`Upload ${uploadRows.length} products`}</button></div></section></div>}
    {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3" role="presentation" onMouseDown={event => { if(event.target===event.currentTarget&&!saving)setEditing(null) }}><section role="dialog" aria-modal="true" aria-label="Edit product" className="w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl max-h-[90vh]"><h2 className="text-lg font-bold">Edit product</h2><p className="mb-4 text-xs text-slate-500">Update catalogue details. Receive stock separately to maintain inventory movement history.</p><form onSubmit={event => void saveProduct(event)} className="grid gap-3">{([['title','Product name'],['sku','SKU'],['isbn','ISBN'],['cover_url','Product image URL'],['cost_price','Cost price'],['selling_price','Selling price'],['reorder_level','Reorder level']] as const).map(([key,label])=><label key={key} className="grid gap-1 text-xs font-semibold text-slate-700">{label}<input className="rounded-lg border border-slate-200 px-3 py-2 text-sm" required={key==='title'||key==='sku'} type={key==='cost_price'||key==='selling_price'||key==='reorder_level'?'number':key==='cover_url'?'url':'text'} min={key==='cost_price'||key==='selling_price'||key==='reorder_level'?0:undefined} step={key==='reorder_level'?'1':key==='cost_price'||key==='selling_price'?'0.01':undefined} value={String(editing[key]??'')} onChange={e=>setEditing({...editing,[key]:e.target.value})}/></label>)}{editError&&<p role="alert" className="text-xs text-rose-600">{editError}</p>}<div className="flex justify-end gap-2"><button type="button" disabled={saving} className="rounded-lg border px-4 py-2 text-sm" onClick={()=>setEditing(null)}>Cancel</button><button disabled={saving} className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-semibold text-white">{saving?'Saving…':'Save product'}</button></div></form></section></div>}
  </main>
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
  type Supplier = { id:number; name:string; contact_person:string|null; phone:string|null; email:string|null; address:string|null; tax_pin:string|null; is_active:boolean }
  const empty = { name:'',contact_person:'',phone:'',email:'',address:'',tax_pin:'' }
  const [rows,setRows] = useState<Supplier[]>([])
  const [search,setSearch] = useState('')
  const [statusFilter,setStatusFilter]=useState<'all'|'active'|'inactive'>('all')
  const [page,setPage] = useState(1)
  const [lastPage,setLastPage] = useState(1)
  const [total,setTotal] = useState(0)
  const [showForm,setShowForm] = useState(false)
  const [form,setForm] = useState(empty)
  const [loading,setLoading] = useState(false)
  const [saving,setSaving] = useState(false)
  const [error,setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result=await api<{data:Supplier[];total:number;last_page:number}>('/suppliers',{query:{page,search}})
      setRows(result.data);setTotal(result.total);setLastPage(result.last_page);setError('')
    } catch(e){setError(e instanceof Error?e.message:'Unable to load suppliers')}
    finally{setLoading(false)}
  },[page,search])
  useEffect(()=>{void load()},[load])
  async function saveSupplier(event:React.FormEvent<HTMLFormElement>){
    event.preventDefault();setSaving(true);setError('')
    try {
      await api('/suppliers',{method:'POST',body:form})
      setShowForm(false);setForm(empty);setPage(1);await load();setToast('Supplier saved successfully')
    }catch(e){setError(e instanceof Error?e.message:'Unable to save supplier')}
    finally{setSaving(false)}
  }
  function exportCsv(){
    const quote=(v:unknown)=>'"'+String(v??'').replaceAll('"','""')+'"'
    const csv=[['Name','Contact','Phone','Email','Address','KRA PIN','Status'],...rows.map(x=>[x.name,x.contact_person,x.phone,x.email,x.address,x.tax_pin,x.is_active?'Active':'Inactive'])].map(x=>x.map(quote).join(',')).join('\n')
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
    const a=document.createElement('a');a.href=url;a.download='hekima-suppliers-page.csv';a.click();URL.revokeObjectURL(url)
  }
  return <div className="min-w-0 space-y-5 bg-[#f8fafc] px-3 py-5 sm:px-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><h1 tabIndex={-1} className="text-2xl font-bold tracking-tight text-slate-900">Suppliers</h1><p className="mt-1 text-sm text-slate-500">Manage suppliers and their contacts for stock receiving.</p></div><button type="button" className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-3 text-sm font-semibold text-white hover:bg-teal-800" onClick={()=>setShowForm(true)}><Plus size={16}/> New Supplier</button></header>
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">Suppliers must be registered before receiving stock. Adding a supplier does not change inventory quantities.</div>
    <nav aria-label="Supplier status" className="flex flex-wrap gap-6 border-b border-slate-200 text-sm font-semibold">{([{value:'all',label:'All Suppliers'},{value:'active',label:'Active'},{value:'inactive',label:'Inactive'}] as const).map(tab=><button type="button" key={tab.value} aria-pressed={statusFilter===tab.value} onClick={()=>setStatusFilter(tab.value)} className={statusFilter===tab.value?'border-b-[3px] border-teal-700 pb-3 text-teal-800':'border-b-[3px] border-transparent pb-3 text-slate-500 hover:text-teal-700'}>{tab.label}</button>)}</nav>
    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px_auto]"><label className="relative block"><Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"/><input aria-label="Search suppliers" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Search supplier or company name…" className="w-full rounded-lg border border-slate-200 bg-white py-3 pl-10 pr-3 text-sm outline-none focus:border-teal-600"/></label><select aria-label="Filter supplier status" value={statusFilter} onChange={e=>setStatusFilter(e.target.value as typeof statusFilter)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select><button type="button" className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50" onClick={exportCsv}><Download size={16}/> Export current page</button></div>
    {error&&<div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error} <button className="underline" onClick={()=>void load()}>Retry</button></div>}
    <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white"><div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3">Supplier / Company</th><th className="px-4 py-3">Contact Person</th><th className="px-4 py-3">Phone</th><th className="px-4 py-3">Email</th><th className="px-4 py-3">KRA PIN</th><th className="px-4 py-3">Status</th></tr></thead><tbody className="divide-y divide-slate-100">{rows.filter(x=>statusFilter==='all'||(statusFilter==='active'?x.is_active:!x.is_active)).map(x=><tr key={x.id} className="hover:bg-teal-50/30"><td className="px-4 py-3"><strong className="text-slate-900">{x.name}</strong>{x.address&&<p className="mt-1 text-xs text-slate-500">{x.address}</p>}</td><td className="px-4 py-3 text-slate-600">{x.contact_person||'—'}</td><td className="px-4 py-3 text-slate-700">{x.phone||'—'}</td><td className="px-4 py-3 text-slate-600">{x.email||'—'}</td><td className="px-4 py-3 text-slate-600">{x.tax_pin||'—'}</td><td className="px-4 py-3"><span className={x.is_active?'rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700':'rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600'}>{x.is_active?'Active':'Inactive'}</span></td></tr>)}{!loading&&rows.length===0&&<tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No suppliers found. Add your first supplier.</td></tr>}{loading&&<tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading suppliers…</td></tr>}</tbody></table></div><footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500"><span>Showing {rows.length} of {total} suppliers · Page {page} of {Math.max(1,lastPage)}</span><div className="flex gap-2"><button className="rounded-lg border px-3 py-2 disabled:opacity-40" disabled={page<=1||loading} onClick={()=>setPage(p=>p-1)}>Previous</button><button className="rounded-lg border px-3 py-2 disabled:opacity-40" disabled={page>=lastPage||loading} onClick={()=>setPage(p=>p+1)}>Next</button></div></footer></section>
    {showForm&&<div className="modal-backdrop"><form className="checkout-modal" onSubmit={saveSupplier}><div className="modal-header"><div><div className="eyebrow">SUPPLIER DIRECTORY</div><h2>Add supplier</h2></div><button type="button" className="icon-button" onClick={()=>setShowForm(false)} aria-label="Close"><X size={18}/></button></div><div className="form-grid">{(['name','contact_person','phone','email','address','tax_pin'] as const).map(field=><label key={field} className="field-label">{({name:'Company name',contact_person:'Contact person',phone:'Phone number',email:'Email address',address:'Physical address',tax_pin:'KRA PIN'})[field]}<input className="text-input" required={field==='name'} type={field==='email'?'email':'text'} value={form[field]} onChange={e=>setForm(v=>({...v,[field]:e.target.value}))}/></label>)}</div><button className="primary-button full" disabled={saving} type="submit">{saving?'Saving…':'Save supplier'} <ArrowUpRight size={16}/></button></form></div>}
  </div>
}

function POSView({ filteredProducts, query, setQuery, cart, addToCart, updateQuantity, subtotal, tax, total, setCart, setShowCheckout }: any) { return <div className="pos-page"><div className="page-heading compact"><div><div className="eyebrow">SALES TERMINAL · REGISTER 01</div><h1 tabIndex={-1}>Point of Sale</h1><p>Serve customers quickly and keep your records accurate.</p></div><div className="register-actions"><button className="secondary-button" onClick={() => { const demoItems = products.filter((product) => [1, 3, 4].includes(product.id)).map((product, index) => ({ product, quantity: index === 0 ? 1 : index === 1 ? 2 : 3 })); setCart(demoItems); }}>Load demo sale</button><div className="register-status"><span className="status-dot" /> Register open</div></div></div><div className="pos-layout"><section className="product-panel card"><div className="pos-search"><Search size={18} /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by product, ISBN or SKU..." /><kbd>/</kbd></div><div className="category-tabs"><button className="selected">All products</button><button>Textbooks</button><button>Stationery</button><button>Exercise books</button><button>Revision</button></div><div className="product-grid">{filteredProducts.map((product: typeof products[number]) => <button className="product-card" key={product.id} onClick={() => addToCart(product)} disabled={product.stock === 0}><div className={`product-art ${product.tone}`}><BookOpen size={24} /><span>{product.category === 'Stationery' ? 'STATIONERY' : product.category.toUpperCase()}</span></div><div className="product-info"><strong>{product.name}</strong><span>{product.sku} · {product.stock === 0 ? 'Out of stock' : `${product.stock} in stock`}</span><b>{money(product.price)}</b></div><Plus className="add-icon" size={17} /></button>)}</div></section><aside className="cart-panel card"><div className="cart-heading"><div><h2>Current sale</h2><span>{cart.reduce((s: number, i: any) => s + i.quantity, 0)} items</span></div>{cart.length > 0 && <button className="clear-button" onClick={() => setCart([])}>Clear</button>}</div><div className="customer-select"><Users size={16} /><span>Walk-in customer</span><ChevronDown size={15} /></div><div className="cart-items">{cart.length === 0 ? <div className="cart-empty"><ShoppingCart size={27} /><strong>Your cart is empty</strong><span>Select a product to start a sale</span></div> : cart.map((item: any) => <div className="cart-item" key={item.product.id}><div className={`mini-art ${item.product.tone}`}><BookOpen size={15} /></div><div className="cart-item-info"><strong>{item.product.name}</strong><span>{money(item.product.price)} each</span><div className="qty"><button onClick={() => updateQuantity(item.product.id, -1)}>−</button><b>{item.quantity}</b><button onClick={() => updateQuantity(item.product.id, 1)}>+</button></div></div><strong>{money(item.product.price * item.quantity)}</strong></div>)}</div><div className="totals"><div><span>Subtotal</span><b>{money(subtotal)}</b></div><div><span>Tax <small>(16%)</small></span><b>{money(tax)}</b></div><div className="total-line"><span>Total due</span><strong>{money(total)}</strong></div></div><button className="primary-button full checkout-button" disabled={!cart.length} onClick={() => setShowCheckout(true)}>Charge {money(total)} <ArrowUpRight size={17} /></button><div className="payment-hint"><CreditCard size={15} /> Payment collected at checkout</div></aside></div></div> }

