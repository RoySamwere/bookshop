import { useMemo, useRef, useState } from 'react'
import { PackageCheck } from 'lucide-react'
import { ApiError, errorMessage } from '../../lib/api'
import { purchasingApi, type PurchaseOrderDetail } from '../../lib/purchasing-api'
import { newKey, today } from './shared'

type Entry = { quantity: number; damaged: number; notes: string }

/**
 * Records a delivery against an LPO. Only outstanding quantities can be received; stock is added
 * by the server in base units. The submission key stays the same for retries of this delivery,
 * so a double click or a dropped connection never adds stock twice.
 */
export function ReceiveGoods({ order, userName, onClose, onDone }: { order: PurchaseOrderDetail; userName: string; onClose: () => void; onDone: (order: PurchaseOrderDetail, message: string) => void }) {
  const open = order.items.filter(item => item.outstanding_quantity > 0)
  const [entries, setEntries] = useState<Record<number, Entry>>(() => Object.fromEntries(open.map(item => [item.id, { quantity: 0, damaged: 0, notes: '' }])))
  const [deliveryNote, setDeliveryNote] = useState('')
  const [receivedOn, setReceivedOn] = useState(today())
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const key = useRef(newKey())

  const receiving = useMemo(() => Object.values(entries).reduce((sum, entry) => sum + entry.quantity, 0), [entries])
  const set = (id: number, patch: Partial<Entry>) => setEntries(current => ({ ...current, [id]: { ...current[id], ...patch } }))

  async function submit() {
    setError('')
    if (receiving < 1) return setError('Enter the quantity received for at least one product.')
    setBusy(true)
    try {
      const result = await purchasingApi.receive(order.id, {
        submission_key: key.current, delivery_note_number: deliveryNote || undefined, received_on: receivedOn, notes: notes || undefined,
        items: open.map(item => ({ purchase_order_item_id: item.id, quantity: entries[item.id].quantity, damaged_quantity: entries[item.id].damaged || undefined, notes: entries[item.id].notes || undefined }))
          .filter(line => line.quantity > 0 || (line.damaged_quantity ?? 0) > 0),
      })
      onDone(result.data, result.message || 'Delivery recorded.')
    } catch (caught) {
      setError(caught instanceof ApiError && Object.keys(caught.errors).length ? Object.values(caught.errors).flat().join(' ') : errorMessage(caught, 'Unable to record the delivery.'))
    } finally { setBusy(false) }
  }

  return <div className="fixed inset-0 z-[55] grid place-items-center overflow-y-auto bg-slate-950/45 p-4" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section role="dialog" data-nested aria-modal="true" aria-labelledby="receive-title" className="my-auto w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl"
      onKeyDown={event => { if (event.key === 'Escape' && !busy) { event.stopPropagation(); onClose() } }}>
      <header className="flex items-start gap-3 border-b border-slate-100 px-6 py-5">
        <span className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><PackageCheck size={20} /></span>
        <div><h2 id="receive-title" className="text-lg font-bold text-slate-900">Receive goods · {order.lpo_number}</h2>
          <p className="text-sm text-slate-500">{order.supplier.name} → {order.branch.name}. Stock increases by what you enter here. Received by {userName}.</p></div>
      </header>
      <div className="space-y-4 px-6 py-5">
        {error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Delivery note number<input className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" value={deliveryNote} maxLength={120} onChange={event => setDeliveryNote(event.target.value)} placeholder="e.g. DN-20431" /></label>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date received<input type="date" max={today()} className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm" value={receivedOn} onChange={event => setReceivedOn(event.target.value)} /></label>
          <div className="flex items-end gap-2">
            <button type="button" className="secondary-button w-full" onClick={() => setEntries(Object.fromEntries(open.map(item => [item.id, { ...entries[item.id], quantity: item.outstanding_quantity }])))}>Receive all outstanding</button>
          </div>
        </div>
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr>
              <th className="px-4 py-2.5">Product</th><th className="px-3 py-2.5 text-right">Ordered</th><th className="px-3 py-2.5 text-right">Received before</th>
              <th className="px-3 py-2.5 text-right">Outstanding</th><th className="px-3 py-2.5 text-right">Receiving now</th><th className="px-3 py-2.5 text-right">Damaged / short</th><th className="px-3 py-2.5">Note</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">{open.map(item => <tr key={item.id}>
              <td className="px-4 py-2.5"><strong className="block text-slate-900">{item.description}</strong><span className="text-xs text-slate-500">{item.unit_label}{item.units_per_package > 1 ? ` of ${item.units_per_package}` : ''} · {item.sku}</span></td>
              <td className="px-3 py-2.5 text-right">{item.quantity}</td>
              <td className="px-3 py-2.5 text-right">{item.received_quantity}</td>
              <td className="px-3 py-2.5 text-right font-semibold">{item.outstanding_quantity}</td>
              <td className="px-3 py-2.5 text-right"><input aria-label={`Receiving now: ${item.description}`} type="number" min={0} max={item.outstanding_quantity} value={entries[item.id].quantity}
                onChange={event => set(item.id, { quantity: Math.min(item.outstanding_quantity, Math.max(0, Math.floor(Number(event.target.value) || 0))) })} className="h-9 w-20 rounded-lg border border-blue-200 bg-blue-50/40 px-2 text-right font-semibold" />
                {item.units_per_package > 1 && entries[item.id].quantity > 0 && <span className="mt-1 block text-[11px] text-slate-500">= {entries[item.id].quantity * item.units_per_package} pieces</span>}</td>
              <td className="px-3 py-2.5 text-right"><input aria-label={`Damaged or short: ${item.description}`} type="number" min={0} value={entries[item.id].damaged} onChange={event => set(item.id, { damaged: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} className="h-9 w-20 rounded-lg border border-slate-200 px-2 text-right" /></td>
              <td className="px-3 py-2.5"><input aria-label={`Note: ${item.description}`} maxLength={500} value={entries[item.id].notes} onChange={event => set(item.id, { notes: event.target.value })} className="h-9 w-full min-w-36 rounded-lg border border-slate-200 px-2" placeholder="Torn cover…" /></td>
            </tr>)}</tbody>
          </table>
        </div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Shortage, damage or delivery notes
          <textarea rows={2} maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm normal-case tracking-normal" /></label>
        <p className="text-xs text-slate-500">Damaged or short items are recorded on the delivery but not added to stock. They stay outstanding until delivered or cancelled.</p>
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
        <span className="mr-auto text-sm text-slate-600">Receiving <strong>{receiving}</strong> unit(s)</span>
        <button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="primary-button" onClick={() => void submit()} disabled={busy || receiving < 1}>{busy ? 'Recording…' : 'Record delivery & update stock'}</button>
      </footer>
    </section>
  </div>
}
