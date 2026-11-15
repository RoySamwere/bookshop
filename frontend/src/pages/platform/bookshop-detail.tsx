import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowLeft, CalendarPlus, CheckCircle2, ChevronRight, FileText, History, Pencil, ReceiptText, ShieldCheck, Users } from 'lucide-react'
import { EmptyState, ErrorState, Field, FormAlert, LoadingState, Modal, ModalActions, dangerButton, formatDate, inputClass, primaryButton, secondaryButton } from '../../components/ui-kit'
import { useAuth } from '../../features/auth/auth-provider'
import { ApiError, errorMessage } from '../../lib/api'
import { hasPermission, type BookshopUser } from '../../lib/auth'
import { billingApi, billsApi, trialApi } from '../../lib/billing-api'
import { platformApi, type BookshopAccount, type PlatformBookshop, type PlatformBookshopDetails } from '../../lib/tenancy-api'
import { BillStatusPill } from './payments-reconciliation'
import { AnnouncementComposer, DeliveryLog } from './communications'
import { ExtendTrialModal } from './trial-extensions'
import { DetailList, Metric, MetricStrip, PageControls, Panel, Pill, PlatformTitle, ShopStatus, StatePill, SubNav, humanize, kes, tdClass, thClass } from './platform-ui'

type Detail = PlatformBookshopDetails

