import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { billingApi, type Plan, paymentStatus } from '../../lib/billing-api'
import { Link } from 'react-router-dom'
import { platformApi } from '../../lib/tenancy-api'
import { useAuth } from '../../features/auth/auth-provider'
import { errorMessage } from '../../lib/api'
import { Card, ErrorState, LoadingState, inputClass, primaryButton, secondaryButton } from '../../components/ui-kit'
import { InvoiceTable, Pager } from '../billing/page'

type PlanDraft = { code: string; name: string; price: string; interval: string }

export default function PlatformBillingView() {
  const { user } = useAuth()
  const client = useQueryClient()
  const context = useQuery({ queryKey: ['platform-billing', 'context'], queryFn: billingApi.context })
  const canManage = user?.permissions?.includes('platform.settings.manage') ?? false
  const [tab, setTab] = useState<'invoices' | 'attempts' | 'reconciliation' | 'subscriptions' | 'payments' | 'plans'>('invoices')
  const [draft, setDraft] = useState<PlanDraft | undefined>()
  const [page, setPage] = useState(1)
  const [environment, setEnvironment] = useState('')
  const invoices = useQuery({ queryKey: ['platform-billing', 'invoices', page, environment], queryFn: () => billingApi.invoices(page, environment), enabled: tab === 'invoices' })
  const attempts = useQuery({ queryKey: ['platform-billing', 'attempts', page, environment], queryFn: () => billingApi.attempts(page, environment), enabled: tab === 'attempts' })
  const items = useQuery({ queryKey: ['platform-billing', 'reconciliation', page, environment], queryFn: () => billingApi.reconciliation(page, environment), enabled: tab === 'reconciliation' })
  const active = tab === 'invoices' ? invoices : tab === 'attempts' ? attempts : items
  return <div className="grid gap-6"><h1 className="text-2xl font-bold">Subscription billing</h1>
    <p>{context.isPending ? 'Loading payment environment.' : context.data?.environment === 'sandbox' ? `TEST MODE — Sandbox shortcode ${context.data.paybill ?? 'not configured'}.` : context.data?.environment === 'production' ? 'Production Paybill 152451.' : 'Payment environment unavailable.'} Payments are verified with Safaricom and applied to invoices automatically. Callbacks alone never credit an invoice. Sandbox payments never grant subscription access. <Link className="font-semibold text-blue-700 underline" to="/platform/bills">Open Bills</Link> to see every M-Pesa payment and handle exceptions.</p>
    {context.data?.environment === 'sandbox' && <Card title="Test the billing journey">
      <p className="mb-3 font-semibold">TEST MODE · Sandbox shortcode {context.data.paybill ?? 'not configured'}</p>
      <ol className="list-decimal space-y-2 pl-5">
        <li>Create a test plan in <strong>Plans & pricing</strong>. The button below prepares a KES 1 monthly draft; review it and click <strong>Add plan</strong> to save.</li>
        <li>Sign in with an existing test bookshop’s <strong>owner account</strong>, then open <code>/billing</code>. Select the plan and create an invoice to receive its six-digit account number.</li>
        <li>Send an STK request using the Safaricom sandbox test phone and shortcode shown on the invoice. No real-money payment is needed for this sandbox test.</li>
        <li>Open <strong>Bills</strong> to watch the payment move from pending to reconciled once Safaricom confirms it. No manual approval is needed.</li>
      </ol>
      <p className="my-3">Sandbox payments never activate or extend subscription access. Plans are shared across payment environments: deactivate test plans before authorizing production testing.</p>
      {canManage && <button className={secondaryButton} onClick={() => {
        setDraft({ code: `sandbox-monthly-${Date.now().toString(36)}`, name: 'Sandbox test monthly', price: '1', interval: 'monthly' })
        setTab('plans'); setPage(1)
      }}>Prepare sandbox test plan</button>}
      <Link className="ml-3 text-blue-700 underline" to="/platform/bookshops">Open test bookshops</Link>
    </Card>}
    <div className="flex flex-wrap gap-3">{(['invoices', 'attempts', 'reconciliation', 'subscriptions', 'payments', 'plans'] as const).map(t => <button aria-pressed={tab === t} className={tab === t ? primaryButton : secondaryButton} key={t} onClick={() => { setTab(t); setPage(1) }}>{{ invoices: 'Invoices', attempts: 'STK requests', reconciliation: 'Excess & legacy review', subscriptions: 'Subscriptions', payments: 'Payment ledger', plans: 'Plans & pricing' }[t]}</button>)}
      <button className={secondaryButton} onClick={() => void client.invalidateQueries({ queryKey: ['platform-billing'] })}>Refresh</button></div>
    {tab !== 'subscriptions' && tab !== 'plans' && <label>Environment<select className={inputClass} value={environment} onChange={e => { setEnvironment(e.target.value); setPage(1) }}><option value="">All environments</option><option>production</option><option>sandbox</option><option>legacy</option></select></label>}
    {['invoices', 'attempts', 'reconciliation'].includes(tab) && <Card title="Billing records">{active.isPending ? <LoadingState /> : active.isError ? <ErrorState message={errorMessage(active.error)} onRetry={() => void active.refetch()} /> : <>
      {tab === 'invoices' && invoices.data && <InvoiceTable invoices={invoices.data.data} />}
      {tab === 'attempts' && attempts.data && <div className="grid gap-3">{attempts.data.data.map(a => <div key={a.id} className="rounded border p-3"><p>Request #{a.id} · Shop {a.bookshop_id} · Account {a.account_number} · KES {a.amount} · {paymentStatus(a)} · {a.environment}</p><p className="break-all">Checkout: {a.checkout_request_id ?? 'Unknown'} · Merchant request: {a.merchant_request_id ?? 'Unknown'}</p>{canManage && a.status === 'unknown' && <UnknownResolution id={a.id} />}</div>)}{!attempts.data.data.length && <p>No STK requests.</p>}</div>}
      {tab === 'reconciliation' && items.data && <div className="grid gap-3">{items.data.data.map(i => <div key={i.id} className="rounded border p-3"><p>{i.source} · {i.provider_transaction_id} · Account {i.account_number} · KES {i.amount} · {i.status} · {i.environment}</p>{canManage && i.source === 'overpayment' && i.status === 'requires_review' && <OverpaymentResolution id={i.id} />}{i.source === 'overpayment' && <p>Excess held for review. Handle any refund through the merchant’s approved process; no extra access is granted.</p>}</div>)}{!items.data.data.length && <p>No reconciliation items.</p>}</div>}
      {active.data && <Pager page={active.data} setPage={setPage} />}
    </>}</Card>}
    {tab === 'subscriptions' && <SubscriptionList />}
    {tab === 'payments' && <PaymentLedger environment={environment} />}
    {tab === 'plans' && <PlanManagement canManage={canManage} draft={draft} />}
    <Link className="text-blue-700 underline" to="/platform/audit">Open billing and platform audit history</Link>
  </div>
}

function PlanForm({ draft }: { draft?: PlanDraft }) {
  const client = useQueryClient()
  const [code, setCode] = useState(draft?.code ?? '')
  const [name, setName] = useState(draft?.name ?? '')
  const [price, setPrice] = useState(draft?.price ?? '')
  const [interval, setInterval] = useState(draft?.interval ?? 'monthly')
  const create = useMutation({ mutationFn: () => billingApi.plan({ code, name, price: Number(price), billing_interval: interval }), onSuccess: () => { setCode(''); setName(''); setPrice(''); void client.invalidateQueries({ queryKey: ['platform-billing', 'plans'] }) } })
  return <Card title="Add a paid subscription plan">
    <p className="mb-3">This creates a selectable subscription offer. It does not create an invoice, charge M-Pesa or activate any bookshop. The price is the full amount for the selected period, in KES.</p>
    <p className="mb-4 text-sm text-slate-600">Example: Quarterly at KES 3,000 creates a three-month offer billed once at KES 3,000. Create separate plans for monthly, quarterly and annual pricing. The unique code is an internal identifier; owners see the plan name.</p>
    <form className="grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); create.mutate() }}>
    <label>Unique code<input className={inputClass} required pattern="[a-z0-9-]{1,40}" value={code} onChange={e => setCode(e.target.value)} /></label>
    <label>Name<input className={inputClass} required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
    <label>Total price for this period (whole KES)<input className={inputClass} required type="number" min="1" max="999999999" step="1" value={price} onChange={e => setPrice(e.target.value)} /></label>
    <label>Period<select className={inputClass} value={interval} onChange={e => setInterval(e.target.value)}><option>monthly</option><option>quarterly</option><option>annual</option></select></label>
    <button className={primaryButton} disabled={create.isPending}>Add plan</button>{create.isSuccess && <p role="status">Plan created. Sign in as a bookshop owner and open /billing to select it and generate an invoice. No payment has been initiated.</p>}{create.isError && <p role="alert">{errorMessage(create.error)}</p>}
  </form></Card>
}

function UnknownResolution({ id }: { id: number }) {
  const [reference, setReference] = useState('')
  const [checked, setChecked] = useState(false)
  const client = useQueryClient()
  const resolve = useMutation({ mutationFn: () => billingApi.resolveUnknown(id, { statement_reference: reference, no_payment_verified: checked }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['platform-billing'] }) } })
  return <form className="mt-3 grid gap-2" onSubmit={e => { e.preventDefault(); resolve.mutate() }}><p>If the customer did pay, Safaricom's record will appear in Bills; record a missing one from Bills.</p>
    <label>Statement reference<input className={inputClass} required value={reference} onChange={e => setReference(e.target.value)} /></label>
    <label><input type="checkbox" required checked={checked} onChange={e => setChecked(e.target.checked)} /> I checked the merchant statement and confirmed no payment was received for this request.</label>
    <button className={secondaryButton} disabled={!checked || resolve.isPending}>Release unknown request for retry</button>{resolve.isError && <p role="alert">{errorMessage(resolve.error)}</p>}
  </form>
}

function OverpaymentResolution({ id }: { id: number }) {
  const [reference, setReference] = useState('')
  const [verified, setVerified] = useState(false)
  const client = useQueryClient()
  const resolve = useMutation({ mutationFn: () => billingApi.resolveOverpayment(id, { refund_reference: reference, refund_verified: verified }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['platform-billing'] }) } })
  return <form className="mt-3 grid gap-2" onSubmit={e => { e.preventDefault(); resolve.mutate() }}>
    <label>External refund reference<input className={inputClass} required maxLength={255} value={reference} onChange={e => setReference(e.target.value)} /></label>
    <label><input type="checkbox" required checked={verified} onChange={e => setVerified(e.target.checked)} /> I verified that the merchant completed the excess refund outside this application.</label>
    <button className={secondaryButton} disabled={!verified || resolve.isPending}>Record completed refund</button>{resolve.isError && <p role="alert">{errorMessage(resolve.error)}</p>}
  </form>
}

