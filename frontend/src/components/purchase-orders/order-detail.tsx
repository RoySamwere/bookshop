import { useCallback, useEffect, useState } from 'react'
import { Ban, CheckCircle2, Download, FilePenLine, Mail, PackageCheck, Printer, RotateCw, Send, ShieldCheck, Trash2, Undo2 } from 'lucide-react'
import { ApiError, errorMessage } from '../../lib/api'
import type { BranchSummary } from '../../lib/auth'
import { formatDate } from '../ui-kit'
import { downloadLpoPdf, formatMoney, purchasingApi, STATUS_LABELS, type PurchaseOrderDetail, type PurchaseOrderStatus } from '../../lib/purchasing-api'
import { OrderForm } from './order-form'
import { ReceiveGoods } from './receive-goods'
import { EmailState, ReasonDialog, Sheet, StatusPill, type SupplierOption } from './shared'

const ACTION_LABELS: Record<string, string> = {
  created: 'Created', updated: 'Edited', submitted: 'Submitted for approval', approved: 'Approved', rejected: 'Returned to draft',
  confirmed: 'Confirmed', amended: 'Amended', cancelled: 'Cancelled', outstanding_cancelled: 'Outstanding quantity cancelled',
  sent_manually: 'Marked as sent manually', email_queued: 'Email queued', email_requeued: 'Email queued again', email_sent: 'Email sent',
  email_failed: 'Email failed', goods_received: 'Goods received',
}

type Prompt = null | 'reject' | 'cancel' | 'mark_sent' | 'delete' | 'confirm' | 'resend'

