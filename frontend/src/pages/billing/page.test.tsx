import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BillingPage from './page'
import PlatformBillingView from '../platform/billing-view'
import { platformApi } from '../../lib/tenancy-api'
import { billingApi, billsApi, paymentStatus } from '../../lib/billing-api'

vi.mock('../../lib/tenancy-api', () => ({ platformApi: { plans: vi.fn() } }))
const auth = vi.hoisted(() => ({ user: { role: 'bookshop_owner', account_type: 'bookshop', permissions: ['platform.settings.manage'] } }))
vi.mock('../../features/auth/auth-provider', () => ({ useAuth: () => auth }))
vi.mock('../../lib/billing-api', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/billing-api')>(), billsApi: { confirmMyPayment: vi.fn(), list: vi.fn().mockResolvedValue({ data: [], current_page: 1, last_page: 1, total: 0, from: null, to: null, summary: null }) }, billingApi: { overview: vi.fn(), invoice: vi.fn(), create: vi.fn(), stk: vi.fn(), invoices: vi.fn(), attempts: vi.fn(), reconciliation: vi.fn(), confirm: vi.fn(), plan: vi.fn(), resolveUnknown: vi.fn(), context: vi.fn(), subscriptions: vi.fn(), payments: vi.fn(), updatePlan: vi.fn() } }))
const invoice = { id: 1, bookshop_id: 1, account_number: '100000', amount: '1000.00', paid: '400.00', currency: 'KES', environment: 'sandbox' as const,
  status: 'partially_paid', billing_months: 1, period_starts_at: '2026-11-01', period_ends_at: '2026-12-01', created_at: '2026-11-01' }
const page = { data: [invoice], current_page: 1, last_page: 1, total: 1 }
function mount(element = <BillingPage />) {
  return render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{element}</QueryClientProvider></MemoryRouter>)
}
beforeEach(() => {
  vi.resetAllMocks()
  auth.user = { role: 'bookshop_owner', account_type: 'bookshop', permissions: ['platform.settings.manage'] }
  vi.mocked(platformApi.plans).mockResolvedValue([{ id: 2, name: 'Monthly', price: '1000', billing_interval: 'monthly', is_active: true, currency: 'KES', description: null, trial_days: 14 }])
  vi.mocked(billingApi.subscriptions).mockResolvedValue({ data: [{ id: 1, bookshop_id: 1, bookshop_name: 'Test Shop', status: 'active', plan: { name: 'Monthly', code: 'monthly' }, days_remaining: 3, trial_days_left: null, trial_ends_at: null, current_period_ends_at: '2026-11-04' }], current_page: 1, last_page: 1, total: 1 })
  vi.mocked(billingApi.payments).mockResolvedValue({ data: [{ id: 1, status: 'confirmed', amount: '1000', channel: 'stk', environment: 'production', mpesa_receipt: 'TESTRECEIPT', created_at: '2026-11-01', account_number: '100000', bookshop_id: 1, statement_reference: 'merchant-statement-1', verified_by: 2 }], current_page: 1, last_page: 1, total: 1 })
  vi.mocked(billingApi.overview).mockResolvedValue({ invoices: page, subscription: null, plans: [{ id: 2, name: 'Monthly', price: '1000', billing_interval: 'monthly' }], paybill: '174379', environment: 'sandbox' })
  vi.mocked(billingApi.context).mockResolvedValue({ environment: 'sandbox', paybill: '174379', can_pay: true })
  vi.mocked(billingApi.invoice).mockResolvedValue({ data: invoice, payments: [], paid: 400, balance: 600, overpayment: 0, environment: 'sandbox', can_pay: true, paybill: '174379' })
  vi.mocked(billingApi.invoices).mockResolvedValue(page)
  vi.mocked(billsApi.list).mockResolvedValue({ data: [], current_page: 1, last_page: 1, total: 0, from: null, to: null, summary: { environment: 'production', paybill: '152451', verified_collections: 0, verified_count: 0, today_collections: 0, today_count: 0, pending_count: 0, pending_amount: 0, unmatched_count: 0, unmatched_amount: 0, excess_amount: 0, outstanding_invoices: 0, outstanding_balance: 0 } })
  vi.mocked(billingApi.attempts).mockResolvedValue({ data: [], current_page: 1, last_page: 1, total: 0 })
  vi.mocked(billingApi.reconciliation).mockResolvedValue({ data: [], current_page: 1, last_page: 1, total: 0 })
})