function SubscriptionList() {
  const [page, setPage] = useState(1)
  const [state, setState] = useState('')
  const rows = useQuery({ queryKey: ['platform-billing', 'subscriptions', page, state], queryFn: () => billingApi.subscriptions(page, state) })
  return <Card title="Subscriptions and upcoming expiries"><label>Show<select className={inputClass} value={state} onChange={e => { setState(e.target.value); setPage(1) }}><option value="">All subscriptions</option><option value="expired">Expired</option><option value="upcoming">Expiring within seven days</option></select></label>
    {rows.isPending ? <LoadingState /> : rows.isError ? <ErrorState message={errorMessage(rows.error)} onRetry={() => void rows.refetch()} /> : <>
      {rows.data.data.map(s => <p className="border-t py-3" key={s.id}>{s.bookshop_name} · Shop {s.bookshop_id} · {s.plan?.name ?? 'No plan'} · {s.status} · {s.days_remaining ?? '—'} days remaining · Expiry: {(s.status === 'trialing' ? s.trial_ends_at : s.current_period_ends_at)?.slice(0, 10) ?? 'No expiry'}</p>)}
      {!rows.data.data.length && <p>No matching subscriptions.</p>}<Pager page={rows.data} setPage={setPage} />
    </>}
  </Card>
}

