import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TrialExtensionsPanel, { parseExtensionDays, previewExpiry } from './trial-extensions'
import PlatformBillingView from './billing-view'
import BillingPage from '../billing/page'
import { ApiError } from '../../lib/api'
import { billingApi, trialApi, type TrialSubscription } from '../../lib/billing-api'

const auth = vi.hoisted(() => ({ user: {} as Record<string, unknown> }))
vi.mock('../../features/auth/auth-provider', () => ({ useAuth: () => auth }))
vi.mock('../../lib/tenancy-api', () => ({ platformApi: { plans: vi.fn().mockResolvedValue([]) } }))
vi.mock('../../lib/billing-api', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/billing-api')>(),
  trialApi: { subscriptions: vi.fn(), history: vi.fn(), extend: vi.fn() },
  billingApi: { context: vi.fn(), overview: vi.fn(), invoice: vi.fn(), subscriptions: vi.fn(), payments: vi.fn(), invoices: vi.fn(), attempts: vi.fn(), reconciliation: vi.fn() },
  billsApi: { list: vi.fn(), health: vi.fn(), myPayments: vi.fn() } }))

const NOW = new Date('2026-11-14T10:00:00Z')
const row = (patch: Partial<TrialSubscription>): TrialSubscription => ({
  id: 1, bookshop_id: 7, bookshop_name: 'Lakeside Books', bookshop_status: 'active', status: 'trialing', plan: { code: 'starter', name: 'Starter' },
  days_remaining: 5, trial_days_left: 5, trial_starts_at: '2026-11-05T10:00:00Z', trial_ends_at: '2026-11-19T10:00:00Z', current_period_ends_at: null,
  trial_state: 'active', remaining_trial_days: 5, eligible: true, ineligible_reason: null, extensions_count: 0, ...patch,
})
const page = <T,>(data: T[]) => ({ data, current_page: 1, last_page: 1, total: data.length })
const owner = { role: 'platform_owner', account_type: 'platform', permissions: ['platform.access', 'platform.settings.view', 'platform.subscriptions.extend_trial'] }

function mount(element = <TrialExtensionsPanel />) {
  return render(<MemoryRouter><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>{element}</QueryClientProvider></MemoryRouter>)
}

beforeEach(() => {
  vi.resetAllMocks()
  auth.user = owner
  vi.mocked(trialApi.subscriptions).mockResolvedValue({ ...page([
    row({}),
    row({ id: 2, bookshop_id: 8, bookshop_name: 'Old Town Books', status: 'expired', trial_ends_at: '2026-11-01T10:00:00Z', trial_state: 'expired', remaining_trial_days: 0, trial_days_left: null, extensions_count: 2 }),
    row({ id: 3, bookshop_id: 9, bookshop_name: 'Paid Pages', status: 'active', trial_state: 'not_trial', eligible: false, ineligible_reason: 'This bookshop has paid subscription access.', current_period_ends_at: '2026-12-14T10:00:00Z' }),
  ]), max_days: 90 })
  vi.mocked(trialApi.history).mockResolvedValue(page([{ id: 11, bookshop_id: 8, bookshop_name: 'Old Town Books', previous_status: 'expired', previous_trial_ends_at: '2026-10-20T10:00:00Z',
    new_trial_ends_at: '2026-11-01T10:00:00Z', days_granted: 5, reactivated: true, extended_by: 1, extended_by_name: 'Platform Boss', reason: 'Data migration delay', created_at: '2026-10-27T10:00:00Z' }]))
  vi.mocked(billingApi.context).mockResolvedValue({ environment: 'production', paybill: '152451' })
})

describe('extension value validation', () => {
  it.each(['', '0', '-1', '1.5', '2.0', 'ten', '1e2', '91'])('rejects %j', value => {
    expect(parseExtensionDays(value, 90).error).toBeTruthy()
    expect(parseExtensionDays(value, 90).days).toBeUndefined()
  })
  it('accepts a whole number within the maximum', () => {
    expect(parseExtensionDays(' 14 ', 90)).toEqual({ days: 14 })
    expect(parseExtensionDays('90', 90)).toEqual({ days: 90 })
  })
})

describe('expiry calculation', () => {
  it('adds days to an active trial expiry', () => {
    expect(previewExpiry(row({}), 10, NOW).toISOString()).toBe('2026-11-29T10:00:00.000Z')
  })
  it('restarts an expired trial from now', () => {
    expect(previewExpiry(row({ trial_state: 'expired', trial_ends_at: '2026-11-01T10:00:00Z' }), 7, NOW).toISOString()).toBe('2026-11-21T10:00:00.000Z')
  })
})

