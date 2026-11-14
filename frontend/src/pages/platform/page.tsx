import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useParams, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, Building2, CalendarPlus, CheckCircle2, ChevronRight, Eye, History, Pencil, ShieldCheck, Store, UserPlus } from 'lucide-react'
import {
  EmptyState, ErrorState, Field, FormAlert, LoadingState, Modal, ModalActions,
  dangerButton, formatDate, inputClass, primaryButton, secondaryButton,
} from '../../components/ui-kit'
import { useAuth } from '../../features/auth/auth-provider'
import { ApiError, errorMessage } from '../../lib/api'
import { hasPermission, type BookshopUser, type BookshopStatus, type Permission } from '../../lib/auth'
import { billingApi, billsApi, trialApi } from '../../lib/billing-api'
import { BOOKSHOP_STATUS_LABELS, enterBookshopManagement, platformApi, type PlatformBookshop } from '../../lib/tenancy-api'
import PlatformBillingView from './billing-view'
import { ExtendTrialModal } from './trial-extensions'
import { BarList, Metric, MetricStrip, PageControls, Panel, Pill, PlatformTitle, SearchField, SelectField, SplitBar, StatePill, Toolbar, humanize, kes, tdClass, thClass } from './platform-ui'
import { PlatformShell } from './shell'
import BookshopRegisterPage from '../register/bookshop/page'

/** The Platform Owner console at /platform. Separate from every bookshop workspace; it shows tenant metadata only. */
export default function PlatformPage() {
  return <Routes>
    <Route element={<PlatformShell />}>
      <Route index element={<OverviewView />} />
      <Route path="bookshops" element={<BookshopsView />} />
      <Route path="bookshops/new" element={<Gate permission="platform.bookshops.onboard"><BookshopRegisterPage platformMode /></Gate>} />
      <Route path="management" element={<ManagementView />} />
      <Route path="bookshops/:id" element={<BookshopDetailView />} />
      <Route path="users" element={<Gate permission="platform.users.view"><UsersView /></Gate>} />
      <Route path="billing/*" element={<Gate permission="platform.settings.view"><PlatformBillingView /></Gate>} />
      {/* Earlier addresses, kept so bookmarks and links still work. */}
      <Route path="bills" element={<Navigate replace to="/platform/billing/payments" />} />
      <Route path="plans" element={<Gate permission="platform.plans.view"><Navigate replace to="/platform/billing/plans" /></Gate>} />
      <Route path="settings" element={<Gate permission="platform.settings.view"><SettingsView /></Gate>} />
      <Route path="audit" element={<Gate permission="platform.audit.view"><AuditView /></Gate>} />
      <Route path="*" element={<Navigate replace to="/platform" />} />
    </Route>
  </Routes>
}

function useCurrentUser(): BookshopUser {
  const { user } = useAuth()
  return user as BookshopUser
}

function Gate({ permission, children }: { permission: Permission; children: ReactNode }) {
  const user = useCurrentUser()
  return hasPermission(user, permission) ? <>{children}</> : <EmptyState icon={<ShieldCheck size={22} />} title="Not available" body="Your platform role does not include this area." />
}

function ShopStatus({ status }: { status: BookshopStatus }) {
  return <StatePill status={status} label={BOOKSHOP_STATUS_LABELS[status]} />
}

