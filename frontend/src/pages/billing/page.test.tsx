import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BillingPage from './page'
import PlatformBillingView from '../platform/billing-view'
import { billingApi } from '../../lib/billing-api'

const auth = vi.hoisted(() => ({ user: { role: 'bookshop_owner', account_type: 'bookshop', permissions: ['platform.settings.manage'] } }))
vi.mock('../../features/auth/auth-provider', () => ({ useAuth: () => auth }))
vi.mock('../../lib/billing-api', () => ({ billingApi: { overview: vi.fn(), invoice: vi.fn(), create: vi.fn(), stk: vi.fn(), invoices: vi.fn(), attempts: vi.fn(), reconciliation: vi.fn(), confirm: vi.fn(), plan: vi.fn(), resolveUnknown: vi.fn() } }))
const invoice = { id: 1, bookshop_id: 1, account_number: '100000', amount: '1000.00', paid: '400.00', currency: 'KES', environment: 'sandbox' as const,
  status: 'partially_paid', billing_months: 1, period_starts_at: '2026-11-01', period_ends_at: '2026-12-01', created_at: '2026-11-01' }
const page = { data: [invoice], current_page: 1, last_page: 1, total: 1 }
function mount(element = <BillingPage />) {
  return render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{element}</QueryClientProvider></MemoryRouter>)
}
beforeEach(() => {
  vi.resetAllMocks()
  auth.user = { role: 'bookshop_owner', account_type: 'bookshop', permissions: ['platform.settings.manage'] }
  vi.mocked(billingApi.overview).mockResolvedValue({ invoices: page, subscription: null, plans: [{ id: 2, name: 'Monthly', price: '1000', billing_interval: 'monthly' }], paybill: '153283', environment: 'sandbox' })
  vi.mocked(billingApi.invoice).mockResolvedValue({ data: invoice, payments: [], paid: 400, balance: 600, overpayment: 0, paybill: '153283' })
  vi.mocked(billingApi.invoices).mockResolvedValue(page)
  vi.mocked(billingApi.attempts).mockResolvedValue({ data: [], current_page: 1, last_page: 1, total: 0 })
  vi.mocked(billingApi.reconciliation).mockResolvedValue({ data: [], current_page: 1, last_page: 1, total: 0 })
})

describe('subscription billing', () => {
  it('shows sandbox restrictions and sends an invoice-scoped partial STK request', async () => {
    vi.mocked(billingApi.stk).mockResolvedValue({ message: 'Awaiting verification' })
    const user = userEvent.setup(); mount()
    expect(await screen.findByText(/Sandbox payments are test records/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '#1 / 100000' }))
    await user.type(await screen.findByLabelText('Phone (2547… or 2541…)'), '254712345678')
    await user.type(screen.getByLabelText('Amount (KES)'), '300')
    expect(screen.getByLabelText('Amount (KES)')).toHaveAttribute('max', '600')
    await user.click(screen.getByRole('button', { name: 'Send STK prompt' }))
    expect(billingApi.stk).toHaveBeenCalledWith(1, '254712345678', 300)
    expect(await screen.findByText('Awaiting verification')).toBeInTheDocument()
  })

  it('blocks another prompt while an unknown request awaits reconciliation', async () => {
    vi.mocked(billingApi.invoice).mockResolvedValue({ data: invoice, payments: [{ id: 1, channel: 'stk', status: 'unknown', amount: '600', environment: 'sandbox', mpesa_receipt: null, created_at: '2026-11-01' }], paid: 400, balance: 600, overpayment: 0, paybill: '153283' })
    const user = userEvent.setup(); mount()
    await user.click(await screen.findByRole('button', { name: '#1 / 100000' }))
    expect(await screen.findByRole('button', { name: 'Send STK prompt' })).toBeDisabled()
    expect(billingApi.stk).not.toHaveBeenCalled()
  })

  it('does not request tenant billing for a staff account', () => {
    auth.user.role = 'cashier'; mount()
    expect(screen.getByText('Billing is available to the bookshop owner.')).toBeInTheDocument()
    expect(billingApi.overview).not.toHaveBeenCalled()
  })

  it('requires independent statement attestation before submitting settlement', async () => {
    vi.mocked(billingApi.attempts).mockResolvedValue({ data: [{ id: 3, account_number: '100000', checkout_request_id: 'checkout-1', bookshop_id: 1, amount: '1000', status: 'pending', environment: 'production', channel: 'stk', mpesa_receipt: null, created_at: '2026-11-01' }], current_page: 1, last_page: 1, total: 1 })
    const user = userEvent.setup(); mount(<PlatformBillingView />)
    await user.click(screen.getByRole('button', { name: 'STK requests' }))
    await user.click(await screen.findByRole('button', { name: 'Verify against statement' }))
    expect(screen.getByRole('button', { name: 'Verify and settle' })).toBeDisabled()
    expect(screen.getByLabelText('Verified receipt')).toHaveValue('')
    expect(billingApi.confirm).not.toHaveBeenCalled()
    await user.click(screen.getByRole('checkbox'))
    expect(screen.getByRole('button', { name: 'Verify and settle' })).toBeEnabled()
  })
})
