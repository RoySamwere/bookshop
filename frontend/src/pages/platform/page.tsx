import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, NavLink, Outlet, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, ArrowLeft, Building2, CircleCheck, Gauge, History, LogOut, Menu, Search, Settings, ShieldCheck, Store, UserPlus, Users, X } from 'lucide-react'
import { useRouter } from '@/lib/navigation'
import BrandLoader from '../../components/brand-loader'
import { BrandMark } from '../../components/brand-mark'
import {
  Card, EmptyState, ErrorState, Field, FormAlert, LoadingState, Modal, ModalActions, PageHeader, Pagination, StatCard, StatusBadge,
  dangerButton, formatDate, inputClass, primaryButton, secondaryButton,
} from '../../components/ui-kit'
import { useAuth } from '../../features/auth/auth-provider'
import { ApiError, errorMessage } from '../../lib/api'
import { hasPermission, homeFor, logout, type BookshopUser, type Permission } from '../../lib/auth'
import { BOOKSHOP_STATUS_LABELS, platformApi, type PlatformBookshop } from '../../lib/tenancy-api'

/** The Platform Owner console at /platform. Separate from every bookshop workspace; it shows tenant metadata only. */
export default function PlatformPage() {
  return <Routes>
    <Route element={<PlatformShell />}>
      <Route index element={<OverviewView />} />
      <Route path="bookshops" element={<BookshopsView />} />
      <Route path="bookshops/:id" element={<BookshopDetailView />} />
      <Route path="users" element={<Gate permission="platform.users.view"><UsersView /></Gate>} />
      <Route path="plans" element={<Gate permission="platform.plans.view"><PlansView /></Gate>} />
      <Route path="settings" element={<Gate permission="platform.settings.view"><SettingsView /></Gate>} />
      <Route path="audit" element={<Gate permission="platform.audit.view"><AuditView /></Gate>} />
      <Route path="*" element={<Navigate replace to="/platform" />} />
    </Route>
  </Routes>
}

const nav: { to: string; label: string; icon: typeof Gauge; permission: Permission }[] = [
  { to: '/platform', label: 'Overview', icon: Gauge, permission: 'platform.access' },
  { to: '/platform/bookshops', label: 'Bookshops', icon: Store, permission: 'platform.bookshops.view' },
  { to: '/platform/users', label: 'Platform users', icon: Users, permission: 'platform.users.view' },
  { to: '/platform/plans', label: 'Subscription plans', icon: Building2, permission: 'platform.plans.view' },
  { to: '/platform/settings', label: 'Settings', icon: Settings, permission: 'platform.settings.view' },
  { to: '/platform/audit', label: 'Audit history', icon: History, permission: 'platform.audit.view' },
]

function useCurrentUser(): BookshopUser {
  const { user } = useAuth()
  return user as BookshopUser
}

function PlatformShell() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  if (loading) return <BrandLoader />
  if (!user) return <Navigate replace to={`/login?next=${encodeURIComponent(location.pathname)}`} />
  if (user.account_type !== 'platform' || !hasPermission(user, 'platform.access')) return <Navigate replace to={homeFor(user)} />

  const links = nav.filter(item => hasPermission(user, item.permission))
  const sidebar = <nav aria-label="Platform navigation" className="flex flex-col gap-1">
    {links.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/platform'} onClick={() => setOpen(false)}
      className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}>
      <Icon size={18} aria-hidden="true" />{label}
    </NavLink>)}
  </nav>

  return <div className="min-h-screen bg-slate-100 lg:pl-64">
    <a className="skip-link" href="#platform-content">Skip to content</a>
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-slate-950 px-4 py-5 text-white transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`} aria-label="Platform console">
      <div className="mb-8 flex items-center gap-3 px-2">
        <BrandMark size={36} />
        <div><strong className="block text-sm">Hekima Platform</strong><span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-amber-400">Owner console</span></div>
        <button className="ml-auto grid size-8 place-items-center rounded-lg text-slate-400 hover:bg-white/10 lg:hidden" onClick={() => setOpen(false)} aria-label="Close navigation"><X size={18} /></button>
      </div>
      {sidebar}
      <div className="mt-auto rounded-xl bg-white/5 p-3 text-xs text-slate-400">
        <p className="m-0 font-semibold text-white">{user.name}</p>
        <p className="m-0 mt-0.5">{user.role_label}</p>
        <button className="mt-3 flex items-center gap-2 font-semibold text-slate-300 hover:text-white" onClick={() => void logout().then(() => router.replace('/login?signed_out=1'))}><LogOut size={14} /> Sign out</button>
      </div>
    </aside>
    {open && <div className="fixed inset-0 z-30 bg-slate-950/50 lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}
    <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur lg:hidden">
      <button className="grid size-9 place-items-center rounded-lg hover:bg-slate-100" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
      <strong className="text-sm">Platform console</strong>
    </header>
    <main id="platform-content" tabIndex={-1} className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8 sm:py-8"><Outlet /></main>
  </div>
}

function Gate({ permission, children }: { permission: Permission; children: ReactNode }) {
  const user = useCurrentUser()
  return hasPermission(user, permission) ? <>{children}</> : <EmptyState icon={<ShieldCheck size={22} />} title="Not available" body="Your platform role does not include this area." />
}

function StatusPill({ status }: { status: PlatformBookshop['status'] }) {
  const tone = status === 'active' ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/10' : status === 'suspended' ? 'bg-rose-50 text-rose-700 ring-rose-600/10' : 'bg-amber-50 text-amber-700 ring-amber-600/10'
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${tone}`}><span className="size-1.5 rounded-full bg-current" />{BOOKSHOP_STATUS_LABELS[status]}</span>
}

