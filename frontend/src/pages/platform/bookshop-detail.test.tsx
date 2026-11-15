import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import BookshopDetailView from './bookshop-detail'
import { SuspendedNotice } from '../../components/onboarding'
import { platformApi, type PlatformBookshopDetails } from '../../lib/tenancy-api'
import { billingApi, billsApi, trialApi } from '../../lib/billing-api'
import { communicationApi } from '../../lib/communication-api'

const owner = { role: 'platform_owner', account_type: 'platform', permissions: ['platform.access', 'platform.bookshops.view', 'platform.bookshops.onboard', 'platform.bookshops.suspend', 'platform.settings.view', 'platform.settings.manage', 'platform.audit.view', 'platform.subscriptions.extend_trial', 'platform.communications.manage'] }
const auth = vi.hoisted(() => ({ user: {} as Record<string, unknown> }))
vi.mock('../../features/auth/auth-provider', () => ({ useAuth: () => auth }))
vi.mock('../../lib/tenancy-api', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/tenancy-api')>(),
  platformApi: { bookshop: vi.fn(), bookshopUsers: vi.fn(), setBookshopUserStatus: vi.fn(), changePlan: vi.fn(), renewalInvoice: vi.fn(), plans: vi.fn(), audit: vi.fn(), approve: vi.fn(), suspend: vi.fn(), reactivate: vi.fn(), updateBookshop: vi.fn(), resendOwnerVerification: vi.fn(), bookshops: vi.fn() } }))
vi.mock('../../lib/billing-api', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/billing-api')>(),
  billingApi: { invoices: vi.fn() }, billsApi: { list: vi.fn(), health: vi.fn() }, trialApi: { subscriptions: vi.fn(), history: vi.fn(), extend: vi.fn() } }))
vi.mock('../../lib/communication-api', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/communication-api')>(),
  communicationApi: { logs: vi.fn(), retry: vi.fn(), audience: vi.fn(), announce: vi.fn() } }))

const page = <T,>(data: T[]) => ({ data, current_page: 1, last_page: 1, total: data.length })
const shop: PlatformBookshopDetails = {
  id: 3, name: 'Kisumu Readers', slug: 'kisumu-readers', status: 'active', business_email: 'shop@example.test', phone: '+254700000000', location: 'Kisumu', country: 'Kenya',
  currency: 'KES', timezone: 'Africa/Nairobi', verified_at: '2026-11-01T08:00:00Z', suspended_at: null, suspension_reason: null, registered_at: '2026-11-01T07:00:00Z',
  owner: { id: 10, name: 'Achieng Otieno', email: 'owner@example.test', email_verified: true, phone: null, last_login_at: null }, branches_count: 1, staff_count: 2,
  subscription: { status: 'trialing', plan: { code: 'starter', name: 'Starter' }, trial_ends_at: '2026-11-20T08:00:00Z', trial_days_left: 5, days_remaining: 5, current_period_ends_at: null },
  subscription_history: [{ event: 'trial_started', from_status: null, to_status: 'trialing', note: '14-day trial', created_at: '2026-11-01T07:00:00Z' }],
  history: [{ id: 1, action: 'platform.bookshop_approved', description: 'Approved Kisumu Readers', metadata: null, ip_address: null, subject_type: null, subject_id: null, user: null, created_at: '2026-11-01T08:00:00Z' }],
}
const users = [
  { id: 10, name: 'Achieng Otieno', email: 'owner@example.test', phone: null, role: 'bookshop_owner' as const, role_label: 'Bookshop Owner', is_active: true, is_owner: true, email_verified: true, last_login_at: null, created_at: null },
  { id: 11, name: 'Brian Cashier', email: 'cashier@example.test', phone: null, role: 'cashier' as const, role_label: 'Cashier', is_active: true, is_owner: false, email_verified: true, last_login_at: null, created_at: null },
]

function mount(path = '/platform/bookshops/3') {
  return render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <Routes><Route path="/platform/bookshops/:id/*" element={<BookshopDetailView />} /></Routes></QueryClientProvider></MemoryRouter>)
}

beforeEach(() => {
  vi.resetAllMocks()
  auth.user = owner
  vi.mocked(platformApi.bookshop).mockResolvedValue(shop)
  vi.mocked(platformApi.bookshopUsers).mockResolvedValue(users)
  vi.mocked(platformApi.plans).mockResolvedValue([{ id: 1, name: 'Starter', description: null, price: '0.00', currency: 'KES', billing_interval: 'monthly', trial_days: 14, is_active: true },
    { id: 2, name: 'Monthly', description: null, price: '1500.00', currency: 'KES', billing_interval: 'monthly', trial_days: 0, is_active: true }])
  vi.mocked(platformApi.audit).mockResolvedValue({ data: shop.history, meta: { current_page: 1, last_page: 1, per_page: 25, total: 1, from: 1, to: 1 } })
  vi.mocked(billingApi.invoices).mockResolvedValue(page([]))
  vi.mocked(billsApi.list).mockResolvedValue({ ...page([]), from: null, to: null, summary: null as never })
  vi.mocked(trialApi.subscriptions).mockResolvedValue({ ...page([]), max_days: 90 })
  vi.mocked(communicationApi.logs).mockResolvedValue(page([]))
})

