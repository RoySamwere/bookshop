'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { CalendarDays, KeyRound, Mail, Pencil, Phone, Power, Search, ShieldCheck, Trash2, UserPlus, UserRound, Users } from 'lucide-react'
import { ApiError, errorMessage, type Paginated } from '../lib/api'
import { roleLabel, type BookshopUser, type Role } from '../lib/auth'
import { branchesApi, usersApi, type Branch, type RoleInfo, type TeamMember, type UserPayload } from '../lib/workspace-api'
import { Card, EmptyState, ErrorState, Field, FormAlert, LoadingState, Modal, ModalActions, PageHeader, Pagination, StatCard, StatusBadge, formatDate, inputClass, primaryButton } from './ui-kit'

const ROLE_TONES: Record<string, string> = {
  system_owner: 'bg-amber-50 text-amber-700 ring-amber-600/10',
  admin: 'bg-violet-50 text-violet-700 ring-violet-600/10',
  store_manager: 'bg-blue-50 text-blue-700 ring-blue-600/10',
  cashier: 'bg-teal-50 text-teal-700 ring-teal-600/10',
  inventory_officer: 'bg-pink-50 text-pink-700 ring-pink-600/10',
  customer: 'bg-slate-100 text-slate-600 ring-slate-500/10',
}