function PaymentLedger({ environment }: { environment: string }) {
  const [page, setPage] = useState(1)
  const rows = useQuery({ queryKey: ['platform-billing', 'payments', page, environment], queryFn: () => billingApi.payments(page, environment) })
  return <Card title="Payment ledger and verification evidence">{rows.isPending ? <LoadingState /> : rows.isError ? <ErrorState message={errorMessage(rows.error)} onRetry={() => void rows.refetch()} /> : <>
    {rows.data.data.map(p => <div className="border-t py-3" key={p.id}><p>Shop {p.bookshop_id} · Account {p.account_number} · KES {p.amount} · {paymentStatus(p)} · {p.environment}</p><p>Receipt: {p.mpesa_receipt ?? 'Unverified'} · Merchant statement: {p.statement_reference ?? 'None'} · Verifier: {p.verified_by ?? 'None'}</p></div>)}
    {!rows.data.data.length && <p>No matching payments.</p>}<Pager page={rows.data} setPage={setPage} />
  </>}</Card>
}

function PlanManagement({ canManage, draft }: { canManage: boolean; draft?: PlanDraft }) {
  const plans = useQuery({ queryKey: ['platform-billing', 'plans'], queryFn: platformApi.plans })
  return <div className="grid gap-5"><Card title="Subscription plans and pricing">
    {plans.isPending ? <LoadingState /> : plans.isError ? <ErrorState message={errorMessage(plans.error)} onRetry={() => void plans.refetch()} /> : plans.data.map(p => <div className="border-t py-3" key={p.id}><p>{p.name} · KES {p.price} / {p.billing_interval} · {p.is_active ? 'Available' : 'Inactive'}</p>{canManage && Number(p.price) > 0 && <PlanEditor key={`${p.id}-${p.price}-${p.is_active}-${p.billing_interval}`} plan={p} />}</div>)}
    <p>Changes affect new invoices only. Issued invoices retain their quoted amount and period.</p>
  </Card>{canManage && <PlanForm key={draft?.code ?? 'new-plan'} draft={draft} />}</div>
}

