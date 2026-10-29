import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Building2, CreditCard, History, MailPlus, Send, Store } from 'lucide-react'
import { Card, EmptyState, ErrorState, Field, FormAlert, LoadingState, PageHeader, StatCard, StatusBadge, formatDate, inputClass, primaryButton, secondaryButton } from './ui-kit'
import { ApiError, errorMessage } from '../lib/api'
import { hasPermission, roleLabel, type BookshopUser, type Role } from '../lib/auth'
import { BOOKSHOP_STATUS_LABELS, bookshopApi, COUNTRY_CURRENCIES, type BookshopDetails } from '../lib/tenancy-api'
import { branchesApi, usersApi } from '../lib/workspace-api'

const STAFF_ROLES: Role[] = ['admin', 'store_manager', 'cashier', 'inventory_officer']

/** Bookshop Owner administration inside the existing workspace: profile, status, staff invitations and activity. */
export function BookshopAdminView({ currentUser, notify, onNavigate }: { currentUser: BookshopUser; notify: (message: string) => void; onNavigate: (section: string) => void }) {
  const details = useQuery({ queryKey: ['bookshop'], queryFn: bookshopApi.get })
  const canManage = hasPermission(currentUser, 'settings.manage')

  return <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-8">
    <PageHeader eyebrow="BOOKSHOP ADMINISTRATION" icon={<Store size={15} />} title={currentUser.bookshop?.name || 'My bookshop'} description="Your business profile, account status and team invitations. Only people in this bookshop can see its records." />
    {details.isPending ? <LoadingState /> : details.error ? <ErrorState message={errorMessage(details.error)} onRetry={() => void details.refetch()} /> : <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Account status" value={BOOKSHOP_STATUS_LABELS[details.data.status]} hint={details.data.verified_at ? `Verified ${formatDate(details.data.verified_at)}` : 'Owner email not verified'} icon={<Store size={18} />} tone="emerald" />
        <StatCard label="Subscription" value={<span className="capitalize">{details.data.subscription?.status.replace('_', ' ') ?? 'Active'}</span>} hint={details.data.subscription?.trial_days_left != null ? `${details.data.subscription.trial_days_left} trial days left` : details.data.subscription?.plan?.name ?? 'Existing business plan'} icon={<CreditCard size={18} />} />
        <StatCard label="Branches" value={details.data.counts.active_branches} hint={`${details.data.counts.branches} in total${details.data.entitlements.branches_limit !== null ? ` · plan allows ${details.data.entitlements.branches_limit}` : ''}`} icon={<Building2 size={18} />} tone="amber" />
        <StatCard label="Team" value={details.data.counts.active_staff} hint={`${details.data.counts.pending_invitations} invitation${details.data.counts.pending_invitations === 1 ? '' : 's'} pending`} icon={<MailPlus size={18} />} tone="pink" />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <ProfileCard details={details.data} canManage={canManage} notify={notify} />
        {hasPermission(currentUser, 'users.manage') ? <InviteCard currentUser={currentUser} canInvite={details.data.entitlements.can_add_user} notify={notify} /> : <Card title="Team"><p className="text-sm text-slate-500">Ask the owner to invite new team members.</p></Card>}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Branches" description="Manage branches, tax rates and receipts in Settings." actions={hasPermission(currentUser, 'settings.view') && <button className={`${secondaryButton} h-9`} onClick={() => onNavigate('Settings')}>Open settings</button>}>
          <p className="text-sm text-slate-600">{details.data.counts.active_branches} active of {details.data.counts.branches} branch{details.data.counts.branches === 1 ? '' : 'es'}. {details.data.entitlements.can_add_branch ? 'You can add more branches.' : 'Your plan does not include more branches.'}</p>
          {hasPermission(currentUser, 'users.view') && <button className={`${secondaryButton} mt-4 h-9`} onClick={() => onNavigate('Users')}>Manage team access and branches</button>}
        </Card>
        {hasPermission(currentUser, 'audit.view') && <ActivityCard />}
      </div>
    </>}
  </div>
}