describe('subscription billing', () => {
  it('shows sandbox restrictions and sends an invoice-scoped partial STK request', async () => {
    vi.mocked(billingApi.stk).mockResolvedValue({ message: 'Awaiting verification' })
    const user = userEvent.setup(); mount()
    expect(await screen.findByText(/Sandbox payments are test records/)).toBeInTheDocument()
    expect(screen.getByText(/TEST MODE — Sandbox shortcode: 174379/)).toBeInTheDocument()
    expect(screen.queryByText(/153283/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '#1 / 100000' }))
    await user.type(await screen.findByLabelText('Phone (2547… or 2541…)'), '254712345678')
    await user.type(screen.getByLabelText('Amount (KES)'), '300')
    expect(screen.getByLabelText('Amount (KES)')).toHaveAttribute('max', '600')
    await user.click(screen.getByRole('button', { name: 'Send STK prompt' }))
    expect(billingApi.stk).toHaveBeenCalledWith(1, '254712345678', 300)
    expect(await screen.findByText('Awaiting verification')).toBeInTheDocument()
  })

  it('blocks another prompt while an unknown request awaits reconciliation', async () => {
    vi.mocked(billingApi.invoice).mockResolvedValue({ data: invoice, payments: [{ id: 1, channel: 'stk', status: 'unknown', amount: '600', environment: 'sandbox', mpesa_receipt: null, created_at: '2026-11-01' }], paid: 400, balance: 600, overpayment: 0, environment: 'sandbox', can_pay: true, paybill: '174379' })
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

  it('no longer asks operators to approve routine payments against the statement', async () => {
    vi.mocked(billingApi.attempts).mockResolvedValue({ data: [{ id: 3, account_number: '100000', checkout_request_id: 'checkout-1', bookshop_id: 1, amount: '1000', status: 'pending', environment: 'production', channel: 'stk', mpesa_receipt: null, created_at: '2026-11-01' }], current_page: 1, last_page: 1, total: 1 })
    const user = userEvent.setup(); mount(<PlatformBillingView />)
    expect((await screen.findAllByText(/verified with Safaricom and applied to invoices automatically/)).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: 'STK requests' }))
    expect(await screen.findByText(/Request #3/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Verify against statement' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Statement verification/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Record independently verified statement payment/ })).not.toBeInTheDocument()
    expect(billingApi.confirm).not.toHaveBeenCalled()
  })
  it('allows platform operators to update future plan pricing', async () => {
    vi.mocked(billingApi.updatePlan).mockResolvedValue({})
    const user = userEvent.setup(); mount(<PlatformBillingView />)
    await user.click(screen.getByRole('button', { name: 'Plans & pricing' }))
    const price = await screen.findByLabelText('New invoice price (whole KES)')
    await user.clear(price); await user.type(price, '1200')
    await user.click(screen.getByRole('button', { name: 'Save plan' }))
    expect(billingApi.updatePlan).toHaveBeenCalledWith(2, { name: 'Monthly', price: 1200, billing_interval: 'monthly', is_active: true })
  })

  it('shows subscription days and supports the expired filter', async () => {
    const user = userEvent.setup(); mount(<PlatformBillingView />)
    await user.click(screen.getByRole('button', { name: 'Subscriptions' }))
    expect(await screen.findByText(/Test Shop.*3 days remaining/)).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Show'), 'expired')
    expect(billingApi.subscriptions).toHaveBeenCalledWith(1, 'expired')
  })

  it('shows independent statement evidence with payment environment filtering', async () => {
    const user = userEvent.setup(); mount(<PlatformBillingView />)
    await user.click(screen.getByRole('button', { name: 'Payment ledger' }))
    expect(await screen.findByText(/merchant-statement-1/)).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Environment'), 'sandbox')
    expect(billingApi.payments).toHaveBeenCalledWith(1, 'sandbox')
  })

  it.each([['cancelled', 'Cancelled by payer'], ['timed_out', 'Timed out — no verified payment'], ['failed', 'Payment failed']])('explains %s provider outcomes', (status, label) => {
    expect(paymentStatus({ status })).toBe(label)
  })

  it('withholds payment instructions for an invoice from another environment', async () => {
    vi.mocked(billingApi.invoice).mockResolvedValue({ data: { ...invoice, environment: 'production' }, payments: [], paid: 0, balance: 1000, overpayment: 0, paybill: '174379', environment: 'sandbox', can_pay: false })
    const user = userEvent.setup(); mount()
    await user.click(await screen.findByRole('button', { name: '#1 / 100000' }))
    expect(await screen.findByText(/Payment instructions are unavailable/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send STK prompt' })).not.toBeInTheDocument()
  })

  it('prepares a sandbox plan draft and saves only after explicit submission', async () => {
    vi.mocked(billingApi.plan).mockResolvedValue({})
    const user = userEvent.setup(); mount(<PlatformBillingView />)
    await user.click(await screen.findByRole('button', { name: 'Prepare sandbox test plan' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Sandbox test monthly')
    expect(screen.getByLabelText('Total price for this period (whole KES)')).toHaveValue(1)
    expect((screen.getByLabelText('Unique code') as HTMLInputElement).value).toMatch(/^sandbox-monthly-[a-z0-9]+$/)
    expect(billingApi.plan).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Add plan' }))
    expect(billingApi.plan).toHaveBeenCalledWith({ code: expect.stringMatching(/^sandbox-monthly-/), name: 'Sandbox test monthly', price: 1, billing_interval: 'monthly' })
    expect(await screen.findByText(/Plan created. Sign in as a bookshop owner/)).toBeInTheDocument()
    expect(billingApi.stk).not.toHaveBeenCalled()
    expect(billingApi.create).not.toHaveBeenCalled()
  })

  it('does not offer the sandbox plan shortcut in production mode', async () => {
    vi.mocked(billingApi.context).mockResolvedValue({ environment: 'production', paybill: '152451', can_pay: true })
    mount(<PlatformBillingView />)
    expect(await screen.findByText(/Production Paybill 152451/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Prepare sandbox test plan' })).not.toBeInTheDocument()
  })

  it('keeps sandbox plan creation unavailable to read-only administrators', async () => {
    auth.user.permissions = []
    mount(<PlatformBillingView />)
    expect(await screen.findByText(/TEST MODE · Sandbox shortcode 174379/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Prepare sandbox test plan' })).not.toBeInTheDocument()
  })

  it('lets the owner confirm a payment with the code from their M-Pesa SMS', async () => {
    vi.mocked(billsApi.confirmMyPayment).mockResolvedValue({ status: 'processing', message: 'Checking payment TJ4K8L2M9P with Safaricom.' })
    const user = userEvent.setup(); mount()
    await user.click(await screen.findByRole('button', { name: '#1 / 100000' }))
    const input = await screen.findByLabelText('M-Pesa confirmation code')
    await user.type(input, 'abc')
    expect(screen.getByRole('button', { name: 'Confirm payment' })).toBeDisabled()
    await user.clear(input); await user.type(input, 'tj4k8l2m9p')
    await user.click(screen.getByRole('button', { name: 'Confirm payment' }))
    expect(billsApi.confirmMyPayment).toHaveBeenCalledWith(1, 'TJ4K8L2M9P')
    expect(await screen.findByText(/Checking payment TJ4K8L2M9P/)).toBeInTheDocument()
  })
})
