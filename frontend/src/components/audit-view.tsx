'use client'

import { useCallback, useEffect, useState } from 'react'
import { History, Search } from 'lucide-react'
import { errorMessage, type Paginated } from '../lib/api'
import { auditApi, type AuditEntry } from '../lib/workspace-api'
import { EmptyState, ErrorState, LoadingState, PageHeader, Pagination, formatDate } from './ui-kit'
import { RoleBadge } from './users-view'

const ACTION_GROUPS = [
  { value: '', label: 'All activity' },
  { value: 'auth', label: 'Sign-ins and passwords' },
  { value: 'user', label: 'User accounts' },
  { value: 'branch', label: 'Branches' },
  { value: 'business', label: 'Business settings' },
  { value: 'tax_rate', label: 'Tax rates' },
]

const ACTION_TONES: Record<string, string> = {
  auth: 'bg-blue-50 text-blue-700', user: 'bg-violet-50 text-violet-700', branch: 'bg-teal-50 text-teal-700',
  business: 'bg-pink-50 text-pink-700', tax_rate: 'bg-amber-50 text-amber-700',
}

export function AuditView() {
  const [query, setQuery] = useState({ search: '', action: '', from: '', to: '', page: 1 })
  const [searchInput, setSearchInput] = useState('')
  const [result, setResult] = useState<Paginated<AuditEntry> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setResult(await auditApi.list(query)) } catch (e) { setError(errorMessage(e)) } finally { setLoading(false) }
  }, [query])
  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(previous => previous.search === searchInput.trim() ? previous : { ...previous, search: searchInput.trim(), page: 1 }), 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])
  const set = (key: 'action' | 'from' | 'to', value: string) => setQuery(previous => ({ ...previous, [key]: value, page: 1 }))

  return <div className="products-page">
    <PageHeader eyebrow="WORKSPACE / SECURITY" icon={<History size={15} />} title="Audit log" description="A permanent record of sign-ins, account changes and settings updates." />
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="grid gap-2 border-b border-slate-100 px-5 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
        <label className="flex h-10 items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-slate-400 focus-within:border-blue-300 focus-within:bg-white">
          <Search size={16} /><input className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none" type="search" value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search activity" aria-label="Search activity" />
        </label>
        <select className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700" value={query.action} onChange={e => set('action', e.target.value)} aria-label="Activity type">
          {ACTION_GROUPS.map(group => <option key={group.value} value={group.value}>{group.label}</option>)}
        </select>
        <input className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700" type="date" value={query.from} onChange={e => set('from', e.target.value)} aria-label="From date" />
        <input className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700" type="date" value={query.to} onChange={e => set('to', e.target.value)} aria-label="To date" />
      </div>
      {loading && !result ? <LoadingState label="Loading activity" /> : error ? <ErrorState message={error} onRetry={load} /> : result && <>
        <ol className={`divide-y divide-slate-100 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          {result.data.map(entry => {
            const group = entry.action.split('.')[0]
            return <li key={entry.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-start sm:gap-4 sm:px-6">
              <span className={`w-fit shrink-0 rounded-md px-2 py-1 font-mono text-[11px] font-semibold ${ACTION_TONES[group] || 'bg-slate-100 text-slate-600'}`}>{entry.action}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">{entry.description}</p>
                <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  {entry.user ? <><span className="font-semibold text-slate-600">{entry.user.name}</span><RoleBadge role={entry.user.role} /></> : <span>Unknown visitor</span>}
                  {entry.ip_address && <span>· {entry.ip_address}</span>}
                </p>
              </div>
              <time className="shrink-0 text-xs text-slate-400" dateTime={entry.created_at}>{formatDate(entry.created_at, true)}</time>
            </li>
          })}
        </ol>
        {result.data.length === 0 && <EmptyState icon={<History size={22} />} title="No activity found" body="Try a different search, activity type or date range." />}
        <Pagination meta={result.meta} onPage={page => setQuery(previous => ({ ...previous, page }))} />
      </>}
    </section>
  </div>
}
