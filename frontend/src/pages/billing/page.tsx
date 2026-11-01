import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../features/auth/auth-provider'
import { ShopPaymentsTable } from './shop-payments'
import { MPESA_CODE_PATTERN, billingApi, billsApi, normalizeMpesaCode, paymentStatus, type Invoice, type Page } from '../../lib/billing-api'
import { errorMessage } from '../../lib/api'
import { CalendarClock, CheckCircle2, FileText, ReceiptText, Smartphone, WalletCards } from 'lucide-react'
import { Card, EmptyState, ErrorState, LoadingState, Modal, PageHeader, StatCard, inputClass, primaryButton, secondaryButton } from '../../components/ui-kit'

export function Pager({ page, setPage }: { page: Page<unknown>; setPage: (page: number) => void }) {
  return <div className="my-4 flex flex-wrap items-center gap-3 print:hidden"><button className={secondaryButton} disabled={page.current_page <= 1} onClick={() => setPage(page.current_page - 1)}>Previous</button>
    <span>Page {page.current_page} of {page.last_page} · {page.total} results</span><button className={secondaryButton} disabled={page.current_page >= page.last_page} onClick={() => setPage(page.current_page + 1)}>Next</button></div>
}

export function InvoiceTable({ invoices, select }: { invoices: Invoice[]; select?: (id: number) => void }) {
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Invoice / account', 'Shop', 'Environment', 'Status', 'Amount (KES)', 'Paid (KES)', 'Period'].map(s => <th className="p-3" key={s}>{s}</th>)}</tr></thead><tbody>
    {invoices.map(i => <tr key={i.id} className="border-t border-slate-200"><td className="p-3">{select ? <button className="font-semibold text-blue-700 underline" onClick={() => select(i.id)}>#{i.id} / {i.account_number}</button> : `#${i.id} / ${i.account_number}`}</td><td className="p-3">{i.bookshop_id}</td><td className="p-3">{i.environment}</td><td className="p-3">{i.status}</td><td className="p-3">{i.amount}</td><td className="p-3">{i.paid}</td><td className="p-3">{i.billing_months} months · {i.period_starts_at.slice(0, 10)} – {i.period_ends_at.slice(0, 10)}</td></tr>)}
  </tbody></table>{!invoices.length && <p className="p-3">No invoices yet.</p>}</div>
}

const kes = (value: number | string) => `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const day = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const INVOICE_TONE: Record<string, string> = {
  paid: 'bg-emerald-50 text-emerald-700 ring-emerald-200', partially_paid: 'bg-amber-50 text-amber-700 ring-amber-200',
  pending: 'bg-blue-50 text-blue-700 ring-blue-200',
}
const SUBSCRIPTION_TONE: Record<string, string> = {
  active: 'text-emerald-700', trialing: 'text-blue-700', expired: 'text-rose-700', past_due: 'text-amber-700', grace_period: 'text-amber-700',
}
/** Payment status of an invoice, worked out from the money received for its account (including payments still being confirmed). */
export function InvoiceStatus({ status, confirming = false }: { status: string; confirming?: boolean }) {
  return <span className="inline-flex flex-col items-start gap-1">
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold capitalize ring-1 ${INVOICE_TONE[status] ?? 'bg-slate-100 text-slate-600 ring-slate-200'}`}>{status.replace('_', ' ')}</span>
    {confirming && <span className="whitespace-nowrap text-[11px] font-medium text-amber-700">Confirming with Safaricom</span>}
  </span>
}

/** Money received for an invoice: confirmed plus what has reached the system and is still being confirmed. */
export function invoiceProgress(invoice: Invoice) {
  const amount = Number(invoice.amount)
  const received = invoice.amount_received ?? Number(invoice.paid)
  return { amount, received, receiving: Number(invoice.receiving ?? 0), remaining: invoice.remaining ?? Math.max(0, amount - received),
    state: invoice.payment_state ?? invoice.status, confirming: Boolean(invoice.confirming) }
}

/**
 * Subscription billing for the bookshop owner, inside the workspace: plan and access, renewal, how to pay,
 * invoices (each opens a payment panel) and the shop's M-Pesa payments.
 */
export default function BillingPage({ onNavigate }: { onNavigate?: (section: string) => void } = {}) {
  const { user } = useAuth()
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<number | null>(null)
  const [plan, setPlan] = useState('')
  const client = useQueryClient()
  const allowed = Boolean(user && ['bookshop_owner', 'system_owner'].includes(user.role)) && user?.account_type === 'bookshop'
  const overview = useQuery({ queryKey: ['billing', page], queryFn: () => billingApi.overview(page), enabled: allowed, refetchInterval: 10000, refetchOnWindowFocus: true })
  const create = useMutation({ mutationFn: () => billingApi.create(Number(plan)), onSuccess: r => { setSelected(r.data.id); setPlan(''); void client.invalidateQueries({ queryKey: ['billing'] }) } })
  if (!allowed) return <EmptyState icon={<WalletCards size={22} />} title="Billing is available to the bookshop owner" body="Ask the owner of this bookshop to manage the subscription." />

  const data = overview.data
  const subscription = data?.subscription
  const daysLeft = subscription?.days_remaining ?? subscription?.trial_days_left ?? null
  const accessUntil = subscription?.status === 'trialing' ? subscription?.trial_ends_at : subscription?.current_period_ends_at
  const openInvoice = data?.invoices.data.find(invoice => invoice.status !== 'paid')

  return <div className="mx-auto grid w-full max-w-[1400px] gap-6 px-3 pb-10 sm:px-5">
    <PageHeader eyebrow="Account" icon={<WalletCards size={22} />} title="Subscription billing"
      description="Your Nifunze plan, invoices and M-Pesa payments. Payments are confirmed with Safaricom automatically."
      actions={onNavigate && <button className={secondaryButton} onClick={() => onNavigate('Bills')}><ReceiptText size={16} /> View bills</button>} />

    {overview.isPending ? <LoadingState label="Loading billing" /> : overview.isError ? <ErrorState message={errorMessage(overview.error)} onRetry={() => void overview.refetch()} /> : data && <>
      {data.environment === 'sandbox' && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>Test mode.</strong> Sandbox payments are test records: do not send real money. They never activate or extend access. Shortcode {data.paybill ?? 'not configured'}.</p>}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Subscription summary">
        <StatCard label="Current plan" value={subscription?.plan?.name ?? 'No plan'} hint={subscription?.plan ? 'Your Nifunze subscription' : 'Choose a plan below'} icon={<WalletCards size={19} />} tone="blue" />
        <StatCard label="Status" value={<span className={`capitalize ${SUBSCRIPTION_TONE[subscription?.status ?? ''] ?? ''}`}>{(subscription?.status ?? 'none').replace('_', ' ')}</span>} hint={daysLeft !== null ? `${daysLeft} day(s) left` : '—'} icon={<CheckCircle2 size={19} />} tone="emerald" />
        <StatCard label={subscription?.status === 'trialing' ? 'Trial ends' : 'Access until'} value={day(accessUntil)} hint="Renewing keeps your remaining time" icon={<CalendarClock size={19} />} tone="amber" />
        <StatCard label={data.environment === 'sandbox' ? 'Sandbox shortcode' : 'M-Pesa Paybill'} value={data.paybill ?? '—'} hint={openInvoice ? `Account ${openInvoice.account_number}` : 'Create an invoice to get an account number'} icon={<Smartphone size={19} />} tone="pink" />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card title="Renew or change plan" description="Creates an invoice with its own six-digit account number. Your remaining paid or trial time is kept.">
          <form className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={e => { e.preventDefault(); create.mutate() }}>
            <label className="text-sm font-semibold text-slate-700">Plan<select aria-label="Renewal plan" className={inputClass} required value={plan} onChange={e => setPlan(e.target.value)}><option value="">Select a plan</option>{data.plans.map(p => <option key={p.id} value={p.id}>{p.name} · KES {p.price} / {p.billing_interval}</option>)}</select></label>
            <button className={primaryButton} disabled={create.isPending || !plan}>Create invoice</button>
            {!data.plans.length && <p className="text-sm text-slate-600 sm:col-span-2">No paid plans are available. Contact platform support.</p>}
            {create.isError && <p role="alert" className="text-sm text-rose-700 sm:col-span-2">{errorMessage(create.error)}</p>}
          </form>
        </Card>
        <Card title="How to pay" description="Pay an invoice in either of two ways.">
          <ol className="grid gap-3 text-sm text-slate-700">
            <li className="flex gap-3"><span className="grid size-7 flex-none place-items-center rounded-full bg-blue-50 font-bold text-blue-700">1</span><span><strong>M-Pesa prompt:</strong> open the invoice below and send a payment prompt to your phone.</span></li>
            <li className="flex gap-3"><span className="grid size-7 flex-none place-items-center rounded-full bg-blue-50 font-bold text-blue-700">2</span><span><strong>Paybill:</strong> Lipa na M-Pesa → Pay Bill → Business number <strong className="font-mono">{data.paybill ?? '—'}</strong> → Account number <strong className="font-mono">{openInvoice?.account_number ?? 'your invoice account'}</strong> → amount.</span></li>
            <li className="text-slate-500">Already paid and it is not showing? Open the invoice and enter the code from your M-Pesa SMS.</li>
          </ol>
        </Card>
      </section>

      <Card title="Invoices" description="Select an invoice to pay it or see its payments." flush>
        <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr>
            {['Invoice', 'Account', 'Period', 'Amount', 'Amount paid', 'Remaining', 'Status', ''].map(label => <th key={label} className={`px-4 py-3 ${['Amount', 'Amount paid', 'Remaining'].includes(label) ? 'text-right' : ''}`}>{label}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-slate-100">{data.invoices.data.map(invoice => {
            const progress = invoiceProgress(invoice)
            const settled = progress.state === 'paid'
            return <tr key={invoice.id} className="hover:bg-blue-50/40">
              <td className="px-4 py-3 font-semibold text-slate-900">#{invoice.id}{invoice.environment === 'sandbox' && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">test</span>}</td>
              <td className="px-4 py-3 font-mono text-slate-700">{invoice.account_number}</td>
              <td className="px-4 py-3 text-slate-600">{invoice.billing_months} month(s) · {day(invoice.period_starts_at)} – {day(invoice.period_ends_at)}</td>
              <td className="px-4 py-3 text-right">{kes(invoice.amount)}</td>
              <td className="px-4 py-3 text-right"><span className="font-semibold text-emerald-700">{kes(progress.received)}</span>
                {progress.receiving > 0 && <span className="block text-[11px] text-amber-700">{kes(progress.receiving)} confirming</span>}</td>
              <td className={`px-4 py-3 text-right font-semibold ${progress.remaining > 0 ? 'text-slate-900' : 'text-slate-400'}`}>{kes(progress.remaining)}</td>
              <td className="px-4 py-3"><InvoiceStatus status={progress.state} confirming={progress.confirming} /></td>
              <td className="px-4 py-3 text-right"><button className={settled ? secondaryButton : primaryButton} onClick={() => setSelected(invoice.id)} aria-label={`${settled ? 'View' : 'Pay'} invoice #${invoice.id} / ${invoice.account_number}`}>{settled ? 'View' : 'Pay'}</button></td>
            </tr>
          })}</tbody>
        </table></div>
        {!data.invoices.data.length && <EmptyState icon={<FileText size={22} />} title="No invoices yet" body="Choose a plan above to create your first invoice." />}
        <div className="px-4"><Pager page={data.invoices} setPage={setPage} /></div>
      </Card>

      <section className="grid gap-3"><div className="flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-lg font-bold text-slate-900">M-Pesa payments</h2><p className="text-sm text-slate-500">Payments Safaricom has reported for your bookshop.</p></div>
        {onNavigate && <button className={secondaryButton} onClick={() => onNavigate('Bills')}>Open Bills</button>}</div>
        <ShopPaymentsTable /></section>
    </>}
    {selected !== null && <Modal title={`Invoice #${selected}`} icon={<FileText size={20} />} onClose={() => setSelected(null)} wide><div className="max-h-[75vh] overflow-y-auto pr-1"><InvoiceDetail key={selected} id={selected} /></div></Modal>}
  </div>
}

