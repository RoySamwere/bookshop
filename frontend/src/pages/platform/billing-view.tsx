import { useState, type ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useSearchParams } from 'react-router-dom'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, ChevronRight, FlaskConical, ReceiptText, RefreshCw, Tags } from 'lucide-react'
import { billingApi, billsApi, paymentStatus, type Plan } from '../../lib/billing-api'
import { platformApi } from '../../lib/tenancy-api'
import { useAuth } from '../../features/auth/auth-provider'
import { errorMessage } from '../../lib/api'
import { EmptyState, ErrorState, LoadingState, formatDate, inputClass, primaryButton, secondaryButton } from '../../components/ui-kit'
import PaymentsReconciliation, { BillStatusPill, BillingHealthBanner } from './payments-reconciliation'
import TrialExtensionsPanel from './trial-extensions'
import { BarList, Metric, MetricStrip, PageControls, Panel, Pill, PlatformTitle, Segmented, SelectField, SplitBar, StatePill, SubNav, Toolbar, humanize, kes, tdClass, thClass } from './platform-ui'

type PlanDraft = { code: string; name: string; price: string; interval: string }
const BASE = '/platform/billing'

/** Billing workspace: one place for subscriptions, invoices, M-Pesa payments, plans, trials and reports. */
export default function PlatformBillingView() {
  const { user } = useAuth()
  const client = useQueryClient()
  const context = useQuery({ queryKey: ['platform-billing', 'context'], queryFn: billingApi.context })
  const canManage = user?.permissions?.includes('platform.settings.manage') ?? false
  const canExtendTrials = user?.permissions?.includes('platform.subscriptions.extend_trial') ?? false
  const sections = [
    { to: BASE, label: 'Overview', end: true },
    { to: `${BASE}/subscriptions`, label: 'Subscriptions' },
    { to: `${BASE}/invoices`, label: 'Invoices' },
    { to: `${BASE}/payments`, label: 'Payments' },
    { to: `${BASE}/plans`, label: 'Plans & pricing' },
    ...(canExtendTrials ? [{ to: `${BASE}/trials`, label: 'Trial management' }] : []),
    { to: `${BASE}/reports`, label: 'Reports' },
  ]
  return <>
    <PlatformTitle title="Billing" description="Subscriptions, invoices and M-Pesa collections for every bookshop. Payments are verified with Safaricom and applied to invoices automatically; callbacks alone never credit an invoice."
      meta={<EnvironmentBadge environment={context.data?.environment} paybill={context.data?.paybill ?? null} pending={context.isPending} />}
      actions={<button className={secondaryButton} onClick={() => { void client.invalidateQueries({ queryKey: ['platform-billing'] }); void client.invalidateQueries({ queryKey: ['platform-bills'] }) }}><RefreshCw size={15} /> Refresh</button>} />
    <SubNav label="Billing sections" items={sections} />
    <Routes>
      <Route index element={<BillingOverview />} />
      <Route path="subscriptions" element={<SubscriptionsSection />} />
      <Route path="invoices" element={<InvoicesSection />} />
      <Route path="payments" element={<PaymentsSection canManage={canManage} />} />
      <Route path="plans" element={<PlansSection canManage={canManage} environment={context.data?.environment} paybill={context.data?.paybill ?? null} />} />
      <Route path="trials" element={canExtendTrials ? <TrialExtensionsPanel /> : <Navigate replace to={BASE} />} />
      <Route path="reports" element={<ReportsSection />} />
      <Route path="*" element={<Navigate replace to={BASE} />} />
    </Routes>
  </>
}

function EnvironmentBadge({ environment, paybill, pending }: { environment?: string; paybill: string | null; pending: boolean }) {
  if (pending) return <Pill tone="neutral">Checking payment mode</Pill>
  if (environment === 'production') return <Pill tone="positive">Live payments on Paybill {paybill ?? '152451'}</Pill>
  if (environment === 'sandbox') return <Pill tone="warning">Test mode on sandbox shortcode {paybill ?? 'not configured'}</Pill>
  return <Pill tone="danger">Payment environment unavailable</Pill>
}

/** The bills summary drives every revenue figure; one shared query key keeps them consistent. */
function useRevenue() {
  return useQuery({ queryKey: ['platform-bills', 'summary'], queryFn: () => billsApi.list({ page: 1 }), refetchInterval: 30000 })
}