function ProfileCard({ details, canManage, notify }: { details: BookshopDetails; canManage: boolean; notify: (message: string) => void }) {
  const client = useQueryClient()
  const initial = { name: details.name, business_email: details.business_email ?? '', phone: details.phone ?? '', location: details.location ?? '', country: details.country, currency: details.currency }
  const [form, setForm] = useState(initial)
  const [error, setError] = useState<ApiError | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key: keyof typeof initial, value: string) => setForm(current => ({ ...current, [key]: value }))

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null); setMessage('')
    try {
      notify((await bookshopApi.update({ ...form, business_email: form.business_email || null })).message)
      await Promise.all([client.invalidateQueries({ queryKey: ['bookshop'] }), client.invalidateQueries({ queryKey: ['auth', 'me'] })])
    } catch (e) { if (e instanceof ApiError) { setError(e); setMessage(e.message) } else setMessage(errorMessage(e)) }
    finally { setBusy(false) }
  }

  return <Card title="Business profile" description={`Bookshop code: ${details.slug} (staff use it to request access)`}>
    <form onSubmit={submit} className="grid gap-4">
      <Field label="Bookshop name" error={error?.field('name')}><input className={inputClass} value={form.name} disabled={!canManage} onChange={e => set('name', e.target.value)} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Phone" error={error?.field('phone')}><input className={inputClass} type="tel" value={form.phone} disabled={!canManage} onChange={e => set('phone', e.target.value)} /></Field>
        <Field label="Business email" error={error?.field('business_email')}><input className={inputClass} type="email" value={form.business_email} disabled={!canManage} onChange={e => set('business_email', e.target.value)} /></Field>
      </div>
      <Field label="Location" error={error?.field('location')}><input className={inputClass} value={form.location} disabled={!canManage} onChange={e => set('location', e.target.value)} /></Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
        <Field label="Country" error={error?.field('country')}><input className={inputClass} list="admin-countries" value={form.country} disabled={!canManage} onChange={e => { set('country', e.target.value); if (COUNTRY_CURRENCIES[e.target.value]) set('currency', COUNTRY_CURRENCIES[e.target.value]) }} /><datalist id="admin-countries">{Object.keys(COUNTRY_CURRENCIES).map(country => <option key={country} value={country} />)}</datalist></Field>
        <Field label="Currency" error={error?.field('currency')}><input className={`${inputClass} uppercase`} maxLength={3} value={form.currency} disabled={!canManage} onChange={e => set('currency', e.target.value.toUpperCase())} /></Field>
      </div>
      <FormAlert message={message} />
      {canManage && <div className="mt-5 flex justify-end"><button className={primaryButton} type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button></div>}
    </form>
  </Card>
}

