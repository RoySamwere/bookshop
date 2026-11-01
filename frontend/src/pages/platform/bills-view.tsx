import { useEffect, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CalendarClock, CheckCircle2, Download, FileSpreadsheet, Hourglass, ReceiptText, RotateCw, Search, WalletCards } from 'lucide-react'
import { useAuth } from '../../features/auth/auth-provider'
import { errorMessage } from '../../lib/api'
import { BILL_STATUS_LABELS, MPESA_CODE_PATTERN, VERIFICATION_SOURCES, billingApi, billsApi, normalizeMpesaCode, type Bill, type BillFilters, type BillStatus } from '../../lib/billing-api'
import { downloadBrandedTable, safeCell } from '../../lib/branded-export'
import { EmptyState, ErrorState, LoadingState, Modal, PageHeader, Pagination, StatCard, formatDate, inputClass, primaryButton, secondaryButton, dangerButton } from '../../components/ui-kit'

const statusTone: Record<BillStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 ring-amber-200', verified: 'bg-sky-50 text-sky-700 ring-sky-200',
  reconciled: 'bg-emerald-50 text-emerald-700 ring-emerald-200', unmatched: 'bg-rose-50 text-rose-700 ring-rose-200', rejected: 'bg-slate-100 text-slate-600 ring-slate-200',
}
const kes = (value: number) => `KES ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const when = (value: string | null) => value ? new Date(value).toLocaleString('en-KE', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

export function BillStatusPill({ status }: { status: BillStatus }) {
  return <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${statusTone[status]}`}>{BILL_STATUS_LABELS[status]}</span>
}