function BillingOverview() {
  const revenue = useRevenue()
  const overview = useQuery({ queryKey: ['platform', 'overview'], queryFn: platformApi.overview })
  const expiring = useQuery({ queryKey: ['platform-billing', 'subscriptions', 1, 'upcoming'], queryFn: () => billingApi.subscriptions(1, 'upcoming') })
  const summary = revenue.data?.summary
  if (revenue.isPending) return <LoadingState label="Loading billing" />
  if (revenue.error) return <ErrorState message={errorMessage(revenue.error)} onRetry={() => void revenue.refetch()} />
  const attention = summary ? [
    { label: 'Unmatched payments to review', show: summary.unmatched_count > 0, value: String(summary.unmatched_count), detail: kes(summary.unmatched_amount), to: `${BASE}/payments` },
    { label: 'Payments waiting for Safaricom', show: summary.pending_count > 0, value: String(summary.pending_count), detail: kes(summary.pending_amount), to: `${BASE}/payments` },
    { label: 'Subscriptions ending within 7 days', show: (expiring.data?.total ?? 0) > 0, value: String(expiring.data?.total ?? 0), detail: '', to: `${BASE}/subscriptions?state=upcoming` },
    { label: 'Excess money held for review', show: summary.excess_amount > 0, value: kes(summary.excess_amount), detail: '', to: `${BASE}/payments?view=exceptions` },
  ].filter(item => item.show) : []

  return <div className="grid gap-6">
    <BillingHealthBanner />
    {summary && <MetricStrip label="Billing summary">
      <Metric label="Collected" value={kes(summary.verified_collections)} hint={`${summary.verified_count} verified payment(s)`} />
      <Metric label="Collected today" value={kes(summary.today_collections)} hint={`${summary.today_count} payment(s) today (EAT)`} />
      <Metric label="Outstanding balance" value={kes(summary.outstanding_balance)} hint={`${summary.outstanding_invoices} unpaid invoice(s)`} tone="owed" />
      <Metric label="Awaiting review" value={summary.unmatched_count + summary.pending_count} hint="Unmatched or pending payments" tone={summary.unmatched_count ? 'alert' : undefined} />
    </MetricStrip>}
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <Panel title="Collected vs outstanding" description="Verified money received compared with what invoices still owe.">
        {summary && <SplitBar collected={summary.verified_collections} outstanding={summary.outstanding_balance} />}
        <div className="mt-5 flex flex-wrap gap-2 border-t border-[var(--pf-line)] pt-4">
          <Link className={secondaryButton} to={`${BASE}/invoices?status=pending`}>Unpaid invoices</Link>
          <Link className={secondaryButton} to={`${BASE}/payments`}>Review payments</Link>
        </div>
      </Panel>
      <Panel title="Needs attention" flush>
        {attention.length === 0 ? <p className="flex items-center gap-2 px-5 py-6 text-sm text-[var(--pf-muted)]"><CheckCircle2 size={18} className="text-emerald-600" /> Every payment is applied and no subscription is about to end.</p>
          : <ul className="m-0 list-none divide-y divide-[var(--pf-line)] p-0">{attention.map(item => <li key={item.label}>
            <Link to={item.to} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-slate-50">
              <AlertTriangle size={16} className="shrink-0 text-amber-600" aria-hidden="true" />
              <span className="flex-1">{item.label}{item.detail && <small className="block text-xs text-[var(--pf-muted)]">{item.detail}</small>}</span>
              <span className="pf-num font-semibold">{item.value}</span>
              <ChevronRight size={16} className="text-slate-400" aria-hidden="true" />
            </Link></li>)}</ul>}
      </Panel>
    </div>
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Subscriptions by status" actions={<Link className="text-sm font-semibold text-[var(--pf-brand)] hover:underline" to={`${BASE}/subscriptions`}>All subscriptions</Link>}>
        {overview.isPending ? <LoadingState /> : overview.error ? <ErrorState message={errorMessage(overview.error)} onRetry={() => void overview.refetch()} />
          : <BarList label="Subscriptions by status" rows={Object.entries(overview.data.subscriptions).map(([status, total]) => ({ key: status, label: humanize(status), value: total }))} />}
      </Panel>
      <Panel title="Latest payments" flush actions={<Link className="text-sm font-semibold text-[var(--pf-brand)] hover:underline" to={`${BASE}/payments`}>All payments</Link>}>
        {revenue.data.data.length === 0 ? <EmptyState icon={<ReceiptText size={22} />} title="No payments yet" body="M-Pesa payments appear here as soon as Safaricom notifies the platform." />
          : <ul className="m-0 list-none divide-y divide-[var(--pf-line)] p-0">{revenue.data.data.slice(0, 6).map(bill => <li key={bill.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
            <span className="min-w-0"><strong className="block truncate font-semibold">{bill.bookshop_name ?? 'Not matched yet'}</strong><small className="text-xs text-[var(--pf-muted)]">{bill.mpesa_receipt_number ?? 'Awaiting code'}, {formatDate(bill.transaction_date, true)}</small></span>
            <span className="flex shrink-0 flex-col items-end gap-1"><span className="pf-num font-semibold">{kes(bill.amount)}</span><BillStatusPill status={bill.status} /></span>
          </li>)}</ul>}
      </Panel>
    </div>
  </div>
}

function SubscriptionsSection() {
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const state = params.get('state') ?? ''
  const rows = useQuery({ queryKey: ['platform-billing', 'subscriptions', page, state], queryFn: () => billingApi.subscriptions(page, state), placeholderData: keepPreviousData })
  return <Panel title="Subscriptions" description="Every bookshop's plan, status and when its current access ends." flush>
    <Toolbar>
      <SelectField label="Show" value={state} onChange={value => { setParams(value ? { state: value } : {}, { replace: true }); setPage(1) }}>
        <option value="">All subscriptions</option><option value="expired">Expired</option><option value="upcoming">Ending within seven days</option>
      </SelectField>
    </Toolbar>
    {rows.isPending ? <LoadingState /> : rows.isError ? <ErrorState message={errorMessage(rows.error)} onRetry={() => void rows.refetch()} />
      : !rows.data.data.length ? <EmptyState icon={<Tags size={22} />} title="No matching subscriptions" body="Choose another filter to see more bookshops." />
      : <table className="w-full text-sm">
        <thead className="border-b border-[var(--pf-line)] bg-slate-50/70"><tr><th className={thClass}>Bookshop</th><th className={`${thClass} hidden sm:table-cell`}>Plan</th><th className={thClass}>Status</th><th className={`${thClass} text-right`}>Days left</th><th className={`${thClass} hidden md:table-cell`}>Access ends</th></tr></thead>
        <tbody className="divide-y divide-[var(--pf-line)]">{rows.data.data.map(s => {
          const ends = s.status === 'trialing' ? s.trial_ends_at : s.current_period_ends_at
          return <tr key={s.id}>
            <td className={tdClass}><Link className="font-semibold hover:text-[var(--pf-brand)]" to={`/platform/bookshops/${s.bookshop_id}`}>{s.bookshop_name}</Link></td>
            <td className={`${tdClass} hidden text-[var(--pf-muted)] sm:table-cell`}>{s.plan?.name ?? 'No plan'}</td>
            <td className={tdClass}><StatePill status={s.status} /></td>
            <td className={`${tdClass} pf-num text-right font-semibold ${s.days_remaining !== null && s.days_remaining !== undefined && s.days_remaining <= 7 ? 'text-amber-700' : ''}`}>{s.days_remaining ?? '—'}</td>
            <td className={`${tdClass} hidden text-[var(--pf-muted)] md:table-cell`}>{ends ? formatDate(ends) : 'No expiry'}</td>
          </tr>
        })}</tbody>
      </table>}
    {rows.data && rows.data.total > 0 && <PageControls page={rows.data} onPage={setPage} />}
  </Panel>
}

function InvoicesSection() {
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(1)
  const [environment, setEnvironment] = useState('')
  const status = params.get('status') ?? ''
  const revenue = useRevenue()
  const invoices = useQuery({ queryKey: ['platform-billing', 'invoices', page, environment, status], queryFn: () => billingApi.invoices(page, environment, status), placeholderData: keepPreviousData })
  const summary = revenue.data?.summary
  return <div className="grid gap-6">
    {summary && <MetricStrip label="Invoice balances">
      <Metric label="Outstanding balance" value={kes(summary.outstanding_balance)} hint="Still owed on open invoices" tone="owed" />
      <Metric label="Unpaid invoices" value={summary.outstanding_invoices} hint="Pending or partly paid" />
      <Metric label="Collected" value={kes(summary.verified_collections)} hint="Verified M-Pesa payments" />
    </MetricStrip>}
    <Panel title="Invoices" description="Each invoice has its own six-digit M-Pesa account number. Issued invoices keep their quoted amount and period." flush>
      <Toolbar>
        <SelectField label="Status" value={status} onChange={value => { setParams(value ? { status: value } : {}, { replace: true }); setPage(1) }}>
          <option value="">All invoices</option><option value="pending">Unpaid</option><option value="partially_paid">Partly paid</option><option value="paid">Paid</option>
        </SelectField>
        <EnvironmentFilter value={environment} onChange={value => { setEnvironment(value); setPage(1) }} />
      </Toolbar>
      {invoices.isPending ? <LoadingState /> : invoices.isError ? <ErrorState message={errorMessage(invoices.error)} onRetry={() => void invoices.refetch()} />
        : !invoices.data.data.length ? <EmptyState icon={<ReceiptText size={22} />} title="No matching invoices" body="Invoices appear when a bookshop owner chooses a plan in Billing." />
        : <table className="w-full text-sm">
          <thead className="border-b border-[var(--pf-line)] bg-slate-50/70"><tr>
            <th className={thClass}>Invoice</th><th className={`${thClass} hidden md:table-cell`}>Bookshop</th><th className={thClass}>Status</th>
            <th className={`${thClass} text-right`}>Amount</th><th className={`${thClass} hidden text-right sm:table-cell`}>Paid</th><th className={`${thClass} text-right`}>Balance</th><th className={`${thClass} hidden lg:table-cell`}>Period</th>
          </tr></thead>
          <tbody className="divide-y divide-[var(--pf-line)]">{invoices.data.data.map(invoice => {
            const balance = Math.max(0, Number(invoice.amount) - Number(invoice.paid))
            return <tr key={invoice.id}>
              <td className={tdClass}><strong className="font-semibold">#{invoice.id}</strong><small className="block text-xs text-[var(--pf-muted)]">Account {invoice.account_number}{invoice.environment !== 'production' ? `, ${invoice.environment}` : ''}</small></td>
              <td className={`${tdClass} hidden md:table-cell`}><Link className="hover:text-[var(--pf-brand)]" to={`/platform/bookshops/${invoice.bookshop_id}`}>Bookshop {invoice.bookshop_id}</Link></td>
              <td className={tdClass}><StatePill status={invoice.status} />{invoice.confirming && <small className="mt-1 block text-xs text-[var(--pf-muted)]">Confirming a payment</small>}</td>
              <td className={`${tdClass} pf-num text-right`}>{kes(invoice.amount)}</td>
              <td className={`${tdClass} pf-num hidden text-right sm:table-cell`}>{kes(invoice.paid)}</td>
              <td className={`${tdClass} pf-num text-right font-semibold ${balance > 0 ? 'text-amber-700' : 'text-[var(--pf-muted)]'}`}>{kes(balance)}</td>
              <td className={`${tdClass} hidden text-[var(--pf-muted)] lg:table-cell`}>{formatDate(invoice.period_starts_at)} to {formatDate(invoice.period_ends_at)}</td>
            </tr>
          })}</tbody>
        </table>}
      {invoices.data && invoices.data.total > 0 && <PageControls page={invoices.data} onPage={setPage} />}
    </Panel>
  </div>
}

function EnvironmentFilter({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <SelectField label="Environment" value={value} onChange={onChange}><option value="">All environments</option><option value="production">Production</option><option value="sandbox">Sandbox</option><option value="legacy">Legacy</option></SelectField>
}

type PaymentsView = 'mpesa' | 'stk' | 'ledger' | 'exceptions'
function PaymentsSection({ canManage }: { canManage: boolean }) {
  const [params, setParams] = useSearchParams()
  const view = (['mpesa', 'stk', 'ledger', 'exceptions'] as const).find(v => v === params.get('view')) ?? 'mpesa'
  return <div className="grid gap-6">
    <Segmented<PaymentsView> label="Payment records" value={view} onChange={next => setParams(next === 'mpesa' ? {} : { view: next }, { replace: true })}
      options={[{ value: 'mpesa', label: 'M-Pesa payments' }, { value: 'stk', label: 'STK requests' }, { value: 'ledger', label: 'Payment ledger' }, { value: 'exceptions', label: 'Excess & legacy review' }]} />
    {view === 'mpesa' && <PaymentsReconciliation />}
    {view === 'stk' && <StkRequests canManage={canManage} />}
    {view === 'ledger' && <PaymentLedger />}
    {view === 'exceptions' && <Exceptions canManage={canManage} />}
  </div>
}

function StkRequests({ canManage }: { canManage: boolean }) {
  const [page, setPage] = useState(1)
  const [environment, setEnvironment] = useState('')
  const attempts = useQuery({ queryKey: ['platform-billing', 'attempts', page, environment], queryFn: () => billingApi.attempts(page, environment), placeholderData: keepPreviousData })
  return <Panel title="STK requests" description="Payment prompts sent to customers' phones and what Safaricom reported back." flush>
    <Toolbar><EnvironmentFilter value={environment} onChange={value => { setEnvironment(value); setPage(1) }} /></Toolbar>
    {attempts.isPending ? <LoadingState /> : attempts.isError ? <ErrorState message={errorMessage(attempts.error)} onRetry={() => void attempts.refetch()} />
      : !attempts.data.data.length ? <EmptyState icon={<ReceiptText size={22} />} title="No STK requests" body="Requests appear when a bookshop owner pays an invoice from their phone." />
      : <ul className="m-0 list-none divide-y divide-[var(--pf-line)] p-0">{attempts.data.data.map(a => <li key={a.id} className="px-5 py-4 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span><strong className="font-semibold">Request #{a.id}</strong><small className="block text-xs text-[var(--pf-muted)]">Bookshop {a.bookshop_id}, account {a.account_number}, {a.environment}</small></span>
          <span className="flex items-center gap-3"><span className="pf-num font-semibold">{kes(a.amount)}</span><StatePill status={a.status} label={paymentStatus(a)} /></span>
        </div>
        <p className="mt-2 break-all text-xs text-[var(--pf-muted)]">Checkout {a.checkout_request_id ?? 'unknown'}, merchant request {a.merchant_request_id ?? 'unknown'}</p>
        {canManage && a.status === 'unknown' && <UnknownResolution id={a.id} />}
      </li>)}</ul>}
    {attempts.data && attempts.data.total > 0 && <PageControls page={attempts.data} onPage={setPage} />}
  </Panel>
}

function PaymentLedger() {
  const [page, setPage] = useState(1)
  const [environment, setEnvironment] = useState('')
  const rows = useQuery({ queryKey: ['platform-billing', 'payments', page, environment], queryFn: () => billingApi.payments(page, environment), placeholderData: keepPreviousData })
  return <Panel title="Payment ledger" description="Payments applied to invoices, with the evidence each one was verified against." flush>
    <Toolbar><EnvironmentFilter value={environment} onChange={value => { setEnvironment(value); setPage(1) }} /></Toolbar>
    {rows.isPending ? <LoadingState /> : rows.isError ? <ErrorState message={errorMessage(rows.error)} onRetry={() => void rows.refetch()} />
      : !rows.data.data.length ? <EmptyState icon={<ReceiptText size={22} />} title="No matching payments" body="Applied payments appear here once they are verified." />
      : <table className="w-full text-sm">
        <thead className="border-b border-[var(--pf-line)] bg-slate-50/70"><tr><th className={thClass}>Receipt</th><th className={`${thClass} hidden md:table-cell`}>Account</th><th className={`${thClass} text-right`}>Amount</th><th className={thClass}>Status</th><th className={`${thClass} hidden lg:table-cell`}>Evidence</th></tr></thead>
        <tbody className="divide-y divide-[var(--pf-line)]">{rows.data.data.map(p => <tr key={p.id}>
          <td className={tdClass}><strong className="font-semibold">{p.mpesa_receipt ?? 'Unverified'}</strong><small className="block text-xs text-[var(--pf-muted)]">Bookshop {p.bookshop_id}, {p.environment}</small></td>
          <td className={`${tdClass} pf-num hidden md:table-cell`}>{p.account_number}</td>
          <td className={`${tdClass} pf-num text-right font-semibold`}>{kes(p.amount)}</td>
          <td className={tdClass}><StatePill status={p.status} label={paymentStatus(p)} /></td>
          <td className={`${tdClass} hidden text-xs text-[var(--pf-muted)] lg:table-cell`}>Merchant statement: {p.statement_reference ?? 'none'}{p.verified_by ? `, verifier ${p.verified_by}` : ''}</td>
        </tr>)}</tbody>
      </table>}
    {rows.data && rows.data.total > 0 && <PageControls page={rows.data} onPage={setPage} />}
  </Panel>
}

function Exceptions({ canManage }: { canManage: boolean }) {
  const [page, setPage] = useState(1)
  const [environment, setEnvironment] = useState('')
  const items = useQuery({ queryKey: ['platform-billing', 'reconciliation', page, environment], queryFn: () => billingApi.reconciliation(page, environment), placeholderData: keepPreviousData })
  return <Panel title="Excess & legacy review" description="Overpayments and legacy records held for a person to resolve. No extra access is ever granted for excess money." flush>
    <Toolbar><EnvironmentFilter value={environment} onChange={value => { setEnvironment(value); setPage(1) }} /></Toolbar>
    {items.isPending ? <LoadingState /> : items.isError ? <ErrorState message={errorMessage(items.error)} onRetry={() => void items.refetch()} />
      : !items.data.data.length ? <EmptyState icon={<CheckCircle2 size={22} />} title="No reconciliation items" body="Nothing is waiting for review." />
      : <ul className="m-0 list-none divide-y divide-[var(--pf-line)] p-0">{items.data.data.map(i => <li key={i.id} className="px-5 py-4 text-sm">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <span><strong className="font-semibold">{humanize(i.source)}</strong><small className="block text-xs text-[var(--pf-muted)]">{i.provider_transaction_id}, account {i.account_number}, {i.environment}</small></span>
          <span className="flex items-center gap-3"><span className="pf-num font-semibold">{kes(i.amount)}</span><StatePill status={i.status} /></span>
        </div>
        {i.source === 'overpayment' && <p className="mt-2 text-[var(--pf-muted)]">Excess held for review. Handle any refund through the merchant’s approved process; no extra access is granted.</p>}
        {canManage && i.source === 'overpayment' && i.status === 'requires_review' && <OverpaymentResolution id={i.id} />}
      </li>)}</ul>}
    {items.data && items.data.total > 0 && <PageControls page={items.data} onPage={setPage} />}
  </Panel>
}

function PlansSection({ canManage, environment, paybill }: { canManage: boolean; environment?: string; paybill: string | null }) {
  const [draft, setDraft] = useState<PlanDraft | undefined>()
  const plans = useQuery({ queryKey: ['platform-billing', 'plans'], queryFn: platformApi.plans })
  return <div className="grid gap-6">
    {environment === 'sandbox' && <Panel title="Test the billing journey" description={`Test mode on sandbox shortcode ${paybill ?? 'not configured'}. Sandbox payments never activate or extend subscription access.`}>
      <ol className="m-0 grid list-decimal gap-2 pl-5 text-sm">
        <li>Create a test plan below. The button prepares a KES 1 monthly draft; review it and select <strong>Add plan</strong> to save.</li>
        <li>Sign in with a test bookshop’s owner account and open Billing. Select the plan to create an invoice with its six-digit account number.</li>
        <li>Send an STK request using the Safaricom sandbox test phone and shortcode shown on the invoice.</li>
        <li>Open <Link className="font-semibold text-[var(--pf-brand)] hover:underline" to={`${BASE}/payments`}>Payments</Link> to watch it move from pending to reconciled once Safaricom confirms it.</li>
      </ol>
      <p className="mt-3 text-sm text-[var(--pf-muted)]">Plans are shared across payment environments: deactivate test plans before production testing.</p>
      {canManage && <div className="mt-4 flex flex-wrap gap-2">
        <button className={secondaryButton} onClick={() => setDraft({ code: `sandbox-monthly-${Date.now().toString(36)}`, name: 'Sandbox test monthly', price: '1', interval: 'monthly' })}><FlaskConical size={15} /> Prepare sandbox test plan</button>
        <Link className={secondaryButton} to="/platform/bookshops">Open test bookshops</Link>
      </div>}
    </Panel>}
    <Panel title="Plans" description="Changes apply to new invoices only. Issued invoices keep their quoted amount and period." flush>
      {plans.isPending ? <LoadingState /> : plans.isError ? <ErrorState message={errorMessage(plans.error)} onRetry={() => void plans.refetch()} />
        : !plans.data.length ? <EmptyState icon={<Tags size={22} />} title="No plans yet" body="Add the first paid plan below." />
        : <ul className="m-0 list-none divide-y divide-[var(--pf-line)] p-0">{plans.data.map(p => <li key={p.id} className="px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <span><strong className="font-semibold">{p.name}</strong>{p.description && <small className="block text-sm text-[var(--pf-muted)]">{p.description}</small>}</span>
            <span className="flex items-center gap-3"><span className="pf-num font-semibold">{p.currency} {p.price} / {p.billing_interval}</span><Pill tone={p.is_active ? 'positive' : 'neutral'}>{p.is_active ? 'Available' : 'Inactive'}</Pill></span>
          </div>
          {p.trial_days ? <p className="mt-1 text-xs text-[var(--pf-muted)]">{p.trial_days}-day trial for new bookshops</p> : null}
          {canManage && Number(p.price) > 0 && <PlanEditor key={`${p.id}-${p.price}-${p.is_active}-${p.billing_interval}`} plan={p} />}
        </li>)}</ul>}
    </Panel>
    {canManage && <PlanForm key={draft?.code ?? 'new-plan'} draft={draft} />}
  </div>
}

function PlanForm({ draft }: { draft?: PlanDraft }) {
  const client = useQueryClient()
  const [code, setCode] = useState(draft?.code ?? '')
  const [name, setName] = useState(draft?.name ?? '')
  const [price, setPrice] = useState(draft?.price ?? '')
  const [interval, setInterval] = useState(draft?.interval ?? 'monthly')
  const create = useMutation({ mutationFn: () => billingApi.plan({ code, name, price: Number(price), billing_interval: interval }), onSuccess: () => { setCode(''); setName(''); setPrice(''); void client.invalidateQueries({ queryKey: ['platform-billing', 'plans'] }) } })
  return <Panel title="Add a paid plan" description="Creates a plan bookshop owners can choose. It does not create an invoice, charge M-Pesa or activate any bookshop. The price is the full amount for the period, in KES.">
    <p className="mb-4 text-sm text-[var(--pf-muted)]">Example: Quarterly at KES 3,000 is a three-month plan billed once at KES 3,000. Create separate plans for monthly, quarterly and annual pricing. Owners see the plan name; the code is internal.</p>
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); create.mutate() }}>
      <label className="text-sm font-medium">Unique code<input className={inputClass} required pattern="[a-z0-9-]{1,40}" value={code} onChange={e => setCode(e.target.value)} /></label>
      <label className="text-sm font-medium">Name<input className={inputClass} required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
      <label className="text-sm font-medium">Total price for this period (whole KES)<input className={inputClass} required type="number" min="1" max="999999999" step="1" value={price} onChange={e => setPrice(e.target.value)} /></label>
      <label className="text-sm font-medium">Period<select className={inputClass} value={interval} onChange={e => setInterval(e.target.value)}><option>monthly</option><option>quarterly</option><option>annual</option></select></label>
      <div className="flex items-center gap-3 sm:col-span-2"><button className={primaryButton} disabled={create.isPending}>Add plan</button>
        {create.isSuccess && <p role="status" className="text-sm text-emerald-700">Plan created. Sign in as a bookshop owner and open Billing to select it and generate an invoice. No payment has been initiated.</p>}
        {create.isError && <p role="alert" className="text-sm text-rose-700">{errorMessage(create.error)}</p>}</div>
    </form>
  </Panel>
}

