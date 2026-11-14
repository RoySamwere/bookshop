import { useState, type FormEvent } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus, History, Search } from 'lucide-react'
import { Card, EmptyState, ErrorState, Field, FormAlert, LoadingState, Modal, formatDate, inputClass, primaryButton, secondaryButton } from '../../components/ui-kit'
import { ApiError, errorMessage } from '../../lib/api'
import { trialApi, type TrialSubscription } from '../../lib/billing-api'
import { Pager } from '../billing/page'

const DAY_MS = 86_400_000

/** Validates the "days to extend" input exactly as the server does: a whole number from 1 to the maximum. */
export function parseExtensionDays(raw: string, max: number): { days?: number; error?: string } {
  const value = raw.trim()
  if (!value) return { error: 'Enter the number of days to add.' }
  if (!/^\d+$/.test(value)) return { error: 'Enter a whole number of days, without decimals or symbols.' }
  const days = Number(value)
  if (days < 1) return { error: 'Enter at least 1 day.' }
  if (days > max) return { error: `A single extension can add at most ${max} days.` }
  return { days }
}

type TrialTarget = Pick<TrialSubscription, 'bookshop_id' | 'bookshop_name' | 'trial_ends_at' | 'trial_state'>

/** An active trial grows from its current end; a lapsed trial restarts from now (same rule as the server). */
export function previewExpiry(target: TrialTarget, days: number, now = new Date()): Date {
  const end = target.trial_ends_at ? new Date(target.trial_ends_at) : null
  const base = target.trial_state === 'active' && end && end > now ? end : now
  return new Date(base.getTime() + days * DAY_MS)
}

const STATE_LABEL: Record<TrialSubscription['trial_state'], { label: string; tone: string }> = {
  active: { label: 'Active trial', tone: 'bg-blue-50 text-blue-700 ring-blue-200' },
  expired: { label: 'Trial expired', tone: 'bg-rose-50 text-rose-700 ring-rose-200' },
  not_trial: { label: 'Not on trial', tone: 'bg-slate-100 text-slate-600 ring-slate-200' },
}