describe('Trial extension panel', () => {
  it('shows trial status per bookshop and offers Extend Trial only where eligible', async () => {
    mount()
    expect((await screen.findAllByText('Lakeside Books')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Active trial').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Trial expired').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Extend trial for Lakeside Books' }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Extend trial for Old Town Books' }).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Extend trial for Paid Pages' })).not.toBeInTheDocument()
    expect((await screen.findAllByText('Data migration delay')).length).toBeGreaterThan(0)
  })

  it('validates, previews, confirms and submits a single extension', async () => {
    let resolve!: (value: Awaited<ReturnType<typeof trialApi.extend>>) => void
    vi.mocked(trialApi.extend).mockReturnValue(new Promise(r => { resolve = r }))
    const user = userEvent.setup(); mount()
    await user.click((await screen.findAllByRole('button', { name: 'Extend trial for Lakeside Books' }))[0])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Bookshop')).toHaveValue('Lakeside Books')
    expect(within(dialog).getByLabelText('Bookshop')).toHaveAttribute('readonly')
    expect(within(dialog).getByLabelText('Current trial expiry')).toHaveAttribute('readonly')

    const days = within(dialog).getByLabelText(/Days to extend/)
    await user.type(days, '2.5')
    await user.click(within(dialog).getByRole('button', { name: 'Review extension' }))
    expect(within(dialog).getByText(/whole number of days/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Confirm Extension' })).not.toBeInTheDocument()

    await user.clear(days); await user.type(days, '10')
    expect(within(dialog).getByTestId('new-expiry')).not.toHaveTextContent('—')
    await user.type(within(dialog).getByLabelText(/Reason/), 'Supplier onboarding')
    await user.click(within(dialog).getByRole('button', { name: 'Review extension' }))
    expect(within(dialog).getByText('+10 days')).toBeInTheDocument()
    expect(within(dialog).getByText('Supplier onboarding')).toBeInTheDocument()

    const confirm = within(dialog).getByRole('button', { name: 'Confirm Extension' })
    await user.click(confirm)
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Saving…' })).toBeDisabled())
    await user.click(within(dialog).getByRole('button', { name: 'Saving…' }))
    expect(trialApi.extend).toHaveBeenCalledTimes(1)
    const [bookshopId, body] = vi.mocked(trialApi.extend).mock.calls[0]
    expect(bookshopId).toBe(7)
    expect(body).toMatchObject({ days: 10, reason: 'Supplier onboarding', expected_trial_ends_at: '2026-11-19T10:00:00Z' })
    expect(body.idempotency_key).toMatch(/^[A-Za-z0-9-]{8,64}$/)

    resolve({ message: 'Trial extended by 10 day(s) for Lakeside Books.', duplicate: false, data: {} as never, subscription: row({}) })
    expect(await screen.findByText('Trial extended by 10 day(s) for Lakeside Books.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('explains that an expired trial restarts from today and shows server errors', async () => {
    vi.mocked(trialApi.extend).mockRejectedValue(new ApiError('Invalid', 422, { subscription: ['This bookshop has paid subscription access.'] }))
    const user = userEvent.setup(); mount()
    await user.click((await screen.findAllByRole('button', { name: 'Extend trial for Old Town Books' }))[0])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/restarts it from today/)).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/Days to extend/), '7')
    await user.click(within(dialog).getByRole('button', { name: 'Review extension' }))
    expect(within(dialog).getByText('+7 days from today')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Confirm Extension' }))
    expect(await within(dialog).findByText('This bookshop has paid subscription access.')).toBeInTheDocument()
  })

  it('cancel closes the modal without saving', async () => {
    const user = userEvent.setup(); mount()
    await user.click((await screen.findAllByRole('button', { name: 'Extend trial for Lakeside Books' }))[0])
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trialApi.extend).not.toHaveBeenCalled()
  })
})

describe('Platform billing tabs', () => {
  it('shows the Trial management tab to the Platform Owner only', async () => {
    const user = userEvent.setup()
    const view = render(<MemoryRouter initialEntries={['/platform/billing']}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Routes><Route path="/platform/billing/*" element={<PlatformBillingView />} /></Routes></QueryClientProvider></MemoryRouter>)
    await user.click(await screen.findByRole('link', { name: 'Trial management' }))
    expect(await screen.findByRole('heading', { name: 'Trial management' })).toBeInTheDocument()
    view.unmount()
    vi.mocked(trialApi.subscriptions).mockClear()

    auth.user = { role: 'platform_admin', account_type: 'platform', permissions: ['platform.access', 'platform.settings.view'] }
    render(<MemoryRouter initialEntries={['/platform/billing/trials']}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Routes><Route path="/platform/billing/*" element={<PlatformBillingView />} /></Routes></QueryClientProvider></MemoryRouter>)
    expect(await screen.findByRole('link', { name: 'Subscriptions' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Trial management' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Trial management' })).not.toBeInTheDocument()
    expect(trialApi.subscriptions).not.toHaveBeenCalled()
  })
})

describe('Bookshop billing after an extension', () => {
  it('shows the extended trial expiry and recalculated days left to the system owner', async () => {
    auth.user = { role: 'system_owner', account_type: 'bookshop', permissions: ['workspace.access'] }
    vi.mocked(billingApi.overview).mockResolvedValue({ invoices: page([]), plans: [], paybill: '152451', environment: 'production',
      subscription: { status: 'trialing', plan: { code: 'starter', name: 'Starter' }, trial_ends_at: '2026-12-04T10:00:00Z', trial_days_left: 20, days_remaining: 20, current_period_ends_at: null } })
    vi.mocked(billingApi.context).mockResolvedValue({ environment: 'production', paybill: '152451' })
    mount(<BillingPage />)
    expect(await screen.findByText('20 day(s) left')).toBeInTheDocument()
    expect(screen.getByText('Trial ends')).toBeInTheDocument()
    expect(screen.getByText(/2026/)).toBeInTheDocument()
  })
})
