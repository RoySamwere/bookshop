'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '../../../lib/api'
import { getCurrentUser, hasPermission } from '../../../lib/auth'

type Book = { id:number; title:string; sku:string; isbn:string|null; selling_price:string; cost_price:string; reorder_level:number }
type Supplier = { id:number; name:string; email:string|null; phone:string|null }
type Inventory = { id:number; title:string; sku:string; branch_name:string; quantity:number; reserved:number; reorder_level:number }

export default function CatalogPage() {
  const [allowed,setAllowed]=useState(false)
  const [loading,setLoading]=useState(true)
  const [books,setBooks]=useState<Book[]>([])
  const [suppliers,setSuppliers]=useState<Supplier[]>([])
  const [inventory,setInventory]=useState<Inventory[]>([])
  const [tab,setTab]=useState<'books'|'suppliers'|'inventory'>('books')
  const [search,setSearch]=useState('')
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [form,setForm]=useState({title:'',sku:'',isbn:'',cost_price:'0',selling_price:'0',reorder_level:'0'})
  const [supplier,setSupplier]=useState({name:'',email:'',phone:''})
  async function load() {
    try {
      const [b,s,i]=await Promise.all([api<{data:Book[]}>('/books'),api<{data:Supplier[]}>('/suppliers'),api<{data:Inventory[]}>('/inventory')])
      setBooks(b.data);setSuppliers(s.data);setInventory(i.data);setError('')
    } catch(e) { setError(e instanceof Error?e.message:'Unable to load records') }
  }
  useEffect(()=>{getCurrentUser().then(u=>{if(!hasPermission(u,'catalog.view'))throw Error('Catalog access denied');setAllowed(true);return load()}).catch(e=>setError(e instanceof Error?e.message:'Please sign in')).finally(()=>setLoading(false))},[])
  async function saveBook(e:React.FormEvent) {
    e.preventDefault();setError('');setMessage('')
    try {await api('/books',{method:'POST',body:{...form,isbn:form.isbn||null,cost_price:Number(form.cost_price),selling_price:Number(form.selling_price),reorder_level:Number(form.reorder_level)}});setMessage('Book saved successfully');setForm({title:'',sku:'',isbn:'',cost_price:'0',selling_price:'0',reorder_level:'0'});await load()}
    catch(e){setError(e instanceof Error?e.message:'Unable to save book')}
  }
  async function saveSupplier(e:React.FormEvent) {
    e.preventDefault();setError('');setMessage('')
    try {await api('/suppliers',{method:'POST',body:{name:supplier.name,email:supplier.email||null,phone:supplier.phone||null}});setMessage('Supplier saved successfully');setSupplier({name:'',email:'',phone:''});await load()}
    catch(e){setError(e instanceof Error?e.message:'Unable to save supplier')}
  }
  const input='w-full rounded-lg border border-slate-300 p-3 text-slate-900'
  return <main className="min-h-screen bg-slate-50 p-5 text-slate-900 md:p-10">
    <div className="mx-auto max-w-6xl">
      <Link href="/dashboard" className="text-sm text-blue-700">← Management dashboard</Link>
      <h1 className="mt-5 text-3xl font-bold">Book catalog & inventory</h1>
      <p className="mt-2 text-slate-600">Live records from the Hekima Bookshop database</p>
      {error&&<p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
      {message&&<p role="status" className="mt-4 rounded-lg bg-green-50 p-3 text-green-800">{message}</p>}
      {loading?<p className="mt-8">Loading…</p>:allowed&&<>
        <div className="mt-7 flex gap-2">{(['books','suppliers','inventory'] as const).map(t=><button key={t} onClick={()=>setTab(t)} className={'rounded-lg px-5 py-2 capitalize '+(tab===t?'bg-blue-800 text-white':'bg-white border')}>{t}</button>)}</div>
        {tab==='books'&&<form onSubmit={saveBook} className="mt-6 grid gap-3 rounded-xl bg-white p-5 shadow-sm md:grid-cols-3">
          <h2 className="md:col-span-3 text-xl font-semibold">Add a book</h2>
          {(['title','sku','isbn','cost_price','selling_price','reorder_level'] as const).map(k=><label key={k} className="text-sm capitalize">{k.replaceAll('_',' ')}<input className={input} value={form[k]} required={k==='title'||k==='sku'} type={['cost_price','selling_price','reorder_level'].includes(k)?'number':'text'} min="0" step={k==='reorder_level'?'1':undefined} onChange={e=>setForm({...form,[k]:e.target.value})}/></label>)}
          <button className="rounded-lg bg-blue-800 px-5 py-3 text-white md:col-span-3">Save book</button>
        </form>}
        {tab==='suppliers'&&<form onSubmit={saveSupplier} className="mt-6 grid gap-3 rounded-xl bg-white p-5 shadow-sm md:grid-cols-3">
          <h2 className="md:col-span-3 text-xl font-semibold">Add a supplier</h2>
          {(['name','email','phone'] as const).map(k=><label key={k} className="text-sm capitalize">{k}<input className={input} value={supplier[k]} required={k==='name'} type={k==='email'?'email':'text'} onChange={e=>setSupplier({...supplier,[k]:e.target.value})}/></label>)}
          <button className="rounded-lg bg-blue-800 px-5 py-3 text-white md:col-span-3">Save supplier</button>
        </form>}
        <div className="mt-6 overflow-x-auto rounded-xl bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-4"><h2 className="text-xl font-semibold capitalize">{tab} records</h2><input aria-label="Search records" className="rounded-lg border p-2" placeholder="Search" value={search} onChange={e=>setSearch(e.target.value)}/></div>
          <table className="w-full text-left text-sm"><thead><tr className="border-b">{(tab==='books'?['Title','SKU','ISBN','Price (KES)']:tab==='suppliers'?['Supplier','Email','Phone']:['Book','Branch','Stock','Reserved','Reorder at']).map(h=><th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>
          {tab==='books'&&books.filter(b=>(b.title+' '+b.sku+' '+(b.isbn||'')).toLowerCase().includes(search.toLowerCase())).map(b=><tr key={b.id} className="border-b"><td className="p-3">{b.title}</td><td className="p-3">{b.sku}</td><td className="p-3">{b.isbn||'—'}</td><td className="p-3">{Number(b.selling_price).toLocaleString('en-KE')}</td></tr>)}
          {tab==='suppliers'&&suppliers.filter(s=>s.name.toLowerCase().includes(search.toLowerCase())).map(s=><tr key={s.id} className="border-b"><td className="p-3">{s.name}</td><td className="p-3">{s.email||'—'}</td><td className="p-3">{s.phone||'—'}</td></tr>)}
          {tab==='inventory'&&inventory.filter(i=>i.title.toLowerCase().includes(search.toLowerCase())).map(i=><tr key={i.id} className="border-b"><td className="p-3">{i.title}</td><td className="p-3">{i.branch_name}</td><td className={'p-3 '+(i.quantity<=i.reorder_level?'text-red-700 font-semibold':'')}>{i.quantity}</td><td className="p-3">{i.reserved}</td><td className="p-3">{i.reorder_level}</td></tr>)}
          </tbody></table>
        </div>
      </>}
    </div>
  </main>
}
