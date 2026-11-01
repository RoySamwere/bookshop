import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Download, Eye, ReceiptText, Search } from 'lucide-react'
import { useAuth } from '../../features/auth/auth-provider'
import { errorMessage } from '../../lib/api'
import { billsApi, downloadPaymentReceipt, type MyPayment, type MyPaymentFilters } from '../../lib/billing-api'
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader, Pagination, formatDate, inputClass, secondaryButton } from '../../components/ui-kit'

export const SHOP_STATUS: Record<MyPayment['status'], [string, string]> = {
  confirmed: ['Confirmed', 'bg-emerald-50 text-emerald-700 ring-emerald-200'],
  processing: ['Confirming with Safaricom', 'bg-amber-50 text-amber-700 ring-amber-200'],
  under_review: ['Under review', 'bg-sky-50 text-sky-700 ring-sky-200'],
  failed: ['Not applied', 'bg-slate-100 text-slate-600 ring-slate-200'],
}
const kes = (value: number) => `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const when = (value: string | null) => value ? new Date(value).toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

export function ShopStatusPill({ status }: { status: MyPayment['status'] }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${SHOP_STATUS[status][1]}`}>{SHOP_STATUS[status][0]}</span>
}

export function useOwnerBilling() {
  const { user } = useAuth()
  return Boolean(user && ['bookshop_owner', 'system_owner'].includes(user.role)) && user?.account_type === 'bookshop'
}

/**
 * The bookshop's own M-Pesa payments from saf_payments, in the same table as the platform Bills page,
 * with a view (eye) icon for the full details and receipt. Used on /bills and /billing.
 */
export function ShopPaymentsTable({ enabled = true }: { enabled?: boolean }) {
  const [filters, setFilters] = useState<MyPaymentFilters>({ page: 1 })
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  useEffect(() => { const timer = window.setTimeout(() => setFilters(current => ({ ...current, search: search.trim() || undefined, page: 1 })), 300); return () => window.clearTimeout(timer) }, [search])
  const payments = useQuery({ queryKey: ['my-payments', filters], queryFn: () => billsApi.myPayments(filters), enabled, placeholderData: keepPreviousData, refetchInterval: 20000 })
  const set = (patch: MyPaymentFilters) => setFilters(current => ({ ...current, ...patch, page: 1 }))

  return <section className="rounded-2xl border border-slate-200 bg-white">
    <div className="grid gap-3 border-b border-slate-100 p-4 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1.5fr)_repeat(3,minmax(0,1fr))]">
      <label className="relative">Search<Search size={15} className="absolute bottom-3.5 left-3 text-slate-400" />
        <input className={`${inputClass} pl-9 normal-case tracking-normal`} value={search} onChange={event => setSearch(event.target.value)} placeholder="M-Pesa code or account number" /></label>
      <label>Status<select className={inputClass} value={filters.status ?? ''} onChange={event => set({ status: (event.target.value || undefined) as MyPayment['status'] | undefined })}>
        <option value="">All statuses</option>{(Object.keys(SHOP_STATUS) as MyPayment['status'][]).map(status => <option key={status} value={status}>{SHOP_STATUS[status][0]}</option>)}</select></label>
      <label>From<input type="date" className={inputClass} value={filters.from ?? ''} onChange={event => set({ from: event.target.value || undefined })} /></label>
      <label>To<input type="date" className={inputClass} value={filters.to ?? ''} onChange={event => set({ to: event.target.value || undefined })} /></label>
    </div>
    {payments.isPending ? <LoadingState label="Loading payments" /> : payments.isError ? <ErrorState message={errorMessage(payments.error)} onRetry={() => void payments.refetch()} /> : <>
      <p className="px-4 pt-3 text-sm text-slate-600">{payments.data.totals.payments} confirmed payment(s) · {kes(payments.data.totals.total)} in total</p>
      <div className="overflow-x-auto"><table className="w-full min-w-[1040px] text-left text-sm">
        <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr>
          {['Date', 'Bookshop', 'Invoice', 'Account', 'M-Pesa code', 'Phone', 'Amount', 'Paybill', 'Status'].map(label => <th key={label} className={`px-4 py-3 ${label === 'Amount' ? 'text-right' : ''}`}>{label}</th>)}
          <th className="px-4 py-3 text-center">View</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-100">{payments.data.data.map(row => <tr key={row.id} className="cursor-pointer hover:bg-blue-50/40" onClick={() => setSelected(row.id)}>
          <td className="px-4 py-3 text-slate-600">{when(row.date)}</td>
          <td className="px-4 py-3"><strong className="text-slate-900">{row.bookshop_name ?? '—'}</strong>{row.environment === 'sandbox' && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">test</span>}</td>
          <td className="px-4 py-3 text-slate-600">{row.invoice_id ? `#${row.invoice_id}` : '—'}</td>
          <td className="px-4 py-3 font-mono text-slate-700">{row.account_number ?? '—'}</td>
          <td className="px-4 py-3 font-mono font-semibold text-blue-700">{row.mpesa_receipt_number ?? <span className="font-sans text-xs font-normal text-slate-400">Awaiting code</span>}</td>
          <td className="px-4 py-3 text-slate-600">{row.phone ?? '—'}</td>
          <td className="px-4 py-3 text-right font-semibold text-slate-900">{kes(row.amount)}{row.excess_amount > 0 && <span className="block text-[11px] font-normal text-amber-700">{kes(row.excess_amount)} above invoice</span>}</td>
          <td className="px-4 py-3 text-slate-600">{row.shortcode ?? '—'}<span className="block text-[11px] text-slate-400">{row.channel === 'stk' ? 'STK Push' : 'Paybill'}</span></td>
          <td className="px-4 py-3"><ShopStatusPill status={row.status} /></td>
          <td className="px-4 py-3 text-center"><button type="button" aria-label={`View payment ${row.mpesa_receipt_number ?? row.id}`} title="View payment details"
            className="inline-grid size-9 place-items-center rounded-lg border border-slate-200 text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
            onClick={event => { event.stopPropagation(); setSelected(row.id) }}><Eye size={17} /></button></td>
        </tr>)}</tbody>
      </table></div>
      {!payments.data.data.length && <EmptyState icon={<ReceiptText size={22} />} title="No payments yet" body="Pay an invoice with M-Pesa and it appears here as soon as Safaricom reports it." />}
      <Pagination meta={{ current_page: payments.data.current_page, last_page: payments.data.last_page, per_page: 20, total: payments.data.total, from: payments.data.from ?? null, to: payments.data.to ?? null }}
        onPage={page => setFilters(current => ({ ...current, page }))} />
    </>}
    {selected !== null && <ShopPaymentModal id={selected} onClose={() => setSelected(null)} />}
  </section>
}

