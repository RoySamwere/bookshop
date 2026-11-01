import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BillsView from './bills-view'
import PaymentsReconciliation from './payments-reconciliation'
import ShopBillsPage from '../billing/shop-payments'
import { billsApi, type Bill } from '../../lib/billing-api'

const auth = vi.hoisted(() => ({ user: { role: 'platform_owner', account_type: 'platform', permissions: ['platform.settings.view', 'platform.settings.manage'] } as Record<string, unknown> }))
vi.mock('../../features/auth/auth-provider', () => ({ useAuth: () => auth }))
vi.mock('../../lib/billing-api', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/billing-api')>(),
  billsApi: { list: vi.fn(), export: vi.fn(), show: vi.fn(), retry: vi.fn(), assign: vi.fn(), reject: vi.fn(), myPayments: vi.fn(), myPayment: vi.fn(), sync: vi.fn(), confirmCode: vi.fn(), confirmMyPayment: vi.fn() }, downloadPaymentReceipt: vi.fn() }))

const bill = (patch: Partial<Bill>): Bill => ({
  id: 1, transaction_date: '2026-11-01T09:00:00Z', bookshop_id: 4, bookshop_name: 'Kisumu Readers', invoice_id: 12, invoice_status: 'paid', account_number: '100045',
  mpesa_receipt_number: 'QK1ABC2DEF', phone_number: '254712345678', amount: 1000, allocated_amount: 1000, excess_amount: 0, shortcode: '152451', payment_channel: 'paybill',
  environment: 'production', status: 'reconciled', verification_source: 'daraja_transaction_status', verification_reference: 'AG_1', verified_at: '2026-11-01T09:01:00Z',
  verification_attempts: 1, next_verification_at: null, exception_reason: null, claimed_account: null, resolution_note: null, resolved_by: null, reconciled_at: '2026-11-01T09:01:00Z',
  confirmation_sent_at: '2026-11-01T09:01:00Z', created_at: '2026-11-01T09:00:00Z', ...patch,
})
const summary = { environment: 'production', paybill: '152451', verified_collections: 1000, verified_count: 1, today_collections: 1000, today_count: 1, pending_count: 0, pending_amount: 0,
  unmatched_count: 1, unmatched_amount: 250, excess_amount: 0, outstanding_invoices: 2, outstanding_balance: 1600 }
const unmatched = bill({ id: 2, bookshop_id: null, bookshop_name: null, invoice_id: null, invoice_status: null, account_number: '0712', mpesa_receipt_number: 'QK1WRONG01', amount: 250, allocated_amount: 0, status: 'unmatched', exception_reason: 'No invoice matches this account number.' })

function mount(element = <PaymentsReconciliation />) {
  return render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{element}</QueryClientProvider></MemoryRouter>)
}

beforeEach(() => {
  vi.resetAllMocks()
  auth.user = { role: 'platform_owner', account_type: 'platform', permissions: ['platform.settings.view', 'platform.settings.manage'] }
  vi.mocked(billsApi.list).mockResolvedValue({ data: [bill({}), unmatched], current_page: 1, last_page: 1, total: 2, from: 1, to: 2, summary })
  vi.mocked(billsApi.show).mockResolvedValue({ data: { ...unmatched, provider_payload: { transaction_status: { ReceiptNo: 'QK1WRONG01' } }, verification_request_id: null, invoice: null,
    candidate_invoices: [{ id: 12, account_number: '100045', amount: '1000.00', status: 'pending', bookshop: 'Kisumu Readers' }], history: [] } })
})