export function RoleBadge({ role }: { role: string }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${ROLE_TONES[role] || ROLE_TONES.customer}`}>
    <span className="size-1.5 rounded-full bg-current" />{roleLabel(role)}
  </span>
}

type Filters = { search: string; role: string; status: string; branch_id: string; page: number }
type Dialog = { kind: 'create' } | { kind: 'edit' | 'password'; user: TeamMember } | null

export function UsersView({ currentUser, notify }: { currentUser: BookshopUser; notify: (message: string) => void }) {
  const canManage = currentUser.permissions.includes('users.manage')
  const [filters, setFilters] = useState<Filters>({ search: '', role: '', status: '', branch_id: '', page: 1 })
  const [searchInput, setSearchInput] = useState('')
  const [result, setResult] = useState<Paginated<TeamMember> | null>(null)
  const [counts, setCounts] = useState<{ active: number; inactive: number } | null>(null)
  const [roles, setRoles] = useState<RoleInfo[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const page = await usersApi.list(filters)
      setResult(page)
      setCounts(page.counts)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { void load() }, [load])
  // Account forms need roles and branches before they can open.
  const [formDataReady, setFormDataReady] = useState(false)
  useEffect(() => {
    Promise.all([usersApi.roles(), branchesApi.list(true)])
      .then(([roleList, branchList]) => { setRoles(roleList); setBranches(branchList); setFormDataReady(true) })
      .catch(() => undefined)
  }, [])
  useEffect(() => {
    const timer = window.setTimeout(() => setFilters(previous => previous.search === searchInput.trim() ? previous : { ...previous, search: searchInput.trim(), page: 1 }), 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const setFilter = (key: keyof Filters, value: string) => setFilters(previous => ({ ...previous, [key]: value, page: 1 }))
  const assignable = useMemo(() => roles.filter(role => role.assignable), [roles])
  const filtered = Boolean(filters.search || filters.role || filters.status || filters.branch_id)

  async function toggleStatus(user: TeamMember) {
    const action = user.is_active ? 'Deactivate' : 'Reactivate'
    if (!confirm(`${action} ${user.name}?${user.is_active ? ' They will be signed out and unable to sign in.' : ''}`)) return
    setBusyId(user.id)
    try {
      notify((await usersApi.setStatus(user.id, !user.is_active)).message)
      await load()
    } catch (e) { notify(errorMessage(e)) } finally { setBusyId(null) }
  }

  async function remove(user: TeamMember) {
    if (!confirm(`Delete ${user.name}? This cannot be undone. Consider deactivating instead to keep their history.`)) return
    setBusyId(user.id)
    try {
      notify((await usersApi.remove(user.id)).message)
      await load()
    } catch (e) { notify(errorMessage(e)) } finally { setBusyId(null) }
  }

  return <div className="products-page">
    <PageHeader eyebrow="WORKSPACE / TEAM" icon={<Users size={15} />} title="Users"
      description={currentUser.role === 'system_owner' ? 'Manage your bookshop team, their roles and the branches they work in.' : 'Team members in your branches and the customer accounts you look after.'}
      actions={canManage && <button className={primaryButton} disabled={!formDataReady} onClick={() => setDialog({ kind: 'create' })}><UserPlus size={17} /> Add user</button>} />

    <div className="mb-5 grid gap-4 sm:grid-cols-3">
      <StatCard label="Accounts" value={counts ? counts.active + counts.inactive : '—'} hint="Visible to you, excluding yourself" icon={<Users size={19} />} />
      <StatCard label="Active" value={counts?.active ?? '—'} hint="Can sign in" icon={<ShieldCheck size={19} />} tone="emerald" />
      <StatCard label="Deactivated" value={counts?.inactive ?? '—'} hint="Sign-in blocked, history kept" icon={<Power size={19} />} tone="pink" />
    </div>

    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-5 sm:px-6 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <div className="flex items-center gap-2"><h2 className="text-base font-bold text-slate-900">Team directory</h2><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{result?.meta.total ?? 0}</span></div>
          <p className="mt-1 text-sm text-slate-500">Search, filter and manage account access.</p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="flex h-10 items-center gap-2.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-slate-400 focus-within:border-blue-300 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-50">
            <Search size={16} /><input className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400" type="search" value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Name, email or phone" aria-label="Search users" />
          </label>
          <select className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700" value={filters.role} onChange={e => setFilter('role', e.target.value)} aria-label="Filter by role">
            <option value="">All roles</option>{roles.filter(role => role.value !== 'system_owner').map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
          </select>
          <select className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700" value={filters.status} onChange={e => setFilter('status', e.target.value)} aria-label="Filter by status">
            <option value="">Any status</option><option value="active">Active</option><option value="inactive">Deactivated</option>
          </select>
          <select className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700" value={filters.branch_id} onChange={e => setFilter('branch_id', e.target.value)} aria-label="Filter by branch">
            <option value="">All branches</option>{branches.map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        </div>
      </div>

      {loading && !result ? <LoadingState label="Loading your team" /> : error ? <ErrorState message={error} onRetry={load} /> : result && <>
        <div className={`overflow-x-auto transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <table className="w-full min-w-[860px] text-left">
            <thead className="bg-slate-50/80"><tr className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">
              <th scope="col" className="px-6 py-3.5">Account</th><th scope="col" className="px-5 py-3.5">Role</th><th scope="col" className="px-5 py-3.5">Branches</th>
              <th scope="col" className="px-5 py-3.5">Status</th><th scope="col" className="px-5 py-3.5">Last sign-in</th><th scope="col" className="px-5 py-3.5 text-right">Manage</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {result.data.map(user => <tr key={user.id} className="transition-colors hover:bg-slate-50/70">
                <td className="px-6 py-4"><div className="flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-blue-100 to-pink-100 text-xs font-bold text-[#164c9b]">{initials(user.name) || <UserRound size={17} />}</span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-800">{user.name}</p>
                    <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-slate-400"><Mail size={12} />{user.email}</p>
                    {user.phone && <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-400"><Phone size={12} />{user.phone}</p>}
                  </div>
                </div></td>
                <td className="px-5 py-4"><RoleBadge role={user.role} /></td>
                <td className="px-5 py-4 text-sm text-slate-600">{user.branches?.length ? user.branches.map(branch => branch.name).join(', ') : <span className="text-slate-400">—</span>}</td>
                <td className="px-5 py-4"><StatusBadge active={user.is_active} inactiveLabel="Deactivated" /></td>
                <td className="px-5 py-4 text-sm text-slate-500"><span className="inline-flex items-center gap-2"><CalendarDays size={14} className="text-slate-400" />{user.last_login_at ? formatDate(user.last_login_at, true) : 'Never'}</span></td>
                <td className="px-5 py-4">{user.can_manage ? <div className="flex justify-end gap-1">
                  <RowAction label={`Edit ${user.name}`} disabled={busyId === user.id || !formDataReady} onClick={() => setDialog({ kind: 'edit', user })}><Pencil size={15} /></RowAction>
                  <RowAction label={`Reset password for ${user.name}`} disabled={busyId === user.id} onClick={() => setDialog({ kind: 'password', user })}><KeyRound size={15} /></RowAction>
                  <RowAction label={`${user.is_active ? 'Deactivate' : 'Reactivate'} ${user.name}`} disabled={busyId === user.id} onClick={() => void toggleStatus(user)} tone={user.is_active ? 'amber' : 'emerald'}><Power size={15} /></RowAction>
                  <RowAction label={`Delete ${user.name}`} disabled={busyId === user.id} onClick={() => void remove(user)} tone="rose"><Trash2 size={15} /></RowAction>
                </div> : <p className="text-right text-xs text-slate-400">View only</p>}</td>
              </tr>)}
            </tbody>
          </table>
          {result.data.length === 0 && <EmptyState icon={<Users size={22} />} title={filtered ? 'No matching accounts' : 'No team members yet'}
            body={filtered ? 'Try another name, role, status or branch.' : 'Add your first user to start building your team.'}
            action={!filtered && canManage && <button className={primaryButton} disabled={!formDataReady} onClick={() => setDialog({ kind: 'create' })}><UserPlus size={16} /> Add user</button>} />}
        </div>
        <Pagination meta={result.meta} onPage={page => setFilters(previous => ({ ...previous, page }))} />
      </>}
    </section>

    {roles.length > 0 && <div className="mt-5"><Card title="Roles and access rights" description="Access is enforced by the server for every request.">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {roles.map(role => <div key={role.value} className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
          <div className="flex items-center justify-between gap-2"><RoleBadge role={role.value} />{role.assignable && <span className="text-[11px] font-semibold text-emerald-600">You can assign</span>}</div>
          <p className="mt-3 text-sm text-slate-600">{role.description}</p>
        </div>)}
      </div>
    </Card></div>}

    {dialog?.kind === 'create' && <UserFormDialog roles={assignable} branches={branches} onClose={() => setDialog(null)} onSaved={message => { setDialog(null); notify(message); void load() }} />}
    {dialog?.kind === 'edit' && <UserFormDialog user={dialog.user} roles={assignable} branches={branches} onClose={() => setDialog(null)} onSaved={message => { setDialog(null); notify(message); void load() }} />}
    {dialog?.kind === 'password' && <ResetPasswordDialog user={dialog.user} onClose={() => setDialog(null)} onSaved={message => { setDialog(null); notify(message) }} />}
  </div>
}