function InviteCard({ currentUser, canInvite, notify }: { currentUser: BookshopUser; canInvite: boolean; notify: (message: string) => void }) {
  const client = useQueryClient()
  const branches = useQuery({ queryKey: ['branches', 'active'], queryFn: () => branchesApi.list(true) })
  const pending = useQuery({ queryKey: ['users', 'unverified'], queryFn: () => usersApi.list({ status: 'unverified', per_page: 10 }) })
  const roles = STAFF_ROLES.filter(role => currentUser.assignable_roles.includes(role))
  const [form, setForm] = useState({ name: '', email: '', role: roles.includes('cashier') ? 'cashier' as Role : roles[0], branch_ids: [] as number[] })
  const [error, setError] = useState<ApiError | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null); setMessage('')
    try {
      notify((await bookshopApi.invite(form)).message)
      setForm(current => ({ ...current, name: '', email: '', branch_ids: [] }))
      await Promise.all([client.invalidateQueries({ queryKey: ['bookshop'] }), client.invalidateQueries({ queryKey: ['users'] })])
    } catch (e) { if (e instanceof ApiError) { setError(e); setMessage(e.message) } else setMessage(errorMessage(e)) }
    finally { setBusy(false) }
  }

  async function resend(id: number) {
    try { notify((await bookshopApi.resendInvitation(id)).message) } catch (e) { notify(errorMessage(e)) }
  }

  const invited = (pending.data?.data ?? []).filter(member => member.registration_source === 'invitation')
  return <Card title="Invite an employee" description="They get an email to set their own password. Access is limited to the branches you choose.">
    {!canInvite ? <p className="text-sm text-slate-500">Your plan does not include more staff accounts.</p> : <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={error?.field('name')}><input className={inputClass} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field label="Email" error={error?.field('email')}><input className={inputClass} type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} required /></Field>
      </div>
      <Field label="Role" error={error?.field('role')}><select className={inputClass} value={form.role} onChange={e => setForm({ ...form, role: e.target.value as Role })}>{roles.map(role => <option key={role} value={role}>{roleLabel(role)}</option>)}</select></Field>
      <fieldset><legend className="text-sm font-medium text-slate-700">Branches</legend>
        {branches.isPending ? <p className="text-xs text-slate-400">Loading branches…</p> : <div className="mt-2 flex flex-wrap gap-2">{(branches.data ?? []).map(branch => <label key={branch.id} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm ${form.branch_ids.includes(branch.id) ? 'border-[#087df5] bg-blue-50 text-[#087df5]' : 'border-slate-200 text-slate-600'}`}>
          <input type="checkbox" className="sr-only" checked={form.branch_ids.includes(branch.id)} onChange={e => setForm({ ...form, branch_ids: e.target.checked ? [...form.branch_ids, branch.id] : form.branch_ids.filter(id => id !== branch.id) })} />{branch.name}
        </label>)}</div>}
        {error?.field('branch_ids') && <p className="mt-1.5 text-xs text-rose-600">{error.field('branch_ids')}</p>}
      </fieldset>
      <FormAlert message={message} />
      <div className="mt-5 flex justify-end"><button className={primaryButton} type="submit" disabled={busy || form.branch_ids.length === 0}><Send size={15} /> {busy ? 'Sending…' : 'Send invitation'}</button></div>
    </form>}
    {invited.length > 0 && <div className="mt-6 border-t border-slate-100 pt-4">
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Waiting to accept</p>
      <ul className="m-0 list-none space-y-2 p-0">{invited.map(member => <li key={member.id} className="flex items-center justify-between gap-3 text-sm">
        <span><span className="text-slate-800">{member.name}</span><small className="block text-xs text-slate-400">{member.email} · {member.role_label}</small></span>
        <span className="flex items-center gap-2"><StatusBadge active={false} inactiveLabel="Invited" />{member.can_manage && <button className="text-xs font-semibold text-[#087df5]" onClick={() => void resend(member.id)}>Resend</button>}</span>
      </li>)}</ul>
    </div>}
  </Card>
}

function ActivityCard() {
  const activity = useQuery({ queryKey: ['bookshop', 'activity'], queryFn: bookshopApi.activity })
  return <Card title="Recent activity" description="The latest changes in this bookshop." flush>
    {activity.isPending ? <LoadingState /> : activity.error ? <ErrorState message={errorMessage(activity.error)} />
      : activity.data.length === 0 ? <EmptyState icon={<History size={22} />} title="No activity yet" body="Sign-ins and changes will appear here." />
      : <ul className="m-0 max-h-80 list-none divide-y divide-slate-100 overflow-y-auto p-0">{activity.data.map(entry => <li key={entry.id} className="px-6 py-3 text-sm"><p className="m-0 text-slate-800">{entry.description}</p><small className="text-xs text-slate-400">{formatDate(entry.created_at, true)}{entry.user ? ` · ${entry.user.name}` : ''}</small></li>)}</ul>}
  </Card>
}
