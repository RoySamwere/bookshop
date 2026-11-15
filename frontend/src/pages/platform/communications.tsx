import { useState, type FormEvent } from 'react'
import { Link, Navigate, Route, Routes, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Mail, Megaphone, RotateCw, Send } from 'lucide-react'
import { EmptyState, ErrorState, Field, FormAlert, LoadingState, Modal, formatDate, inputClass, primaryButton, secondaryButton } from '../../components/ui-kit'
import { errorMessage } from '../../lib/api'
import {
  CATEGORY_LABELS, EVENT_LABELS, communicationApi,
  type AnnouncementCategory, type CommunicationLog, type CommunicationTemplate, type LogFilters, type RecipientGroup,
} from '../../lib/communication-api'
import { platformApi } from '../../lib/tenancy-api'
import { Metric, MetricStrip, PageControls, Panel, Pill, PlatformTitle, SearchField, SelectField, SubNav, Toolbar, humanize, tdClass, thClass, type Tone } from './platform-ui'

const BASE = '/platform/communications'
const STATUS_TONE: Record<string, Tone> = { sent: 'positive', queued: 'info', sending: 'info', failed: 'danger' }
const STATUS_LABEL: Record<string, string> = { sent: 'Delivered', queued: 'Queued', sending: 'Sending', failed: 'Failed' }

export function DeliveryPill({ status }: { status: string }) {
  return <Pill tone={STATUS_TONE[status] ?? 'neutral'}>{STATUS_LABEL[status] ?? humanize(status)}</Pill>
}

/** Platform Owner communication centre at /platform/communications. */
export default function CommunicationsView() {
  return <>
    <PlatformTitle title="Communication" description="Emails the platform sends to bookshops: automatic notices for activation, reminders, payments and suspensions, plus announcements you write. Every message is queued, logged and can be retried if delivery fails." />
    <SubNav label="Communication sections" items={[
      { to: BASE, label: 'Overview', end: true }, { to: `${BASE}/announcements`, label: 'Announcements' },
      { to: `${BASE}/log`, label: 'Delivery log' }, { to: `${BASE}/templates`, label: 'Templates' },
    ]} />
    <Routes>
      <Route index element={<CommunicationOverview />} />
      <Route path="announcements" element={<div className="grid gap-6"><AnnouncementComposer /><AnnouncementHistory /></div>} />
      <Route path="log" element={<LogPage />} />
      <Route path="templates" element={<TemplateEditor />} />
      <Route path="*" element={<Navigate replace to={BASE} />} />
    </Routes>
  </>
}

function CommunicationOverview() {
  const client = useQueryClient()
  const summary = useQuery({ queryKey: ['platform-communications', 'summary'], queryFn: communicationApi.summary })
  const retryAll = useMutation({ mutationFn: () => communicationApi.retryFailed(), onSuccess: () => void client.invalidateQueries({ queryKey: ['platform-communications'] }) })
  return <div className="grid gap-6">
    {summary.isPending ? <LoadingState /> : summary.error ? <ErrorState message={errorMessage(summary.error)} onRetry={() => void summary.refetch()} /> : <MetricStrip label="Delivery summary">
      <Metric label="Delivered" value={summary.data.sent} hint="Emails accepted by the mail server" />
      <Metric label="Waiting to send" value={summary.data.queued} hint="Queued for the next worker run" />
      <Metric label="Failed" value={summary.data.failed} hint="Need a retry or a fixed address" tone={summary.data.failed ? 'alert' : undefined} />
      <Metric label="Last 30 days" value={summary.data.last_30_days} hint={`${summary.data.announcements} announcement(s) in total`} />
    </MetricStrip>}
    {retryAll.isSuccess && <FormAlert tone="success" message={retryAll.data.message} />}
    {retryAll.isError && <FormAlert message={errorMessage(retryAll.error)} />}
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <DeliveryLog title="Latest messages" compact />
      <Panel title="Quick actions">
        <div className="grid gap-2">
          <Link className={primaryButton} to={`${BASE}/announcements`}><Megaphone size={16} /> Write an announcement</Link>
          <Link className={secondaryButton} to={`${BASE}/log?status=failed`}>Review failed deliveries</Link>
          <button className={secondaryButton} disabled={!summary.data?.failed || retryAll.isPending} onClick={() => retryAll.mutate()}><RotateCw size={15} /> {retryAll.isPending ? 'Queuing…' : 'Retry all failed'}</button>
          <Link className={secondaryButton} to={`${BASE}/templates`}>Edit email templates</Link>
        </div>
        <p className="mt-4 text-xs text-[var(--pf-muted)]">Emails are sent by the queue worker using the server's mail settings. If many messages fail, check the mail configuration before retrying.</p>
      </Panel>
    </div>
  </div>
}