function RowAction({ label, onClick, disabled, tone = 'slate', children }: { label: string; onClick: () => void; disabled?: boolean; tone?: 'slate' | 'amber' | 'emerald' | 'rose'; children: React.ReactNode }) {
  const tones = { slate: 'text-slate-500 hover:bg-slate-100 hover:text-slate-800', amber: 'text-amber-600 hover:bg-amber-50', emerald: 'text-emerald-600 hover:bg-emerald-50', rose: 'text-rose-600 hover:bg-rose-50' }
  return <button className={`grid size-9 place-items-center rounded-lg transition focus:outline-none focus:ring-4 focus:ring-blue-50 disabled:opacity-40 ${tones[tone]}`} onClick={onClick} disabled={disabled} aria-label={label} title={label}>{children}</button>
}

const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()

function UserFormDialog({ user, roles, branches, onClose, onSaved }: { user?: TeamMember; roles: RoleInfo[]; branches: Branch[]; onClose: () => void; onSaved: (message: string) => void }) {
  const editing = Boolean(user)
  // Editing keeps the user's current role selectable even when the caller could not assign it fresh.
  const roleOptions = user && !roles.some(role => role.value === user.role) ? [{ value: user.role, label: roleLabel(user.role), description: '', uses_branches: true } as RoleInfo, ...roles] : roles
  const [form, setForm] = useState({
    name: user?.name || '', email: user?.email || '', phone: user?.phone || '', role: (user?.role || roles.find(role => role.value === 'cashier')?.value || roles[0]?.value || 'cashier') as Role,
    branch_ids: user?.branches?.map(branch => branch.id) || (branches.length === 1 ? [branches[0].id] : []), password: '', password_confirmation: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [message, setMessage] = useState('')
  const roleInfo = roleOptions.find(role => role.value === form.role)
  const usesBranches = roleInfo?.uses_branches ?? form.role !== 'customer'
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm(previous => ({ ...previous, [key]: value }))

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!editing && form.password !== form.password_confirmation) { setMessage('Passwords do not match.'); return }
    setBusy(true); setError(null); setMessage('')
    const payload: UserPayload = { name: form.name, email: form.email, phone: form.phone || null, role: form.role, branch_ids: usesBranches ? form.branch_ids : [] }
    if (!editing) Object.assign(payload, { password: form.password, password_confirmation: form.password_confirmation })
    try {
      const saved = user ? await usersApi.update(user.id, payload) : await usersApi.create(payload)
      onSaved(saved.message)
    } catch (e) {
      if (e instanceof ApiError) { setError(e); setMessage(e.message) } else setMessage(errorMessage(e))
    } finally { setBusy(false) }
  }

  return <Modal title={editing ? `Edit ${user!.name}` : 'Add a team member'} description={editing ? 'Update their details, role and branches.' : 'Create an account and choose their level of access.'}
    icon={editing ? <Pencil size={19} /> : <UserPlus size={19} />} onClose={onClose} busy={busy} wide>
    <form onSubmit={submit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={error?.field('name')}><input className={inputClass} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Jane Muthoni" required /></Field>
        <Field label="Email address" error={error?.field('email')}><input className={inputClass} type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="jane@example.com" required /></Field>
        <Field label="Phone (optional)" error={error?.field('phone')}><input className={inputClass} type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+254 7XX XXX XXX" /></Field>
        <Field label="Role" error={error?.field('role')} hint={roleInfo?.description}>
          <select className={inputClass} value={form.role} onChange={e => set('role', e.target.value as Role)}>{roleOptions.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}</select>
        </Field>
        {!editing && <>
          <Field label="Password" error={error?.field('password')}><input className={inputClass} type="password" autoComplete="new-password" value={form.password} onChange={e => set('password', e.target.value)} placeholder="At least 8 characters" required minLength={8} /></Field>
          <Field label="Confirm password"><input className={inputClass} type="password" autoComplete="new-password" value={form.password_confirmation} onChange={e => set('password_confirmation', e.target.value)} placeholder="Enter password again" required minLength={8} /></Field>
        </>}
      </div>
      {usesBranches ? <fieldset className="mt-5">
        <legend className="text-sm font-medium text-slate-700">Branches</legend>
        <p className="mt-1 text-xs text-slate-400">Staff can only work in the branches selected here.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {branches.map(branch => <label key={branch.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-sm transition ${form.branch_ids.includes(branch.id) ? 'border-blue-300 bg-blue-50/60 text-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            <input type="checkbox" className="size-4 accent-[#087df5]" checked={form.branch_ids.includes(branch.id)}
              onChange={e => set('branch_ids', e.target.checked ? [...form.branch_ids, branch.id] : form.branch_ids.filter(id => id !== branch.id))} />
            <span className="font-medium">{branch.name}</span><span className="ml-auto text-xs text-slate-400">{branch.code}</span>
          </label>)}
        </div>
        {error?.field('branch_ids') && <p className="mt-2 text-xs text-rose-600">{error.field('branch_ids')}</p>}
      </fieldset> : <p className="mt-5 rounded-xl bg-slate-50 px-3.5 py-3 text-xs text-slate-500">Customer accounts are not tied to a branch.</p>}
      {editing && form.role !== user!.role && <FormAlert tone="success" message="Changing the role signs this person out so their new access applies at next sign-in." />}
      <FormAlert message={message} />
      <ModalActions busy={busy} submitLabel={editing ? 'Save changes' : 'Create user'} busyLabel={editing ? 'Saving…' : 'Creating account…'} onCancel={onClose} />
    </form>
  </Modal>
}

function ResetPasswordDialog({ user, onClose, onSaved }: { user: TeamMember; onClose: () => void; onSaved: (message: string) => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setBusy(true); setError('')
    try { onSaved((await usersApi.resetPassword(user.id, password, confirm)).message) }
    catch (e) { setError(e instanceof ApiError ? (e.field('password') || e.message) : errorMessage(e)) }
    finally { setBusy(false) }
  }

  return <Modal title={`Reset ${user.name}'s password`} description="Set a temporary password and share it with them securely. They will be signed out everywhere." icon={<KeyRound size={19} />} onClose={onClose} busy={busy}>
    <form onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Temporary password"><input className={inputClass} type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} placeholder="At least 8 characters" /></Field>
        <Field label="Confirm password"><input className={inputClass} type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} required minLength={8} /></Field>
      </div>
      <FormAlert message={error} />
      <ModalActions busy={busy} submitLabel="Reset password" busyLabel="Resetting…" onCancel={onClose} />
    </form>
  </Modal>
}