describe('Bills', () => {
  it('lists every Safaricom payment from saf_payments with a view icon for details', async () => {
    const user = userEvent.setup(); mount(<BillsView />)
    expect(await screen.findByRole('heading', { name: 'Bills' })).toBeInTheDocument()
    expect(await screen.findByText('QK1ABC2DEF')).toBeInTheDocument()
    for (const label of ['Date', 'Bookshop', 'Invoice', 'Account', 'M-Pesa code', 'Phone', 'Amount', 'Paybill', 'Status', 'View']) expect(screen.getByRole('columnheader', { name: label })).toBeInTheDocument()
    expect(screen.getByText('QK1ABC2DEF')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Update payments/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Verified collections')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View payment QK1WRONG01' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Payment details')).toBeInTheDocument()
    expect(within(dialog).getByText(/No invoice matches this account number/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Assign to invoice' })).not.toBeInTheDocument()
    expect(billsApi.show).toHaveBeenCalledWith(2)
  })
})

describe('Payments & reconciliation', () => {
  it('shows collections, real payment rows and filters by status', async () => {
    const user = userEvent.setup(); mount()
    expect(await screen.findByText('QK1ABC2DEF')).toBeInTheDocument()
    const cards = screen.getByRole('region', { name: 'Collections summary' })
    for (const label of ['Verified collections', "Today's collections", 'Pending verification', 'Unmatched payments', 'Outstanding invoices']) expect(within(cards).getByText(label)).toBeInTheDocument()
    expect(within(cards).getByText('KES 1,600.00')).toBeInTheDocument()
    expect(screen.getAllByText('Reconciled').length).toBeGreaterThan(0)
    await user.selectOptions(screen.getByLabelText('Status'), 'unmatched')
    expect(billsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'unmatched', page: 1 }))
  })

  it('assigns a verified unmatched payment to an invoice with a reason', async () => {
    vi.mocked(billsApi.assign).mockResolvedValue({ data: { ...unmatched, status: 'reconciled', provider_payload: {}, verification_request_id: null, invoice: null, candidate_invoices: [], history: [] } })
    const user = userEvent.setup(); mount()
    await user.click(await screen.findByRole('button', { name: 'QK1WRONG01' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/No invoice matches this account number/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Assign to invoice' }))
    await user.type(within(dialog).getByLabelText(/Why this invoice/), 'Customer typed phone digits')
    await user.click(within(dialog).getByRole('button', { name: 'Apply payment' }))
    expect(billsApi.assign).toHaveBeenCalledWith(2, '100045', 'Customer typed phone digits')
  })

  it('shows the real M-Pesa code, never a checkout placeholder', async () => {
    vi.mocked(billsApi.list).mockResolvedValue({ data: [bill({ id: 3, payment_channel: 'stk', mpesa_receipt_number: null })], current_page: 1, last_page: 1, total: 1, from: 1, to: 1, summary })
    mount()
    expect(await screen.findByText('Awaiting code')).toBeInTheDocument()
    expect(screen.queryByText(/ws_CO|STK \(pending code\)/)).not.toBeInTheDocument()
  })

  it('confirms a payment by the code from the customer SMS', async () => {
    vi.mocked(billsApi.confirmCode).mockResolvedValue({ data: { ...unmatched, id: 9, status: 'pending', provider_payload: {}, verification_request_id: null, invoice: null, candidate_invoices: [], history: [] } })
    const user = userEvent.setup(); mount()
    await screen.findByText('QK1ABC2DEF')
    await user.type(screen.getByLabelText('M-Pesa code'), 'tj4k 8l2m9p')
    await user.type(screen.getByLabelText('Invoice account'), '100045')
    await user.click(screen.getByRole('button', { name: 'Check with Safaricom' }))
    expect(billsApi.confirmCode).toHaveBeenCalledWith('TJ4K8L2M9P', '100045', '')
  })

  it('updates every payment by its M-Pesa code on request', async () => {
    vi.mocked(billsApi.sync).mockResolvedValue({ data: { checked: 3, applied: 2, still_pending: 1, needs_review: 0, codes_filled: 1, links_repaired: 0 }, summary })
    const user = userEvent.setup(); mount()
    await screen.findByText('QK1ABC2DEF')
    await user.click(screen.getByRole('button', { name: /Update payments/ }))
    expect(await screen.findByText(/Checked 3 payment\(s\) by M-Pesa code: 2 applied/)).toBeInTheDocument()
  })

  it('hides exception actions from read-only platform staff', async () => {
    auth.user = { role: 'platform_admin', account_type: 'platform', permissions: ['platform.settings.view'] }
    const user = userEvent.setup(); mount()
    await user.click(await screen.findByRole('button', { name: 'QK1WRONG01' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Assign to invoice|Reject without credit|Check with Safaricom again/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Confirm a payment by M-Pesa code')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Update payments/ })).not.toBeInTheDocument()
  })
})

describe('Shop Bills', () => {
  it('shows the bookshop payments in the same table with a view icon and receipt for confirmed ones', async () => {
    auth.user = { role: 'bookshop_owner', account_type: 'bookshop', permissions: [] }
    const row = { id: 1, date: '2026-11-01T09:00:00Z', bookshop_name: 'Kisumu Readers', shortcode: '152451', amount: 1000, allocated_amount: 1000, excess_amount: 0, invoice_id: 12, invoice_status: 'paid', account_number: '100045', mpesa_receipt_number: 'QK1ABC2DEF', phone: '2547•••678', channel: 'paybill', environment: 'production', status: 'confirmed' as const, has_receipt: true }
    vi.mocked(billsApi.myPayments).mockResolvedValue({ data: [row,
      { ...row, id: 2, mpesa_receipt_number: null, channel: 'stk', status: 'processing', has_receipt: false, invoice_status: 'pending' },
    ], current_page: 1, last_page: 1, total: 2, totals: { payments: 1, total: 1000 } })
    vi.mocked(billsApi.myPayment).mockResolvedValue({ data: { ...row, verified_by: 'Safaricom (automatic)', verified_at: '2026-11-01T09:01:00Z', applied_at: '2026-11-01T09:01:00Z', note: null,
      invoice: { id: 12, account_number: '100045', plan: 'Monthly', amount: 1000, paid: 1000, balance: 0, status: 'paid', period_starts_at: '2026-11-01', period_ends_at: '2026-12-01' } } })
    const user = userEvent.setup(); mount(<ShopBillsPage />)
    expect(await screen.findByText('QK1ABC2DEF')).toBeInTheDocument()
    for (const label of ['Date', 'Bookshop', 'Invoice', 'Account', 'M-Pesa code', 'Phone', 'Amount', 'Paybill', 'Status', 'View']) expect(screen.getByRole('columnheader', { name: label })).toBeInTheDocument()
    expect(screen.getAllByText('Confirming with Safaricom').length).toBeGreaterThan(1) // filter option + status pill
    await user.click(screen.getByRole('button', { name: 'View payment QK1ABC2DEF' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Confirmed by Safaricom \(automatic\)/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Download receipt/ })).toBeInTheDocument()
    expect(billsApi.myPayment).toHaveBeenCalledWith(1)
  })
})