function PlanEditor({ plan }: { plan: Plan }) {
  const [name, setName] = useState(plan.name)
  const [price, setPrice] = useState(plan.price)
  const [interval, setInterval] = useState(plan.billing_interval)
  const [active, setActive] = useState(plan.is_active ?? true)
  const client = useQueryClient()
  const save = useMutation({ mutationFn: () => billingApi.updatePlan(plan.id, { name, price: Number(price), billing_interval: interval, is_active: active }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['platform-billing', 'plans'] }) } })
  return <form className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-end" onSubmit={e => { e.preventDefault(); save.mutate() }}>
    <label className="text-xs font-medium text-[var(--pf-muted)]">Plan name<input required maxLength={100} className={inputClass} value={name} onChange={e => setName(e.target.value)} /></label>
    <label className="text-xs font-medium text-[var(--pf-muted)]">New invoice price (whole KES)<input required type="number" min="1" step="1" max="999999999" className={inputClass} value={price} onChange={e => setPrice(e.target.value)} /></label>
    <label className="text-xs font-medium text-[var(--pf-muted)]">Billing interval<select className={inputClass} value={interval} onChange={e => setInterval(e.target.value)}><option>monthly</option><option>quarterly</option><option>annual</option></select></label>
    <button className={primaryButton} disabled={save.isPending}>Save plan</button>
    <label className="flex items-center gap-2 text-sm sm:col-span-2 lg:col-span-4"><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Available for new invoices</label>
    {save.isError && <p role="alert" className="text-sm text-rose-700 sm:col-span-2 lg:col-span-4">{errorMessage(save.error)}</p>}{save.isSuccess && <p role="status" className="text-sm text-emerald-700 sm:col-span-2 lg:col-span-4">Saved.</p>}
  </form>
}