function OverviewView() {
  const user = useCurrentUser()
  const canBilling = hasPermission(user, 'platform.settings.view')
  const overview = useQuery({ queryKey: ['platform', 'overview'], queryFn: platformApi.overview })
  const revenue = useQuery({ queryKey: ['platform-bills', 'summary'], queryFn: () => billsApi.list({ page: 1 }), enabled: canBilling })
  const expiring = useQuery({ queryKey: ['platform-billing', 'subscriptions', 1, 'upcoming'], queryFn: () => billingApi.subscriptions(1, 'upcoming'), enabled: canBilling })

  if (overview.isPending) return <><PlatformTitle title="Platform overview" /><LoadingState /></>
  if (overview.error) return <><PlatformTitle title="Platform overview" /><ErrorState message={errorMessage(overview.error)} onRetry={() => void overview.refetch()} /></>
  const data = overview.data
  const summary = revenue.data?.summary
  const attention = [
    { label: 'Bookshops awaiting approval', count: data.bookshops.pending_verification, to: '/platform/bookshops?status=pending_verification', show: true },
    { label: 'Unmatched M-Pesa payments', count: summary?.unmatched_count ?? 0, to: '/platform/billing/payments', show: canBilling },
    { label: 'Payments waiting for Safaricom', count: summary?.pending_count ?? 0, to: '/platform/billing/payments', show: canBilling },
    { label: 'Subscriptions ending within 7 days', count: expiring.data?.total ?? 0, to: '/platform/billing/subscriptions?state=upcoming', show: canBilling },
    { label: 'Expired subscriptions', count: data.subscriptions.expired ?? 0, to: '/platform/billing/subscriptions?state=expired', show: canBilling },
    { label: 'Suspended bookshops', count: data.bookshops.suspended, to: '/platform/bookshops?status=suspended', show: true },
  ].filter(item => item.show && item.count > 0)

  return <>
    <PlatformTitle title="Platform overview" description="Bookshops, subscriptions and revenue across the platform. Bookshop business records are never shown here."
      actions={user.role === 'platform_owner' && <Link className={secondaryButton} to="/platform/management">Open a managed bookshop</Link>} />
    <MetricStrip label="Bookshops">
      <Metric label="Bookshops" value={data.bookshops.total} hint={`${data.bookshops.registered_last_30_days} new in the last 30 days`} />
      <Metric label="Active" value={data.bookshops.active} hint="Approved and operating" />
      <Metric label="Awaiting approval" value={data.bookshops.pending_verification} hint="Need verification or approval" />
      <Metric label="Suspended" value={data.bookshops.suspended} hint="Workspace access paused" tone={data.bookshops.suspended ? 'alert' : undefined} />
    </MetricStrip>
    <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      {canBilling ? <Panel title="Revenue" description="Verified M-Pesa collections against unpaid invoice balances." actions={<Link className="text-sm font-semibold text-[var(--pf-brand)] hover:underline" to="/platform/billing">Open billing</Link>}>
        {revenue.isPending ? <LoadingState /> : revenue.error ? <ErrorState message={errorMessage(revenue.error)} onRetry={() => void revenue.refetch()} /> : summary && <>
          <SplitBar collected={summary.verified_collections} outstanding={summary.outstanding_balance} />
          <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-[var(--pf-line)] pt-4 text-sm sm:grid-cols-3">
            <div><dt className="text-[var(--pf-muted)]">Collected today</dt><dd className="pf-num m-0 mt-0.5 font-semibold">{kes(summary.today_collections)}</dd></div>
            <div><dt className="text-[var(--pf-muted)]">Unpaid invoices</dt><dd className="pf-num m-0 mt-0.5 font-semibold">{summary.outstanding_invoices}</dd></div>
            <div><dt className="text-[var(--pf-muted)]">Payment mode</dt><dd className="m-0 mt-0.5 font-semibold capitalize">{summary.environment}</dd></div>
          </dl>
        </>}
      </Panel> : <Panel title="Accounts"><AccountCounts data={data.users} /></Panel>}
      <Panel title="Needs attention" flush>
        {attention.length === 0 ? <p className="flex items-center gap-2 px-5 py-6 text-sm text-[var(--pf-muted)]"><CheckCircle2 size={18} className="text-emerald-600" /> Nothing needs your attention right now.</p>
          : <ul className="m-0 list-none divide-y divide-[var(--pf-line)] p-0">{attention.map(item => <li key={item.label}>
            <Link to={item.to} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-slate-50">
              <AlertTriangle size={16} className="shrink-0 text-amber-600" aria-hidden="true" /><span className="flex-1">{item.label}</span>
              <span className="pf-num font-semibold">{item.count}</span><ChevronRight size={16} className="text-slate-400" aria-hidden="true" />
            </Link></li>)}</ul>}
      </Panel>
    </div>
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <Panel title="Subscriptions by status">
        <BarList label="Subscriptions by status" rows={Object.entries(data.subscriptions).map(([status, total]) => ({ key: status, label: humanize(status), value: total }))} />
      </Panel>
      {canBilling ? <Panel title="Accounts"><AccountCounts data={data.users} /></Panel> : null}
    </div>
    <div className="mt-6"><Panel title="Newest bookshops" flush actions={<Link className="text-sm font-semibold text-[var(--pf-brand)] hover:underline" to="/platform/bookshops">All bookshops</Link>}>
      {data.recent_bookshops.length === 0 ? <EmptyState icon={<Store size={22} />} title="No bookshops yet" body="Bookshops appear here as soon as an owner registers." />
        : <ul className="m-0 list-none divide-y divide-[var(--pf-line)] p-0">{data.recent_bookshops.map(shop => <li key={shop.id}>
          <Link to={`/platform/bookshops/${shop.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
            <span className="min-w-0"><strong className="block truncate text-sm font-semibold">{shop.name}</strong><small className="text-xs text-[var(--pf-muted)]">{shop.country}, registered {formatDate(shop.created_at)}</small></span>
            <ShopStatus status={shop.status} />
          </Link></li>)}</ul>}
    </Panel></div>
  </>
}

function AccountCounts({ data }: { data: { bookshop_staff: number; platform_staff: number; unassigned_legacy_staff: number } }) {
  return <dl className="grid gap-3 text-sm">
    <div className="flex justify-between"><dt className="text-[var(--pf-muted)]">Bookshop staff</dt><dd className="pf-num m-0 font-semibold">{data.bookshop_staff}</dd></div>
    <div className="flex justify-between"><dt className="text-[var(--pf-muted)]">Platform staff</dt><dd className="pf-num m-0 font-semibold">{data.platform_staff}</dd></div>
    {data.unassigned_legacy_staff > 0 && <div className="flex justify-between text-amber-700"><dt>Legacy staff not yet in a bookshop</dt><dd className="pf-num m-0 font-semibold">{data.unassigned_legacy_staff}</dd></div>}
  </dl>
}

function ManagementView() {
  const user = useCurrentUser()
  if (user.role !== 'platform_owner') return <EmptyState icon={<ShieldCheck size={22} />} title="Access restricted" body="Bookshop management requires explicit Platform Owner authorization." />
  return <ManagedBookshops />
}

function ManagedBookshops() {
  const shops = useQuery({ queryKey: ['platform', 'managed-bookshops'], queryFn: platformApi.managedBookshops })
  const enter = useMutation({ mutationFn: enterBookshopManagement })
  return <>
    <PlatformTitle title="Bookshop management" description="Work inside a bookshop's own workspace. Only businesses explicitly authorized for your account appear here, and every action is recorded." />
    {enter.error && <div className="mb-4"><FormAlert message={errorMessage(enter.error)} /></div>}
    {shops.isPending ? <LoadingState /> : shops.error ? <ErrorState message={errorMessage(shops.error)} onRetry={() => void shops.refetch()} /> : shops.data.length === 0
      ? <EmptyState icon={<Building2 size={22} />} title="Original bookshop awaiting authorization" body="The server administrator must verify and restore the original bookshop before it can be managed here." />
      : <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{shops.data.map(shop => <Panel key={shop.id}>
        <div className="flex items-start justify-between gap-3"><h2 className="text-base font-semibold">{shop.name}</h2><ShopStatus status={shop.status} /></div>
        <p className="mt-1 text-sm text-[var(--pf-muted)]">{shop.location || shop.country}</p>
        <button type="button" className={`${primaryButton} mt-4 w-full`} disabled={enter.isPending || shop.status !== 'active'} onClick={() => enter.mutate(shop.id)}>{enter.isPending ? 'Opening…' : 'Open bookshop workspace'}</button>
      </Panel>)}</div>}
  </>
}

function BookshopsView() {
  const user = useCurrentUser()
  const client = useQueryClient()
  const [params, setParams] = useSearchParams()
  const canOnboard = hasPermission(user, 'platform.bookshops.onboard')
  const [createOpen, setCreateOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState(params.get('q') ?? '')
  const [status, setStatus] = useState(params.get('status') ?? '')
  const [page, setPage] = useState(1)
  const [selectedShop, setSelectedShop] = useState<number | null>(null)

  // The header search and "New bookshop" quick action arrive as ?q= and ?create=1.
  useEffect(() => {
    const q = params.get('q'); const filter = params.get('status')
    if (q !== null) { setSearch(q); setPage(1) }
    if (filter !== null) { setStatus(filter); setPage(1) }
    if (params.get('create') === '1') {
      if (canOnboard) { setNotice(''); setCreateOpen(true) }
      const next = new URLSearchParams(params); next.delete('create'); setParams(next, { replace: true })
    }
  }, [params, setParams, canOnboard])

  const list = useQuery({ queryKey: ['platform', 'bookshops', search, status, page], queryFn: () => platformApi.bookshops({ search: search.trim() || undefined, status: status || undefined, page }), placeholderData: keepPreviousData })
  return <>
    <PlatformTitle title="Bookshops" description="Every registered bookshop, its owner and subscription state."
      actions={canOnboard && <button type="button" className={primaryButton} onClick={() => { setNotice(''); setCreateOpen(true) }}>Create bookshop</button>} />
    {notice && <div className="mb-4"><p className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800" role="status">{notice}</p></div>}
    {createOpen && canOnboard && <Modal title="Create bookshop" description="Add a shop and its separate owner account." icon={<Store size={18} />} wide busy={creating} onClose={() => { if (!creating) setCreateOpen(false) }}>
      <BookshopRegisterPage platformMode embedded onPendingChange={setCreating} onCancel={() => setCreateOpen(false)} onCreated={message => {
        setCreateOpen(false); setNotice(message)
        void client.invalidateQueries({ queryKey: ['platform'] })
      }} />
    </Modal>}
    <Panel flush>
      <Toolbar>
        <SearchField label="Search bookshops" value={search} onChange={value => { setSearch(value); setPage(1) }} placeholder="Name, code or email" />
        <SelectField label="Status" hideLabel value={status} onChange={value => { setStatus(value); setPage(1) }}>
          <option value="">All statuses</option>{Object.entries(BOOKSHOP_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </SelectField>
      </Toolbar>
      {list.isPending ? <LoadingState /> : list.error ? <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        : list.data.data.length === 0 ? <EmptyState icon={<Store size={22} />} title="No bookshops found" body="Try a different search or status." />
        : <table className="w-full text-sm">
          <thead className="border-b border-[var(--pf-line)] bg-slate-50/70"><tr>
            <th className={thClass}>Bookshop</th><th className={`${thClass} hidden md:table-cell`}>Owner</th><th className={`${thClass} hidden lg:table-cell`}>Branches / staff</th>
            <th className={`${thClass} hidden sm:table-cell`}>Subscription</th><th className={thClass}>Status</th><th className={thClass}><span className="sr-only">Actions</span></th>
          </tr></thead>
          <tbody className="divide-y divide-[var(--pf-line)]">{list.data.data.map(shop => <tr key={shop.id} className="hover:bg-slate-50/70">
            <td className={tdClass}><Link to={`/platform/bookshops/${shop.id}`} className="font-semibold text-[var(--pf-ink)] hover:text-[var(--pf-brand)]">{shop.name}</Link><small className="block text-xs text-[var(--pf-muted)]"><span className="hidden sm:inline">{shop.slug}, </span>{shop.country}</small></td>
            <td className={`${tdClass} hidden md:table-cell`}>{shop.owner ? <><span>{shop.owner.name}</span><small className="block text-xs text-[var(--pf-muted)]">{shop.owner.email}{!shop.owner.email_verified && ' (unverified)'}</small></> : '—'}</td>
            <td className={`${tdClass} pf-num hidden text-[var(--pf-muted)] lg:table-cell`}>{shop.branches_count ?? 0} / {shop.staff_count ?? 0}</td>
            <td className={`${tdClass} hidden sm:table-cell`}>{shop.subscription ? <span className="flex flex-col items-start gap-1"><StatePill status={shop.subscription.status} />{shop.subscription.trial_days_left !== null && <small className="text-xs text-[var(--pf-muted)]">{shop.subscription.trial_days_left} trial days left</small>}</span> : <span className="text-[var(--pf-muted)]">—</span>}</td>
            <td className={tdClass}><ShopStatus status={shop.status} /></td>
            <td className={`${tdClass} text-right`}><button type="button" className="inline-grid size-9 place-items-center rounded-lg border border-[var(--pf-line)] bg-white text-slate-600 hover:bg-slate-50" title={`View and manage ${shop.name}`} aria-label={`View and manage ${shop.name}`} onClick={() => setSelectedShop(shop.id)}><Eye size={16} /></button></td>
          </tr>)}</tbody>
        </table>}
      {list.data && list.data.meta.total > 0 && <PageControls page={list.data.meta} onPage={setPage} />}
    </Panel>
    {selectedShop !== null && <BookshopManageModal id={selectedShop} onClose={() => setSelectedShop(null)} />}
  </>
}

function DetailList({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="m-0 grid gap-3 text-sm">{rows.map(([label, value]) => <div key={label} className="grid grid-cols-[minmax(0,8.5rem)_1fr] gap-3"><dt className="text-[var(--pf-muted)]">{label}</dt><dd className="m-0 min-w-0 break-words">{value}</dd></div>)}</dl>
}

function BookshopManageModal({ id, onClose }: { id: number; onClose: () => void }) {
  const user = useCurrentUser()
  const client = useQueryClient()
  const detail = useQuery({ queryKey: ['platform', 'bookshop', id], queryFn: () => platformApi.bookshop(id) })
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ name: '', business_email: '', phone: '', location: '' })
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const save = useMutation({
    mutationFn: () => platformApi.updateBookshop(id, form),
    onSuccess: result => { setNotice(result.message); setEditing(false); void client.invalidateQueries({ queryKey: ['platform'] }) },
    onError: e => setError(errorMessage(e)),
  })
  const approve = useMutation({
    mutationFn: () => platformApi.approve(id),
    onSuccess: result => { setNotice(result.message); void client.invalidateQueries({ queryKey: ['platform'] }) },
    onError: e => setError(errorMessage(e)),
  })
  const shop = detail.data
  return <Modal title={shop ? `Manage ${shop.name}` : 'Manage bookshop'} description="Review registration, update business details and manage activation." wide onClose={onClose} busy={save.isPending || approve.isPending}>
    {detail.isPending ? <LoadingState /> : detail.error ? <ErrorState message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} /> : shop && <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2"><ShopStatus status={shop.status} /><Link className={secondaryButton} to={`/platform/bookshops/${id}`} onClick={onClose}>Full management page</Link></div>
      {notice && <FormAlert tone="success" message={notice} />}
      {error && <FormAlert message={error} />}
      <DetailList rows={[['Owner', `${shop.owner?.name || '—'} (${shop.owner?.email || '—'})`], ['Registered', formatDate(shop.registered_at, true)], ['Branches / staff', `${shop.branches_count ?? 0} / ${shop.staff_count ?? 0}`]]} />
      {editing ? <form className="grid gap-3 border-t border-slate-100 pt-4" onSubmit={e => { e.preventDefault(); save.mutate() }}>
        <Field label="Bookshop name"><input required className={inputClass} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
        <Field label="Business email"><input type="email" className={inputClass} value={form.business_email} onChange={e => setForm({ ...form, business_email: e.target.value })} /></Field>
        <Field label="Phone"><input className={inputClass} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></Field>
        <Field label="Location"><input className={inputClass} value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} /></Field>
        <div className="flex gap-2"><button className={primaryButton} type="submit" disabled={save.isPending}>Save changes</button><button type="button" className={secondaryButton} onClick={() => setEditing(false)}>Cancel</button></div>
      </form> : <div className="border-t border-slate-100 pt-4"><DetailList rows={[['Bookshop', shop.name], ['Business email', shop.business_email || '—'], ['Phone', shop.phone || '—'], ['Location', shop.location || '—']]} /></div>}
      {user.role === 'platform_owner' && <div className="flex flex-wrap gap-2">
        {!editing && <button type="button" className={secondaryButton} onClick={() => { setForm({ name: shop.name, business_email: shop.business_email || '', phone: shop.phone || '', location: shop.location || '' }); setEditing(true); setError('') }}><Pencil size={16} /> Edit details</button>}
        {shop.status === 'pending_verification' && <button type="button" className={primaryButton} disabled={approve.isPending} onClick={() => approve.mutate()}>Approve & activate</button>}
      </div>}
    </div>}
  </Modal>
}

function BookshopDetailView() {
  const id = Number(useParams().id)
  const user = useCurrentUser()
  const client = useQueryClient()
  const shop = useQuery({ queryKey: ['platform', 'bookshop', id], queryFn: () => platformApi.bookshop(id) })
  const [dialog, setDialog] = useState<'suspend' | 'reactivate' | null>(null)
  const [extending, setExtending] = useState(false)
  const [notice, setNotice] = useState('')
  const canExtendTrial = hasPermission(user, 'platform.subscriptions.extend_trial')
  const trial = useQuery({ queryKey: ['platform-billing', 'trials', 'bookshop', id], queryFn: () => trialApi.subscriptions({ bookshop_id: id }), enabled: canExtendTrial })
  const trialRow = trial.data?.data.find(row => row.bookshop_id === id)
  const approve = useMutation({ mutationFn: () => platformApi.approve(id), onSuccess: result => { setNotice(result.message); void client.invalidateQueries({ queryKey: ['platform'] }) }, onError: error => setNotice(errorMessage(error)) })

  if (shop.isPending) return <LoadingState />
  if (shop.error) return <ErrorState message={errorMessage(shop.error)} onRetry={() => void shop.refetch()} />
  const data = shop.data
  const done = (message: string) => { setDialog(null); setNotice(message); void client.invalidateQueries({ queryKey: ['platform'] }) }

  return <>
    <Link to="/platform/bookshops" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--pf-muted)] hover:text-[var(--pf-ink)]"><ArrowLeft size={15} /> All bookshops</Link>
    <PlatformTitle title={data.name} description={`${data.location || 'No location'}, ${data.country}. Prices in ${data.currency}.`} meta={<><ShopStatus status={data.status} /><span className="text-xs text-[var(--pf-muted)]">Code {data.slug}</span></>}
      actions={<>
        {user.role === 'platform_owner' && data.status === 'pending_verification' && <button className={primaryButton} onClick={() => approve.mutate()} disabled={approve.isPending}>{approve.isPending ? 'Approving…' : 'Approve & activate'}</button>}
        {hasPermission(user, 'platform.bookshops.suspend') && (data.status === 'suspended'
          ? <button className={primaryButton} onClick={() => setDialog('reactivate')}>Reactivate</button>
          : <button className={dangerButton} onClick={() => setDialog('suspend')}>Suspend</button>)}
      </>} />
    {notice && <div className="mb-5"><FormAlert tone="success" message={notice} /></div>}
    {data.status === 'suspended' && <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="status"><strong>Suspended {formatDate(data.suspended_at, true)}.</strong> {data.suspension_reason}</div>}
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="grid min-w-0 content-start gap-6">
        <Panel title="Subscription">{data.subscription ? <div className="grid gap-4">
          <DetailList rows={[
            ['Plan', data.subscription.plan?.name || '—'],
            ['Status', <StatePill key="s" status={data.subscription.status} />],
            ['Trial ends', formatDate(data.subscription.trial_ends_at)],
            ...(data.subscription.trial_days_left !== null ? [['Trial days left', String(data.subscription.trial_days_left)] as [string, ReactNode]] : []),
            ...(data.subscription.current_period_ends_at ? [['Paid until', formatDate(data.subscription.current_period_ends_at)] as [string, ReactNode]] : []),
          ]} />
          {trialRow?.eligible && <div><button className={secondaryButton} onClick={() => { setNotice(''); setExtending(true) }}><CalendarPlus size={15} /> Extend Trial</button></div>}
        </div> : <p className="text-sm text-[var(--pf-muted)]">No subscription record (legacy bookshop).</p>}</Panel>
        <Panel title="Lifecycle history" description="Registration, activation, suspension and support actions." flush>
          {data.history.length === 0 ? <EmptyState icon={<History size={22} />} title="No history yet" body="Lifecycle events will appear here." />
            : <ol className="m-0 list-none divide-y divide-[var(--pf-line)] p-0">{data.history.map(entry => <li key={entry.id} className="px-5 py-3 text-sm"><p className="m-0">{entry.description}</p><small className="text-xs text-[var(--pf-muted)]">{formatDate(entry.created_at, true)}{entry.user ? `, by ${entry.user.name}` : ''}</small></li>)}</ol>}
        </Panel>
        {data.subscription_history?.length > 0 && <Panel title="Subscription history" flush>
          <ol className="m-0 list-none divide-y divide-[var(--pf-line)] p-0">{data.subscription_history.map((entry, index) => <li key={`${entry.created_at}-${index}`} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3 text-sm">
            <span><span className="font-medium">{humanize(entry.event)}</span>{entry.note && <small className="block text-xs text-[var(--pf-muted)]">{entry.note}</small>}</span>
            <span className="flex items-center gap-2">{entry.from_status && <StatePill status={entry.from_status} />}{entry.from_status && <ChevronRight size={14} className="text-slate-400" aria-label="to" />}<StatePill status={entry.to_status} /><time className="text-xs text-[var(--pf-muted)]">{formatDate(entry.created_at, true)}</time></span>
          </li>)}</ol>
        </Panel>}
      </div>
      <div className="grid content-start gap-6">
        <Panel title="Owner">{data.owner ? <DetailList rows={[['Name', data.owner.name], ['Email', data.owner.email], ['Phone', data.owner.phone || '—'], ['Last sign-in', formatDate(data.owner.last_login_at ?? null, true)]]} /> : <p className="text-sm text-[var(--pf-muted)]">No owner account.</p>}</Panel>
        <Panel title="Bookshop"><DetailList rows={[['Registered', formatDate(data.registered_at, true)], ['Approved', formatDate(data.verified_at, true)], ['Business email', data.business_email || '—'], ['Phone', data.phone || '—'], ['Branches / staff', `${data.branches_count ?? 0} / ${data.staff_count ?? 0}`]]} /></Panel>
      </div>
    </div>
    {extending && trialRow && trial.data && <ExtendTrialModal target={trialRow} maxDays={trial.data.max_days} onClose={() => setExtending(false)} onDone={message => { setExtending(false); setNotice(message) }} />}
    {dialog && <StatusDialog shop={data} mode={dialog} onClose={() => setDialog(null)} onDone={done} />}
  </>
}

function StatusDialog({ shop, mode, onClose, onDone }: { shop: PlatformBookshop; mode: 'suspend' | 'reactivate'; onClose: () => void; onDone: (message: string) => void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try { onDone((mode === 'suspend' ? await platformApi.suspend(shop.id, text) : await platformApi.reactivate(shop.id, text)).message) }
    catch (e) { setError(e instanceof ApiError ? (e.field('reason') || e.message) : errorMessage(e)); setBusy(false) }
  }
  return <Modal title={mode === 'suspend' ? `Suspend ${shop.name}?` : `Reactivate ${shop.name}?`} description={mode === 'suspend' ? 'Staff lose workspace access immediately. No records are changed or deleted.' : 'Staff regain access to the workspace.'} onClose={onClose} busy={busy}>
    <form onSubmit={submit} className="grid gap-4">
      <Field label={mode === 'suspend' ? 'Reason (shown to the bookshop owner)' : 'Note (optional)'}>
        <textarea className={`${inputClass} h-24 py-2`} value={text} onChange={e => setText(e.target.value)} required={mode === 'suspend'} />
      </Field>
      <FormAlert message={error} />
      <ModalActions busy={busy} submitLabel={mode === 'suspend' ? 'Suspend bookshop' : 'Reactivate'} busyLabel="Saving…" onCancel={onClose} danger={mode === 'suspend'} />
    </form>
  </Modal>
}

function UsersView() {
  const user = useCurrentUser()
  const client = useQueryClient()
  const users = useQuery({ queryKey: ['platform', 'users'], queryFn: platformApi.users })
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState('')
  const toggle = useMutation({ mutationFn: (target: { id: number; is_active: boolean }) => platformApi.setUserStatus(target.id, target.is_active), onSuccess: result => { setNotice(result.message); void client.invalidateQueries({ queryKey: ['platform', 'users'] }) }, onError: error => setNotice(errorMessage(error)) })
  const canManage = hasPermission(user, 'platform.users.manage')
  return <>
    <PlatformTitle title="Platform users" description="People who administer the platform. Platform Owners are created from the server console only."
      actions={canManage && <button className={primaryButton} onClick={() => setCreating(true)}><UserPlus size={16} /> Add administrator</button>} />
    {notice && <div className="mb-5"><FormAlert tone="success" message={notice} /></div>}
    <Panel flush>
      {users.isPending ? <LoadingState /> : users.error ? <ErrorState message={errorMessage(users.error)} onRetry={() => void users.refetch()} />
        : <table className="w-full text-sm">
          <thead className="border-b border-[var(--pf-line)] bg-slate-50/70"><tr><th className={thClass}>Name</th><th className={`${thClass} hidden sm:table-cell`}>Role</th><th className={`${thClass} hidden md:table-cell`}>Last sign-in</th><th className={thClass}>Status</th><th className={thClass}><span className="sr-only">Actions</span></th></tr></thead>
          <tbody className="divide-y divide-[var(--pf-line)]">{users.data.map(member => <tr key={member.id}>
            <td className={tdClass}><strong className="font-semibold">{member.name}</strong><small className="block break-all text-xs text-[var(--pf-muted)]">{member.email}</small></td>
            <td className={`${tdClass} hidden sm:table-cell`}>{member.role_label}</td>
            <td className={`${tdClass} hidden text-[var(--pf-muted)] md:table-cell`}>{formatDate(member.last_login_at)}</td>
            <td className={tdClass}><Pill tone={member.is_active ? 'positive' : 'neutral'}>{member.is_active ? 'Active' : 'Inactive'}</Pill></td>
            <td className={`${tdClass} text-right`}>{canManage && member.role !== 'platform_owner' && member.id !== user.id && <button className={`${secondaryButton} h-9`} onClick={() => toggle.mutate({ id: member.id, is_active: !member.is_active })}>{member.is_active ? 'Deactivate' : 'Activate'}</button>}</td>
          </tr>)}</tbody>
        </table>}
    </Panel>
    {creating && <CreateAdminDialog onClose={() => setCreating(false)} onDone={message => { setCreating(false); setNotice(message); void client.invalidateQueries({ queryKey: ['platform', 'users'] }) }} />}
  </>
}

function CreateAdminDialog({ onClose, onDone }: { onClose: () => void; onDone: (message: string) => void }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', password_confirmation: '' })
  const [error, setError] = useState<ApiError | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null); setMessage('')
    try { onDone((await platformApi.createUser({ ...form, role: 'platform_admin' })).message) }
    catch (e) { if (e instanceof ApiError) { setError(e); setMessage(e.message) } else setMessage(errorMessage(e)); setBusy(false) }
  }
  return <Modal title="Add platform administrator" description="Administrators support onboarding. They cannot suspend bookshops, change settings or manage platform staff." icon={<UserPlus size={18} />} onClose={onClose} busy={busy}>
    <form onSubmit={submit} className="grid gap-4">
      {(['name', 'email', 'password', 'password_confirmation'] as const).map(key => <Field key={key} label={{ name: 'Full name', email: 'Email', password: 'Password', password_confirmation: 'Confirm password' }[key]} error={error?.field(key)}>
        <input className={inputClass} type={key.startsWith('password') ? 'password' : key === 'email' ? 'email' : 'text'} autoComplete={key.startsWith('password') ? 'new-password' : undefined} value={form[key]} onChange={e => setForm(current => ({ ...current, [key]: e.target.value }))} required />
      </Field>)}
      <FormAlert message={message} />
      <ModalActions busy={busy} submitLabel="Create administrator" busyLabel="Creating…" onCancel={onClose} />
    </form>
  </Modal>
}

function SettingsView() {
  const user = useCurrentUser()
  const client = useQueryClient()
  const settings = useQuery({ queryKey: ['platform', 'settings'], queryFn: platformApi.settings })
  const [draft, setDraft] = useState<{ open: boolean; email: string; trial: string } | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const save = useMutation({
    mutationFn: () => platformApi.updateSettings({ bookshop_registration_open: draft!.open, support_email: draft!.email.trim() || null, trial_days: draft!.trial === '' ? null : Number(draft!.trial) }),
    onSuccess: result => { setMessage({ tone: 'success', text: result.message }); setDraft(null); void client.invalidateQueries({ queryKey: ['platform', 'settings'] }) },
    onError: error => setMessage({ tone: 'error', text: errorMessage(error) }),
  })
  if (settings.isPending) return <><PlatformTitle title="Platform settings" /><LoadingState /></>
  if (settings.error) return <><PlatformTitle title="Platform settings" /><ErrorState message={errorMessage(settings.error)} onRetry={() => void settings.refetch()} /></>
  const value = draft ?? { open: settings.data.bookshop_registration_open, email: settings.data.support_email ?? '', trial: settings.data.trial_days === null ? '' : String(settings.data.trial_days) }
  const canEdit = hasPermission(user, 'platform.settings.manage')
  return <>
    <PlatformTitle title="Platform settings" description="Global settings that apply to every bookshop." />
    <form className="grid max-w-3xl gap-6" onSubmit={event => { event.preventDefault(); save.mutate() }}>
      <Panel title="Registration" description="Whether new bookshops can sign up on their own.">
        <label className="hk-check"><input type="checkbox" checked={value.open} disabled={!canEdit} onChange={e => setDraft({ ...value, open: e.target.checked })} /><span>Accept new bookshop registrations<small>When off, the public bookshop sign-up form is paused.</small></span></label>
      </Panel>
      <Panel title="Support and trials">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Support email" hint="Shown to bookshops that need help."><input className={inputClass} type="email" value={value.email} disabled={!canEdit} onChange={e => setDraft({ ...value, email: e.target.value })} /></Field>
          <Field label="Trial length (days)" hint={`Applies to new bookshops. Leave empty to use the server default of ${settings.data.default_trial_days} days.`}><input className={inputClass} type="number" min={0} max={365} value={value.trial} disabled={!canEdit} onChange={e => setDraft({ ...value, trial: e.target.value })} /></Field>
        </div>
        {hasPermission(user, 'platform.subscriptions.extend_trial') && <p className="mt-4 text-sm text-[var(--pf-muted)]">To give one bookshop more trial time, use <Link className="font-semibold text-[var(--pf-brand)] hover:underline" to="/platform/billing/trials">Trial management</Link>.</p>}
      </Panel>
      {message && <FormAlert tone={message.tone} message={message.text} />}
      {canEdit ? <div className="flex justify-end"><button className={primaryButton} type="submit" disabled={save.isPending || !draft}>{save.isPending ? 'Saving…' : 'Save settings'}</button></div>
        : <p className="text-sm text-[var(--pf-muted)]">Your role can view these settings but not change them.</p>}
    </form>
  </>
}

function AuditView() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const audit = useQuery({ queryKey: ['platform', 'audit', search, page], queryFn: () => platformApi.audit({ search: search.trim() || undefined, page }), placeholderData: keepPreviousData })
  return <>
    <PlatformTitle title="Audit history" description="Platform administration, billing and bookshop lifecycle events. Activity inside bookshops stays in each bookshop's own audit log." />
    <Panel flush>
      <Toolbar><SearchField label="Search events" value={search} onChange={value => { setSearch(value); setPage(1) }} placeholder="Search descriptions" /></Toolbar>
      {audit.isPending ? <LoadingState /> : audit.error ? <ErrorState message={errorMessage(audit.error)} onRetry={() => void audit.refetch()} />
        : audit.data.data.length === 0 ? <EmptyState icon={<History size={22} />} title="No events" body="Platform events will appear here." />
        : <ol className="m-0 list-none divide-y divide-[var(--pf-line)] p-0">{audit.data.data.map(entry => <li key={entry.id} className="flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <span className="min-w-0"><span className="block">{entry.description}</span><small className="text-xs text-[var(--pf-muted)]">{humanize(entry.action.split('.')[0])} event{entry.user ? `, by ${entry.user.name}` : ''}</small></span>
          <time className="shrink-0 text-xs text-[var(--pf-muted)]">{formatDate(entry.created_at, true)}</time>
        </li>)}</ol>}
      {audit.data && audit.data.meta.total > 0 && <PageControls page={audit.data.meta} onPage={setPage} />}
    </Panel>
  </>
}
