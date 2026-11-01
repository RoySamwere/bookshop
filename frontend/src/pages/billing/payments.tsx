import { useState } from 'react'
import { Link } from 'react-router-dom'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Download, ReceiptText } from 'lucide-react'
import { useAuth } from '../../features/auth/auth-provider'
import { errorMessage } from '../../lib/api'
import { billsApi, downloadPaymentReceipt, type MyPayment } from '../../lib/billing-api'
import { Card, EmptyState, ErrorState, LoadingState, secondaryButton } from '../../components/ui-kit'
import { Pager } from './page'

const LABELS: Record<MyPayment['status'], [string, string]> = {
  confirmed: ['Confirmed', 'bg-emerald-50 text-emerald-700 ring-emerald-200'],
  processing: ['Confirming with Safaricom', 'bg-amber-50 text-amber-700 ring-amber-200'],
  under_review: ['Under review', 'bg-sky-50 text-sky-700 ring-sky-200'],
  failed: ['Not completed', 'bg-slate-100 text-slate-600 ring-slate-200'],
}
const kes = (value: number) => `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** My Payments: the bookshop owner's own M-Pesa subscription payments and receipts. */
export default function MyPaymentsPage() {
  const { user } = useAuth()
  const [page, setPage] = useState(1)
  const [error, setError] = useState('')
  const allowed = Boolean(user && ['bookshop_owner', 'system_owner'].includes(user.role)) && user?.account_type === 'bookshop'
  const payments = useQuery({ queryKey: ['my-payments', page], queryFn: () => billsApi.myPayments(page), enabled: allowed, placeholderData: keepPreviousData, refetchInterval: 20000 })
  if (!allowed) return <main className="p-8"><h1>Payments are available to the bookshop owner.</h1><Link to="/dashboard">Return to workspace</Link></main>

  async function receipt(row: MyPayment) {
    setError('')
    try { await downloadPaymentReceipt(row.id, `nifunze-receipt-${row.mpesa_receipt_number ?? row.id}.pdf`) } catch (caught) { setError(errorMessage(caught)) }
  }

  return <main className="mx-auto grid max-w-6xl gap-6 p-4 sm:p-8">
    <div className="flex flex-wrap gap-4 text-blue-700"><Link to="/dashboard">← Return to workspace</Link><Link to="/billing">Subscription billing</Link></div>
    <div><h1 className="text-2xl font-bold">My Payments</h1><p className="mt-1 text-slate-600">Every M-Pesa payment made for your Nifunze subscription. Payments are confirmed with Safaricom automatically, usually within a few minutes.</p></div>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-rose-700">{error}</p>}
    {payments.isPending ? <LoadingState /> : payments.isError ? <ErrorState message={errorMessage(payments.error)} onRetry={() => void payments.refetch()} /> : <>
      <p className="text-sm text-slate-600">{payments.data.totals.payments} confirmed payment(s) · {kes(payments.data.totals.total)} in total</p>
      <Card title="Payment history">
        <div className="overflow-x-auto"><table className="w-full min-w-[860px] text-left text-sm">
          <thead className="text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr>{['Date', 'Amount', 'Invoice', 'Account', 'M-Pesa code', 'Phone', 'Status', ''].map(label => <th key={label} className="p-3">{label}</th>)}</tr></thead>
          <tbody>{payments.data.data.map(row => <tr key={row.id} className="border-t border-slate-200">
            <td className="p-3">{new Date(row.date).toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
            <td className="p-3 font-semibold">{kes(row.amount)}{row.excess_amount > 0 && <span className="block text-xs font-normal text-amber-700">{kes(row.excess_amount)} above the invoice, held for review</span>}</td>
            <td className="p-3">{row.invoice_id ? `#${row.invoice_id}` : '—'}{row.invoice_status && <span className="block text-xs text-slate-500">{row.invoice_status.replace('_', ' ')}</span>}</td>
            <td className="p-3 font-mono">{row.account_number ?? '—'}</td>
            <td className="p-3 font-mono">{row.mpesa_receipt_number ?? '—'}</td>
            <td className="p-3">{row.phone ?? '—'}</td>
            <td className="p-3"><span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${LABELS[row.status][1]}`}>{LABELS[row.status][0]}</span>{row.environment === 'sandbox' && <span className="block text-xs text-amber-700">Test payment</span>}</td>
            <td className="p-3 text-right">{row.has_receipt && <button className={secondaryButton} onClick={() => void receipt(row)}><Download size={15} /> Receipt</button>}</td>
          </tr>)}</tbody>
        </table></div>
        {!payments.data.data.length && <EmptyState icon={<ReceiptText size={22} />} title="No payments yet" body="Pay an invoice with M-Pesa and it will appear here once Safaricom confirms it." />}
        <Pager page={payments.data} setPage={setPage} />
      </Card>
    </>}
  </main>
}