function ReportsSection() {
  const revenue = useRevenue()
  const overview = useQuery({ queryKey: ['platform', 'overview'], queryFn: platformApi.overview })
  const statuses = [['pending', 'Unpaid'], ['partially_paid', 'Partly paid'], ['paid', 'Paid']] as const
  const counts = useQuery({ queryKey: ['platform-billing', 'invoice-counts'], queryFn: async () => Promise.all(statuses.map(async ([status, label]) => ({ key: status, label, value: (await billingApi.invoices(1, '', status)).total }))) })
  const plans = useQuery({ queryKey: ['platform-billing', 'plans'], queryFn: platformApi.plans })
  const summary = revenue.data?.summary
  const subscriptionTotal = overview.data ? Object.values(overview.data.subscriptions).reduce((a, b) => a + b, 0) : 0
  const count = (status: string) => overview.data?.subscriptions[status] ?? 0
  const paying = count('active') + count('past_due') + count('grace_period')
  const conversionBase = paying + count('trialing') + count('expired')
  return <div className="grid gap-6">
    <MetricStrip label="Subscription performance">
      <Metric label="Subscriptions" value={overview.data ? subscriptionTotal : '—'} hint="All bookshops with a subscription" />
      <Metric label="Paying" value={overview.data ? paying : '—'} hint="Active, past due or in grace" />
      <Metric label="On trial" value={overview.data?.subscriptions.trialing ?? '—'} hint="Not yet paying" />
      <Metric label="Paying share" value={conversionBase > 0 ? `${Math.round((paying / conversionBase) * 100)}%` : '—'} hint="Paying, out of paying, trialing and expired" />
    </MetricStrip>
    <div className="grid gap-6 lg:grid-cols-2">
      <ReportPanel title="Collections" description="Money received through M-Pesa, by where it stands." state={revenue}>
        {summary && <BarList label="Collections" format={kes} rows={[
          { key: 'verified', label: 'Verified', value: summary.verified_collections },
          { key: 'pending', label: 'Pending', value: summary.pending_amount },
          { key: 'unmatched', label: 'Unmatched', value: summary.unmatched_amount },
          { key: 'excess', label: 'Excess held', value: summary.excess_amount },
        ]} />}
      </ReportPanel>
      <ReportPanel title="Invoices by status" description="Number of invoices in each state, all environments." state={counts}>
        {counts.data && <BarList label="Invoices by status" rows={counts.data} />}
      </ReportPanel>
      <ReportPanel title="Subscriptions by status" description="Where every bookshop's subscription stands today." state={overview}>
        {overview.data && <BarList label="Subscriptions by status" rows={Object.entries(overview.data.subscriptions).map(([status, total]) => ({ key: status, label: humanize(status), value: total }))} />}
      </ReportPanel>
      <ReportPanel title="Revenue position" description="Verified collections compared with balances still owed." state={revenue}>
        {summary && <SplitBar collected={summary.verified_collections} outstanding={summary.outstanding_balance} />}
        {plans.data && <p className="mt-4 text-sm text-[var(--pf-muted)]">{plans.data.filter(p => p.is_active && Number(p.price) > 0).length} paid plan(s) currently available to bookshops.</p>}
      </ReportPanel>
    </div>
  </div>
}