function InvoiceDetail({ id }: { id: number }) {
  const client = useQueryClient()
  const [phone, setPhone] = useState('')
  const [amount, setAmount] = useState('')
  const [message, setMessage] = useState('')
  const invoice = useQuery({ queryKey: ['invoice', id], queryFn: () => billingApi.invoice(id), refetchInterval: 15000 })
  const stk = useMutation({ mutationFn: () => billingApi.stk(id, phone, Number(amount)), onSuccess: r => { setMessage(r.message); void client.invalidateQueries({ queryKey: ['invoice', id] }); void client.invalidateQueries({ queryKey: ['billing'] }) } })
  function submit(e: FormEvent) { e.preventDefault(); setMessage(''); stk.mutate() }
  if (invoice.isPending) return <LoadingState />
  if (invoice.isError) return <ErrorState message={errorMessage(invoice.error)} onRetry={() => void invoice.refetch()} />
  const { data: row, balance: confirmedBalance, paid, overpayment, payments } = invoice.data
  const receiving = Number(invoice.data.receiving ?? 0)
  const remaining = invoice.data.remaining ?? confirmedBalance
  const balance = remaining
  const pending = payments.some(p => ['pending', 'awaiting_verification', 'unknown'].includes(p.status))
  return <section id="billing-invoice"><style>{`@media print { body * { visibility: hidden; } #billing-invoice, #billing-invoice * { visibility: visible; } #billing-invoice { position: absolute; left: 0; top: 0; width: 100%; } }`}</style><Card title={`Account ${row.account_number} · ${(row.payment_state ?? row.status).replace('_', ' ')}`}>
    <p>{invoice.data.environment === 'sandbox' ? 'TEST MODE — Sandbox shortcode' : 'Production Paybill'}: {invoice.data.paybill ?? 'Not configured'} · Invoice environment: {row.environment} · Status: {row.status}</p>
    {invoice.data.can_pay === false && <p role="alert">This invoice cannot be paid in the current payment environment. Contact platform support.</p>}
    <dl className="my-3 grid gap-3 sm:grid-cols-4" aria-label="Payment summary">
      {[['Invoice amount', kes(row.amount), 'text-slate-900'], ['Amount paid', kes(Number(paid) + receiving), 'text-emerald-700'], ['Remaining', kes(remaining), remaining > 0 ? 'text-slate-900' : 'text-slate-400'],
        ['Status', (row.payment_state ?? row.status).replace('_', ' '), 'capitalize text-slate-900']].map(([label, value, tone]) =>
        <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3"><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className={`mt-1 text-lg font-bold ${tone}`}>{value}</dd></div>)}
    </dl>
    {receiving > 0 && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{kes(receiving)} has reached us and is being confirmed with Safaricom. Your access is extended as soon as it is confirmed.</p>}
    {Number(overpayment) > 0 && <p className="text-sm text-slate-600">Excess awaiting review: {kes(overpayment)}</p>}
    <p>Period: {row.period_starts_at.slice(0, 10)} – {row.period_ends_at.slice(0, 10)}</p>
    <p className="my-3">{invoice.data.can_pay === false ? 'Payment instructions are unavailable for this invoice in the current environment.' : invoice.data.environment === 'sandbox' ? 'Sandbox test only: use the displayed sandbox shortcode and this six-digit account. Do not send real money.' : 'Use the displayed production Paybill and this invoice’s six-digit account number for manual payments.'} Your payment is confirmed with Safaricom automatically, usually within a few minutes, and you will get a confirmation.</p>
    <button className={`${secondaryButton} print:hidden`} onClick={() => window.print()}>Print / save invoice PDF</button>
    {balance > 0 && invoice.data.can_pay !== false && <form onSubmit={submit} className="my-4 flex flex-wrap items-end gap-3 print:hidden">
      <label>Phone (2547… or 2541…)<input className={inputClass} required pattern="254[17][0-9]{8}" value={phone} onChange={e => setPhone(e.target.value)} /></label>
      <label>Amount (KES)<input className={inputClass} required type="number" min="1" step="1" max={Math.min(balance, 250000)} value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <button className={primaryButton} disabled={stk.isPending || pending}>Send STK prompt</button>
    </form>}
    {pending && <p role="status">A payment is being confirmed with Safaricom. This page updates automatically; contact platform support if it is still pending after an hour.</p>}
    {message && <p role="status">{message}</p>}{stk.isError && <p role="alert">{errorMessage(stk.error)}</p>}
    {invoice.data.can_pay !== false && row.status !== 'paid' && <ConfirmWithCode invoiceId={id} onDone={() => { void client.invalidateQueries({ queryKey: ['invoice', id] }); void client.invalidateQueries({ queryKey: ['billing'] }) }} />}
    <h3 className="mt-5 font-semibold">Payment history</h3><ul>{payments.map(p => <li className="border-t py-2" key={p.id}>{p.channel} · KES {p.amount} · {paymentStatus(p)} · {p.mpesa_receipt ?? 'No verified receipt'} · {p.environment}</li>)}</ul>
  </Card></section>
}

/** "Already paid?": the owner types the confirmation code from their M-Pesa SMS; it is checked with Safaricom. */
function ConfirmWithCode({ invoiceId, onDone }: { invoiceId: number; onDone: () => void }) {
  const [code, setCode] = useState('')
  const normalized = normalizeMpesaCode(code)
  const valid = MPESA_CODE_PATTERN.test(normalized)
  const confirm = useMutation({ mutationFn: () => billsApi.confirmMyPayment(invoiceId, normalized), onSuccess: () => { setCode(''); onDone() } })
  return <form className="my-4 grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 print:hidden" onSubmit={event => { event.preventDefault(); if (valid) confirm.mutate() }}>
    <p className="font-semibold">Already paid through Paybill?</p>
    <p className="text-sm text-slate-600">Enter the confirmation code from your M-Pesa SMS (for example <span className="font-mono">TJ4K8L2M9P</span>). We check it with Safaricom and apply the payment.</p>
    <div className="flex flex-wrap items-end gap-3">
      <label>M-Pesa confirmation code<input className={`${inputClass} font-mono uppercase tracking-wider`} required maxLength={14} value={code} onChange={event => setCode(event.target.value)} placeholder="TJ4K8L2M9P" aria-invalid={code !== '' && !valid} /></label>
      <button className={secondaryButton} disabled={confirm.isPending || !valid}>{confirm.isPending ? 'Checking…' : 'Confirm payment'}</button>
    </div>
    {code !== '' && !valid && <p className="text-sm text-amber-700">The code is 10 letters and numbers.</p>}
    {confirm.isSuccess && <p role="status" className={confirm.data.status === 'confirmed' ? 'text-emerald-700' : 'text-slate-700'}>{confirm.data.message}</p>}
    {confirm.isError && <p role="alert" className="text-rose-700">{errorMessage(confirm.error)}</p>}
  </form>
}