describe('Bookshop workspace', () => {
  it('organises the bookshop into deep-linkable tabs', async () => {
    mount()
    expect(await screen.findByRole('heading', { name: 'Kisumu Readers' })).toBeInTheDocument()
    const tabs = screen.getByRole('navigation', { name: 'Bookshop sections' })
    for (const [name, href] of [['Overview', '/platform/bookshops/3'], ['Subscription & billing', '/platform/bookshops/3/billing'], ['Users', '/platform/bookshops/3/users'], ['Activity', '/platform/bookshops/3/activity'], ['Communication', '/platform/bookshops/3/communication'], ['Settings', '/platform/bookshops/3/settings']]) {
      expect(within(tabs).getByRole('link', { name })).toHaveAttribute('href', href)
    }
    expect(await screen.findByText('Access ends in 5 day(s)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Suspend' })).toBeInTheDocument()
  })

  it('deactivates a staff account only after confirmation and never offers it for the owner', async () => {
    vi.mocked(platformApi.setBookshopUserStatus).mockResolvedValue({ message: 'Brian Cashier has been deactivated and signed out.', data: { ...users[1], is_active: false } })
    const user = userEvent.setup(); mount('/platform/bookshops/3/users')
    const cashierRow = (await screen.findByText('Brian Cashier')).closest('tr')!
    expect(within(screen.getByText('Achieng Otieno').closest('tr')!).queryByRole('button')).not.toBeInTheDocument()
    await user.click(within(cashierRow).getByRole('button', { name: 'Deactivate' }))
    expect(platformApi.setBookshopUserStatus).not.toHaveBeenCalled()
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Deactivate user' }))
    expect(platformApi.setBookshopUserStatus).toHaveBeenCalledWith(3, 11, false)
    expect(await screen.findByText('Brian Cashier has been deactivated and signed out.')).toBeInTheDocument()
  })

  it('changes the plan for future renewals through a confirmation dialog', async () => {
    vi.mocked(platformApi.changePlan).mockResolvedValue({ message: 'Kisumu Readers will renew on Monthly.', data: shop.subscription! })
    const user = userEvent.setup(); mount('/platform/bookshops/3/billing')
    await user.click(await screen.findByRole('button', { name: 'Change plan' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByLabelText('Current plan')).toHaveValue('Starter')
    await user.selectOptions(within(dialog).getByLabelText('New plan'), '2')
    await user.click(within(dialog).getByRole('button', { name: 'Change plan' }))
    expect(platformApi.changePlan).toHaveBeenCalledWith(3, 2)
    expect(await screen.findByText('Kisumu Readers will renew on Monthly.')).toBeInTheDocument()
  })

  it('requires a reason before suspending', async () => {
    vi.mocked(platformApi.suspend).mockResolvedValue({ message: 'Kisumu Readers has been suspended.', data: { ...shop, status: 'suspended' } })
    const user = userEvent.setup(); mount('/platform/bookshops/3/settings')
    await user.click(await screen.findByRole('button', { name: 'Suspend bookshop' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Users can still sign in/)).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Suspend bookshop' }))
    expect(platformApi.suspend).not.toHaveBeenCalled()
    await user.type(within(dialog).getByLabelText(/Reason/), 'Billing review')
    await user.click(within(dialog).getByRole('button', { name: 'Suspend bookshop' }))
    expect(platformApi.suspend).toHaveBeenCalledWith(3, 'Billing review')
  })

  it('shows platform administrators a read-only workspace', async () => {
    auth.user = { role: 'platform_admin', account_type: 'platform', permissions: ['platform.access', 'platform.bookshops.view', 'platform.bookshops.onboard', 'platform.settings.view', 'platform.audit.view'] }
    const user = userEvent.setup(); mount('/platform/bookshops/3/users')
    expect(await screen.findByText('Brian Cashier')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Communication' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Subscription & billing' }))
    expect(await screen.findByText('Trial started')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change plan' })).not.toBeInTheDocument()
  })
})

describe('Suspension notice', () => {
  it('is polite, keeps records safe and names the support contact', () => {
    render(<SuspendedNotice reason="Billing review" supportEmail="help@hekima.test" />)
    expect(screen.getByRole('heading', { name: 'Your bookshop is temporarily unavailable' })).toBeInTheDocument()
    expect(screen.getByText(/safe and unchanged/)).toBeInTheDocument()
    expect(screen.getByText('Billing review')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'help@hekima.test' })).toHaveAttribute('href', 'mailto:help@hekima.test')
  })
})