function OverviewView() {
  const overview = useQuery({ queryKey: ['platform', 'overview'], queryFn: platformApi.overview })
  return <>
    <PageHeader eyebrow="PLATFORM" icon={<Gauge size={15} />} title="Platform overview" description="Bookshops, subscriptions and accounts across the platform. Bookshop business records are never shown here." />
    {overview.isPending ? <LoadingState /> : overview.error ? <ErrorState message={errorMessage(overview.error)} onRetry={() => void overview.refetch()} /> : <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Bookshops" value={overview.data.bookshops.total} hint={`${overview.data.bookshops.registered_last_30_days} registered in the last 30 days`} icon={<Store size={18} />} />
        <StatCard label="Active" value={overview.data.bookshops.active} hint="Verified and operating" icon={<CircleCheck size={18} />} tone="emerald" />
        <StatCard label="Awaiting verification" value={overview.data.bookshops.pending_verification} hint="Owner has not confirmed email" icon={<Activity size={18} />} tone="amber" />
        <StatCard label="Suspended" value={overview.data.bookshops.suspended} hint="Workspace access paused" icon={<ShieldCheck size={18} />} tone="pink" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Subscriptions" description="Trial and billing state (no payments are processed yet).">
          <dl className="grid grid-cols-2 gap-3 text-sm">{Object.entries(overview.data.subscriptions).map(([status, total]) => <div key={status} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2"><dt className="capitalize text-slate-500">{status.replace('_', ' ')}</dt><dd className="m-0 font-semibold text-slate-900">{total}</dd></div>)}</dl>
        </Card>
        <Card title="Accounts" description="People using the platform.">
          <dl className="grid gap-3 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Bookshop staff</dt><dd className="m-0 font-semibold">{overview.data.users.bookshop_staff}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Platform staff</dt><dd className="m-0 font-semibold">{overview.data.users.platform_staff}</dd></div>
            {overview.data.users.unassigned_legacy_staff > 0 && <div className="flex justify-between text-amber-700"><dt>Legacy staff not yet in a bookshop</dt><dd className="m-0 font-semibold">{overview.data.users.unassigned_legacy_staff}</dd></div>}
          </dl>
        </Card>
      </div>
      <div className="mt-6"><Card title="Newest bookshops" flush>
        {overview.data.recent_bookshops.length === 0 ? <EmptyState icon={<Store size={22} />} title="No bookshops yet" body="Bookshops appear here as soon as an owner registers." />
          : <ul className="m-0 list-none divide-y divide-slate-100 p-0">{overview.data.recent_bookshops.map(shop => <li key={shop.id}><Link to={`/platform/bookshops/${shop.id}`} className="flex items-center justify-between gap-3 px-6 py-3 hover:bg-slate-50"><span><strong className="text-sm text-slate-900">{shop.name}</strong><small className="block text-xs text-slate-400">{shop.country} · {formatDate(shop.created_at)}</small></span><StatusPill status={shop.status} /></Link></li>)}</ul>}
      </Card></div>
    </>}
  </>
}

function PlansView() {
  const plans = useQuery({ queryKey: ['platform', 'plans'], queryFn: platformApi.plans })
  return <>
    <PageHeader eyebrow="PLATFORM" icon={<Building2 size={15} />} title="Subscription plans" description="Available plans, prices and trial periods." />
    {plans.isPending ? <LoadingState /> : plans.error ? <ErrorState message={errorMessage(plans.error)} onRetry={() => void plans.refetch()} /> :
      <div className="grid gap-4 sm:grid-cols-2">{plans.data.map(plan => <Card key={plan.id} title={plan.name} description={plan.description || undefined}>
        <p className="font-semibold">{plan.currency} {plan.price} / {plan.billing_interval}</p>
        <p className="text-sm text-slate-500">{plan.trial_days} trial days · {plan.is_active ? 'Active' : 'Inactive'}</p>
      </Card>)}</div>}
  </>
}

function BookshopsView() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const list = useQuery({ queryKey: ['platform', 'bookshops', search, status, page], queryFn: () => platformApi.bookshops({ search: search.trim() || undefined, status: status || undefined, page }), placeholderData: keepPreviousData })
  return <>
    <PageHeader eyebrow="PLATFORM" icon={<Store size={15} />} title="Bookshops" description="Every registered bookshop, its owner and subscription state." />
    <Card title="Directory" flush actions={<div className="flex flex-col gap-2 sm:flex-row">
      <label className="relative"><span className="sr-only">Search bookshops</span><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm sm:w-64" placeholder="Name, code or email" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} /></label>
      <label><span className="sr-only">Status</span><select className="h-10 rounded-xl border border-slate-200 px-3 text-sm" value={status} onChange={e => { setStatus(e.target.value); setPage(1) }}><option value="">All statuses</option>{Object.entries(BOOKSHOP_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>}>
      {list.isPending ? <LoadingState /> : list.error ? <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
        : list.data.data.length === 0 ? <EmptyState icon={<Store size={22} />} title="No bookshops found" body="Try a different search or status." />
        : <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm">
          <thead><tr className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400"><th className="px-6 py-3 font-semibold">Bookshop</th><th className="px-3 py-3 font-semibold">Owner</th><th className="px-3 py-3 font-semibold">Branches · staff</th><th className="px-3 py-3 font-semibold">Subscription</th><th className="px-3 py-3 font-semibold">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{list.data.data.map(shop => <tr key={shop.id} className="hover:bg-slate-50">
            <td className="px-6 py-3"><Link to={`/platform/bookshops/${shop.id}`} className="font-semibold text-slate-900 hover:text-[#087df5]">{shop.name}</Link><small className="block text-xs text-slate-400">{shop.slug} · {shop.country}</small></td>
            <td className="px-3 py-3">{shop.owner ? <><span className="text-slate-700">{shop.owner.name}</span><small className="block text-xs text-slate-400">{shop.owner.email}{!shop.owner.email_verified && ' · unverified'}</small></> : '—'}</td>
            <td className="px-3 py-3 text-slate-600">{shop.branches_count ?? 0} · {shop.staff_count ?? 0}</td>
            <td className="px-3 py-3 capitalize text-slate-600">{shop.subscription ? `${shop.subscription.status.replace('_', ' ')}${shop.subscription.trial_days_left !== null ? ` · ${shop.subscription.trial_days_left}d left` : ''}` : '—'}</td>
            <td className="px-3 py-3"><StatusPill status={shop.status} /></td>
          </tr>)}</tbody>
        </table></div>}
      {list.data && <Pagination meta={list.data.meta} onPage={setPage} />}
    </Card>
  </>
}

function BookshopDetailView() {
  const id = Number(useParams().id)
  const user = useCurrentUser()
  const client = useQueryClient()
  const shop = useQuery({ queryKey: ['platform', 'bookshop', id], queryFn: () => platformApi.bookshop(id) })
  const [dialog, setDialog] = useState<'suspend' | 'reactivate' | null>(null)
  const [notice, setNotice] = useState('')
  const resend = useMutation({ mutationFn: () => platformApi.resendOwnerVerification(id), onSuccess: result => setNotice(result.message), onError: error => setNotice(errorMessage(error)) })

  if (shop.isPending) return <LoadingState />
  if (shop.error) return <ErrorState message={errorMessage(shop.error)} onRetry={() => void shop.refetch()} />
  const data = shop.data
  const done = (message: string) => { setDialog(null); setNotice(message); void client.invalidateQueries({ queryKey: ['platform'] }) }

  return <>
    <Link to="/platform/bookshops" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 hover:text-slate-900"><ArrowLeft size={15} /> All bookshops</Link>
    <PageHeader eyebrow={data.slug.toUpperCase()} icon={<Building2 size={15} />} title={data.name} description={`${data.location || 'No location'} · ${data.country} · ${data.currency}`}
      actions={<>
        <StatusPill status={data.status} />
        {hasPermission(user, 'platform.bookshops.onboard') && data.owner && !data.owner.email_verified && <button className={secondaryButton} onClick={() => resend.mutate()} disabled={resend.isPending}>Resend owner verification</button>}
        {hasPermission(user, 'platform.bookshops.suspend') && (data.status === 'suspended'
          ? <button className={primaryButton} onClick={() => setDialog('reactivate')}>Reactivate</button>
          : <button className={dangerButton} onClick={() => setDialog('suspend')}>Suspend</button>)}
      </>} />
    {notice && <div className="mb-5"><FormAlert tone="success" message={notice} /></div>}
    {data.status === 'suspended' && <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="status"><strong>Suspended {formatDate(data.suspended_at, true)}.</strong> {data.suspension_reason}</div>}
    <div className="grid gap-6 lg:grid-cols-3">
      <Card title="Owner">{data.owner ? <dl className="grid gap-2 text-sm">
        <div><dt className="text-xs text-slate-400">Name</dt><dd className="m-0 font-medium">{data.owner.name}</dd></div>
        <div><dt className="text-xs text-slate-400">Email</dt><dd className="m-0 break-all">{data.owner.email} <StatusBadge active={data.owner.email_verified} activeLabel="Verified" inactiveLabel="Unverified" /></dd></div>
        <div><dt className="text-xs text-slate-400">Phone</dt><dd className="m-0">{data.owner.phone || '—'}</dd></div>
        <div><dt className="text-xs text-slate-400">Last sign-in</dt><dd className="m-0">{formatDate(data.owner.last_login_at ?? null, true)}</dd></div>
      </dl> : <p className="text-sm text-slate-500">No owner account.</p>}</Card>
      <Card title="Bookshop"><dl className="grid gap-2 text-sm">
        <div><dt className="text-xs text-slate-400">Registered</dt><dd className="m-0">{formatDate(data.registered_at, true)}</dd></div>
        <div><dt className="text-xs text-slate-400">Verified</dt><dd className="m-0">{formatDate(data.verified_at, true)}</dd></div>
        <div><dt className="text-xs text-slate-400">Business contact</dt><dd className="m-0 break-all">{data.business_email || '—'} · {data.phone || '—'}</dd></div>
        <div><dt className="text-xs text-slate-400">Branches · staff accounts</dt><dd className="m-0">{data.branches_count ?? 0} · {data.staff_count ?? 0}</dd></div>
      </dl></Card>
      <Card title="Subscription">{data.subscription ? <dl className="grid gap-2 text-sm">
        <div><dt className="text-xs text-slate-400">Plan</dt><dd className="m-0">{data.subscription.plan?.name || '—'}</dd></div>
        <div><dt className="text-xs text-slate-400">Status</dt><dd className="m-0 capitalize">{data.subscription.status.replace('_', ' ')}</dd></div>
        <div><dt className="text-xs text-slate-400">Trial ends</dt><dd className="m-0">{formatDate(data.subscription.trial_ends_at)}</dd></div>
      </dl> : <p className="text-sm text-slate-500">No subscription record (legacy bookshop).</p>}</Card>
    </div>
    <div className="mt-6"><Card title="Lifecycle history" description="Registration, activation, suspension and support actions." flush>
      {data.history.length === 0 ? <EmptyState icon={<History size={22} />} title="No history yet" body="Lifecycle events will appear here." />
        : <ul className="m-0 list-none divide-y divide-slate-100 p-0">{data.history.map(entry => <li key={entry.id} className="px-6 py-3 text-sm"><p className="m-0 text-slate-800">{entry.description}</p><small className="text-xs text-slate-400">{formatDate(entry.created_at, true)}{entry.user ? ` · ${entry.user.name}` : ''}</small></li>)}</ul>}
    </Card></div>
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
    <PageHeader eyebrow="PLATFORM" icon={<Users size={15} />} title="Platform users" description="People who administer the platform. Platform Owners are created from the server console only."
      actions={canManage && <button className={primaryButton} onClick={() => setCreating(true)}><UserPlus size={16} /> Add administrator</button>} />
    {notice && <div className="mb-5"><FormAlert tone="success" message={notice} /></div>}
    <Card title="Platform staff" flush>
      {users.isPending ? <LoadingState /> : users.error ? <ErrorState message={errorMessage(users.error)} onRetry={() => void users.refetch()} />
        : <ul className="m-0 list-none divide-y divide-slate-100 p-0">{users.data.map(member => <li key={member.id} className="flex flex-wrap items-center justify-between gap-3 px-6 py-3">
          <span><strong className="text-sm text-slate-900">{member.name}</strong><small className="block text-xs text-slate-400">{member.email} · {member.role_label} · last sign-in {formatDate(member.last_login_at)}</small></span>
          <span className="flex items-center gap-3"><StatusBadge active={member.is_active} />
            {canManage && member.role !== 'platform_owner' && member.id !== user.id && <button className={`${secondaryButton} h-9`} onClick={() => toggle.mutate({ id: member.id, is_active: !member.is_active })}>{member.is_active ? 'Deactivate' : 'Activate'}</button>}</span>
        </li>)}</ul>}
    </Card>
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
    onSuccess: result => { setMessage({ tone: 'success', text: result.message }); void client.invalidateQueries({ queryKey: ['platform', 'settings'] }) },
    onError: error => setMessage({ tone: 'error', text: errorMessage(error) }),
  })
  if (settings.isPending) return <LoadingState />
  if (settings.error) return <ErrorState message={errorMessage(settings.error)} onRetry={() => void settings.refetch()} />
  const value = draft ?? { open: settings.data.bookshop_registration_open, email: settings.data.support_email ?? '', trial: settings.data.trial_days === null ? '' : String(settings.data.trial_days) }
  const canEdit = hasPermission(user, 'platform.settings.manage')
  return <>
    <PageHeader eyebrow="PLATFORM" icon={<Settings size={15} />} title="Platform settings" description="Global settings that apply to every bookshop." />
    <Card title="Registration and trials">
      <form className="grid gap-4" onSubmit={event => { event.preventDefault(); save.mutate() }}>
        <label className="hk-check"><input type="checkbox" checked={value.open} disabled={!canEdit} onChange={e => setDraft({ ...value, open: e.target.checked })} /><span>Accept new bookshop registrations<small>When off, the public bookshop sign-up form is paused.</small></span></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Support email" hint="Shown to bookshops that need help."><input className={inputClass} type="email" value={value.email} disabled={!canEdit} onChange={e => setDraft({ ...value, email: e.target.value })} /></Field>
          <Field label="Trial length (days)" hint={`Leave empty to use the server default of ${settings.data.default_trial_days} days.`}><input className={inputClass} type="number" min={0} max={365} value={value.trial} disabled={!canEdit} onChange={e => setDraft({ ...value, trial: e.target.value })} /></Field>
        </div>
        {message && <FormAlert tone={message.tone} message={message.text} />}
        {canEdit && <div className="mt-5 flex justify-end"><button className={primaryButton} type="submit" disabled={save.isPending || !draft}>{save.isPending ? 'Saving…' : 'Save settings'}</button></div>}
      </form>
    </Card>
  </>
}