function ReportPanel({ title, description, state, children }: { title: string; description: string; state: { isPending: boolean; error: unknown; refetch: () => unknown }; children: ReactNode }) {
  return <Panel title={title} description={description}>
    {state.isPending ? <LoadingState /> : state.error ? <ErrorState message={errorMessage(state.error)} onRetry={() => void state.refetch()} /> : children}
  </Panel>
}

function UnknownResolution({ id }: { id: number }) {
  const [reference, setReference] = useState('')
  const [checked, setChecked] = useState(false)
  const client = useQueryClient()
  const resolve = useMutation({ mutationFn: () => billingApi.resolveUnknown(id, { statement_reference: reference, no_payment_verified: checked }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['platform-billing'] }) } })
  return <form className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-4 text-sm" onSubmit={e => { e.preventDefault(); resolve.mutate() }}><p>If the customer did pay, Safaricom's record will appear under M-Pesa payments; record a missing one from there.</p>
    <label className="font-medium">Statement reference<input className={inputClass} required value={reference} onChange={e => setReference(e.target.value)} /></label>
    <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" required checked={checked} onChange={e => setChecked(e.target.checked)} /> I checked the merchant statement and confirmed no payment was received for this request.</label>
    <div><button className={secondaryButton} disabled={!checked || resolve.isPending}>Release unknown request for retry</button></div>{resolve.isError && <p role="alert" className="text-rose-700">{errorMessage(resolve.error)}</p>}
  </form>
}

function OverpaymentResolution({ id }: { id: number }) {
  const [reference, setReference] = useState('')
  const [verified, setVerified] = useState(false)
  const client = useQueryClient()
  const resolve = useMutation({ mutationFn: () => billingApi.resolveOverpayment(id, { refund_reference: reference, refund_verified: verified }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['platform-billing'] }) } })
  return <form className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-4 text-sm" onSubmit={e => { e.preventDefault(); resolve.mutate() }}>
    <label className="font-medium">External refund reference<input className={inputClass} required maxLength={255} value={reference} onChange={e => setReference(e.target.value)} /></label>
    <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" required checked={verified} onChange={e => setVerified(e.target.checked)} /> I verified that the merchant completed the excess refund outside this application.</label>
    <div><button className={secondaryButton} disabled={!verified || resolve.isPending}>Record completed refund</button></div>{resolve.isError && <p role="alert" className="text-rose-700">{errorMessage(resolve.error)}</p>}
  </form>
}