export function ShopPaymentModal({ id, onClose }: { id: number; onClose: () => void }) {
  const detail = useQuery({ queryKey: ['my-payment', id], queryFn: () => billsApi.myPayment(id) })
  const [error, setError] = useState('')
  async function receipt(code: string | null) {
    setError('')
    try { await downloadPaymentReceipt(id, `nifunze-receipt-${code ?? id}.pdf`) } catch (caught) { setError(errorMessage(caught)) }
  }
  return <Modal title="Payment details" description={detail.data ? `${detail.data.data.mpesa_receipt_number ?? 'M-Pesa payment'} · ${kes(detail.data.data.amount)}` : undefined} icon={<ReceiptText size={20} />} onClose={onClose} wide>
    {detail.isPending ? <LoadingState /> : detail.isError ? <ErrorState message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} /> : (() => {
      const payment = detail.data.data
      return <div className="grid max-h-[70vh] gap-5 overflow-y-auto pr-1 text-sm">
        <div className="flex flex-wrap items-center gap-3"><ShopStatusPill status={payment.status} />{payment.verified_by && <span className="text-slate-600">Confirmed by {payment.verified_by}{payment.verified_at ? ` · ${when(payment.verified_at)}` : ''}</span>}</div>
        {payment.note && <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-700">{payment.note}</p>}
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {([
            ['Payment date', when(payment.date)], ['M-Pesa code', payment.mpesa_receipt_number ?? 'Awaiting code'],
            ['Amount', kes(payment.amount)], ['Applied to invoice', kes(payment.allocated_amount)],
            ['Above the invoice (held for review)', kes(payment.excess_amount)], ['Account number', payment.account_number ?? '—'],
            ['Paid to', `${payment.shortcode ?? '—'} · ${payment.channel === 'stk' ? 'STK Push' : 'Paybill'}`], ['Phone', payment.phone ?? '—'],
            ['Applied on', when(payment.applied_at)], ['Bookshop', payment.bookshop_name ?? '—'],
          ] as const).map(([label, value]) => <div key={label}><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-0.5 font-medium text-slate-900">{value}</dd></div>)}
        </dl>
        {payment.invoice && <div className="rounded-xl border border-slate-200 p-3">
          <p className="font-semibold text-slate-900">Invoice #{payment.invoice.id} · account {payment.invoice.account_number}{payment.invoice.plan ? ` · ${payment.invoice.plan}` : ''}</p>
          <p className="text-slate-600">{kes(payment.invoice.amount)} · paid {kes(payment.invoice.paid)} · balance {kes(payment.invoice.balance)} · {payment.invoice.status.replace('_', ' ')} · {formatDate(payment.invoice.period_starts_at)} – {formatDate(payment.invoice.period_ends_at)}</p>
        </div>}
        {error && <p role="alert" className="text-rose-700">{error}</p>}
        {payment.has_receipt && <div><button className={secondaryButton} onClick={() => void receipt(payment.mpesa_receipt_number)}><Download size={16} /> Download receipt</button></div>}
      </div>
    })()}
  </Modal>
}

/** /bills for bookshops: every M-Pesa payment the shop has made to Nifunze, from saf_payments. */
export default function ShopBillsPage() {
  const allowed = useOwnerBilling()
  if (!allowed) return <main className="p-8"><h1>Bills are available to the bookshop owner.</h1><Link to="/dashboard">Return to workspace</Link></main>
  return <main className="mx-auto grid max-w-7xl gap-6 p-4 sm:p-8">
    <div className="flex flex-wrap gap-4 text-blue-700"><Link to="/dashboard">← Return to workspace</Link><Link to="/billing">Subscription billing</Link></div>
    <PageHeader eyebrow="M-Pesa · Safaricom" icon={<ReceiptText size={22} />} title="Bills"
      description="Every M-Pesa payment your bookshop has made for its Nifunze subscription. Select the eye icon for full details and the receipt." />
    <ShopPaymentsTable />
  </main>
}
