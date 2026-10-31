import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Search, ArrowLeft } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'

type Category = { id: number; name: string; subcategories: { id: number; name: string }[] }

export default function PublicProducts() {
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<{ title:string; sku:string|null; isbn:string|null; brand:string|null; category:string|null; subcategory:string|null }[]>([])
  const [page,setPage] = useState(1)
  const [lastPage,setLastPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    Promise.all([api<{ data: Category[] }>('/public/products-catalogue', { query: { search: term } }), api<{data: typeof products;last_page:number}>('/public/products',{query:{search:term,page}})])
      .then(([result, catalogue]) => { if (!cancelled) { setCategories(result.data);setProducts(catalogue.data);setLastPage(catalogue.last_page) } })
      .catch(e => { if (!cancelled) setError(errorMessage(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [term,page])
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-8">
    <div className="mx-auto max-w-5xl">
      <nav className="mb-8 flex flex-wrap items-center justify-between gap-3 text-sm">
        <Link className="inline-flex items-center gap-2 font-semibold text-blue-700" to="/register/bookshop"><ArrowLeft size={16}/> Back to bookshop application</Link>
        <Link className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white" to="/register/bookshop">Apply for a bookshop account</Link>
      </nav>
      <header className="mb-7"><div className="mb-3 inline-flex items-center gap-2 rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-800"><BookOpen size={16}/> Public product catalogue</div><h1 className="text-3xl font-bold sm:text-4xl">Products &amp; Books</h1><p className="mt-3 max-w-2xl text-slate-600">Explore the shared product categories and subcategories and products uploaded by participating Nifunze bookshops. Stock quantities, prices and private shop information remain separate.</p></header>
      <form onSubmit={event => { event.preventDefault(); setPage(1); setTerm(search.trim()) }} className="mb-6 flex gap-2"><label className="relative flex-1"><Search className="absolute left-3 top-3 text-slate-400" size={18}/><span className="sr-only">Search categories</span><input className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-3 outline-none focus:border-blue-600" placeholder="Search products, brands, ISBN or categories…" value={search} onChange={e => setSearch(e.target.value)}/></label><button type="submit" className="rounded-xl bg-blue-700 px-5 font-semibold text-white">Search</button></form>
      {loading && <p role="status">Loading catalogue…</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
      {!loading && !error && <section className="mb-8"><h2 className="mb-4 text-xl font-bold">Available products</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{products.map((product,index)=><article key={index} className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-semibold">{product.title}</h3><p className="mt-1 text-sm text-slate-600">{[product.brand,product.category,product.subcategory].filter(Boolean).join(' · ')}</p><p className="mt-2 text-xs text-slate-500">{[product.sku&&'SKU: '+product.sku,product.isbn&&'ISBN: '+product.isbn].filter(Boolean).join(' · ')}</p></article>)}</div>{!products.length&&<p className="rounded-xl bg-white p-5 text-slate-500">No matching products found.</p>}<div className="mt-4 flex items-center justify-between"><button type="button" disabled={page<=1} onClick={()=>setPage(p=>p-1)} className="rounded-lg border px-4 py-2 disabled:opacity-40">Previous</button><span>Page {page} of {lastPage}</span><button type="button" disabled={page>=lastPage} onClick={()=>setPage(p=>p+1)} className="rounded-lg border px-4 py-2 disabled:opacity-40">Next</button></div></section>}
      {!loading && !error && <div className="grid gap-4 sm:grid-cols-2">{categories.map(category => <section key={category.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-3 text-lg font-bold">{category.name}</h2>{category.subcategories.length ? <ul className="flex flex-wrap gap-2">{category.subcategories.map(child => <li key={child.id} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-700">{child.name}</li>)}</ul> : <p className="text-sm text-slate-500">No subcategories listed</p>}</section>)}</div>}
      {!loading && !error && !categories.length && <p className="rounded-xl bg-white p-8 text-center text-slate-600">No matching categories found.</p>}
      <p className="mt-8 text-sm text-slate-500">Read-only reference information. Product descriptions are publicly discoverable. Individual shop prices, purchase costs, quantities and inventory records are private.</p>
    </div>
  </main>
}
