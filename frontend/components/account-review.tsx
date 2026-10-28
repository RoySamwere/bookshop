'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CircleCheck, CircleX, Clock3, History, MailCheck, MailWarning, ShieldCheck, UserCheck } from 'lucide-react'
import { ApiError, errorMessage } from '../lib/api'
import { roleLabel, type Role } from '../lib/auth'
import { usersApi, type AuditEntry, type Branch, type RoleInfo, type TeamMember } from '../lib/workspace-api'
import { EmptyState, ErrorState, Field, FormAlert, LoadingState, Modal, ModalActions, formatDate, inputClass, secondaryButton } from './ui-kit'

export function VerificationBadge({ verified }: { verified: boolean }) {
  return verified
    ? <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700"><MailCheck size={13} /> Email verified</span>
    : <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"><MailWarning size={13} /> Not verified</span>
}

export function StaffRequestBadge({ status }: { status: TeamMember['staff_access_status'] }) {
  if (status === 'pending') return <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-600/10"><Clock3 size={11} /> Staff request pending</span>
  if (status === 'rejected') return <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-inset ring-rose-600/10"><CircleX size={11} /> Staff request declined</span>
  return null
}

/** Registrations that asked for staff access, shown above the directory for anyone who can review them. */
export function PendingRequests({ reloadKey, roles, branches, notify, onChanged }: {
  reloadKey: number; roles: RoleInfo[]; branches: Branch[]; notify: (message: string) => void; onChanged: () => void
}) {
  const [requests, setRequests] = useState<TeamMember[] | null>(null)
  const [error, setError] = useState('')
  const [dialog, setDialog] = useState<{ kind: 'approve' | 'reject'; user: TeamMember } | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(() => {
    setError('')
    usersApi.list({ status: 'pending', per_page: 50 }).then(page => setRequests(page.data)).catch(e => setError(errorMessage(e)))
  }, [])
  useEffect(() => { load() }, [load, reloadKey])

  async function resend(user: TeamMember) {
    setBusyId(user.id)
    try { notify((await usersApi.resendVerification(user.id)).message) } catch (e) { notify(errorMessage(e)) } finally { setBusyId(null) }
  }

  function finished(message: string) {
    setDialog(null); notify(message); load(); onChanged()
  }

  if (error) return <section className="mb-5 rounded-2xl border border-slate-200 bg-white"><ErrorState message={error} onRetry={load} /></section>
  if (!requests?.length) return null

  return <section className="mb-5 overflow-hidden rounded-2xl border border-blue-200 bg-white shadow-sm" aria-labelledby="pending-title">
    <div className="flex flex-col gap-1 border-b border-blue-100 bg-blue-50/50 px-5 py-4 sm:px-6">
      <h2 id="pending-title" className="flex items-center gap-2 text-base font-bold text-slate-900"><UserCheck size={18} className="text-[#087df5]" /> Staff access requests <span className="rounded-full bg-[#087df5] px-2 py-0.5 text-xs text-white">{requests.length}</span></h2>
      <p className="text-sm text-slate-500">These people registered on the website and asked for staff access. Approve with a role and branch, or decline. Their customer account stays either way.</p>
    </div>
    <ul className="divide-y divide-slate-100">
      {requests.map(user => <li key={user.id} className="flex flex-col gap-3 px-5 py-4 sm:px-6 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-800">{user.name}</p>
          <p className="mt-0.5 truncate text-xs text-slate-500">{user.email}{user.phone ? ` · ${user.phone}` : ''}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <VerificationBadge verified={user.email_verified} />
            <span>Requested {formatDate(user.staff_access_requested_at || user.created_at, true)}</span>
          </div>
        </div>
        {user.can_review && <div className="flex flex-wrap gap-2">
          {!user.email_verified && <button className={`${secondaryButton} h-9`} disabled={busyId === user.id} onClick={() => void resend(user)}><MailCheck size={15} /> {busyId === user.id ? 'Sending…' : 'Resend verification'}</button>}
          <button className={`${secondaryButton} h-9 text-rose-600`} onClick={() => setDialog({ kind: 'reject', user })}><CircleX size={15} /> Decline</button>
          <button className={`${secondaryButton} h-9 border-emerald-200 text-emerald-700 hover:bg-emerald-50`} disabled={!user.email_verified || !roles.length}
            title={user.email_verified ? undefined : 'They need to verify their email first'} onClick={() => setDialog({ kind: 'approve', user })}><CircleCheck size={15} /> Approve</button>
        </div>}
      </li>)}
    </ul>
    {dialog?.kind === 'approve' && <ApproveDialog user={dialog.user} roles={roles} branches={branches} onClose={() => setDialog(null)} onDone={finished} />}
    {dialog?.kind === 'reject' && <RejectDialog user={dialog.user} onClose={() => setDialog(null)} onDone={finished} />}
  </section>
}