function PlanEditor({ plan }: { plan: Plan }) {
  const [name, setName] = useState(plan.name)
  const [price, setPrice] = useState(plan.price)
  const [interval, setInterval] = useState(plan.billing_interval)
  const [active, setActive] = useState(plan.is_active ?? true)
  const client = useQueryClient()
  const save = useMutation({ mutationFn: () => billingApi.updatePlan(plan.id, { name, price: Number(price), billing_interval: interval, is_active: active }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['platform-billing', 'plans'] }) } })
  return <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); save.mutate() }}>
    <label>Plan name<input required maxLength={100} className={inputClass} value={name} onChange={e => setName(e.target.value)} /></label>
    <label>New invoice price (whole KES)<input required type="number" min="1" step="1" max="999999999" className={inputClass} value={price} onChange={e => setPrice(e.target.value)} /></label>
    <label>Billing interval<select className={inputClass} value={interval} onChange={e => setInterval(e.target.value)}><option>monthly</option><option>quarterly</option><option>annual</option></select></label>
    <label><input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} /> Available for new invoices</label>
    <button className={primaryButton} disabled={save.isPending}>Save plan</button>{save.isError && <p role="alert">{errorMessage(save.error)}</p>}{save.isSuccess && <p role="status">Saved.</p>}
  </form>
}
