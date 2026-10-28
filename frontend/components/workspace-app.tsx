'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import BrandLoader from './brand-loader'
import { WorkspaceShell, PROFILE_SECTION, canOpenSection, firstSection } from './workspace-shell'
import { OverviewDashboard } from './overview-dashboard'
import { UsersView } from './users-view'
import { InventoryView } from './inventory-view'
import { SettingsView } from './settings-view'
import { AuditView } from './audit-view'
import { ProfileView } from './profile-view'
import { ErrorState } from './ui-kit'
import { API_BASE, ApiError, UNAUTHORIZED_EVENT, tokenStore, api } from '../lib/api'
import { getCurrentUser, hasPermission, homeFor, logout, type BookshopUser } from '../lib/auth'
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
  'Dashboard': 'Phase 5', 'Point of Sale': 'Phase 3', 'Sales History': 'Phase 3', 
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
    // Customers and pending applicants have no workspace; their account page explains why.
    if (!hasPermission(user, 'workspace.access')) { router.replace(homeFor(user)); return }
    setCurrentUser(user)
    const requested = new URLSearchParams(window.location.search).get('section')
    setActive(previous => requested && canOpenSection(user, requested) ? requested : canOpenSection(user, previous) ? previous : firstSection(user))
  }, [router])

  const restoreSession = useCallback(() => {
    setBootError('')
    if (!tokenStore.get()) { router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`); return }
    setAuthLoading(true)
    getCurrentUser()
      .then(user => { enterWorkspace(user); setAuthLoading(false) })
      .catch((error: unknown) => {
        // Network failures keep the token so a retry can restore the session.
        if (error instanceof ApiError && error.status === 0) { setBootError(error.message); setAuthLoading(false); return }
        tokenStore.clear()
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
    setCart([])
    setShowCheckout(false)
    void logout().catch(() => undefined)
    router.replace('/login?signed_out=1')
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

  const view = !canOpenSection(currentUser, active)
    ? <section className="page-placeholder"><h1 tabIndex={-1}>Access restricted</h1><p>Your role does not include access to this section.</p></section>
    : active === 'Users' ? <UsersView currentUser={currentUser} notify={notify} />
    : active === 'Settings' ? <SettingsView currentUser={currentUser} notify={notify} />
    : active === 'Audit Log' ? <AuditView />
    : active === PROFILE_SECTION ? <ProfileView currentUser={currentUser} onUpdated={setCurrentUser} notify={notify} />
    : active === 'Point of Sale' ? <POSView filteredProducts={filteredProducts} query={query} setQuery={setQuery} cart={cart} addToCart={addToCart} updateQuantity={updateQuantity} subtotal={subtotal} tax={tax} total={total} setCart={setCart} setShowCheckout={setShowCheckout} />
    : active === 'Products & Books' ? <ProductsBooksView setToast={notify} />
    : active === 'Inventory & Stock' ? <InventoryView currentUser={currentUser} notify={notify} />
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
  type BookRow = { id: number; title: string; sku: string; isbn: string | null; selling_price: string; cost_price: string; reorder_level: number; category_name?: string; subcategory_name?: string }
  const [books, setBooks] = useState<BookRow[]>([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(20)
  const [lastPage, setLastPage] = useState(1)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [subcategory, setSubcategory] = useState('')
  const [hierarchy, setHierarchy] = useState<{id:number;name:string;subcategories:{id:number;name:string}[]}[]>([])
  const [showForm, setShowForm] = useState(false)
  const [unitBook, setUnitBook] = useState<BookRow|null>(null)
  const [unitName, setUnitName] = useState('Pack of 10')
  const [unitFactor, setUnitFactor] = useState('10')
  const [units, setUnits] = useState<{id:number;name:string;pieces_per_unit:number}[]>([])
  const [unitError, setUnitError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState({ title: '', sku: '', isbn: '', selling_price: '', cost_price: '', reorder_level: '10' })
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await api<{ data: BookRow[]; total: number; current_page: number; last_page: number }>('/books', { query: { page, search, per_page: perPage, category_id: category, subcategory_id: subcategory } })
      setBooks(result.data)
      setCount(result.total)
      setLastPage(result.last_page)
      setError('')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to load catalogue') }
    finally { setLoading(false) }
  }, [page, search, perPage, category, subcategory])
  useEffect(() => { void load() }, [load])
  useEffect(() => { api<{id:number;name:string;subcategories:{id:number;name:string}[]}[]>('/product-hierarchy').then(setHierarchy).catch(()=>undefined) }, [])
  useEffect(() => { const timer = window.setTimeout(() => {setPage(1);setSearch(query.trim())}, 250); return () => window.clearTimeout(timer) }, [query])
  async function saveBook(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true); setError('')
    try {
      await api('/books', { method: 'POST', body: { ...form, isbn: form.isbn || null, selling_price: Number(form.selling_price), cost_price: Number(form.cost_price), reorder_level: Number(form.reorder_level) } })
      setForm({ title: '', sku: '', isbn: '', selling_price: '', cost_price: '', reorder_level: '10' })
      setShowForm(false); setPage(1); await load()
      setToast('Product saved to the database')
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to save product') }
    finally { setSaving(false) }
  }
  async function openUnits(book:BookRow) {
    setUnitBook(book);setUnitError('');
    try {setUnits(await api<{id:number;name:string;pieces_per_unit:number}[]>(`/books/${book.id}/units`))}
    catch(e){setUnitError(e instanceof Error?e.message:'Unable to load packaging')}
  }
  async function addUnit(event:React.FormEvent) {
    event.preventDefault();if(!unitBook)return;setUnitError('');
    try {await api(`/books/${unitBook.id}/units`,{method:'POST',body:{name:unitName.trim(),pieces_per_unit:Number(unitFactor)}});
      setUnits(await api<{id:number;name:string;pieces_per_unit:number}[]>(`/books/${unitBook.id}/units`));setToast('Packaging saved')}
    catch(e){setUnitError(e instanceof Error?e.message:'Unable to save packaging')}
  }
  const [newRows,setNewRows] = useState<{title:string;sku:string;cost_price:number;selling_price:number;reorder_level:number}[]>([])
  const [newImportError,setNewImportError] = useState('')
  const [newImportBusy,setNewImportBusy] = useState(false)
  function downloadNewTemplate(){
    const csv='title,sku,cost_price,selling_price,reorder_level\r\n'
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}))
    const link=document.createElement('a');link.href=url;link.download='hekima-new-products-template.csv';link.click();URL.revokeObjectURL(url)
  }
  async function readNewProducts(file:File|undefined){
    setNewRows([]);setNewImportError('');if(!file)return
    try{
      if(file.size>5_000_000)throw new Error('File exceeds 5 MB')
      const lines=(await file.text()).replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean)
      if(lines.shift()?.trim()!=='title,sku,cost_price,selling_price,reorder_level')throw new Error('Use the downloaded template and keep its column headings.')
      const parsed=lines.map((line,i)=>{
        const cols=line.split(',').map(x=>x.trim().replace(/^"|"$/g,''))
        if(cols.length!==5||!cols[0]||!cols[1]||cols.slice(2,4).some(x=>x===''||!Number.isFinite(Number(x))||Number(x)<0)||!Number.isInteger(Number(cols[4]))||Number(cols[4])<0)throw new Error(`Invalid values on CSV line ${i+2}. Use no commas inside product names.`)
        return {title:cols[0],sku:cols[1],cost_price:Number(cols[2]),selling_price:Number(cols[3]),reorder_level:Number(cols[4])}
      })
      if(!parsed.length)throw new Error('Add at least one product to the CSV')
      if(new Set(parsed.map(x=>x.sku.toLowerCase())).size!==parsed.length)throw new Error('Duplicate SKUs in the file')
      setNewRows(parsed)
    }catch(e){setNewImportError(e instanceof Error?e.message:'Cannot read CSV')}
  }
  async function uploadNewProducts(){
    if(!newRows.length||newImportBusy)return
    setNewImportBusy(true);setNewImportError('');let created=0
    try{
      for(let i=0;i<newRows.length;i+=200){
        const result=await api<{created:number}>('/books-bulk-create',{method:'POST',body:{rows:newRows.slice(i,i+200)}})
        created+=result.created
      }
      setNewRows([]);setPage(1);await load();setToast(`${created} new products registered in catalogue and inventory`)
    }catch(e){setNewImportError(`${created} products created before error. ${e instanceof Error?e.message:'Upload failed'}`)}
    finally{setNewImportBusy(false)}
  }
  const [importRows,setImportRows] = useState<Record<string,string>[]>([])
  const [importError,setImportError] = useState('')
  const [importing,setImporting] = useState(false)
  const [exporting,setExporting] = useState(false)
  const columns=['id','title','sku','isbn','brand','ruling_style','page_count','paper_size','binding_type','cost_price','selling_price','reorder_level','is_active','product_subcategory_id']
  async function downloadCsv() {
    setExporting(true);setError('')
    try {
      const response=await fetch(`${API_BASE}/books-export`,{headers:{Authorization:`Bearer ${tokenStore.get()??''}`,Accept:'text/csv'}})
      if(!response.ok)throw new Error('Export failed. Check your session and permissions.')
      const url=URL.createObjectURL(await response.blob())
      const link=document.createElement('a');link.href=url;link.download='hekima-products-all.csv';link.click();URL.revokeObjectURL(url)
      setToast('Full catalogue exported')
    }catch(e){setError(e instanceof Error?e.message:'Export failed')}finally{setExporting(false)}
  }
  function parseCsv(text:string):string[][] {
    const rows:string[][]=[];let row:string[]=[],field='',quoted=false
    for(let i=0;i<text.length;i++){const c=text[i]
      if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++}else quoted=!quoted}
      else if(c===','&&!quoted){row.push(field);field=''}
      else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(x=>x!==''))rows.push(row);row=[];field=''}
      else field+=c
    }
    if(quoted)throw new Error('CSV contains an unclosed quoted field')
    row.push(field);if(row.some(x=>x!==''))rows.push(row)
    return rows
  }
  async function readImport(file:File|undefined){
    setImportRows([]);setImportError('');if(!file)return
    try{
      if(file.size>10_000_000)throw new Error('CSV must be smaller than 10 MB')
      const parsed=parseCsv((await file.text()).replace(/^\uFEFF/,''))
      if(!parsed.length||columns.some((c,i)=>parsed[0][i]!==c)||parsed[0].length!==columns.length)throw new Error('Please upload the original full-catalogue CSV template with unchanged column headings.')
      const rows=parsed.slice(1).map((r,i)=>{
        if(r.length!==columns.length)throw new Error(`Row ${i+2}: wrong number of columns`)
        return Object.fromEntries(columns.map((key,j)=>[key,r[j].replace(/^'(?=[=+@\-])/, '')]))
      })
      if(rows.some(r=>!/^\d+$/.test(r.id)))throw new Error('Every row must retain its numeric product ID.')
      if(new Set(rows.map(r=>r.id)).size!==rows.length)throw new Error('Duplicate product IDs detected.')
      if(rows.length===0)throw new Error('The file has no product rows.')
      setImportRows(rows)
    }catch(e){setImportError(e instanceof Error?e.message:'Could not read CSV')}
  }
  async function uploadImport(){
    if(!importRows.length||importing)return
    setImporting(true);setImportError('')
    let done=0
    try{
      for(let i=0;i<importRows.length;i+=200){
        const rows=importRows.slice(i,i+200).map(r=>({
          id:Number(r.id),title:r.title,sku:r.sku,isbn:r.isbn||null,brand:r.brand||null,
          ruling_style:r.ruling_style||null,page_count:r.page_count?Number(r.page_count):null,
          paper_size:r.paper_size||null,binding_type:r.binding_type||null,
          cost_price:Number(r.cost_price),selling_price:Number(r.selling_price),
          reorder_level:Number(r.reorder_level),is_active:r.is_active==='1'||r.is_active.toLowerCase()==='true',
          product_subcategory_id:r.product_subcategory_id?Number(r.product_subcategory_id):null
        }))
        await api('/books-import',{method:'POST',body:{rows}});done+=rows.length
      }
      setImportRows([]);await load();setToast(`${done} products updated successfully`)
    }catch(e){setImportError(`${done} rows updated before error: ${e instanceof Error?e.message:'Import failed'}. Correct the file and retry carefully.`)}
    finally{setImporting(false)}
  }
  return <div className="products-page">
    <div className="page-heading compact"><div><div className="eyebrow">LIVE CATALOGUE · MYSQL</div><h1 tabIndex={-1}>Products & Books</h1><p>Browse and register real products stored in the Hekima database.</p></div><div className="heading-actions"><button className="secondary-button" disabled={exporting} onClick={()=>void downloadCsv()}><Download size={16}/> {exporting?"Exporting…":"Download all products (CSV)"}</button><button className="primary-button" onClick={() => setShowForm(v => !v)}><Plus size={17}/> Add product</button></div></div>
    <div className="catalog-stats"><div className="card catalog-stat"><span>Total products</span><strong>{count.toLocaleString('en-KE')}</strong><small>Live catalogue records</small></div><div className="card catalog-stat"><span>Showing</span><strong>{books.length}</strong><small>Page {page} of {lastPage}</small></div></div>
    {error && <div role="alert" className="card" style={{padding:16,color:'#b91c1c'}}>{error} <button className="text-button" onClick={() => void load()}>Retry</button></div>}
    <section className="card" style={{padding:20,marginBottom:16}}><h2>Bulk add new products</h2><p>Download a simple CSV template, enter real products and upload. New products appear in Products & Books and Inventory & Stock with zero stock until received. Existing SKUs are rejected to prevent duplicates.</p><div style={{display:'flex',gap:12,alignItems:'center',flexWrap:'wrap'}}><button type="button" className="secondary-button" onClick={downloadNewTemplate}><Download size={16}/> Download blank template</button><label className="field-label">Choose completed CSV <input className="text-input" type="file" accept=".csv,text/csv" onChange={e=>void readNewProducts(e.target.files?.[0])}/></label></div>{newImportError&&<p role="alert" style={{color:'#b91c1c'}}>{newImportError}</p>}{newRows.length>0&&<div style={{display:'flex',gap:12,alignItems:'center',marginTop:12}}><span>{newRows.length} new products ready</span><button className="primary-button" disabled={newImportBusy} onClick={()=>void uploadNewProducts()}>{newImportBusy?'Uploading…':'Upload products'}</button></div>}</section>
    <section className="card" style={{padding:20,marginBottom:16}}><h2>Clean catalogue · Download, edit & upload</h2><p>Download all products as CSV, clean the rows in Excel, then upload the same file. Keep product IDs and column headers unchanged. Existing products are updated by ID; stock quantities and sales history are not touched.</p><label className="field-label">Upload cleaned CSV <input className="text-input" type="file" accept=".csv,text/csv" onChange={e=>void readImport(e.target.files?.[0])}/></label>{importError&&<p role="alert" style={{color:'#b91c1c'}}>{importError}</p>}{importRows.length>0&&<div style={{display:'flex',alignItems:'center',gap:12,marginTop:12}}><span>{importRows.length.toLocaleString()} product rows ready to update</span><button className="primary-button" disabled={importing} onClick={()=>void uploadImport()}>{importing?'Uploading…':'Confirm & update products'}</button><button className="secondary-button" disabled={importing} onClick={()=>setImportRows([])}>Cancel</button></div>}</section>
    {showForm && <form className="card product-form" onSubmit={saveBook}><div className="card-heading"><h2>Add a product</h2><button type="button" className="icon-button" onClick={() => setShowForm(false)}><X size={17}/></button></div><div className="form-grid">
      {(['title','sku','isbn','selling_price','cost_price','reorder_level'] as const).map(field => <label className="field-label" key={field}>{field.replaceAll('_',' ')}<input className="text-input" required={field==='title'||field==='sku'||field==='selling_price'||field==='cost_price'} type={['selling_price','cost_price','reorder_level'].includes(field)?'number':'text'} min={['selling_price','cost_price','reorder_level'].includes(field)?'0':undefined} step={field==='reorder_level'?'1':undefined} value={form[field]} onChange={e => setForm(v => ({...v,[field]:e.target.value}))}/></label>)}
    </div><button className="primary-button" type="submit" disabled={saving}>{saving?'Saving…':'Save product'}</button></form>}
    {unitBook&&<section className="card" style={{padding:20,marginBottom:16}}><div className="card-heading"><h2>Packaging · {unitBook.title}</h2><button className="secondary-button" onClick={()=>setUnitBook(null)}>Close</button></div><p>Base stock unit: 1 piece. Packaging is converted automatically when receiving stock.</p>{unitError&&<p role="alert" style={{color:'#b91c1c'}}>{unitError}</p>}<ul>{units.map(u=><li key={u.id}>{u.name} = {u.pieces_per_unit} pieces</li>)}</ul><form onSubmit={addUnit} style={{display:'flex',gap:12,flexWrap:'wrap',marginTop:12}}><label>Packaging name <input className="text-input" required maxLength={80} value={unitName} onChange={e=>setUnitName(e.target.value)}/></label><label>Pieces per package <input className="text-input" type="number" required min={2} max={100000} value={unitFactor} onChange={e=>setUnitFactor(e.target.value)}/></label><button className="primary-button" type="submit">Add packaging</button></form></section>}
    <section className="card catalogue-card"><div className="card-heading"><div><h2>Products catalogue</h2><p>Data loaded from Laravel and MySQL. Stock is managed separately in Inventory.</p></div><form className="catalogue-search" onSubmit={e => { e.preventDefault(); setPage(1); setSearch(query) }}><Search size={15}/><input aria-label="Search catalogue" placeholder="Search all products: name, category, SKU, ISBN…" value={query} onChange={e => setQuery(e.target.value)}/><button type="button" className="text-button" onClick={()=>{setQuery("");setSearch("");setCategory("");setSubcategory("");setPage(1)}}>Clear</button></form></div><div style={{display:"flex",gap:12,padding:"0 16px 16px",flexWrap:"wrap"}}><label>Category <select value={category} onChange={e=>{setCategory(e.target.value);setSubcategory("");setPage(1)}}><option value="">All categories</option>{hierarchy.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label><label>Subcategory <select value={subcategory} onChange={e=>{setSubcategory(e.target.value);setPage(1)}}><option value="">All subcategories</option>{hierarchy.filter(c=>!category||String(c.id)===category).flatMap(c=>c.subcategories).map(sc=><option key={sc.id} value={sc.id}>{sc.name}</option>)}</select></label></div>
      {loading?<p style={{padding:20}}>Loading catalogue…</p>:<div className="catalogue-table"><div className="catalogue-row catalogue-head"><span>Product</span><span>Category</span><span>SKU</span><span>Price</span><span>Units & packs</span></div>{books.map(book=><div className="catalogue-row" key={book.id}><span className="catalogue-product"><span className="mini-art teal"><BookOpen size={14}/></span><strong>{book.title}</strong></span><span>{book.subcategory_name || book.category_name || '—'}</span><span className="muted-text">{book.sku}</span><span>{money(Number(book.selling_price))}</span><span><button className="text-button" onClick={()=>void openUnits(book)}>Packaging</button></span></div>)}{books.length===0&&<p style={{padding:20}}>No matching products. Try another name, category, SKU or ISBN.</p>}</div>}
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:16,gap:12}}><label>Items per page <select value={perPage} onChange={e=>{setPerPage(Number(e.target.value));setPage(1)}}>{[10,20,50,100,200].map(n=><option key={n} value={n}>{n}</option>)}</select></label><button className="secondary-button" disabled={page<=1||loading} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page} of {lastPage}</span><button className="secondary-button" disabled={page>=lastPage||loading} onClick={()=>setPage(p=>p+1)}>Next</button><button className="secondary-button" disabled={page>=lastPage||loading} onClick={()=>setPage(lastPage)}>Last »</button></div>
    </section>
  </div>
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
  return <div className="products-page">
    <div className="page-heading compact"><div><div className="eyebrow">PROCUREMENT · LIVE SUPPLIER DIRECTORY</div><h1 tabIndex={-1}>Suppliers</h1><p>Register suppliers before receiving deliveries. All records are saved in MySQL.</p></div><div className="heading-actions"><button className="secondary-button" onClick={exportCsv}><Download size={16}/> Export current page</button><button className="primary-button" onClick={()=>setShowForm(true)}><Plus size={17}/> Add supplier</button></div></div>
    <div className="catalog-stats"><div className="card catalog-stat"><span>Total suppliers</span><strong>{total}</strong><small>Live supplier records</small></div><div className="card catalog-stat"><span>Showing</span><strong>{rows.length}</strong><small>Page {page} of {lastPage}</small></div></div>
    {error&&<div className="card" role="alert" style={{padding:16,color:'#b91c1c'}}>{error} <button className="text-button" onClick={()=>void load()}>Retry</button></div>}
    <section className="card inventory-table-card"><div className="card-heading"><div><h2>Supplier directory</h2><p>Search the full supplier database by company name</p></div><div className="inventory-search"><Search size={16}/><input aria-label="Search suppliers" value={search} onChange={e=>{setSearch(e.target.value);setPage(1)}} placeholder="Search suppliers…"/></div></div>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Supplier</th><th>Contact person</th><th>Phone</th><th>Email</th><th>KRA PIN</th><th>Status</th></tr></thead><tbody>{rows.map(x=><tr key={x.id}><td><strong>{x.name}</strong></td><td>{x.contact_person||'—'}</td><td>{x.phone||'—'}</td><td>{x.email||'—'}</td><td>{x.tax_pin||'—'}</td><td><span className="status-chip">{x.is_active?'Active':'Inactive'}</span></td></tr>)}{!loading&&rows.length===0&&<tr><td colSpan={6}>No suppliers found. Add your first supplier.</td></tr>}</tbody></table></div>
      <div style={{display:'flex',alignItems:'center',justifyContent:'flex-end',gap:16,padding:16}}><button className="secondary-button" disabled={page<=1||loading} onClick={()=>setPage(p=>p-1)}>Previous</button><span>Page {page} of {lastPage}</span><button className="secondary-button" disabled={page>=lastPage||loading} onClick={()=>setPage(p=>p+1)}>Next</button><button className="secondary-button" disabled={page>=lastPage||loading} onClick={()=>setPage(lastPage)}>Last »</button></div>
    </section>
    {showForm&&<div className="modal-backdrop"><form className="checkout-modal" onSubmit={saveSupplier}><div className="modal-header"><div><div className="eyebrow">SUPPLIER DIRECTORY</div><h2>Add supplier</h2></div><button type="button" className="icon-button" onClick={()=>setShowForm(false)} aria-label="Close"><X size={18}/></button></div><div className="form-grid">{(['name','contact_person','phone','email','address','tax_pin'] as const).map(field=><label key={field} className="field-label">{({name:'Company name',contact_person:'Contact person',phone:'Phone number',email:'Email address',address:'Physical address',tax_pin:'KRA PIN'})[field]}<input className="text-input" required={field==='name'} type={field==='email'?'email':'text'} value={form[field]} onChange={e=>setForm(v=>({...v,[field]:e.target.value}))}/></label>)}</div><button className="primary-button full" disabled={saving} type="submit">{saving?'Saving…':'Save supplier'} <ArrowUpRight size={16}/></button></form></div>}
  </div>
}

function POSView({ filteredProducts, query, setQuery, cart, addToCart, updateQuantity, subtotal, tax, total, setCart, setShowCheckout }: any) { return <div className="pos-page"><div className="page-heading compact"><div><div className="eyebrow">SALES TERMINAL · REGISTER 01</div><h1 tabIndex={-1}>Point of Sale</h1><p>Serve customers quickly and keep your records accurate.</p></div><div className="register-actions"><button className="secondary-button" onClick={() => { const demoItems = products.filter((product) => [1, 3, 4].includes(product.id)).map((product, index) => ({ product, quantity: index === 0 ? 1 : index === 1 ? 2 : 3 })); setCart(demoItems); }}>Load demo sale</button><div className="register-status"><span className="status-dot" /> Register open</div></div></div><div className="pos-layout"><section className="product-panel card"><div className="pos-search"><Search size={18} /><input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by product, ISBN or SKU..." /><kbd>/</kbd></div><div className="category-tabs"><button className="selected">All products</button><button>Textbooks</button><button>Stationery</button><button>Exercise books</button><button>Revision</button></div><div className="product-grid">{filteredProducts.map((product: typeof products[number]) => <button className="product-card" key={product.id} onClick={() => addToCart(product)} disabled={product.stock === 0}><div className={`product-art ${product.tone}`}><BookOpen size={24} /><span>{product.category === 'Stationery' ? 'STATIONERY' : product.category.toUpperCase()}</span></div><div className="product-info"><strong>{product.name}</strong><span>{product.sku} · {product.stock === 0 ? 'Out of stock' : `${product.stock} in stock`}</span><b>{money(product.price)}</b></div><Plus className="add-icon" size={17} /></button>)}</div></section><aside className="cart-panel card"><div className="cart-heading"><div><h2>Current sale</h2><span>{cart.reduce((s: number, i: any) => s + i.quantity, 0)} items</span></div>{cart.length > 0 && <button className="clear-button" onClick={() => setCart([])}>Clear</button>}</div><div className="customer-select"><Users size={16} /><span>Walk-in customer</span><ChevronDown size={15} /></div><div className="cart-items">{cart.length === 0 ? <div className="cart-empty"><ShoppingCart size={27} /><strong>Your cart is empty</strong><span>Select a product to start a sale</span></div> : cart.map((item: any) => <div className="cart-item" key={item.product.id}><div className={`mini-art ${item.product.tone}`}><BookOpen size={15} /></div><div className="cart-item-info"><strong>{item.product.name}</strong><span>{money(item.product.price)} each</span><div className="qty"><button onClick={() => updateQuantity(item.product.id, -1)}>−</button><b>{item.quantity}</b><button onClick={() => updateQuantity(item.product.id, 1)}>+</button></div></div><strong>{money(item.product.price * item.quantity)}</strong></div>)}</div><div className="totals"><div><span>Subtotal</span><b>{money(subtotal)}</b></div><div><span>Tax <small>(16%)</small></span><b>{money(tax)}</b></div><div className="total-line"><span>Total due</span><strong>{money(total)}</strong></div></div><button className="primary-button full checkout-button" disabled={!cart.length} onClick={() => setShowCheckout(true)}>Charge {money(total)} <ArrowUpRight size={17} /></button><div className="payment-hint"><CreditCard size={15} /> Payment collected at checkout</div></aside></div></div> }