function LogPage() {
  const [params] = useSearchParams()
  const announcement = Number(params.get('announcement')) || undefined
  return <DeliveryLog title="Delivery log" announcementId={announcement} initialStatus={params.get('status') ?? ''} />
}

/** Every logged email with filters, the message itself and a retry for failures. */
export function DeliveryLog({ title, bookshopId, announcementId, initialStatus = '', compact = false }: { title: string; bookshopId?: number; announcementId?: number; initialStatus?: string; compact?: boolean }) {
  const client = useQueryClient()
  const [filters, setFilters] = useState<LogFilters>({ page: 1, status: initialStatus || undefined })
  const [viewing, setViewing] = useState<CommunicationLog | null>(null)
  const query = { ...filters, bookshop_id: bookshopId, announcement_id: announcementId }
  const logs = useQuery({ queryKey: ['platform-communications', 'logs', query], queryFn: () => communicationApi.logs(query), placeholderData: keepPreviousData, refetchInterval: 15000 })
  const retry = useMutation({ mutationFn: (id: number) => communicationApi.retry(id), onSuccess: () => void client.invalidateQueries({ queryKey: ['platform-communications'] }) })
  const set = (patch: Partial<LogFilters>) => setFilters(current => ({ ...current, ...patch, page: 1 }))
  return <Panel title={title} description={announcementId ? 'Deliveries for one announcement.' : undefined} flush>
    {!compact && <Toolbar>
      <SearchField label="Search messages" value={filters.search ?? ''} onChange={value => set({ search: value || undefined })} placeholder="Email address or subject" />
      <SelectField label="Status" hideLabel value={filters.status ?? ''} onChange={value => set({ status: value || undefined })}>
        <option value="">All statuses</option><option value="sent">Delivered</option><option value="queued">Queued</option><option value="failed">Failed</option>
      </SelectField>
      <SelectField label="Message type" hideLabel value={filters.event ?? ''} onChange={value => set({ event: value || undefined })}>
        <option value="">All message types</option>{Object.entries(EVENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </SelectField>
    </Toolbar>}
    {retry.isError && <div className="px-5 pt-3"><FormAlert message={errorMessage(retry.error)} /></div>}
    {logs.isPending ? <LoadingState /> : logs.error ? <ErrorState message={errorMessage(logs.error)} onRetry={() => void logs.refetch()} />
      : !logs.data.data.length ? <EmptyState icon={<Mail size={22} />} title="No messages yet" body="Emails appear here as soon as one is queued." />
      : <table className="w-full text-sm">
        <thead className="border-b border-[var(--pf-line)] bg-slate-50/70"><tr>
          <th className={thClass}>Message</th><th className={`${thClass} hidden md:table-cell`}>Recipient</th><th className={thClass}>Status</th>
          <th className={`${thClass} hidden lg:table-cell`}>Queued</th><th className={thClass}><span className="sr-only">Actions</span></th>
        </tr></thead>
        <tbody className="divide-y divide-[var(--pf-line)]">{logs.data.data.map(log => <tr key={log.id}>
          <td className={tdClass}><strong className="block max-w-[34ch] truncate font-semibold">{log.subject}</strong><small className="text-xs text-[var(--pf-muted)]">{EVENT_LABELS[log.event] ?? humanize(log.event)}{log.bookshop_name && !bookshopId ? `, ${log.bookshop_name}` : ''}</small></td>
          <td className={`${tdClass} hidden md:table-cell`}><span className="block max-w-[28ch] truncate">{log.recipient_name ?? log.recipient_email}</span><small className="block max-w-[28ch] truncate text-xs text-[var(--pf-muted)]">{log.recipient_email}</small></td>
          <td className={tdClass}><DeliveryPill status={log.status} />{log.status === 'failed' && log.last_error && <small className="mt-1 hidden max-w-[28ch] truncate text-xs text-rose-700 lg:block" title={log.last_error}>{log.last_error}</small>}</td>
          <td className={`${tdClass} hidden whitespace-nowrap text-[var(--pf-muted)] lg:table-cell`}>{formatDate(log.created_at, true)}</td>
          <td className={`${tdClass} whitespace-nowrap text-right`}>
            {log.status === 'failed' && <button className={`${secondaryButton} mr-2 h-9 px-3`} disabled={retry.isPending} onClick={() => retry.mutate(log.id)} aria-label={`Retry email to ${log.recipient_email}`}><RotateCw size={15} /><span className="hidden sm:inline">Retry</span></button>}
            <button className="inline-grid size-9 place-items-center rounded-lg border border-[var(--pf-line)] text-slate-600 hover:bg-slate-50" onClick={() => setViewing(log)} aria-label={`View email to ${log.recipient_email}`}><Eye size={16} /></button>
          </td>
        </tr>)}</tbody>
      </table>}
    {logs.data && logs.data.total > 0 && <PageControls page={logs.data} onPage={page => setFilters(current => ({ ...current, page }))} />}
    {viewing && <Modal title={viewing.subject} description={`${EVENT_LABELS[viewing.event] ?? humanize(viewing.event)} to ${viewing.recipient_email}`} icon={<Mail size={18} />} wide onClose={() => setViewing(null)}>
      <div className="grid gap-4 text-sm">
        <div className="flex flex-wrap items-center gap-3"><DeliveryPill status={viewing.status} /><span className="text-[var(--pf-muted)]">{viewing.attempts} attempt(s){viewing.sent_at ? `, delivered ${formatDate(viewing.sent_at, true)}` : ''}</span></div>
        {viewing.last_error && viewing.status !== 'sent' && <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-rose-800"><strong>Last error:</strong> {viewing.last_error}</p>}
        <div className="whitespace-pre-wrap rounded-xl border border-[var(--pf-line)] bg-slate-50 p-4 leading-6">{viewing.body}</div>
      </div>
    </Modal>}
  </Panel>
}

/**
 * Compose and send an announcement. With `bookshop`, the audience is fixed to that one bookshop.
 * Sending always goes through a confirmation that states exactly who will receive it.
 */
export function AnnouncementComposer({ bookshop }: { bookshop?: { id: number; name: string } }) {
  const client = useQueryClient()
  const [key, setKey] = useState(() => crypto.randomUUID())
  const [form, setForm] = useState({ subject: '', body: 'Hello {name},\n\n', category: 'update' as AnnouncementCategory, recipients: 'owners' as RecipientGroup, audience: (bookshop ? 'selected' : 'all') as 'all' | 'selected' })
  const [selected, setSelected] = useState<number[]>(bookshop ? [bookshop.id] : [])
  const [shopSearch, setShopSearch] = useState('')
  const [review, setReview] = useState<{ bookshops: number; recipients: number } | null>(null)
  const [notice, setNotice] = useState('')
  const shops = useQuery({ queryKey: ['platform', 'bookshops', 'picker', shopSearch], queryFn: () => platformApi.bookshops({ search: shopSearch.trim() || undefined }), enabled: !bookshop && form.audience === 'selected' })
  const audience = { audience: form.audience, bookshop_ids: selected, recipients: form.recipients }
  const check = useMutation({ mutationFn: () => communicationApi.audience(audience), onSuccess: setReview })
  const send = useMutation({
    mutationFn: () => communicationApi.announce({ ...audience, subject: form.subject.trim(), body: form.body.trim(), category: form.category, idempotency_key: key }),
    onSuccess: result => {
      setReview(null); setNotice(result.message); setKey(crypto.randomUUID())
      setForm(current => ({ ...current, subject: '', body: 'Hello {name},\n\n' }))
      void client.invalidateQueries({ queryKey: ['platform-communications'] })
    },
  })
  const ready = form.subject.trim() && form.body.trim().length > 'Hello {name},'.length && (form.audience === 'all' || selected.length > 0)
  function submit(event: FormEvent) { event.preventDefault(); setNotice(''); if (ready) check.mutate() }
  const toggle = (id: number) => setSelected(current => current.includes(id) ? current.filter(x => x !== id) : [...current, id])

  return <Panel title={bookshop ? `Message ${bookshop.name}` : 'New announcement'} description="Write in plain text. {name} and {bookshop} are replaced for each person. Recipients also see it in their notification panel.">
    {notice && <div className="mb-4"><FormAlert tone="success" message={notice} /></div>}
    <form className="grid gap-4" onSubmit={submit}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type"><select className={inputClass} value={form.category} onChange={e => setForm({ ...form, category: e.target.value as AnnouncementCategory })}>{Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Send to"><select className={inputClass} value={form.recipients} onChange={e => setForm({ ...form, recipients: e.target.value as RecipientGroup })}><option value="owners">Bookshop owners</option><option value="staff">Owners and all staff</option></select></Field>
      </div>
      {!bookshop && <fieldset className="grid gap-3">
        <legend className="mb-1 text-sm font-medium text-slate-700">Bookshops</legend>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" name="audience" checked={form.audience === 'all'} onChange={() => setForm({ ...form, audience: 'all' })} /> All bookshops</label>
          <label className="flex items-center gap-2"><input type="radio" name="audience" checked={form.audience === 'selected'} onChange={() => setForm({ ...form, audience: 'selected' })} /> Selected bookshops{selected.length ? ` (${selected.length})` : ''}</label>
        </div>
        {form.audience === 'selected' && <div className="rounded-xl border border-[var(--pf-line)]">
          <div className="border-b border-[var(--pf-line)] p-3"><SearchField label="Search bookshops to add" value={shopSearch} onChange={setShopSearch} placeholder="Find a bookshop" /></div>
          <div className="max-h-56 overflow-y-auto p-2">{shops.isPending ? <LoadingState /> : shops.error ? <ErrorState message={errorMessage(shops.error)} /> : shops.data.data.length === 0 ? <p className="p-3 text-sm text-[var(--pf-muted)]">No bookshops match.</p>
            : shops.data.data.map(shop => <label key={shop.id} className="flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-slate-50">
              <input type="checkbox" checked={selected.includes(shop.id)} onChange={() => toggle(shop.id)} /><span className="flex-1">{shop.name}</span><small className="text-xs text-[var(--pf-muted)]">{humanize(shop.status)}</small>
            </label>)}</div>
        </div>}
      </fieldset>}
      <Field label="Subject"><input className={inputClass} maxLength={200} required value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} placeholder="For example: Scheduled maintenance on Sunday night" /></Field>
      <Field label="Message" hint="Separate paragraphs with a blank line."><textarea className={`${inputClass} h-44 py-2 leading-6`} maxLength={5000} required value={form.body} onChange={e => setForm({ ...form, body: e.target.value })} /></Field>
      {check.isError && <FormAlert message={errorMessage(check.error)} />}
      <div className="flex justify-end"><button className={primaryButton} disabled={!ready || check.isPending}><Send size={16} /> {check.isPending ? 'Counting recipients…' : 'Review and send'}</button></div>
    </form>
    {review && <Modal title="Send this announcement?" description="Emails are queued straight away and cannot be recalled." icon={<Megaphone size={18} />} onClose={() => setReview(null)} busy={send.isPending}>
      <dl className="m-0 grid gap-3 rounded-xl border border-[var(--pf-line)] p-4 text-sm">
        <div className="flex justify-between gap-4"><dt className="text-[var(--pf-muted)]">Subject</dt><dd className="m-0 text-right font-semibold">{form.subject}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-[var(--pf-muted)]">Type</dt><dd className="m-0">{CATEGORY_LABELS[form.category]}</dd></div>
        <div className="flex justify-between gap-4"><dt className="text-[var(--pf-muted)]">Bookshops</dt><dd className="m-0">{bookshop ? bookshop.name : form.audience === 'all' ? `All ${review.bookshops}` : review.bookshops}</dd></div>
        <div className="flex justify-between gap-4 border-t border-[var(--pf-line)] pt-3"><dt className="text-[var(--pf-muted)]">People who will receive it</dt><dd className="pf-num m-0 font-semibold">{review.recipients}</dd></div>
      </dl>
      {review.recipients === 0 && <p className="mt-3 text-sm text-amber-700">No active users with an email address match this audience.</p>}
      {send.isError && <div className="mt-3"><FormAlert message={errorMessage(send.error)} /></div>}
      <div className="mt-6 flex flex-col-reverse gap-3 border-t border-slate-100 pt-5 sm:flex-row sm:justify-end">
        <button type="button" className={secondaryButton} onClick={() => setReview(null)} disabled={send.isPending}>Cancel</button>
        <button type="button" className={primaryButton} disabled={send.isPending || review.recipients === 0} onClick={() => send.mutate()}>{send.isPending ? 'Sending…' : `Send to ${review.recipients} ${review.recipients === 1 ? 'person' : 'people'}`}</button>
      </div>
    </Modal>}
  </Panel>
}

function AnnouncementHistory() {
  const [page, setPage] = useState(1)
  const rows = useQuery({ queryKey: ['platform-communications', 'announcements', page], queryFn: () => communicationApi.announcements(page), placeholderData: keepPreviousData, refetchInterval: 15000 })
  return <Panel title="Sent announcements" flush>
    {rows.isPending ? <LoadingState /> : rows.error ? <ErrorState message={errorMessage(rows.error)} onRetry={() => void rows.refetch()} />
      : !rows.data.data.length ? <EmptyState icon={<Megaphone size={22} />} title="No announcements yet" body="Announcements you send appear here with their delivery results." />
      : <table className="w-full text-sm">
        <thead className="border-b border-[var(--pf-line)] bg-slate-50/70"><tr><th className={thClass}>Announcement</th><th className={`${thClass} hidden md:table-cell`}>Audience</th><th className={`${thClass} text-right`}>Delivered</th><th className={`${thClass} hidden sm:table-cell`}>Sent</th><th className={thClass}><span className="sr-only">Deliveries</span></th></tr></thead>
        <tbody className="divide-y divide-[var(--pf-line)]">{rows.data.data.map(a => <tr key={a.id}>
          <td className={tdClass}><strong className="block max-w-[40ch] truncate font-semibold">{a.subject}</strong><small className="text-xs text-[var(--pf-muted)]">{CATEGORY_LABELS[a.category]}</small></td>
          <td className={`${tdClass} hidden text-[var(--pf-muted)] md:table-cell`}>{a.audience === 'all' ? 'All bookshops' : `${a.bookshop_ids?.length ?? 0} bookshop(s)`}, {a.recipients === 'owners' ? 'owners' : 'all staff'}</td>
          <td className={`${tdClass} pf-num text-right`}><span className="font-semibold">{a.sent_count}</span> / {a.recipient_count}{a.failed_count > 0 && <small className="block text-xs text-rose-700">{a.failed_count} failed</small>}</td>
          <td className={`${tdClass} hidden whitespace-nowrap text-[var(--pf-muted)] sm:table-cell`}>{formatDate(a.created_at, true)}</td>
          <td className={`${tdClass} text-right`}><Link className="text-sm font-semibold text-[var(--pf-brand)] hover:underline" to={`${BASE}/log?announcement=${a.id}`}>Deliveries</Link></td>
        </tr>)}</tbody>
      </table>}
    {rows.data && rows.data.total > 0 && <PageControls page={rows.data} onPage={setPage} />}
  </Panel>
}

function TemplateEditor() {
  const templates = useQuery({ queryKey: ['platform-communications', 'templates'], queryFn: communicationApi.templates })
  const [open, setOpen] = useState<string | null>(null)
  if (templates.isPending) return <LoadingState />
  if (templates.error) return <ErrorState message={errorMessage(templates.error)} onRetry={() => void templates.refetch()} />
  return <Panel title="Automatic email templates" description="These messages are sent automatically when the event happens. Edits apply to new messages only." flush>
    <ul className="m-0 list-none divide-y divide-[var(--pf-line)] p-0">{templates.data.map(template => <li key={template.key}>
      <button type="button" className="flex w-full items-start justify-between gap-3 px-5 py-4 text-left hover:bg-slate-50" aria-expanded={open === template.key} onClick={() => setOpen(open === template.key ? null : template.key)}>
        <span className="min-w-0"><strong className="block font-semibold">{template.label}</strong><small className="block text-sm text-[var(--pf-muted)]">{template.description}</small></span>
        <span className="flex shrink-0 flex-wrap justify-end gap-2">{template.customized && <Pill tone="info">Edited</Pill>}<Pill tone={template.is_enabled ? 'positive' : 'neutral'}>{template.is_enabled ? 'On' : 'Off'}</Pill></span>
      </button>
      {open === template.key && <TemplateForm key={`${template.key}-${template.subject}-${template.is_enabled}`} template={template} />}
    </li>)}</ul>
  </Panel>
}

function TemplateForm({ template }: { template: CommunicationTemplate }) {
  const client = useQueryClient()
  const [subject, setSubject] = useState(template.subject)
  const [body, setBody] = useState(template.body)
  const [enabled, setEnabled] = useState(template.is_enabled)
  const [confirmReset, setConfirmReset] = useState(false)
  const done = () => void client.invalidateQueries({ queryKey: ['platform-communications', 'templates'] })
  const save = useMutation({ mutationFn: () => communicationApi.saveTemplate(template.key, { subject, body, is_enabled: enabled }), onSuccess: done })
  const reset = useMutation({ mutationFn: () => communicationApi.resetTemplate(template.key), onSuccess: () => { setConfirmReset(false); done() } })
  return <form className="grid gap-4 border-t border-[var(--pf-line)] bg-slate-50/60 px-5 py-5" onSubmit={e => { e.preventDefault(); save.mutate() }}>
    <Field label="Subject"><input className={inputClass} maxLength={200} required value={subject} onChange={e => setSubject(e.target.value)} /></Field>
    <Field label="Message" hint="Separate paragraphs with a blank line."><textarea className={`${inputClass} h-52 py-2 leading-6`} maxLength={5000} required value={body} onChange={e => setBody(e.target.value)} /></Field>
    <div className="text-xs text-[var(--pf-muted)]"><p className="mb-1.5 font-medium">Placeholders you can use</p><div className="flex flex-wrap gap-1.5">{template.placeholders.map(p => <code key={p} className="rounded bg-white px-1.5 py-0.5 ring-1 ring-[var(--pf-line)]">{`{${p}}`}</code>)}</div></div>
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={enabled} onChange={e => setEnabled(e.target.checked)} /><span>Send this email automatically<small className="block text-xs text-[var(--pf-muted)]">When off, the event still happens but no email or in-app notice is sent for it.</small></span></label>
    {save.isSuccess && <FormAlert tone="success" message={save.data.message} />}
    {(save.error || reset.error) && <FormAlert message={errorMessage(save.error ?? reset.error)} />}
    <div className="flex flex-wrap justify-end gap-2">
      {template.customized && <button type="button" className={secondaryButton} onClick={() => setConfirmReset(true)}>Restore default</button>}
      <button className={primaryButton} disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save template'}</button>
    </div>
    {confirmReset && <Modal title="Restore the default template?" description="Your edited subject and message are replaced with the built-in wording." onClose={() => setConfirmReset(false)} busy={reset.isPending}>
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" className={secondaryButton} onClick={() => setConfirmReset(false)}>Cancel</button>
        <button type="button" className={primaryButton} disabled={reset.isPending} onClick={() => reset.mutate()}>{reset.isPending ? 'Restoring…' : 'Restore default'}</button>
      </div>
    </Modal>}
  </form>
}

