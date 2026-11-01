import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BillsView from './bills-view'
import MyPaymentsPage from '../billing/payments'
import { billsApi, type Bill } from '../../lib/billing-api'

const auth = vi.hoisted(() => ({ user: { role: 'platform_owner', account_type: 'platform', permissions: ['platform.settings.view', 'platform.settings.manage'] } as Record<string, unknown> }))
vi.mock('../../features/auth/auth-provider', () => ({ useAuth: () => auth }))
vi.mock('../../lib/billing-api', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/billing-api')>(),
  billsApi: { list: vi.fn(), export: vi.fn(), show: vi.fn(), retry: vi.fn(), assign: vi.fn(), reject: vi.fn(), myPayments: vi.fn() }, downloadPaymentReceipt: vi.fn() }))

const bill = (patch: Partial<Bill>): Bill => ({
  id: 1, transaction_date: '2026-11-01T09:00:00Z', bookshop_id: 4, bookshop_name: 'Kisumu Readers', invoice_id: 12, invoice_status: 'paid', account_number: '100045',
  mpesa_receipt_number: 'QK1ABC2DEF', phone_number: '254712345678', amount: 1000, allocated_amount: 1000, excess_amount: 0, shortcode: '152451', payment_channel: 'paybill',
  environment: 'production', status: 'reconciled', verification_source: 'daraja_transaction_status', verification_reference: 'AG_1', verified_at: '2026-11-01T09:01:00Z',
  verification_attempts: 1, next_verification_at: null, exception_reason: null, resolution_note: null, resolved_by: null, reconciled_at: '2026-11-01T09:01:00Z',
  confirmation_sent_at: '2026-11-01T09:01:00Z', created_at: '2026-11-01T09:00:00Z', ...patch,
})
const summary = { environment: 'production', paybill: '152451', verified_collections: 1000, verified_count: 1, today_collections: 1000, today_count: 1, pending_count: 0, pending_amount: 0,
  unmatched_count: 1, unmatched_amount: 250, excess_amount: 0, outstanding_invoices: 2, outstanding_balance: 1600 }
const unmatched = bill({ id: 2, bookshop_id: null, bookshop_name: null, invoice_id: null, invoice_status: null, account_number: '0712', mpesa_receipt_number: 'QK1WRONG01', amount: 250, allocated_amount: 0, status: 'unmatched', exception_reason: 'No invoice matches this account number.' })

function mount(element = <BillsView />) {
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

  it('hides exception actions from read-only platform staff', async () => {
    auth.user = { role: 'platform_admin', account_type: 'platform', permissions: ['platform.settings.view'] }
    const user = userEvent.setup(); mount()
    await user.click(await screen.findByRole('button', { name: 'QK1WRONG01' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Assign to invoice|Reject without credit|Check with Safaricom again/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Payment missing from Bills?')).not.toBeInTheDocument()
  })
})

describe('My Payments', () => {
  it('lists the bookshop payments and offers receipts only for confirmed ones', async () => {
    auth.user = { role: 'bookshop_owner', account_type: 'bookshop', permissions: [] }
    vi.mocked(billsApi.myPayments).mockResolvedValue({ data: [
      { id: 1, date: '2026-11-01T09:00:00Z', amount: 1000, allocated_amount: 1000, excess_amount: 0, invoice_id: 12, invoice_status: 'paid', account_number: '100045', mpesa_receipt_number: 'QK1ABC2DEF', phone: '2547•••678', channel: 'paybill', environment: 'production', status: 'confirmed', has_receipt: true },
      { id: 2, date: '2026-11-01T10:00:00Z', amount: 500, allocated_amount: 0, excess_amount: 0, invoice_id: 13, invoice_status: 'pending', account_number: '100046', mpesa_receipt_number: null, phone: null, channel: 'stk', environment: 'production', status: 'processing', has_receipt: false },
    ], current_page: 1, last_page: 1, total: 2, totals: { payments: 1, total: 1000 } })
    mount(<MyPaymentsPage />)
    expect(await screen.findByText('QK1ABC2DEF')).toBeInTheDocument()
    expect(screen.getByText('Confirming with Safaricom')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Receipt/ })).toHaveLength(1)
  })
})