/** One place to run a bookshop's whole lifecycle: /platform/bookshops/:id and its tabs. */
export default function BookshopDetailView() {
  const id = Number(useParams().id)
  const { user } = useAuth() as { user: BookshopUser }
  const client = useQueryClient()
  const shop = useQuery({ queryKey: ['platform', 'bookshop', id], queryFn: () => platformApi.bookshop(id) })
  const [dialog, setDialog] = useState<'suspend' | 'reactivate' | 'approve' | null>(null)
  const [notice, setNotice] = useState('')
  const done = (message: string) => { setDialog(null); setNotice(message); void client.invalidateQueries({ queryKey: ['platform'] }); void client.invalidateQueries({ queryKey: ['platform-communications'] }) }

  if (shop.isPending) return <LoadingState />
  if (shop.error) return <ErrorState message={errorMessage(shop.error)} onRetry={() => void shop.refetch()} />
  const data = shop.data
  const base = `/platform/bookshops/${id}`
  const isOwner = user.role === 'platform_owner'
  const lifecycle = {
    approve: isOwner && data.status === 'pending_verification',
    suspend: hasPermission(user, 'platform.bookshops.suspend') && data.status !== 'suspended',
    reactivate: hasPermission(user, 'platform.bookshops.suspend') && data.status === 'suspended',
  }
  const tabs = [
    { to: base, label: 'Overview', end: true }, { to: `${base}/billing`, label: 'Subscription & billing' }, { to: `${base}/users`, label: 'Users' },
    { to: `${base}/activity`, label: 'Activity' },
    ...(hasPermission(user, 'platform.communications.manage') ? [{ to: `${base}/communication`, label: 'Communication' }] : []),
    { to: `${base}/settings`, label: 'Settings' },
  ]
  const actions = <>
    {lifecycle.approve && <button className={primaryButton} onClick={() => setDialog('approve')}>Approve & activate</button>}
    {lifecycle.reactivate && <button className={primaryButton} onClick={() => setDialog('reactivate')}>Reactivate</button>}
    {lifecycle.suspend && <button className={dangerButton} onClick={() => setDialog('suspend')}>Suspend</button>}
  </>

  return <>
    <Link to="/platform/bookshops" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-[var(--pf-muted)] hover:text-[var(--pf-ink)]"><ArrowLeft size={15} /> All bookshops</Link>
    <PlatformTitle title={data.name} description={`${data.location || 'No location'}, ${data.country}. Prices in ${data.currency}.`}
      meta={<><ShopStatus status={data.status} />{data.subscription && <StatePill status={data.subscription.status} label={`Subscription: ${humanize(data.subscription.status)}`} />}<span className="text-xs text-[var(--pf-muted)]">Code {data.slug}</span></>}
      actions={actions} />
    {notice && <div className="mb-5"><FormAlert tone="success" message={notice} /></div>}
    {data.status === 'suspended' && <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800" role="status"><strong>Suspended {formatDate(data.suspended_at, true)}.</strong> {data.suspension_reason && <>Reason: {data.suspension_reason.replace(/[.!?]*$/, '.')} </>}Users can still sign in but only see a suspension notice; no records are changed.</div>}
    <SubNav label="Bookshop sections" items={tabs} />
    <Routes>
      <Route index element={<OverviewTab data={data} base={base} />} />
      <Route path="billing" element={<BillingTab data={data} user={user} onNotice={setNotice} />} />
      <Route path="users" element={<UsersTab data={data} user={user} />} />
      <Route path="activity" element={<ActivityTab data={data} />} />
      <Route path="communication" element={hasPermission(user, 'platform.communications.manage') ? <CommunicationTab data={data} /> : <Navigate replace to={base} />} />
      <Route path="settings" element={<SettingsTab data={data} user={user} lifecycle={lifecycle} onLifecycle={setDialog} />} />
      <Route path="*" element={<Navigate replace to={base} />} />
    </Routes>
    {(dialog === 'suspend' || dialog === 'reactivate') && <StatusDialog shop={data} mode={dialog} onClose={() => setDialog(null)} onDone={done} />}
    {dialog === 'approve' && <ApproveDialog shop={data} onClose={() => setDialog(null)} onDone={done} />}
  </>
}

function OverviewTab({ data, base }: { data: Detail; base: string }) {
  const users = useQuery({ queryKey: ['platform', 'bookshop', data.id, 'users'], queryFn: () => platformApi.bookshopUsers(data.id) })
  const invoices = useQuery({ queryKey: ['platform-billing', 'invoices', 'bookshop', data.id, 1], queryFn: () => billingApi.invoices(1, '', '', data.id) })
  const s = data.subscription
  const accessEnds = s ? (s.status === 'trialing' ? s.trial_ends_at : s.current_period_ends_at) : null
  const open = invoices.data?.data.filter(i => i.status !== 'paid') ?? []
  const attention = [
    data.status === 'pending_verification' && { text: 'Waiting for approval', to: `${base}/settings` },
    data.owner && !data.owner.email_verified && { text: 'Owner has not verified their email address', to: `${base}/settings` },
    s && s.days_remaining !== null && s.days_remaining !== undefined && s.days_remaining <= 7 && ['trialing', 'active', 'past_due', 'grace_period'].includes(s.status) && { text: `Access ends in ${s.days_remaining} day(s)`, to: `${base}/billing` },
    s?.status === 'expired' && { text: 'Subscription has ended; the workspace is closed', to: `${base}/billing` },
    open.length > 0 && { text: `${open.length} unpaid invoice(s)`, to: `${base}/billing` },
  ].filter(Boolean) as { text: string; to: string }[]
  return <div className="grid gap-6">
    <MetricStrip label="Bookshop at a glance">
      <Metric label="Subscription" value={s ? humanize(s.status) : 'Legacy'} hint={s?.plan?.name ?? 'No plan'} />
      <Metric label={s?.status === 'trialing' ? 'Trial ends' : 'Access until'} value={accessEnds ? formatDate(accessEnds) : '—'} hint={s?.days_remaining != null ? `${s.days_remaining} day(s) left` : 'No end date'} />
      <Metric label="Users" value={users.data ? users.data.filter(u => u.is_active).length : '—'} hint={users.data ? `${users.data.length} account(s) in total` : ''} />
      <Metric label="Branches" value={data.branches_count ?? 0} hint={`${data.staff_count ?? 0} staff account(s)`} />
    </MetricStrip>
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="grid min-w-0 content-start gap-6">
        <Panel title="Needs attention" flush>
          {attention.length === 0 ? <p className="flex items-center gap-2 px-5 py-5 text-sm text-[var(--pf-muted)]"><CheckCircle2 size={18} className="text-emerald-600" /> Nothing needs attention for this bookshop.</p>
            : <ul className="m-0 list-none divide-y divide-[var(--pf-line)] p-0">{attention.map(item => <li key={item.text}><Link to={item.to} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-slate-50"><AlertTriangle size={16} className="text-amber-600" aria-hidden="true" /><span className="flex-1">{item.text}</span><ChevronRight size={16} className="text-slate-400" aria-hidden="true" /></Link></li>)}</ul>}
        </Panel>
        <Panel title="Recent activity" flush actions={<Link className="text-sm font-semibold text-[var(--pf-brand)] hover:underline" to={`${base}/activity`}>All activity</Link>}>
          {data.history.length === 0 ? <EmptyState icon={<History size={22} />} title="No activity yet" body="Lifecycle events will appear here." />
            : <ol className="m-0 list-none divide-y divide-[var(--pf-line)] p-0">{data.history.slice(0, 5).map(entry => <li key={entry.id} className="px-5 py-3 text-sm"><p className="m-0">{entry.description}</p><small className="text-xs text-[var(--pf-muted)]">{formatDate(entry.created_at, true)}{entry.user ? `, by ${entry.user.name}` : ''}</small></li>)}</ol>}
        </Panel>
      </div>
      <div className="grid content-start gap-6">
        <Panel title="Owner">{data.owner ? <DetailList rows={[['Name', data.owner.name], ['Email', <>{data.owner.email}{!data.owner.email_verified && <Pill tone="warning">Unverified</Pill>}</>], ['Phone', data.owner.phone || '—'], ['Last sign-in', formatDate(data.owner.last_login_at ?? null, true)]]} /> : <p className="text-sm text-[var(--pf-muted)]">No owner account.</p>}</Panel>
        <Panel title="Bookshop"><DetailList rows={[['Registered', formatDate(data.registered_at, true)], ['Approved', formatDate(data.verified_at, true)], ['Business email', data.business_email || '—'], ['Phone', data.phone || '—'], ['Time zone', data.timezone]]} /></Panel>
      </div>
    </div>
  </div>
}

function BillingTab({ data, user, onNotice }: { data: Detail; user: BookshopUser; onNotice: (message: string) => void }) {
  const client = useQueryClient()
  const isOwner = user.role === 'platform_owner'
  const [invoicePage, setInvoicePage] = useState(1)
  const [paymentPage, setPaymentPage] = useState(1)
  const [modal, setModal] = useState<'trial' | 'plan' | 'invoice' | null>(null)
  const trial = useQuery({ queryKey: ['platform-billing', 'trials', 'bookshop', data.id], queryFn: () => trialApi.subscriptions({ bookshop_id: data.id }), enabled: hasPermission(user, 'platform.subscriptions.extend_trial') })
  const trialRow = trial.data?.data.find(row => row.bookshop_id === data.id)
  const plans = useQuery({ queryKey: ['platform-billing', 'plans'], queryFn: platformApi.plans, enabled: isOwner })
  const invoices = useQuery({ queryKey: ['platform-billing', 'invoices', 'bookshop', data.id, invoicePage], queryFn: () => billingApi.invoices(invoicePage, '', '', data.id), placeholderData: keepPreviousData })
  const payments = useQuery({ queryKey: ['platform-bills', 'bookshop', data.id, paymentPage], queryFn: () => billsApi.list({ bookshop_id: data.id, page: paymentPage }), placeholderData: keepPreviousData })
  const s = data.subscription
  const finish = (message: string) => { setModal(null); onNotice(message); void client.invalidateQueries({ queryKey: ['platform'] }); void client.invalidateQueries({ queryKey: ['platform-billing'] }); void client.invalidateQueries({ queryKey: ['platform-communications'] }) }

  return <div className="grid gap-6">
    <Panel title="Subscription" actions={s && <div className="flex flex-wrap gap-2">
      {trialRow?.eligible && <button className={secondaryButton} onClick={() => setModal('trial')}><CalendarPlus size={15} /> Extend Trial</button>}
      {isOwner && hasPermission(user, 'platform.settings.manage') && <button className={secondaryButton} onClick={() => setModal('plan')}>Change plan</button>}
      {isOwner && hasPermission(user, 'platform.settings.manage') && <button className={secondaryButton} onClick={() => setModal('invoice')}><FileText size={15} /> Issue renewal invoice</button>}
    </div>}>
      {s ? <DetailList rows={[
        ['Plan', s.plan?.name ?? '—'], ['Status', <StatePill key="status" status={s.status} />],
        ['Trial ends', formatDate(s.trial_ends_at, true)], ['Paid access until', formatDate(s.current_period_ends_at, true)],
        ['Days left', s.days_remaining ?? '—'],
      ]} /> : <p className="text-sm text-[var(--pf-muted)]">No subscription record. This is the adopted legacy bookshop and keeps unrestricted access.</p>}
    </Panel>
    <div className="grid gap-6 xl:grid-cols-2">
      <Panel title="Invoices" flush>
        {invoices.isPending ? <LoadingState /> : invoices.error ? <ErrorState message={errorMessage(invoices.error)} onRetry={() => void invoices.refetch()} />
          : !invoices.data.data.length ? <EmptyState icon={<ReceiptText size={22} />} title="No invoices" body="Invoices appear when the owner chooses a plan or a renewal is issued." />
          : <table className="w-full text-sm"><thead className="border-b border-[var(--pf-line)] bg-slate-50/70"><tr><th className={thClass}>Invoice</th><th className={thClass}>Status</th><th className={`${thClass} text-right`}>Balance</th></tr></thead>
            <tbody className="divide-y divide-[var(--pf-line)]">{invoices.data.data.map(invoice => {
              const balance = Math.max(0, Number(invoice.amount) - Number(invoice.paid))
              return <tr key={invoice.id}><td className={tdClass}><strong className="font-semibold">#{invoice.id}</strong><small className="block text-xs text-[var(--pf-muted)]">Account {invoice.account_number}, {kes(invoice.amount)}</small></td>
                <td className={tdClass}><StatePill status={invoice.status} /></td><td className={`${tdClass} pf-num text-right font-semibold ${balance > 0 ? 'text-amber-700' : 'text-[var(--pf-muted)]'}`}>{kes(balance)}</td></tr>
            })}</tbody></table>}
        {invoices.data && invoices.data.total > 0 && <PageControls page={invoices.data} onPage={setInvoicePage} />}
      </Panel>
      <Panel title="Payments" flush>
        {payments.isPending ? <LoadingState /> : payments.error ? <ErrorState message={errorMessage(payments.error)} onRetry={() => void payments.refetch()} />
          : !payments.data.data.length ? <EmptyState icon={<ReceiptText size={22} />} title="No payments" body="M-Pesa payments for this bookshop appear here." />
          : <table className="w-full text-sm"><thead className="border-b border-[var(--pf-line)] bg-slate-50/70"><tr><th className={thClass}>M-Pesa code</th><th className={`${thClass} text-right`}>Amount</th><th className={thClass}>Status</th></tr></thead>
            <tbody className="divide-y divide-[var(--pf-line)]">{payments.data.data.map(bill => <tr key={bill.id}><td className={tdClass}><strong className="font-semibold">{bill.mpesa_receipt_number ?? 'Awaiting code'}</strong><small className="block text-xs text-[var(--pf-muted)]">{formatDate(bill.transaction_date, true)}</small></td>
              <td className={`${tdClass} pf-num text-right`}>{kes(bill.amount)}</td><td className={tdClass}><BillStatusPill status={bill.status} /></td></tr>)}</tbody></table>}
        {payments.data && payments.data.total > 0 && <PageControls page={payments.data} onPage={setPaymentPage} />}
      </Panel>
    </div>
    <Panel title="Subscription history" flush>
      {!data.subscription_history?.length ? <EmptyState icon={<History size={22} />} title="No subscription changes" body="Trials, renewals, plan changes and status changes appear here." />
        : <ol className="m-0 list-none divide-y divide-[var(--pf-line)] p-0">{data.subscription_history.map((entry, index) => <li key={`${entry.created_at}-${index}`} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3 text-sm">
          <span><span className="font-medium">{humanize(entry.event)}</span>{entry.note && <small className="block text-xs text-[var(--pf-muted)]">{entry.note}</small>}</span>
          <span className="flex items-center gap-2">{entry.from_status && entry.from_status !== entry.to_status && <><StatePill status={entry.from_status} /><ChevronRight size={14} className="text-slate-400" aria-label="to" /></>}<StatePill status={entry.to_status} /><time className="text-xs text-[var(--pf-muted)]">{formatDate(entry.created_at, true)}</time></span>
        </li>)}</ol>}
    </Panel>
    {modal === 'trial' && trialRow && trial.data && <ExtendTrialModal target={trialRow} maxDays={trial.data.max_days} onClose={() => setModal(null)} onDone={finish} />}
    {modal === 'plan' && s && <PlanDialog shop={data} plans={(plans.data ?? []).filter(p => p.is_active)} currentPlan={s.plan?.name ?? null} onClose={() => setModal(null)} onDone={finish} />}
    {modal === 'invoice' && <InvoiceDialog shop={data} plans={(plans.data ?? []).filter(p => p.is_active && Number(p.price) > 0)} defaultPlan={s?.plan?.name} onClose={() => setModal(null)} onDone={finish} />}
  </div>
}

function PlanDialog({ shop, plans, currentPlan, onClose, onDone }: { shop: Detail; plans: { id: number; name: string; price: string; billing_interval: string }[]; currentPlan: string | null; onClose: () => void; onDone: (message: string) => void }) {
  const [planId, setPlanId] = useState('')
  const save = useMutation({ mutationFn: () => platformApi.changePlan(shop.id, Number(planId)), onSuccess: result => onDone(result.message) })
  return <Modal title="Change plan" description={`Applies to ${shop.name}'s next renewal. Current access, the trial and issued invoices are not changed. The owner is told by email.`} onClose={onClose} busy={save.isPending}>
    <form className="grid gap-4" onSubmit={e => { e.preventDefault(); if (planId) save.mutate() }}>
      <Field label="Current plan"><input className={inputClass} value={currentPlan ?? 'No plan'} readOnly /></Field>
      <Field label="New plan"><select className={inputClass} required value={planId} onChange={e => setPlanId(e.target.value)}><option value="">Choose a plan</option>{plans.filter(p => p.name !== currentPlan).map(p => <option key={p.id} value={p.id}>{p.name}, KES {Number(p.price).toLocaleString()} / {p.billing_interval}</option>)}</select></Field>
      <FormAlert message={save.error ? errorMessage(save.error) : ''} />
      <ModalActions busy={save.isPending} submitLabel="Change plan" busyLabel="Saving…" onCancel={onClose} />
    </form>
  </Modal>
}

function InvoiceDialog({ shop, plans, defaultPlan, onClose, onDone }: { shop: Detail; plans: { id: number; name: string; price: string; billing_interval: string }[]; defaultPlan?: string; onClose: () => void; onDone: (message: string) => void }) {
  const [planId, setPlanId] = useState(String(plans.find(p => p.name === defaultPlan)?.id ?? ''))
  const issue = useMutation({ mutationFn: () => platformApi.renewalInvoice(shop.id, Number(planId)), onSuccess: result => onDone(result.message) })
  return <Modal title="Issue a renewal invoice" description={`Creates an invoice with its own M-Pesa account number and emails ${shop.name}'s owner. If an invoice is already open, that one is reused and nothing new is created.`} onClose={onClose} busy={issue.isPending}>
    <form className="grid gap-4" onSubmit={e => { e.preventDefault(); if (planId) issue.mutate() }}>
      <Field label="Plan"><select className={inputClass} required value={planId} onChange={e => setPlanId(e.target.value)}><option value="">Choose a paid plan</option>{plans.map(p => <option key={p.id} value={p.id}>{p.name}, KES {Number(p.price).toLocaleString()} / {p.billing_interval}</option>)}</select></Field>
      {plans.length === 0 && <p className="text-sm text-amber-700">There are no available paid plans. Add one under Billing, Plans & pricing.</p>}
      <FormAlert message={issue.error ? errorMessage(issue.error) : ''} />
      <ModalActions busy={issue.isPending} submitLabel="Issue invoice" busyLabel="Issuing…" onCancel={onClose} />
    </form>
  </Modal>
}

function UsersTab({ data, user }: { data: Detail; user: BookshopUser }) {
  const client = useQueryClient()
  const users = useQuery({ queryKey: ['platform', 'bookshop', data.id, 'users'], queryFn: () => platformApi.bookshopUsers(data.id) })
  const [target, setTarget] = useState<BookshopAccount | null>(null)
  const [notice, setNotice] = useState('')
  const canManage = user.role === 'platform_owner' && hasPermission(user, 'platform.bookshops.suspend')
  const toggle = useMutation({
    mutationFn: (account: BookshopAccount) => platformApi.setBookshopUserStatus(data.id, account.id, !account.is_active),
    onSuccess: result => { setTarget(null); setNotice(result.message); void client.invalidateQueries({ queryKey: ['platform', 'bookshop', data.id, 'users'] }) },
  })
  return <Panel title="Users" description="Accounts that can sign in to this bookshop. Their business records stay in the bookshop's own workspace." flush>
    {notice && <div className="border-b border-[var(--pf-line)] px-5 py-3"><FormAlert tone="success" message={notice} /></div>}
    {users.isPending ? <LoadingState /> : users.error ? <ErrorState message={errorMessage(users.error)} onRetry={() => void users.refetch()} />
      : !users.data.length ? <EmptyState icon={<Users size={22} />} title="No users" body="Staff appear here once the owner invites them." />
      : <table className="w-full text-sm">
        <thead className="border-b border-[var(--pf-line)] bg-slate-50/70"><tr><th className={thClass}>Name</th><th className={`${thClass} hidden sm:table-cell`}>Role</th><th className={`${thClass} hidden md:table-cell`}>Last sign-in</th><th className={thClass}>Status</th><th className={thClass}><span className="sr-only">Actions</span></th></tr></thead>
        <tbody className="divide-y divide-[var(--pf-line)]">{users.data.map(account => <tr key={account.id}>
          <td className={tdClass}><strong className="font-semibold">{account.name}</strong>{account.is_owner && <Pill tone="info">Owner</Pill>}<small className="block break-all text-xs text-[var(--pf-muted)]">{account.email}{!account.email_verified && ' (unverified)'}</small></td>
          <td className={`${tdClass} hidden sm:table-cell`}>{account.role_label}</td>
          <td className={`${tdClass} hidden text-[var(--pf-muted)] md:table-cell`}>{formatDate(account.last_login_at, true)}</td>
          <td className={tdClass}><Pill tone={account.is_active ? 'positive' : 'neutral'}>{account.is_active ? 'Active' : 'Deactivated'}</Pill></td>
          <td className={`${tdClass} text-right`}>{canManage && !account.is_owner && <button className={`${account.is_active ? dangerButton : secondaryButton} h-9 px-3`} onClick={() => setTarget(account)}>{account.is_active ? 'Deactivate' : 'Activate'}</button>}</td>
        </tr>)}</tbody>
      </table>}
    {target && <Modal title={target.is_active ? `Deactivate ${target.name}?` : `Activate ${target.name}?`} description={target.is_active ? 'They are signed out everywhere and cannot sign in until reactivated. Their records and history are kept.' : 'They can sign in again with their existing password.'} onClose={() => setTarget(null)} busy={toggle.isPending}>
      <FormAlert message={toggle.error ? errorMessage(toggle.error) : ''} />
      <div className="mt-2 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button type="button" className={secondaryButton} onClick={() => setTarget(null)} disabled={toggle.isPending}>Cancel</button>
        <button type="button" className={target.is_active ? dangerButton : primaryButton} disabled={toggle.isPending} onClick={() => toggle.mutate(target)}>{toggle.isPending ? 'Saving…' : target.is_active ? 'Deactivate user' : 'Activate user'}</button>
      </div>
    </Modal>}
  </Panel>
}

function ActivityTab({ data }: { data: Detail }) {
  const [page, setPage] = useState(1)
  const audit = useQuery({ queryKey: ['platform', 'audit', 'bookshop', data.id, page], queryFn: () => platformApi.audit({ bookshop_id: data.id, page }), placeholderData: keepPreviousData })
  return <Panel title="Administrative activity" description="Lifecycle, billing and platform actions for this bookshop, newest first. Activity inside the workspace stays in the bookshop's own audit log." flush>
    {audit.isPending ? <LoadingState /> : audit.error ? <ErrorState message={errorMessage(audit.error)} onRetry={() => void audit.refetch()} />
      : audit.data.data.length === 0 ? <EmptyState icon={<History size={22} />} title="No activity yet" body="Actions taken on this bookshop appear here." />
      : <ol className="m-0 list-none divide-y divide-[var(--pf-line)] p-0">{audit.data.data.map(entry => <li key={entry.id} className="flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <span className="min-w-0"><span className="block">{entry.description}</span><small className="text-xs text-[var(--pf-muted)]">{humanize(entry.action.split('.')[0])} event{entry.user ? `, by ${entry.user.name}` : ''}</small></span>
        <time className="shrink-0 text-xs text-[var(--pf-muted)]">{formatDate(entry.created_at, true)}</time>
      </li>)}</ol>}
    {audit.data && audit.data.meta.total > 0 && <PageControls page={audit.data.meta} onPage={setPage} />}
  </Panel>
}

function CommunicationTab({ data }: { data: Detail }) {
  return <div className="grid gap-6">
    <DeliveryLog title="Emails sent to this bookshop" bookshopId={data.id} />
    <AnnouncementComposer bookshop={{ id: data.id, name: data.name }} />
  </div>
}

function SettingsTab({ data, user, lifecycle, onLifecycle }: { data: Detail; user: BookshopUser; lifecycle: { approve: boolean; suspend: boolean; reactivate: boolean }; onLifecycle: (mode: 'approve' | 'suspend' | 'reactivate') => void }) {
  const client = useQueryClient()
  const isOwner = user.role === 'platform_owner'
  const [form, setForm] = useState({ name: data.name, business_email: data.business_email ?? '', phone: data.phone ?? '', location: data.location ?? '' })
  const save = useMutation({ mutationFn: () => platformApi.updateBookshop(data.id, form), onSuccess: () => void client.invalidateQueries({ queryKey: ['platform'] }) })
  const resend = useMutation({ mutationFn: () => platformApi.resendOwnerVerification(data.id) })
  return <div className="grid max-w-3xl gap-6">
    <Panel title="Business details" description="Contact details shown to platform staff. The owner can also change these in their workspace.">
      <form className="grid gap-4" onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate() }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bookshop name"><input required className={inputClass} disabled={!isOwner} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Business email"><input type="email" className={inputClass} disabled={!isOwner} value={form.business_email} onChange={e => setForm({ ...form, business_email: e.target.value })} /></Field>
          <Field label="Phone"><input className={inputClass} disabled={!isOwner} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></Field>
          <Field label="Location"><input className={inputClass} disabled={!isOwner} value={form.location} onChange={e => setForm({ ...form, location: e.target.value })} /></Field>
        </div>
        {save.isSuccess && <FormAlert tone="success" message={save.data.message} />}
        {save.isError && <FormAlert message={errorMessage(save.error)} />}
        {isOwner ? <div className="flex justify-end"><button className={primaryButton} disabled={save.isPending}><Pencil size={15} /> {save.isPending ? 'Saving…' : 'Save details'}</button></div>
          : <p className="text-sm text-[var(--pf-muted)]">Only the Platform Owner can change these details.</p>}
      </form>
    </Panel>
    {data.owner && !data.owner.email_verified && hasPermission(user, 'platform.bookshops.onboard') && <Panel title="Owner email verification" description={`${data.owner.email} has not confirmed their email address yet.`}>
      {resend.isSuccess && <div className="mb-3"><FormAlert tone="success" message={resend.data.message} /></div>}
      {resend.isError && <div className="mb-3"><FormAlert message={errorMessage(resend.error)} /></div>}
      <button className={secondaryButton} disabled={resend.isPending} onClick={() => resend.mutate()}>{resend.isPending ? 'Sending…' : 'Resend verification email'}</button>
    </Panel>}
    <Panel title="Lifecycle" description="Activation and suspension. Suspending keeps every record and account; users can sign in but only see a notice asking them to contact support.">
      <div className="grid gap-3 text-sm">
        <LifecycleRow title="Activation" body={data.status === 'pending_verification' ? 'Approve the bookshop to open its workspace and send the welcome email.' : `Activated ${formatDate(data.verified_at, true)}.`}
          action={lifecycle.approve && <button className={primaryButton} onClick={() => onLifecycle('approve')}>Approve & activate</button>} />
        <LifecycleRow title="Suspension" body={data.status === 'suspended' ? `Suspended ${formatDate(data.suspended_at, true)}. Reason: ${data.suspension_reason ?? '—'}` : 'Temporarily pause access, for example during a billing dispute. Every user is notified.'}
          action={lifecycle.reactivate ? <button className={primaryButton} onClick={() => onLifecycle('reactivate')}>Reactivate</button> : lifecycle.suspend ? <button className={dangerButton} onClick={() => onLifecycle('suspend')}>Suspend bookshop</button> : null} />
      </div>
      {!lifecycle.approve && !lifecycle.suspend && !lifecycle.reactivate && <p className="mt-3 flex items-center gap-2 text-sm text-[var(--pf-muted)]"><ShieldCheck size={16} /> Your platform role cannot change this bookshop's lifecycle.</p>}
    </Panel>
  </div>
}

function LifecycleRow({ title, body, action }: { title: string; body: string; action: ReactNode }) {
  return <div className="flex flex-col gap-3 rounded-xl border border-[var(--pf-line)] p-4 sm:flex-row sm:items-center sm:justify-between">
    <div><p className="m-0 font-semibold">{title}</p><p className="m-0 mt-0.5 text-[var(--pf-muted)]">{body}</p></div>{action}
  </div>
}

function ApproveDialog({ shop, onClose, onDone }: { shop: PlatformBookshop; onClose: () => void; onDone: (message: string) => void }) {
  const approve = useMutation({ mutationFn: () => platformApi.approve(shop.id), onSuccess: result => onDone(result.message) })
  return <Modal title={`Approve ${shop.name}?`} description="The workspace opens for its owner and staff, and the owner receives the welcome email." onClose={onClose} busy={approve.isPending}>
    <FormAlert message={approve.error ? errorMessage(approve.error) : ''} />
    <div className="mt-2 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      <button type="button" className={secondaryButton} onClick={onClose} disabled={approve.isPending}>Cancel</button>
      <button type="button" className={primaryButton} disabled={approve.isPending} onClick={() => approve.mutate()}>{approve.isPending ? 'Approving…' : 'Approve & activate'}</button>
    </div>
  </Modal>
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
  return <Modal title={mode === 'suspend' ? `Suspend ${shop.name}?` : `Reactivate ${shop.name}?`} description={mode === 'suspend' ? 'Users can still sign in but only see a notice asking them to contact support. Every user is emailed. No records are changed or deleted.' : 'Users regain access according to the subscription, and everyone is emailed.'} onClose={onClose} busy={busy}>
    <form onSubmit={submit} className="grid gap-4">
      <Field label={mode === 'suspend' ? 'Reason (shown to the bookshop users)' : 'Note (optional)'}>
        <textarea className={`${inputClass} h-24 py-2`} value={text} onChange={e => setText(e.target.value)} required={mode === 'suspend'} />
      </Field>
      <FormAlert message={error} />
      <ModalActions busy={busy} submitLabel={mode === 'suspend' ? 'Suspend bookshop' : 'Reactivate'} busyLabel="Saving…" onCancel={onClose} danger={mode === 'suspend'} />
    </form>
  </Modal>
}