function ApproveDialog({ user, roles, branches, onClose, onDone }: { user: TeamMember; roles: RoleInfo[]; branches: Branch[]; onClose: () => void; onDone: (message: string) => void }) {
  const staffRoles = roles.filter(role => role.value !== 'customer')
  const [role, setRole] = useState<Role>(staffRoles.find(item => item.value === 'cashier')?.value || staffRoles[0]?.value || 'cashier')
  const [branchIds, setBranchIds] = useState<number[]>(branches.length === 1 ? [branches[0].id] : [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [message, setMessage] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!branchIds.length) { setMessage('Choose at least one branch.'); return }
    setBusy(true); setError(null); setMessage('')
    try { onDone((await usersApi.approve(user.id, { role, branch_ids: branchIds })).message) }
    catch (e) { if (e instanceof ApiError) { setError(e); setMessage(e.message) } else setMessage(errorMessage(e)) }
    finally { setBusy(false) }
  }

  return <Modal title={`Approve ${user.name}`} description="Choose the role and branches they will work in. They will be asked to sign in again." icon={<ShieldCheck size={19} />} onClose={onClose} busy={busy} wide>
    <form onSubmit={submit} noValidate>
      <Field label="Role" error={error?.field('role')} hint={staffRoles.find(item => item.value === role)?.description}>
        <select className={inputClass} value={role} onChange={e => setRole(e.target.value as Role)}>
          {staffRoles.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </Field>
      <fieldset className="mt-5">
        <legend className="text-sm font-medium text-slate-700">Branches</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {branches.map(branch => <label key={branch.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-sm transition ${branchIds.includes(branch.id) ? 'border-blue-300 bg-blue-50/60 text-slate-800' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            <input type="checkbox" className="size-4 accent-[#087df5]" checked={branchIds.includes(branch.id)}
              onChange={e => setBranchIds(e.target.checked ? [...branchIds, branch.id] : branchIds.filter(id => id !== branch.id))} />
            <span className="font-medium">{branch.name}</span><span className="ml-auto text-xs text-slate-400">{branch.code}</span>
          </label>)}
        </div>
        {error?.field('branch_ids') && <p className="mt-2 text-xs text-rose-600">{error.field('branch_ids')}</p>}
      </fieldset>
      <FormAlert message={message} />
      <ModalActions busy={busy} submitLabel={`Approve as ${roleLabel(role)}`} busyLabel="Approving…" onCancel={onClose} />
    </form>
  </Modal>
}

function RejectDialog({ user, onClose, onDone }: { user: TeamMember; onClose: () => void; onDone: (message: string) => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setMessage('')
    try { onDone((await usersApi.reject(user.id, note.trim())).message) }
    catch (e) { setMessage(e instanceof ApiError ? (e.field('note') || e.message) : errorMessage(e)) }
    finally { setBusy(false) }
  }

  return <Modal title={`Decline ${user.name}'s request`} description="They keep their customer account and are emailed the outcome." icon={<CircleX size={19} />} onClose={onClose} busy={busy}>
    <form onSubmit={submit}>
      <Field label="Note to the applicant (optional)" hint="Shown to them on their account page and in the email.">
        <textarea className={`${inputClass} h-auto py-3`} rows={3} maxLength={500} value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Please ask your branch manager to add you." />
      </Field>
      <FormAlert message={message} />
      <ModalActions busy={busy} submitLabel="Decline request" busyLabel="Declining…" onCancel={onClose} danger />
    </form>
  </Modal>
}

/** Recent changes to an account and actions taken by it. */
export function AccountHistoryDialog({ user, onClose }: { user: TeamMember; onClose: () => void }) {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState('')
  const load = useCallback(() => {
    setError('')
    usersApi.history(user.id).then(setEntries).catch(e => setError(errorMessage(e)))
  }, [user.id])
  useEffect(() => { load() }, [load])

  return <Modal title={`${user.name}'s history`} description="The 50 most recent sign-ins and account changes." icon={<History size={19} />} onClose={onClose} wide>
    {error ? <ErrorState message={error} onRetry={load} /> : !entries ? <LoadingState label="Loading history" /> : !entries.length
      ? <EmptyState icon={<History size={22} />} title="No activity yet" body="Sign-ins and changes to this account will appear here." />
      : <ol className="-mx-1 max-h-[55vh] divide-y divide-slate-100 overflow-y-auto">
        {entries.map(entry => <li key={entry.id} className="flex flex-col gap-1 px-1 py-3 sm:flex-row sm:items-start sm:gap-4">
          <time className="w-40 shrink-0 text-xs text-slate-400" dateTime={entry.created_at}>{formatDate(entry.created_at, true)}</time>
          <div className="min-w-0">
            <p className="text-sm text-slate-700">{entry.description}</p>
            <p className="mt-0.5 text-xs text-slate-400">{entry.user ? `By ${entry.user.id === user.id ? 'this account' : entry.user.name}` : 'System'}{entry.ip_address ? ` · ${entry.ip_address}` : ''}</p>
          </div>
        </li>)}
      </ol>}
    <div className="mt-6 flex justify-end border-t border-slate-100 pt-5"><button type="button" className={secondaryButton} onClick={onClose}>Close</button></div>
  </Modal>
}