function AuditView() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const audit = useQuery({ queryKey: ['platform', 'audit', search, page], queryFn: () => platformApi.audit({ search: search.trim() || undefined, page }), placeholderData: keepPreviousData })
  return <>
    <PageHeader eyebrow="PLATFORM" icon={<History size={15} />} title="Audit history" description="Platform administration and bookshop lifecycle events. Activity inside bookshops stays in each bookshop's own audit log." />
    <Card title="Events" flush actions={<label className="relative"><span className="sr-only">Search events</span><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm sm:w-64" placeholder="Search descriptions" value={search} onChange={e => { setSearch(e.target.value); setPage(1) }} /></label>}>
      {audit.isPending ? <LoadingState /> : audit.error ? <ErrorState message={errorMessage(audit.error)} onRetry={() => void audit.refetch()} />
        : audit.data.data.length === 0 ? <EmptyState icon={<History size={22} />} title="No events" body="Platform events will appear here." />
        : <ul className="m-0 list-none divide-y divide-slate-100 p-0">{audit.data.data.map(entry => <li key={entry.id} className="flex flex-wrap items-start justify-between gap-2 px-6 py-3 text-sm">
          <span><span className="text-slate-800">{entry.description}</span><small className="block text-xs text-slate-400">{entry.action}{entry.user ? ` · ${entry.user.name}` : ''}</small></span>
          <time className="text-xs text-slate-400">{formatDate(entry.created_at, true)}</time>
        </li>)}</ul>}
      {audit.data && <Pagination meta={audit.data.meta} onPage={setPage} />}
    </Card>
  </>
}