/** Platform "Bills": every M-Pesa transaction received for subscriptions, straight from saf_payments. */
export default function BillsView() {
  const { user } = useAuth()
  const canManage = user?.permissions?.includes('platform.settings.manage') ?? false
  const [filters, setFilters] = useState<BillFilters>({ page: 1 })
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<number | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const client = useQueryClient()
  const sync = useMutation({ mutationFn: billsApi.sync, onSuccess: () => void client.invalidateQueries({ queryKey: ['platform-bills'] }) })

  useEffect(() => { const timer = window.setTimeout(() => setFilters(current => ({ ...current, search: search.trim() || undefined, page: 1 })), 300); return () => window.clearTimeout(timer) }, [search])
  const bills = useQuery({ queryKey: ['platform-bills', filters], queryFn: () => billsApi.list(filters), placeholderData: keepPreviousData, refetchInterval: 30000 })
  const set = (patch: BillFilters) => setFilters(current => ({ ...current, ...patch, page: 1 }))
  const summary = bills.data?.summary

  async function exportRows(kind: 'csv' | 'xlsx') {
    setExporting(true); setExportError('')
    try {
      const { data, truncated } = await billsApi.export(filters)
      const header = ['Date', 'Bookshop', 'Invoice', 'Account', 'M-Pesa code', 'Phone', 'Amount (KES)', 'Allocated (KES)', 'Excess (KES)', 'Paybill', 'Channel', 'Environment', 'Status', 'Verified by', 'Exception']
      const rows = data.map(row => [when(row.transaction_date), row.bookshop_name ?? '', row.invoice_id ? `#${row.invoice_id}` : '', row.account_number ?? '', row.mpesa_receipt_number ?? '',
        row.phone_number ?? '', row.amount, row.allocated_amount, row.excess_amount, row.shortcode ?? '', row.payment_channel === 'stk' ? 'STK Push' : 'Paybill', row.environment,
        BILL_STATUS_LABELS[row.status], row.verification_source ? VERIFICATION_SOURCES[row.verification_source] ?? row.verification_source : '', row.exception_reason ?? ''])
      const stamp = new Date().toLocaleDateString('en-CA')
      if (kind === 'xlsx') {
        await downloadBrandedTable({
          filename: `bills-${stamp}.xlsx`, sheetName: 'Bills', title: 'M-Pesa bills', bookshopName: 'Platform billing', subtitle: truncated ? 'First 5,000 matching payments' : undefined,
          columns: header.map((label, index) => ({ header: label, width: [20, 28, 10, 10, 16, 15, 14, 14, 12, 10, 10, 12, 18, 26, 40][index], numFmt: index >= 6 && index <= 8 ? '#,##0.00' : undefined })),
          rows: rows.map(row => row.map(value => safeCell(value))),
        })
      } else {
        const cell = (value: unknown) => `"${String(value ?? '').replace(/^[=+\-@\t\r]/, "'$&").replaceAll('"', '""')}"`
        const csv = [['Nifunze Bookshop · M-Pesa bills', `Generated ${new Date().toLocaleString('en-KE')}`], [], header, ...rows].map(row => row.map(cell).join(',')).join('\r\n')
        const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
        const link = document.createElement('a'); link.href = url; link.download = `nifunze-bills-${stamp}.csv`; link.click()
        window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
      }
    } catch (error) { setExportError(errorMessage(error, 'Export failed.')) } finally { setExporting(false) }
  }

  return <div className="grid gap-6">
    <PageHeader eyebrow="Platform billing" icon={<ReceiptText size={22} />} title="Bills"
      description={`Every M-Pesa payment received for subscriptions${summary ? ` · ${summary.environment === 'production' ? 'Production Paybill' : 'Sandbox shortcode'} ${summary.paybill}` : ''}. Payments are verified with Safaricom and applied to invoices automatically; only exceptions need you.`}
      actions={<div className="flex flex-wrap gap-2">
        {canManage && <button className={primaryButton} disabled={sync.isPending} onClick={() => sync.mutate()} title="Check every payment in saf_payments with Safaricom by its M-Pesa code and apply confirmed ones"><RotateCw size={16} className={sync.isPending ? 'animate-spin' : ''} /> {sync.isPending ? 'Updating…' : 'Update payments'}</button>}
        <button className={secondaryButton} disabled={exporting} onClick={() => void exportRows('csv')}><Download size={16} /> CSV</button>
        <button className={secondaryButton} disabled={exporting} onClick={() => void exportRows('xlsx')}><FileSpreadsheet size={16} /> Excel</button>
      </div>} />
    {exportError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{exportError}</p>}
    {sync.isError && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">{errorMessage(sync.error)}</p>}
    {sync.isSuccess && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
      Checked {sync.data.data.checked} payment(s) by M-Pesa code: {sync.data.data.applied} applied, {sync.data.data.still_pending} still waiting for Safaricom, {sync.data.data.needs_review} need review{sync.data.data.codes_filled ? `, ${sync.data.data.codes_filled} code(s) filled in` : ''}.
    </p>}

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5" aria-label="Collections summary">
      <StatCard label="Verified collections" value={summary ? kes(summary.verified_collections) : '—'} hint={summary ? `${summary.verified_count} payment(s) applied` : ''} icon={<CheckCircle2 size={19} />} tone="emerald" />
      <StatCard label="Today's collections" value={summary ? kes(summary.today_collections) : '—'} hint={summary ? `${summary.today_count} today (EAT)` : ''} icon={<CalendarClock size={19} />} tone="blue" />
      <StatCard label="Pending verification" value={summary ? String(summary.pending_count) : '—'} hint={summary ? kes(summary.pending_amount) : ''} icon={<Hourglass size={19} />} tone="amber" />
      <StatCard label="Unmatched payments" value={summary ? String(summary.unmatched_count) : '—'} hint={summary ? `${kes(summary.unmatched_amount)} to review` : ''} icon={<AlertTriangle size={19} />} tone="pink" />
      <StatCard label="Outstanding invoices" value={summary ? kes(summary.outstanding_balance) : '—'} hint={summary ? `${summary.outstanding_invoices} unpaid invoice(s)` : ''} icon={<WalletCards size={19} />} tone="blue" />
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white">
      <div className="grid gap-3 border-b border-slate-100 p-4 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1.5fr)_repeat(5,minmax(0,1fr))]">
        <label className="relative">Search<Search size={15} className="absolute bottom-3.5 left-3 text-slate-400" />
          <input className={`${inputClass} pl-9 normal-case tracking-normal`} value={search} onChange={event => setSearch(event.target.value)} placeholder="M-Pesa code, account, phone or bookshop" /></label>
        <label>Status<select className={inputClass} value={filters.status ?? ''} onChange={event => set({ status: event.target.value || undefined })}>
          <option value="">All statuses</option>{(Object.keys(BILL_STATUS_LABELS) as BillStatus[]).map(status => <option key={status} value={status}>{BILL_STATUS_LABELS[status]}</option>)}</select></label>
        <label>Channel<select className={inputClass} value={filters.channel ?? ''} onChange={event => set({ channel: event.target.value || undefined })}>
          <option value="">STK and Paybill</option><option value="stk">STK Push</option><option value="paybill">Paybill</option></select></label>
        <label>Environment<select className={inputClass} value={filters.environment ?? ''} onChange={event => set({ environment: event.target.value || undefined })}>
          <option value="">All</option><option value="production">Production</option><option value="sandbox">Sandbox</option><option value="legacy">Legacy</option></select></label>
        <label>From<input type="date" className={inputClass} value={filters.from ?? ''} onChange={event => set({ from: event.target.value || undefined })} /></label>
        <label>To<input type="date" className={inputClass} value={filters.to ?? ''} onChange={event => set({ to: event.target.value || undefined })} /></label>
      </div>
      {bills.isPending ? <LoadingState label="Loading bills" /> : bills.isError ? <ErrorState message={errorMessage(bills.error)} onRetry={() => void bills.refetch()} /> : <>
        <div className="overflow-x-auto"><table className="w-full min-w-[1080px] text-left text-sm">
          <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wide text-slate-500"><tr>
            {['Date', 'Bookshop', 'Invoice', 'Account', 'M-Pesa code', 'Phone', 'Amount', 'Paybill', 'Status'].map(label => <th key={label} className={`px-4 py-3 ${label === 'Amount' ? 'text-right' : ''}`}>{label}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-slate-100">{bills.data.data.map(row => <BillRow key={row.id} row={row} onOpen={() => setSelected(row.id)} />)}</tbody>
        </table></div>
        {!bills.data.data.length && <EmptyState icon={<ReceiptText size={22} />} title="No payments match" body="M-Pesa payments appear here as soon as Safaricom notifies the platform." />}
        <Pagination meta={{ current_page: bills.data.current_page, last_page: bills.data.last_page, per_page: 25, total: bills.data.total, from: bills.data.from, to: bills.data.to }} onPage={page => setFilters(current => ({ ...current, page }))} />
      </>}
    </section>
    {canManage && summary && <ConfirmByCode environment={summary.environment} onOpen={setSelected} />}
    {canManage && summary && <MissingPayment environment={summary.environment} paybill={summary.paybill} />}
    {selected !== null && <BillDetailModal id={selected} canManage={canManage} onClose={() => setSelected(null)} />}
  </div>
}

/**
 * Confirm a payment with the code from the customer's M-Pesa SMS. Safaricom is asked about the code and the
 * amount it reports is applied to the invoice account entered here.
 */
function ConfirmByCode({ environment, onOpen }: { environment: string; onOpen: (id: number) => void }) {
  const client = useQueryClient()
  const [code, setCode] = useState('')
  const [account, setAccount] = useState('')
  const [note, setNote] = useState('')
  const normalized = normalizeMpesaCode(code)
  const valid = MPESA_CODE_PATTERN.test(normalized)
  const confirm = useMutation({
    mutationFn: () => billsApi.confirmCode(normalized, account.trim(), note.trim()),
    onSuccess: result => { setCode(''); setAccount(''); setNote(''); void client.invalidateQueries({ queryKey: ['platform-bills'] }); onOpen(result.data.id) },
  })
  return <section className="rounded-2xl border border-slate-200 bg-white p-4">
    <h2 className="font-semibold text-slate-900">Confirm a payment by M-Pesa code</h2>
    <p className="mt-1 text-sm text-slate-600">A customer paid but it is not listed, or paid with the wrong account number? Enter the confirmation code from their M-Pesa SMS and their invoice account. The code is checked with Safaricom ({environment}) and the amount Safaricom reports is applied.</p>
    <form className="mt-3 grid gap-3 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:grid-cols-[1fr_1fr_2fr_auto]" onSubmit={event => { event.preventDefault(); if (valid) confirm.mutate() }}>
      <label>M-Pesa code<input className={`${inputClass} font-mono uppercase tracking-wider`} required maxLength={14} value={code} onChange={event => setCode(event.target.value)} placeholder="TJ4K8L2M9P" aria-invalid={code !== '' && !valid} /></label>
      <label>Invoice account<input className={`${inputClass} font-mono`} required pattern="[0-9]{6}" inputMode="numeric" value={account} onChange={event => setAccount(event.target.value)} placeholder="100045" /></label>
      <label>Note<input className={`${inputClass} normal-case tracking-normal`} maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder="e.g. Customer sent the SMS on WhatsApp" /></label>
      <div className="flex items-end"><button className={primaryButton} disabled={confirm.isPending || !valid || !/^[0-9]{6}$/.test(account.trim())}>{confirm.isPending ? 'Checking…' : 'Check with Safaricom'}</button></div>
      {code !== '' && !valid && <p className="text-xs normal-case tracking-normal text-amber-700 sm:col-span-4">M-Pesa codes are 10 letters and numbers, e.g. TJ4K8L2M9P.</p>}
      {confirm.isError && <p role="alert" className="text-sm normal-case tracking-normal text-rose-700 sm:col-span-4">{errorMessage(confirm.error)}</p>}
    </form>
  </section>
}

/**
 * Exception tool for a payment Safaricom never notified the platform about (for example before the Paybill
 * URLs were registered). It needs the operator's own check of the merchant statement and is audited.
 */
function MissingPayment({ environment, paybill }: { environment: string; paybill: string }) {
  const client = useQueryClient()
  const [form, setForm] = useState({ receipt: '', account: '', amount: '', at: '', reference: '', checked: false })
  const record = useMutation({
    mutationFn: () => billingApi.confirm('statement-payments', 0, {
      verified_receipt: form.receipt.trim().toUpperCase(), verified_account: form.account.trim(), verified_amount: Number(form.amount),
      verified_at: new Date(form.at).toISOString(), verified_shortcode: paybill, statement_reference: form.reference.trim(), statement_verified: form.checked,
    }),
    onSuccess: () => { setForm({ receipt: '', account: '', amount: '', at: '', reference: '', checked: false }); void client.invalidateQueries({ queryKey: ['platform-bills'] }) },
  })
  const field = (key: 'receipt' | 'account' | 'amount' | 'at' | 'reference', label: string, extra: Record<string, unknown> = {}) =>
    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}<input className={`${inputClass} normal-case tracking-normal`} required value={form[key]} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} {...extra} /></label>
  return <details className="rounded-2xl border border-slate-200 bg-white p-4">
    <summary className="cursor-pointer font-semibold text-slate-800">Safaricom cannot confirm the code? Record it from the merchant statement</summary>
    <p className="mt-2 text-sm text-slate-600">Use this only when a customer paid {environment === 'production' ? 'Paybill' : 'sandbox shortcode'} {paybill} and Safaricom never notified the platform. Enter the values from your own copy of the M-Pesa merchant statement. The payment is applied immediately and recorded in the audit log.</p>
    <form className="mt-4 grid gap-3 sm:grid-cols-3" onSubmit={event => { event.preventDefault(); record.mutate() }}>
      {field('receipt', 'Code on statement', { pattern: '[A-Za-z0-9]{6,30}' })}
      {field('account', 'Invoice account (6 digits)', { pattern: '[0-9]{6}', inputMode: 'numeric' })}
      {field('amount', 'Amount (KES)', { type: 'number', min: '0.01', step: '0.01' })}
      {field('at', 'Paid at', { type: 'datetime-local' })}
      {field('reference', 'Statement reference', { maxLength: 255 })}
      <label className="flex items-start gap-2 self-end text-sm text-slate-700 sm:col-span-3"><input type="checkbox" className="mt-1" required checked={form.checked} onChange={event => setForm(current => ({ ...current, checked: event.target.checked }))} /> I checked this payment on the merchant statement myself.</label>
      {record.isError && <p role="alert" className="text-sm text-rose-700 sm:col-span-3">{errorMessage(record.error)}</p>}
      {record.isSuccess && <p role="status" className="text-sm text-emerald-700 sm:col-span-3">Payment recorded and applied.</p>}
      <div className="sm:col-span-3"><button className={secondaryButton} disabled={record.isPending || !form.checked}>Record missing payment</button></div>
    </form>
  </details>
}

function BillRow({ row, onOpen }: { row: Bill; onOpen: () => void }) {
  return <tr className="cursor-pointer hover:bg-blue-50/40" onClick={onOpen}>
    <td className="px-4 py-3 text-slate-600">{when(row.transaction_date)}</td>
    <td className="px-4 py-3"><strong className="text-slate-900">{row.bookshop_name ?? '—'}</strong>{row.environment !== 'production' && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-amber-800">{row.environment}</span>}</td>
    <td className="px-4 py-3 text-slate-600">{row.invoice_id ? `#${row.invoice_id}` : '—'}</td>
    <td className="px-4 py-3 font-mono text-slate-700">{row.account_number ?? '—'}</td>
    <td className="px-4 py-3"><button type="button" className="font-mono font-semibold text-blue-700 hover:underline" onClick={event => { event.stopPropagation(); onOpen() }}>{row.mpesa_receipt_number ?? <span className="font-sans text-xs font-normal text-slate-400">Awaiting code</span>}</button></td>
    <td className="px-4 py-3 text-slate-600">{row.phone_number ?? '—'}</td>
    <td className="px-4 py-3 text-right font-semibold text-slate-900">{kes(row.amount)}{row.excess_amount > 0 && <span className="block text-[11px] font-normal text-amber-700">{kes(row.excess_amount)} excess</span>}</td>
    <td className="px-4 py-3 text-slate-600">{row.shortcode ?? '—'}<span className="block text-[11px] text-slate-400">{row.payment_channel === 'stk' ? 'STK Push' : 'Paybill'}</span></td>
    <td className="px-4 py-3"><BillStatusPill status={row.status} />{row.exception_reason && row.status !== 'reconciled' && <span className="mt-1 block max-w-56 truncate text-[11px] text-slate-500" title={row.exception_reason}>{row.exception_reason}</span>}</td>
  </tr>
}

function BillDetailModal({ id, canManage, onClose }: { id: number; canManage: boolean; onClose: () => void }) {
  const client = useQueryClient()
  const detail = useQuery({ queryKey: ['platform-bill', id], queryFn: () => billsApi.show(id) })
  const [mode, setMode] = useState<null | 'assign' | 'reject'>(null)
  const [account, setAccount] = useState('')
  const [note, setNote] = useState('')
  const done = () => { void client.invalidateQueries({ queryKey: ['platform-bills'] }); void client.invalidateQueries({ queryKey: ['platform-bill', id] }); setMode(null); setNote('') }
  const retry = useMutation({ mutationFn: () => billsApi.retry(id), onSuccess: done })
  const assign = useMutation({ mutationFn: () => billsApi.assign(id, account, note), onSuccess: done })
  const reject = useMutation({ mutationFn: () => billsApi.reject(id, note), onSuccess: done })
  const busy = retry.isPending || assign.isPending || reject.isPending
  const error = retry.error ?? assign.error ?? reject.error

  return <Modal title="Payment details" description={detail.data ? `${detail.data.data.mpesa_receipt_number ?? 'STK payment'} · ${kes(detail.data.data.amount)}` : undefined} icon={<ReceiptText size={20} />} onClose={onClose} busy={busy} wide>
    {detail.isPending ? <LoadingState /> : detail.isError ? <ErrorState message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} /> : (() => {
      const bill = detail.data.data
      const open = bill.status === 'pending' || bill.status === 'unmatched'
      return <div className="grid max-h-[70vh] gap-5 overflow-y-auto pr-1 text-sm">
        <div className="flex flex-wrap items-center gap-3"><BillStatusPill status={bill.status} />{bill.verification_source && <span className="text-slate-600">Verified by {VERIFICATION_SOURCES[bill.verification_source] ?? bill.verification_source} {bill.verified_at && `· ${when(bill.verified_at)}`}</span>}</div>
        {bill.exception_reason && bill.status !== 'reconciled' && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900"><strong>Why it needs attention:</strong> {bill.exception_reason}</p>}
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {([
            ['Transaction date', when(bill.transaction_date)], ['Bookshop', bill.bookshop_name ?? 'Not matched'], ['Account number', bill.account_number ?? '—'],
            ['M-Pesa code', bill.mpesa_receipt_number ?? '—'], ['Phone', bill.phone_number ?? '—'], ['Paybill / channel', `${bill.shortcode ?? '—'} · ${bill.payment_channel === 'stk' ? 'STK Push' : 'Paybill'} · ${bill.environment}`],
            ['Customer says it is for', bill.claimed_account ? `Invoice account ${bill.claimed_account}` : '—'],
            ['Amount', kes(bill.amount)], ['Applied / excess', `${kes(bill.allocated_amount)} / ${kes(bill.excess_amount)}`],
            ['Verification checks', `${bill.verification_attempts}${bill.next_verification_at && bill.status === 'pending' ? ` · next ${when(bill.next_verification_at)}` : ''}`],
            ['Confirmation sent', bill.confirmation_sent_at ? when(bill.confirmation_sent_at) : '—'],
          ] as const).map(([label, value]) => <div key={label}><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt><dd className="mt-0.5 font-medium text-slate-900">{value}</dd></div>)}
        </dl>
        {bill.invoice && <div className="rounded-xl border border-slate-200 p-3"><p className="font-semibold text-slate-900">Invoice #{bill.invoice.id} · account {bill.invoice.account_number}</p>
          <p className="text-slate-600">{kes(bill.invoice.amount)} · paid {kes(bill.invoice.paid)} · balance {kes(bill.invoice.balance)} · {bill.invoice.status} · {formatDate(bill.invoice.period_starts_at)} – {formatDate(bill.invoice.period_ends_at)}</p></div>}
        {bill.resolution_note && <p className="text-slate-600"><strong>Resolution:</strong> {bill.resolution_note}{bill.resolved_by ? ` — ${bill.resolved_by}` : ''}</p>}
        <details className="rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer font-semibold text-slate-700">Provider evidence (minimised)</summary>
          <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-all text-xs text-slate-600">{JSON.stringify(bill.provider_payload, null, 2)}</pre></details>
        {bill.history.length > 0 && <div><p className="mb-1 font-semibold text-slate-700">Audit trail</p><ul className="divide-y divide-slate-100">{bill.history.map(entry => <li key={entry.id} className="py-1.5 text-slate-600">{when(entry.created_at)} · {entry.description}</li>)}</ul></div>}

        {canManage && open && <section className="rounded-xl border border-blue-100 bg-blue-50/40 p-4">
          <p className="font-semibold text-slate-900">Exception handling</p>
          <p className="mt-1 text-slate-600">Ask Safaricom again, assign a verified payment to the right invoice, or close it without credit. Every action is audited.</p>
          {error && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-2 text-rose-700">{errorMessage(error)}</p>}
          {mode === null && <div className="mt-3 flex flex-wrap gap-2">
            <button className={secondaryButton} disabled={busy} onClick={() => retry.mutate()}><RotateCw size={16} /> Check with Safaricom again</button>
            {bill.status === 'unmatched' && bill.verified_at && <button className={primaryButton} onClick={() => { setMode('assign'); setAccount(bill.candidate_invoices[0]?.account_number ?? '') }}>Assign to invoice</button>}
            <button className={dangerButton} onClick={() => setMode('reject')}>Reject without credit</button>
          </div>}
          {mode === 'assign' && <form className="mt-3 grid gap-3" onSubmit={event => { event.preventDefault(); assign.mutate() }}>
            <label className="font-semibold text-slate-700">Invoice account<select className={inputClass} value={account} onChange={event => setAccount(event.target.value)} required>
              <option value="">Choose an open invoice</option>{bill.candidate_invoices.map(invoice => <option key={invoice.id} value={invoice.account_number}>{invoice.account_number} · {invoice.bookshop} · KES {invoice.amount} · {invoice.status}</option>)}</select></label>
            <label className="font-semibold text-slate-700">Why this invoice?<textarea className={`${inputClass} h-20 py-2`} required maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder="e.g. Customer confirmed by phone they typed their number as the account" /></label>
            <div className="flex gap-2"><button className={primaryButton} disabled={busy || !account || !note.trim()}>Apply payment</button><button type="button" className={secondaryButton} onClick={() => setMode(null)}>Back</button></div>
          </form>}
          {mode === 'reject' && <form className="mt-3 grid gap-3" onSubmit={event => { event.preventDefault(); reject.mutate() }}>
            <label className="font-semibold text-slate-700">Reason<textarea className={`${inputClass} h-20 py-2`} required maxLength={500} value={note} onChange={event => setNote(event.target.value)} placeholder="Duplicate, refunded through the merchant process, or not a subscription payment" /></label>
            <div className="flex gap-2"><button className={dangerButton} disabled={busy || !note.trim()}>Reject payment</button><button type="button" className={secondaryButton} onClick={() => setMode(null)}>Back</button></div>
          </form>}
        </section>}
      </div>
    })()}
  </Modal>
}