function TrialStateBadge({ state }: { state: TrialSubscription['trial_state'] }) {
  const { label, tone } = STATE_LABEL[state]
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${tone}`}>{label}</span>
}

/** Platform Owner screen: trial status of every bookshop, the Extend Trial action and the permanent history. */
export default function TrialExtensionsPanel() {
  const [search, setSearch] = useState('')
  const [state, setState] = useState('')
  const [page, setPage] = useState(1)
  const [target, setTarget] = useState<TrialSubscription | null>(null)
  const [historyFor, setHistoryFor] = useState<TrialSubscription | null>(null)
  const [notice, setNotice] = useState('')
  const rows = useQuery({
    queryKey: ['platform-billing', 'trials', search.trim(), state, page],
    queryFn: () => trialApi.subscriptions({ page, search: search.trim() || undefined, state: state || undefined }),
    placeholderData: keepPreviousData,
  })
  const maxDays = rows.data?.max_days ?? 90

  return <div className="grid gap-6">
    <Card title="Trial extension" description={`Give an unpaid bookshop more trial time. Active trials grow from their current expiry; expired trials restart from today. Plans, invoices and payments are never changed. Up to ${maxDays} days per extension.`}>
      {notice && <div className="mb-4"><FormAlert tone="success" message={notice} /></div>}
      <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_220px]">
        <label className="text-sm font-medium text-slate-700">Search bookshops
          <span className="relative block"><Search className="pointer-events-none absolute left-3 top-[calc(50%+4px)] -translate-y-1/2 text-slate-400" size={16} />
            <input className={`${inputClass} pl-9`} value={search} placeholder="Bookshop name" onChange={e => { setSearch(e.target.value); setPage(1) }} /></span>
        </label>
        <label className="text-sm font-medium text-slate-700">Show
          <select className={inputClass} value={state} onChange={e => { setState(e.target.value); setPage(1) }}>
            <option value="">All bookshops</option><option value="active">Active trials</option><option value="expired">Expired trials</option><option value="eligible">Eligible for extension</option>
          </select>
        </label>
      </div>
      {rows.isPending ? <LoadingState /> : rows.isError ? <ErrorState message={errorMessage(rows.error)} onRetry={() => void rows.refetch()} />
        : !rows.data.data.length ? <EmptyState icon={<CalendarPlus size={22} />} title="No matching bookshops" body="Change the search or filter to see other subscriptions." />
        : <>
          <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400"><tr>
              {['Bookshop', 'Trial status', 'Trial started', 'Trial expires', 'Days left', 'Extensions', 'Action'].map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.data.data.map(row => <tr key={row.id}>
              <td className="px-3 py-3"><p className="m-0 font-semibold text-slate-800">{row.bookshop_name}</p><small className="text-xs capitalize text-slate-400">{row.plan?.name ?? 'No plan'} · {row.status.replace('_', ' ')}</small></td>
              <td className="px-3 py-3"><TrialStateBadge state={row.trial_state} /></td>
              <td className="px-3 py-3 text-slate-600">{formatDate(row.trial_starts_at)}</td>
              <td className="px-3 py-3 text-slate-600">{formatDate(row.trial_ends_at, true)}</td>
              <td className="px-3 py-3 font-semibold text-slate-800">{row.trial_state === 'not_trial' ? '—' : row.remaining_trial_days}</td>
              <td className="px-3 py-3"><button className="font-semibold text-blue-700 underline-offset-2 hover:underline disabled:text-slate-400 disabled:no-underline" disabled={!row.extensions_count} onClick={() => setHistoryFor(row)} aria-label={`View trial extension history for ${row.bookshop_name}`}>{row.extensions_count}</button></td>
              <td className="px-3 py-3"><ExtendButton row={row} onClick={() => { setNotice(''); setTarget(row) }} /></td>
            </tr>)}</tbody>
          </table></div>
          <ul className="m-0 grid list-none gap-3 p-0 md:hidden">{rows.data.data.map(row => <li key={row.id} className="rounded-xl border border-slate-200 p-4">
            <div className="flex items-start justify-between gap-3"><p className="m-0 font-semibold text-slate-800">{row.bookshop_name}</p><TrialStateBadge state={row.trial_state} /></div>
            <dl className="my-3 grid grid-cols-2 gap-2 text-sm">
              <div><dt className="text-xs text-slate-400">Trial started</dt><dd className="m-0">{formatDate(row.trial_starts_at)}</dd></div>
              <div><dt className="text-xs text-slate-400">Trial expires</dt><dd className="m-0">{formatDate(row.trial_ends_at)}</dd></div>
              <div><dt className="text-xs text-slate-400">Days left</dt><dd className="m-0">{row.trial_state === 'not_trial' ? '—' : row.remaining_trial_days}</dd></div>
              <div><dt className="text-xs text-slate-400">Extensions</dt><dd className="m-0">{row.extensions_count ? <button className="font-semibold text-blue-700" onClick={() => setHistoryFor(row)}>{row.extensions_count} · view</button> : 0}</dd></div>
            </dl>
            <ExtendButton row={row} onClick={() => { setNotice(''); setTarget(row) }} />
          </li>)}</ul>
          <Pager page={rows.data} setPage={setPage} />
        </>}
    </Card>
    <TrialExtensionHistory bookshop={historyFor} onClear={() => setHistoryFor(null)} />
    {target && <ExtendTrialModal target={target} maxDays={maxDays} onClose={() => setTarget(null)} onDone={message => { setTarget(null); setNotice(message) }} />}
  </div>
}

function ExtendButton({ row, onClick }: { row: TrialSubscription; onClick: () => void }) {
  if (!row.eligible) return <span className="text-xs text-slate-500" title={row.ineligible_reason ?? undefined}>{row.trial_state === 'not_trial' ? 'Paid or not on trial' : 'Not eligible'}</span>
  return <button className={`${secondaryButton} h-9 w-full sm:w-auto`} onClick={onClick} aria-label={`Extend trial for ${row.bookshop_name}`}><CalendarPlus size={15} /> Extend Trial</button>
}

/** Extension form with a review step before saving. One submission key per opening prevents duplicate grants. */
export function ExtendTrialModal({ target, maxDays, onClose, onDone }: { target: TrialTarget; maxDays: number; onClose: () => void; onDone: (message: string) => void }) {
  const client = useQueryClient()
  const [idempotencyKey] = useState(() => crypto.randomUUID())
  const [rawDays, setRawDays] = useState('')
  const [reason, setReason] = useState('')
  const [step, setStep] = useState<'form' | 'confirm'>('form')
  const [touched, setTouched] = useState(false)
  const parsed = parseExtensionDays(rawDays, maxDays)
  const expired = target.trial_state !== 'active'
  const newExpiry = parsed.days ? previewExpiry(target, parsed.days) : null
  const save = useMutation({
    mutationFn: () => trialApi.extend(target.bookshop_id, { days: parsed.days!, reason: reason.trim() || null, idempotency_key: idempotencyKey, expected_trial_ends_at: target.trial_ends_at }),
    onSuccess: result => {
      void client.invalidateQueries({ queryKey: ['platform-billing'] })
      void client.invalidateQueries({ queryKey: ['platform'] })
      onDone(result.message)
    },
    onError: error => {
      if (error instanceof ApiError && error.status === 409) void client.invalidateQueries({ queryKey: ['platform-billing', 'trials'] })
      setStep('form')
    },
  })
  const busy = save.isPending
  const serverError = save.error instanceof ApiError ? (save.error.field('days') || save.error.field('subscription') || save.error.field('reason') || save.error.message) : save.error ? errorMessage(save.error) : ''

  function review(event: FormEvent) {
    event.preventDefault()
    setTouched(true)
    if (parsed.days) setStep('confirm')
  }
  function confirm(event: FormEvent) {
    event.preventDefault()
    if (!busy && parsed.days) save.mutate()
  }

  return <Modal title="Extend trial" description={expired ? 'This trial has expired. The extension restarts it from today.' : 'Days are added to the current trial expiry.'} icon={<CalendarPlus size={18} />} onClose={onClose} busy={busy}>
    {step === 'form' ? <form onSubmit={review} className="grid gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bookshop"><input className={inputClass} value={target.bookshop_name ?? `Bookshop ${target.bookshop_id}`} readOnly /></Field>
        <Field label="Current trial expiry"><input className={inputClass} value={`${formatDate(target.trial_ends_at, true)}${expired ? ' (expired)' : ''}`} readOnly /></Field>
      </div>
      <Field label="Days to extend" hint={`Whole days, 1 to ${maxDays}.`} error={touched ? parsed.error : undefined}>
        <input className={inputClass} inputMode="numeric" autoComplete="off" value={rawDays} onChange={e => setRawDays(e.target.value)} onBlur={() => setTouched(true)} aria-invalid={touched && !!parsed.error} required />
      </Field>
      <div className="rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm" aria-live="polite">
        <p className="m-0 text-xs font-semibold uppercase tracking-wide text-blue-700">New trial expiry</p>
        <p className="m-0 mt-1 text-base font-semibold text-slate-900" data-testid="new-expiry">{newExpiry ? formatDate(newExpiry.toISOString(), true) : '—'}</p>
      </div>
      <Field label="Reason for extension (optional)">
        <textarea className={`${inputClass} h-24 py-2`} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="For example: onboarding delayed by data migration" />
      </Field>
      <FormAlert message={serverError} />
      <div className="mt-2 flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end">
        <button type="button" className={secondaryButton} onClick={onClose}>Cancel</button>
        <button type="submit" className={primaryButton}>Review extension</button>
      </div>
    </form> : <form onSubmit={confirm} className="grid gap-4">
      <p className="m-0 text-sm text-slate-600">Please confirm. This change is recorded permanently in the trial extension history.</p>
      <dl className="m-0 grid gap-3 rounded-xl border border-slate-200 p-4 text-sm">
        <div className="flex justify-between gap-4"><dt className="text-slate-500">Bookshop</dt><dd className="m-0 text-right font-semibold">{target.bookshop_name}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-slate-500">Current expiry</dt><dd className="m-0 text-right">{formatDate(target.trial_ends_at, true)}{expired ? ' (expired)' : ''}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-slate-500">Extension</dt><dd className="m-0 text-right font-semibold">+{parsed.days} day{parsed.days === 1 ? '' : 's'}{expired ? ' from today' : ''}</dd></div>
        <div className="flex justify-between gap-4 border-t border-slate-100 pt-3"><dt className="text-slate-500">New expiry</dt><dd className="m-0 text-right font-semibold text-blue-700">{newExpiry ? formatDate(newExpiry.toISOString(), true) : '—'}</dd></div>
        {reason.trim() && <div className="flex justify-between gap-4"><dt className="text-slate-500">Reason</dt><dd className="m-0 break-words text-right">{reason.trim()}</dd></div>}
      </dl>
      <div className="mt-2 flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end">
        <button type="button" className={secondaryButton} onClick={() => setStep('form')} disabled={busy}>Back</button>
        <button type="button" className={secondaryButton} onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className={primaryButton} disabled={busy}>{busy ? 'Saving…' : 'Confirm Extension'}</button>
      </div>
    </form>}
  </Modal>
}

function TrialExtensionHistory({ bookshop, onClear }: { bookshop: TrialSubscription | null; onClear: () => void }) {
  const [page, setPage] = useState(1)
  const bookshopId = bookshop?.bookshop_id
  const rows = useQuery({ queryKey: ['platform-billing', 'trial-history', bookshopId ?? 'all', page], queryFn: () => trialApi.history({ page, bookshop_id: bookshopId }), placeholderData: keepPreviousData })
  return <Card title="Trial extension history" description={bookshop ? `Extensions granted to ${bookshop.bookshop_name}. History is permanent and cannot be edited.` : 'Every extension granted on the platform. History is permanent and cannot be edited.'}
    actions={bookshop ? <button className={secondaryButton} onClick={() => { onClear(); setPage(1) }}>Show all bookshops</button> : undefined}>
    {rows.isPending ? <LoadingState /> : rows.isError ? <ErrorState message={errorMessage(rows.error)} onRetry={() => void rows.refetch()} />
      : !rows.data.data.length ? <EmptyState icon={<History size={22} />} title="No trial extensions yet" body="Extensions you grant will be listed here." />
      : <>
        <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400"><tr>
            {['Date', 'Bookshop', 'Previous expiry', 'Days', 'New expiry', 'Granted by', 'Reason'].map(h => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.data.data.map(entry => <tr key={entry.id}>
            <td className="px-3 py-3 text-slate-600">{formatDate(entry.created_at, true)}</td>
            <td className="px-3 py-3 font-semibold text-slate-800">{entry.bookshop_name ?? `Bookshop ${entry.bookshop_id}`}</td>
            <td className="px-3 py-3 text-slate-600">{formatDate(entry.previous_trial_ends_at, true)}{entry.reactivated && <span className="ml-1 text-xs text-rose-600">(expired)</span>}</td>
            <td className="px-3 py-3 font-semibold">+{entry.days_granted}</td>
            <td className="px-3 py-3 text-slate-600">{formatDate(entry.new_trial_ends_at, true)}</td>
            <td className="px-3 py-3 text-slate-600">{entry.extended_by_name ?? '—'}</td>
            <td className="max-w-[260px] break-words px-3 py-3 text-slate-600">{entry.reason ?? '—'}</td>
          </tr>)}</tbody>
        </table></div>
        <Pager page={rows.data} setPage={setPage} />
      </>}
  </Card>
}
