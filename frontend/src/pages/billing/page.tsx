import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../features/auth/auth-provider'
import { billingApi, paymentStatus, type Invoice, type Page } from '../../lib/billing-api'
import { errorMessage } from '../../lib/api'
import { Card, ErrorState, LoadingState, inputClass, primaryButton, secondaryButton } from '../../components/ui-kit'

export function Pager({ page, setPage }: { page: Page<unknown>; setPage: (page: number) => void }) {
  return <div className="my-4 flex flex-wrap items-center gap-3 print:hidden"><button className={secondaryButton} disabled={page.current_page <= 1} onClick={() => setPage(page.current_page - 1)}>Previous</button>
    <span>Page {page.current_page} of {page.last_page} · {page.total} results</span><button className={secondaryButton} disabled={page.current_page >= page.last_page} onClick={() => setPage(page.current_page + 1)}>Next</button></div>
}

export function InvoiceTable({ invoices, select }: { invoices: Invoice[]; select?: (id: number) => void }) {
  return <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{['Invoice / account', 'Shop', 'Environment', 'Status', 'Amount (KES)', 'Paid (KES)', 'Period'].map(s => <th className="p-3" key={s}>{s}</th>)}</tr></thead><tbody>
    {invoices.map(i => <tr key={i.id} className="border-t border-slate-200"><td className="p-3">{select ? <button className="font-semibold text-blue-700 underline" onClick={() => select(i.id)}>#{i.id} / {i.account_number}</button> : `#${i.id} / ${i.account_number}`}</td><td className="p-3">{i.bookshop_id}</td><td className="p-3">{i.environment}</td><td className="p-3">{i.status}</td><td className="p-3">{i.amount}</td><td className="p-3">{i.paid}</td><td className="p-3">{i.billing_months} months · {i.period_starts_at.slice(0, 10)} – {i.period_ends_at.slice(0, 10)}</td></tr>)}
  </tbody></table>{!invoices.length && <p className="p-3">No invoices yet.</p>}</div>
}

export default function BillingPage() {
  const { user } = useAuth()
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<number | null>(null)
  const [plan, setPlan] = useState('')
  const client = useQueryClient()
  const allowed = Boolean(user && ['bookshop_owner', 'system_owner'].includes(user.role)) && user?.account_type === 'bookshop'
  const overview = useQuery({ queryKey: ['billing', page], queryFn: () => billingApi.overview(page), enabled: allowed, refetchInterval: 30000 })
  const create = useMutation({ mutationFn: () => billingApi.create(Number(plan)), onSuccess: r => { setSelected(r.data.id); void client.invalidateQueries({ queryKey: ['billing'] }) } })
  if (!allowed) return <main className="p-8"><h1>Billing is available to the bookshop owner.</h1><Link to="/dashboard">Return to workspace</Link></main>
  return <main className="mx-auto grid max-w-6xl gap-6 p-4 sm:p-8"><Link className="print:hidden text-blue-700" to="/dashboard">← Return to workspace</Link>
    <h1 className="text-2xl font-bold">Nifunze subscription billing</h1>
    {overview.isPending ? <LoadingState /> : overview.isError ? <ErrorState message={errorMessage(overview.error)} onRetry={() => void overview.refetch()} /> : <>
      <Card title="Your subscription"><p>Plan: {overview.data.subscription?.plan?.name ?? 'No plan'} · Remaining days: {overview.data.subscription?.days_remaining ?? overview.data.subscription?.trial_days_left ?? '—'}</p><p>Status: {overview.data.subscription?.status ?? 'No subscription'}</p><p>Paid access until: {overview.data.subscription?.current_period_ends_at?.slice(0, 10) ?? '—'} · Trial until: {overview.data.subscription?.trial_ends_at?.slice(0, 10) ?? '—'}</p>
        <p className="mt-3 font-semibold">{overview.data.environment === 'sandbox' ? 'TEST MODE — Sandbox shortcode' : 'Production Paybill'}: {overview.data.paybill ?? 'Not configured'}</p>
        {overview.data.environment === 'sandbox' && <p role="status" className="my-3 rounded bg-amber-100 p-3">Sandbox payments are test records. Do not send real money during this test. They never activate or extend subscription access. Use the Safaricom sandbox shortcode configured for testing.</p>}
        <p className="my-3">Renewal preserves your remaining paid or trial period. Partial payments activate access only after the invoice is fully verified. Excess payments are held for platform review.</p>
        <form className="flex flex-wrap items-end gap-3 print:hidden" onSubmit={e => { e.preventDefault(); create.mutate() }}>
          <label>Renewal plan<select aria-label="Renewal plan" className={inputClass} required value={plan} onChange={e => setPlan(e.target.value)}><option value="">Select a plan</option>{overview.data.plans.map(p => <option key={p.id} value={p.id}>{p.name} · KES {p.price} / {p.billing_interval}</option>)}</select></label>
          <button className={primaryButton} disabled={create.isPending || !plan}>Create invoice</button>
        </form>{!overview.data.plans.length && <p>No paid plans are available. Contact platform support.</p>}{create.isError && <p role="alert">{errorMessage(create.error)}</p>}
      </Card>
      <Card title="Invoices"><InvoiceTable invoices={overview.data.invoices.data} select={setSelected} /><Pager page={overview.data.invoices} setPage={setPage} /></Card>
    </>}
    {selected !== null && <InvoiceDetail key={selected} id={selected} />}
  </main>
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
  const { data: row, balance, paid, overpayment, payments } = invoice.data
  const pending = payments.some(p => ['pending', 'awaiting_verification', 'unknown'].includes(p.status))
  return <section id="billing-invoice"><style>{`@media print { body * { visibility: hidden; } #billing-invoice, #billing-invoice * { visibility: visible; } #billing-invoice { position: absolute; left: 0; top: 0; width: 100%; } }`}</style><Card title={`Invoice #${id} · Account ${row.account_number}`}>
    <p>{invoice.data.environment === 'sandbox' ? 'TEST MODE — Sandbox shortcode' : 'Production Paybill'}: {invoice.data.paybill ?? 'Not configured'} · Invoice environment: {row.environment} · Status: {row.status}</p>
    {invoice.data.can_pay === false && <p role="alert">This invoice cannot be paid in the current payment environment. Contact platform support.</p>}
    <p>Amount: KES {row.amount} · Verified paid: KES {paid} · Balance: KES {balance} · Excess awaiting review: KES {overpayment}</p>
    <p>Period: {row.period_starts_at.slice(0, 10)} – {row.period_ends_at.slice(0, 10)}</p>
    <p className="my-3">{invoice.data.can_pay === false ? 'Payment instructions are unavailable for this invoice in the current environment.' : invoice.data.environment === 'sandbox' ? 'Sandbox test only: use the displayed sandbox shortcode and this six-digit account. Do not send real money.' : 'Use the displayed production Paybill and this invoice’s six-digit account number for manual payments.'} An STK prompt or SMS receipt alone does not confirm settlement. Platform staff verify payments against the merchant statement.</p>
    <button className={`${secondaryButton} print:hidden`} onClick={() => window.print()}>Print / save invoice PDF</button>
    {balance > 0 && invoice.data.can_pay !== false && <form onSubmit={submit} className="my-4 flex flex-wrap items-end gap-3 print:hidden">
      <label>Phone (2547… or 2541…)<input className={inputClass} required pattern="254[17][0-9]{8}" value={phone} onChange={e => setPhone(e.target.value)} /></label>
      <label>Amount (KES)<input className={inputClass} required type="number" min="1" step="1" max={Math.min(balance, 250000)} value={amount} onChange={e => setAmount(e.target.value)} /></label>
      <button className={primaryButton} disabled={stk.isPending || pending}>Send STK prompt</button>
    </form>}
    {pending && <p role="status">A payment request is awaiting provider and statement verification. Contact platform support if it remains pending.</p>}
    {message && <p role="status">{message}</p>}{stk.isError && <p role="alert">{errorMessage(stk.error)}</p>}
    <h3 className="mt-5 font-semibold">Payment history</h3><ul>{payments.map(p => <li className="border-t py-2" key={p.id}>{p.channel} · KES {p.amount} · {paymentStatus(p)} · {p.mpesa_receipt ?? 'No verified receipt'} · {p.environment}</li>)}</ul>
  </Card></section>
}
