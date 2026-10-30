import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Search, ArrowLeft } from 'lucide-react'
import { api, errorMessage } from '../../lib/api'

type Category = { id: number; name: string; subcategories: { id: number; name: string }[] }

export default function PublicProducts() {
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    api<{ data: Category[] }>('/public/products-catalogue', { query: { search: term } })
      .then(result => { if (!cancelled) setCategories(result.data) })
      .catch(e => { if (!cancelled) setError(errorMessage(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [term])
  return <main className="min-h-screen bg-slate-50 px-4 py-8 text-slate-900 sm:px-8">
    <div className="mx-auto max-w-5xl">
      <nav className="mb-8 flex flex-wrap items-center justify-between gap-3 text-sm">
        <Link className="inline-flex items-center gap-2 font-semibold text-blue-700" to="/register/bookshop"><ArrowLeft size={16}/> Back to bookshop application</Link>
        <Link className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white" to="/register/bookshop">Apply for a bookshop account</Link>
      </nav>
      <header className="mb-7"><div className="mb-3 inline-flex items-center gap-2 rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-800"><BookOpen size={16}/> Shared reference catalogue</div><h1 className="text-3xl font-bold sm:text-4xl">Products &amp; Books</h1><p className="mt-3 max-w-2xl text-slate-600">Explore the shared product categories and subcategories supported by Hekima Bookshop. Your own products, prices and stock are private to your shop after registration.</p></header>
      <form onSubmit={event => { event.preventDefault(); setTerm(search.trim()) }} className="mb-6 flex gap-2"><label className="relative flex-1"><Search className="absolute left-3 top-3 text-slate-400" size={18}/><span className="sr-only">Search categories</span><input className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-3 outline-none focus:border-blue-600" placeholder="Search categories and subcategories…" value={search} onChange={e => setSearch(e.target.value)}/></label><button type="submit" className="rounded-xl bg-blue-700 px-5 font-semibold text-white">Search</button></form>
      {loading && <p role="status">Loading catalogue…</p>}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
      {!loading && !error && <div className="grid gap-4 sm:grid-cols-2">{categories.map(category => <section key={category.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="mb-3 text-lg font-bold">{category.name}</h2>{category.subcategories.length ? <ul className="flex flex-wrap gap-2">{category.subcategories.map(child => <li key={child.id} className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-700">{child.name}</li>)}</ul> : <p className="text-sm text-slate-500">No subcategories listed</p>}</section>)}</div>}
      {!loading && !error && !categories.length && <p className="rounded-xl bg-white p-8 text-center text-slate-600">No matching categories found.</p>}
      <p className="mt-8 text-sm text-slate-500">Read-only reference information. Individual bookshop product listings, selling prices, purchase costs, quantities and inventory records are never shown here.</p>
    </div>
  </main>
}