export function OrderDetail({ id, userName, branches, suppliers, canEditPrices, onClose, onChanged, notify }: {
  id: number; userName: string; branches: BranchSummary[]; suppliers: SupplierOption[]; canEditPrices: boolean
  onClose: () => void; onChanged: () => void; notify: (message: string) => void
}) {
  const [order, setOrder] = useState<PurchaseOrderDetail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [prompt, setPrompt] = useState<Prompt>(null)
  const [editing, setEditing] = useState<null | 'edit' | 'amend'>(null)
  const [receiving, setReceiving] = useState(false)
  const [sendEmail, setSendEmail] = useState(true)
  const [outstandingWarning, setOutstandingWarning] = useState('')

  const load = useCallback(() => purchasingApi.show(id).then(result => { setOrder(result.data); setError('') }).catch(caught => setError(errorMessage(caught, 'Unable to load the order.'))), [id])
  useEffect(() => { void load() }, [load])

  // While an email is queued or sending, refresh until the worker has finished.
  useEffect(() => {
    if (!order || !['queued', 'sending'].includes(order.email_status)) return
    const timer = window.setTimeout(() => { void load().then(() => onChanged()) }, 4000)
    return () => window.clearTimeout(timer)
  }, [order, load, onChanged])

  async function run(action: () => Promise<{ data: PurchaseOrderDetail; message?: string }>, success: string) {
    setBusy(true); setError('')
    try {
      const result = await action()
      setOrder(result.data)
      notify(result.message || success)
      onChanged()
      setPrompt(null)
    } catch (caught) {
      const outstanding = caught instanceof ApiError ? caught.field('outstanding') : undefined
      if (outstanding) { setOutstandingWarning(outstanding); setPrompt('confirm') }
      else { setError(caught instanceof ApiError && Object.keys(caught.errors).length ? Object.values(caught.errors).flat().join(' ') : errorMessage(caught, 'That did not work. Try again.')); setPrompt(null) }
    } finally { setBusy(false) }
  }

  async function pdf(mode: 'download' | 'print') {
    if (!order?.lpo_number) return
    try { await downloadLpoPdf(order.id, `${order.lpo_number}.pdf`, mode) } catch (caught) { setError(errorMessage(caught)) }
  }

  async function remove() {
    setBusy(true)
    try { await purchasingApi.remove(id); notify('Draft deleted.'); onChanged(); onClose() } catch (caught) { setError(errorMessage(caught)); setBusy(false) }
  }

  if (editing && order) return <OrderForm mode={editing} order={order} branches={branches} suppliers={suppliers} currency={order.currency || 'KES'} canEditPrices={canEditPrices}
    onClose={() => setEditing(null)} onSaved={(saved, message) => { setOrder(saved); setEditing(null); notify(message); onChanged() }} />

  const a = order?.actions
  const currency = order?.currency || 'KES'
  const lastAttempt = order?.email_attempts[0]
  return <Sheet onClose={onClose} busy={busy}
    title={order ? <span className="flex flex-wrap items-center gap-3">{order.lpo_number || `Draft #${order.id}`} <StatusPill status={order.status} />{order.version > 1 && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">v{order.version}</span>}</span> : 'Purchase order'}
    subtitle={order ? <>{order.supplier.name} · {order.branch.name} · {formatMoney(order.total, currency)}</> : undefined}
    footer={order && a ? <>
      {a.delete && <button type="button" className="mr-auto inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-rose-600 hover:bg-rose-50" onClick={() => setPrompt('delete')}><Trash2 size={16} /> Delete draft</button>}
      {a.cancel && <button type="button" className="secondary-button" onClick={() => setPrompt('cancel')}><Ban size={16} /> {order.status === 'partially_received' ? 'Cancel outstanding' : 'Cancel order'}</button>}
      {a.download_pdf && <><button type="button" className="secondary-button" onClick={() => void pdf('print')}><Printer size={16} /> Print</button><button type="button" className="secondary-button" onClick={() => void pdf('download')}><Download size={16} /> PDF</button></>}
      {a.edit && <button type="button" className="secondary-button" onClick={() => setEditing('edit')}><FilePenLine size={16} /> Edit</button>}
      {a.amend && <button type="button" className="secondary-button" onClick={() => setEditing('amend')}><FilePenLine size={16} /> Amend</button>}
      {a.reject && <button type="button" className="secondary-button" onClick={() => setPrompt('reject')}><Undo2 size={16} /> Return to draft</button>}
      {a.submit && !a.confirm && <button type="button" className="primary-button" disabled={busy} onClick={() => void run(() => purchasingApi.submit(order.id), 'Submitted for approval.')}><Send size={16} /> Submit for approval</button>}
      {a.submit && a.confirm && <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(() => purchasingApi.submit(order.id), 'Submitted for approval.')}><Send size={16} /> Submit for approval</button>}
      {a.approve && <button type="button" className="primary-button" disabled={busy} onClick={() => void run(() => purchasingApi.approve(order.id), 'Order approved.')}><ShieldCheck size={16} /> Approve</button>}
      {a.confirm && <button type="button" className="primary-button" onClick={() => { setOutstandingWarning(''); setSendEmail(Boolean(order.supplier.email)); setPrompt('confirm') }}><CheckCircle2 size={16} /> Confirm & send order</button>}
      {a.mark_sent && <button type="button" className="secondary-button" onClick={() => setPrompt('mark_sent')}>Mark sent manually</button>}
      {a.send_email && order.email_status !== 'sent' && order.supplier.email && <button type="button" className="primary-button" disabled={busy || ['queued', 'sending'].includes(order.email_status)} onClick={() => void run(() => purchasingApi.send(order.id), 'Queued for sending.')}>
        {order.email_status === 'failed' ? <><RotateCw size={16} /> Retry sending</> : <><Mail size={16} /> Email supplier</>}</button>}
      {a.send_email && order.email_status === 'sent' && <button type="button" className="secondary-button" onClick={() => setPrompt('resend')}><Mail size={16} /> Resend</button>}
      {a.receive && <button type="button" className="primary-button" onClick={() => setReceiving(true)}><PackageCheck size={16} /> Receive goods</button>}
    </> : undefined}>
    {error && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
    {!order ? !error && <p className="py-16 text-center text-slate-400">Loading order…</p> : <div className="space-y-4">
      {order.rejection_reason && order.status === 'draft' && <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><strong>Returned by approver:</strong> {order.rejection_reason}</p>}
      {order.cancellation_reason && <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><strong>Cancelled:</strong> {order.cancellation_reason}</p>}
      {order.is_overdue && <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Delivery was expected on {formatDate(order.expected_date)} and is overdue.</p>}

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          ['Order date', formatDate(order.order_date)], ['Expected delivery', formatDate(order.expected_date)],
          ['Payment terms', order.payment_terms || '—'], ['Deliver to', order.delivery_location || order.branch.name],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-slate-200 bg-white p-3.5"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-900">{value}</p></div>)}
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#087df5]">Supplier</p>
          <p className="mt-1 font-semibold text-slate-900">{order.supplier.name}{!order.supplier.is_active && <span className="ml-2 text-xs text-rose-600">inactive</span>}</p>
          <p className="text-slate-500">{[order.supplier.contact_person, order.supplier.phone].filter(Boolean).join(' · ') || '—'}</p>
          <p className={order.supplier.email ? 'text-slate-600' : 'text-amber-700'}>{order.supplier.email || 'No email: download or print the LPO and mark it sent manually.'}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#087df5]">Delivery to supplier</p>
          <p className="mt-1 flex flex-wrap items-center gap-2"><EmailState status={order.email_status} />{order.delivery_method === 'manual' && <span className="text-xs font-semibold text-slate-600">Sent manually</span>}</p>
          <p className="text-slate-500">Last attempt: {order.email_last_attempt_at ? formatDate(order.email_last_attempt_at, true) : '—'} · Last success: {order.email_sent_at ? formatDate(order.email_sent_at, true) : '—'}</p>
          {lastAttempt?.status === 'failed' && <p className="mt-1 text-xs text-rose-700">Error: {lastAttempt.error}</p>}
          <p className="mt-1 text-xs text-slate-400">An emailed order is not the same as supplier acceptance. Record the supplier's confirmation in the notes.</p>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr>
            <th className="px-4 py-2.5">Product</th><th className="px-3 py-2.5">Unit</th><th className="px-3 py-2.5 text-right">Ordered</th><th className="px-3 py-2.5 text-right">Received</th>
            <th className="px-3 py-2.5 text-right">Outstanding</th><th className="px-3 py-2.5 text-right">Unit cost</th><th className="px-3 py-2.5 text-right">Line total</th>
          </tr></thead>
          <tbody className="divide-y divide-slate-100">{order.items.map(item => <tr key={item.id}>
            <td className="px-4 py-2.5"><strong className="block text-slate-900">{item.description}</strong><span className="text-xs text-slate-500">{[item.sku, item.isbn].filter(Boolean).join(' · ')}</span></td>
            <td className="px-3 py-2.5 text-slate-600">{item.unit_label}{item.units_per_package > 1 ? ` ×${item.units_per_package}` : ''}</td>
            <td className="px-3 py-2.5 text-right">{item.quantity}</td>
            <td className="px-3 py-2.5 text-right text-emerald-700">{item.received_quantity}</td>
            <td className="px-3 py-2.5 text-right font-semibold">{item.outstanding_quantity}{item.cancelled_quantity > 0 && <span className="block text-[11px] font-normal text-rose-600">{item.cancelled_quantity} cancelled</span>}</td>
            <td className="px-3 py-2.5 text-right">{item.unit_cost.toLocaleString('en-KE', { minimumFractionDigits: 2 })}{item.discount > 0 && <span className="block text-[11px] text-slate-500">−{item.discount.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</span>}</td>
            <td className="px-3 py-2.5 text-right font-semibold">{item.line_total.toLocaleString('en-KE', { minimumFractionDigits: 2 })}</td>
          </tr>)}</tbody>
        </table></div>
        <dl className="ml-auto max-w-xs space-y-1 border-t border-slate-100 p-4 text-sm">
          <div className="flex justify-between"><dt className="text-slate-500">Subtotal</dt><dd>{formatMoney(order.subtotal, currency)}</dd></div>
          {order.discount_total > 0 && <div className="flex justify-between"><dt className="text-slate-500">Discount</dt><dd>− {formatMoney(order.discount_total, currency)}</dd></div>}
          <div className="flex justify-between"><dt className="text-slate-500">Tax ({order.tax_rate}%{order.prices_include_tax ? ', included' : ''})</dt><dd>{formatMoney(order.tax_total, currency)}</dd></div>
          <div className="flex justify-between border-t border-slate-100 pt-1 font-bold text-slate-900"><dt>Total</dt><dd>{formatMoney(order.total, currency)}</dd></div>
        </dl>
      </section>

      {(order.supplier_notes || order.internal_notes) && <section className="grid gap-3 sm:grid-cols-2">
        {order.supplier_notes && <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Notes for supplier</p><p className="mt-1 whitespace-pre-line text-slate-700">{order.supplier_notes}</p></div>}
        {order.internal_notes && <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Internal notes</p><p className="mt-1 whitespace-pre-line text-slate-700">{order.internal_notes}</p></div>}
      </section>}

      {order.receipts.length > 0 && <section className="rounded-xl border border-slate-200 bg-white">
        <h3 className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">Receiving history</h3>
        <ul className="divide-y divide-slate-100">{order.receipts.map(receipt => <li key={receipt.id} className="px-4 py-3 text-sm">
          <p className="font-semibold text-slate-800">{receipt.reference}{receipt.delivery_note_number && <span className="font-normal text-slate-500"> · DN {receipt.delivery_note_number}</span>}</p>
          <p className="text-xs text-slate-500">{formatDate(receipt.received_on || receipt.created_at)} · by {receipt.received_by || '—'}</p>
          <p className="mt-1 text-slate-600">{receipt.items.map(line => { const item = order.items.find(row => row.id === line.purchase_order_item_id); return `${item?.description ?? 'Item'}: ${line.quantity}${line.damaged_quantity ? ` (+${line.damaged_quantity} damaged)` : ''}` }).join(' · ')}</p>
          {receipt.notes && <p className="mt-1 text-xs text-slate-500">{receipt.notes}</p>}
        </li>)}</ul>
      </section>}

      <section className="rounded-xl border border-slate-200 bg-white">
        <h3 className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-900">Audit trail</h3>
        <ol className="divide-y divide-slate-100">{order.events.map(event => <li key={event.id} className="flex gap-3 px-4 py-2.5 text-sm">
          <span className="w-36 flex-none text-xs text-slate-500">{formatDate(event.created_at, true)}</span>
          <span className="min-w-0"><strong className="text-slate-800">{ACTION_LABELS[event.action] || event.action}</strong>{event.to_status && event.from_status !== event.to_status && <span className="text-slate-500"> → {STATUS_LABELS[event.to_status as PurchaseOrderStatus] ?? event.to_status}</span>}
            <span className="text-slate-500"> · {event.user || 'System'}{event.action === 'amended' ? ` · replaced v${event.version}` : ''}</span>
            {event.notes && <span className="block text-xs text-slate-500">{event.notes}</span>}</span>
        </li>)}</ol>
      </section>
    </div>}

    {receiving && order && <ReceiveGoods order={order} userName={userName} onClose={() => setReceiving(false)} onDone={(saved, message) => { setOrder(saved); setReceiving(false); notify(message); onChanged() }} />}
    {prompt === 'reject' && order && <ReasonDialog title="Return to draft" label="What needs to change?" submitLabel="Return to draft" busy={busy} onClose={() => setPrompt(null)} onSubmit={reason => void run(() => purchasingApi.reject(order.id, reason), 'Returned to draft.')} />}
    {prompt === 'cancel' && order && <ReasonDialog danger title={order.status === 'partially_received' ? 'Cancel outstanding quantities' : 'Cancel this order'} label="Reason" submitLabel="Cancel order" busy={busy} onClose={() => setPrompt(null)} onSubmit={reason => void run(() => purchasingApi.cancel(order.id, reason), 'Order cancelled.')}>
      <p className="mt-2 text-sm text-slate-600">{order.status === 'partially_received' ? 'Goods already received stay in stock. Only quantities still outstanding are cancelled and the order is closed.' : 'The order is kept for your records and cannot be reopened.'}{order.email_status === 'sent' ? ' Let the supplier know: cancelling here does not notify them.' : ''}</p>
    </ReasonDialog>}
    {prompt === 'mark_sent' && order && <ReasonDialog optional title="Mark as sent manually" label="How was it delivered?" submitLabel="Mark as sent" busy={busy} onClose={() => setPrompt(null)} onSubmit={notes => void run(() => purchasingApi.markSent(order.id, notes || undefined), 'Marked as sent.')} />}
    {prompt === 'resend' && order && <ReasonDialog optional title={`Resend ${order.lpo_number}?`} label="Note for the record" submitLabel="Resend email" busy={busy} onClose={() => setPrompt(null)} onSubmit={() => void run(() => purchasingApi.send(order.id, true), 'Queued for sending again.')}>
      <p className="mt-2 text-sm text-slate-600">The supplier already received this order by email. The same LPO number and document will be sent again to {order.supplier.email}.</p>
    </ReasonDialog>}
    {prompt === 'delete' && order && <ReasonDialog optional danger title="Delete this draft?" label="Note" submitLabel="Delete draft" busy={busy} onClose={() => setPrompt(null)} onSubmit={() => void remove()} />}
    {prompt === 'confirm' && order && <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/45 p-4">
      <div role="dialog" data-nested aria-modal="true" aria-labelledby="confirm-title" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); setPrompt(null) } }}>
        <h3 id="confirm-title" className="text-lg font-bold text-slate-900">Confirm order to {order.supplier.name}?</h3>
        <p className="mt-2 text-sm text-slate-600">An LPO number is issued and the document is stored. The total of <strong>{formatMoney(order.total, currency)}</strong> becomes a commitment. Stock only changes when goods are received.</p>
        {outstandingWarning && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{outstandingWarning}</p>}
        <label className={`mt-4 flex items-start gap-2 text-sm ${order.supplier.email ? 'text-slate-700' : 'text-slate-400'}`}>
          <input type="checkbox" className="mt-0.5" checked={sendEmail && Boolean(order.supplier.email)} disabled={!order.supplier.email} onChange={event => setSendEmail(event.target.checked)} />
          <span>Email the LPO to {order.supplier.email || 'the supplier (no email on file)'}</span></label>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="secondary-button" disabled={busy} onClick={() => setPrompt(null)}>Back</button>
          <button type="button" className="primary-button" disabled={busy} autoFocus onClick={() => void run(() => purchasingApi.confirm(order.id, { send_email: sendEmail && Boolean(order.supplier.email), acknowledge_outstanding: Boolean(outstandingWarning) }), 'Order confirmed.')}>
            {busy ? 'Confirming…' : outstandingWarning ? 'Order anyway' : sendEmail && order.supplier.email ? 'Confirm & send' : 'Confirm order'}</button>
        </div>
      </div>
    </div>}
  </Sheet>
}
