import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { billingApi, type Attempt, type Evidence, type Reconciliation } from '../../lib/billing-api'
import { useAuth } from '../../features/auth/auth-provider'
import { errorMessage } from '../../lib/api'
import { Card, ErrorState, LoadingState, inputClass, primaryButton, secondaryButton } from '../../components/ui-kit'
import { InvoiceTable, Pager } from '../billing/page'

export default function PlatformBillingView() {
  const { user } = useAuth()
  const canManage = user?.permissions?.includes('platform.settings.manage') ?? false
  const [tab, setTab] = useState<'invoices' | 'attempts' | 'reconciliation'>('invoices')
  const [page, setPage] = useState(1)
  const [environment, setEnvironment] = useState('')
  const [selected, setSelected] = useState<{ kind: 'stk-attempts' | 'reconciliation' | 'statement-payments'; row: Attempt | Reconciliation } | null>(null)
  const invoices = useQuery({ queryKey: ['platform-billing', 'invoices', page, environment], queryFn: () => billingApi.invoices(page, environment), enabled: tab === 'invoices' })
  const attempts = useQuery({ queryKey: ['platform-billing', 'attempts', page], queryFn: () => billingApi.attempts(page), enabled: tab === 'attempts' })
  const items = useQuery({ queryKey: ['platform-billing', 'reconciliation', page], queryFn: () => billingApi.reconciliation(page), enabled: tab === 'reconciliation' })
  const active = tab === 'invoices' ? invoices : tab === 'attempts' ? attempts : items
  return <div className="grid gap-6"><h1 className="text-2xl font-bold">Subscription billing</h1>
    <p>Platform Paybill 153283. Confirm only after independently checking the merchant statement. Unsigned callbacks and successful STK queries alone do not prove the receipt or amount. Sandbox settlement never grants subscription access.</p>
    <div className="flex flex-wrap gap-3">{(['invoices', 'attempts', 'reconciliation'] as const).map(t => <button aria-pressed={tab === t} className={tab === t ? primaryButton : secondaryButton} key={t} onClick={() => { setTab(t); setPage(1) }}>{t === 'attempts' ? 'STK requests' : t === 'reconciliation' ? 'Paybill / excess review' : 'Invoices'}</button>)}
      <button className={secondaryButton} onClick={() => void active.refetch()}>Refresh</button></div>
    {tab === 'invoices' && <label>Environment<select className={inputClass} value={environment} onChange={e => { setEnvironment(e.target.value); setPage(1) }}><option value="">All environments</option><option>production</option><option>sandbox</option><option>legacy</option></select></label>}
    <Card title="Billing records">{active.isPending ? <LoadingState /> : active.isError ? <ErrorState message={errorMessage(active.error)} onRetry={() => void active.refetch()} /> : <>
      {tab === 'invoices' && invoices.data && <InvoiceTable invoices={invoices.data.data} />}
      {tab === 'attempts' && attempts.data && <div className="grid gap-3">{attempts.data.data.map(a => <div key={a.id} className="rounded border p-3"><p>Request #{a.id} · Shop {a.bookshop_id} · Account {a.account_number} · KES {a.amount} · {a.status} · {a.environment}</p><p className="break-all">{a.checkout_request_id}</p>{canManage && a.status === 'unknown' && <UnknownResolution id={a.id} />} {canManage && a.status !== 'reconciled' && a.status !== 'unknown' && <button className={secondaryButton} onClick={() => setSelected({ kind: 'stk-attempts', row: a })}>Verify against statement</button>}</div>)}{!attempts.data.data.length && <p>No STK requests.</p>}</div>}
      {tab === 'reconciliation' && items.data && <div className="grid gap-3">{items.data.data.map(i => <div key={i.id} className="rounded border p-3"><p>{i.source} · {i.provider_transaction_id} · Account {i.account_number} · KES {i.amount} · {i.status} · {i.environment}</p>{canManage && i.source === 'c2b' && i.status !== 'settled' && <button className={secondaryButton} onClick={() => setSelected({ kind: 'reconciliation', row: i })}>Verify against statement</button>}{canManage && i.source === 'overpayment' && i.status === 'requires_review' && <OverpaymentResolution id={i.id} />}{i.source === 'overpayment' && <p>Excess held for review. Handle any refund through the merchant’s approved process; no extra access is granted.</p>}</div>)}{!items.data.data.length && <p>No reconciliation items.</p>}</div>}
      {active.data && <Pager page={active.data} setPage={setPage} />}
    </>}</Card>
    {canManage && selected && <Verification key={`${selected.kind}-${selected.row.id}`} {...selected} close={() => setSelected(null)} />}
    {canManage && <button className={secondaryButton} onClick={() => setSelected({ kind: 'statement-payments', row: { id: 0, source: 'statement', status: 'awaiting_verification', environment, provider_transaction_id: '', account_number: '', amount: '', destination_shortcode: '' } })}>Record independently verified statement payment</button>}
    {canManage && <PlanForm />}
  </div>
}

function Verification({ kind, row, close }: { kind: 'stk-attempts' | 'reconciliation' | 'statement-payments'; row: Attempt | Reconciliation; close: () => void }) {
  const [receipt, setReceipt] = useState('')
  const [amount, setAmount] = useState('')
  const [at, setAt] = useState('')
  const [shortcode, setShortcode] = useState('')
  const [account, setAccount] = useState('')
  const [reference, setReference] = useState('')
  const [verified, setVerified] = useState(false)
  const client = useQueryClient()
  const confirm = useMutation({ mutationFn: (body: Evidence) => billingApi.confirm(kind, row.id, body), onSuccess: () => { void client.invalidateQueries({ queryKey: ['platform-billing'] }); close() } })
  function submit(e: FormEvent) {
    e.preventDefault()
    confirm.mutate({ verified_receipt: receipt.trim().toUpperCase(), verified_amount: Number(amount), verified_at: new Date(at).toISOString(), verified_shortcode: shortcode,
      ...(kind !== 'stk-attempts' ? { verified_account: account } : {}), statement_reference: reference, statement_verified: verified })
  }
  return <Card title={`Statement verification · ${row.environment || 'current server environment'} · #${row.id}`}><form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
    <p className="sm:col-span-2">Enter values from an independent merchant statement, not the callback or a customer’s SMS. {row.environment === 'legacy' && 'Legacy records lack payment provenance and cannot be settled here.'}</p>
    <label>Verified receipt<input className={inputClass} required pattern="[A-Za-z0-9]{6,30}" value={receipt} onChange={e => setReceipt(e.target.value)} /></label>
    <label>Verified amount (KES)<input className={inputClass} required type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></label>
    <label>Payment date / time (your local time)<input className={inputClass} required type="datetime-local" value={at} onChange={e => setAt(e.target.value)} /></label>
    <label>Destination shortcode<input className={inputClass} required value={shortcode} onChange={e => setShortcode(e.target.value)} /></label>
    {kind !== 'stk-attempts' && <label>Verified six-digit account<input className={inputClass} required pattern="[0-9]{6}" value={account} onChange={e => setAccount(e.target.value)} /></label>}
    <label>Merchant statement reference<input className={inputClass} required maxLength={255} value={reference} onChange={e => setReference(e.target.value)} /></label>
    <label className="sm:col-span-2"><input required type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} /> I independently verified this receipt, amount, date, account and destination against the trusted merchant statement.</label>
    {confirm.isError && <p role="alert" className="sm:col-span-2">{errorMessage(confirm.error)}</p>}
    <div className="flex gap-3"><button className={primaryButton} disabled={confirm.isPending || !verified || row.environment === 'legacy'}>Verify and settle</button><button type="button" className={secondaryButton} onClick={close}>Cancel</button></div>
  </form></Card>
}

function PlanForm() {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [price, setPrice] = useState('')
  const [interval, setInterval] = useState('monthly')
  const create = useMutation({ mutationFn: () => billingApi.plan({ code, name, price: Number(price), billing_interval: interval }), onSuccess: () => { setCode(''); setName(''); setPrice('') } })
  return <Card title="Add a paid subscription plan"><form className="grid gap-3 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); create.mutate() }}>
    <label>Unique code<input className={inputClass} required pattern="[a-z0-9-]{1,40}" value={code} onChange={e => setCode(e.target.value)} /></label>
    <label>Name<input className={inputClass} required maxLength={100} value={name} onChange={e => setName(e.target.value)} /></label>
    <label>Price (whole KES)<input className={inputClass} required type="number" min="1" max="999999999" step="1" value={price} onChange={e => setPrice(e.target.value)} /></label>
    <label>Period<select className={inputClass} value={interval} onChange={e => setInterval(e.target.value)}><option>monthly</option><option>quarterly</option><option>annual</option></select></label>
    <button className={primaryButton} disabled={create.isPending}>Add plan</button>{create.isSuccess && <p role="status">Plan created.</p>}{create.isError && <p role="alert">{errorMessage(create.error)}</p>}
  </form></Card>
}

function UnknownResolution({ id }: { id: number }) {
  const [reference, setReference] = useState('')
  const [checked, setChecked] = useState(false)
  const client = useQueryClient()
  const resolve = useMutation({ mutationFn: () => billingApi.resolveUnknown(id, { statement_reference: reference, no_payment_verified: checked }), onSuccess: () => { void client.invalidateQueries({ queryKey: ['platform-billing'] }) } })
  return <form className="mt-3 grid gap-2" onSubmit={e => { e.preventDefault(); resolve.mutate() }}><p>If a payment exists, record it using the verified statement payment form below.</p>
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
