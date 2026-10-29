import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import PlatformPage from '../../pages/platform/page'
import { ProtectedRoute } from '../../routes/protected-route'
import { WorkspaceShell } from '../../components/workspace-shell'
import type { BookshopUser } from '../../lib/auth'

const mocks = vi.hoisted(() => ({ user: null as BookshopUser | null, enter: vi.fn(), leave: vi.fn(), create: vi.fn(), list: vi.fn() }))
vi.mock('./auth-provider', () => ({ useAuth: () => ({ user: mocks.user, loading: false, error: null }) }))
vi.mock('../../lib/tenancy-api', async original => ({ ...await original<typeof import('../../lib/tenancy-api')>(), enterBookshopManagement: mocks.enter, returnToPlatform: mocks.leave,
  platformApi: { managedBookshops: mocks.list, createBookshop: mocks.create } }))
vi.mock('../../lib/workspace-api', async original => ({ ...await original<typeof import('../../lib/workspace-api')>(), notificationsApi: { list: async () => ({ data: [], meta: { unread: 0 } }) } }))

const permissions: BookshopUser['permissions'] = ['platform.access', 'platform.bookshops.onboard', 'platform.bookshops.view', 'workspace.access', 'dashboard.view', 'catalog.view', 'inventory.view', 'suppliers.view', 'pos.access', 'sales.view', 'customers.view', 'users.view', 'branches.view', 'settings.view', 'reports.view', 'audit.view']
const owner = { id: 1, name: 'Roy Sam', role: 'platform_owner', account_type: 'platform', role_label: 'Platform Owner', permissions, branches: [], bookshop_id: null, bookshop: null, email_verified: true, is_active: true } as unknown as BookshopUser

beforeEach(() => {
  mocks.user = { ...owner }; mocks.enter.mockReset().mockResolvedValue(undefined); mocks.leave.mockReset().mockResolvedValue(undefined); mocks.create.mockReset(); mocks.list.mockReset().mockResolvedValue([{ id: 7, name: 'Hekima Bookshop', status: 'active' }])
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })) })
  Element.prototype.scrollTo = vi.fn()
})

function mount(path: string) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/platform/*" element={<PlatformPage />} />
    <Route element={<ProtectedRoute permission="workspace.access" />}><Route path="/dashboard" element={<WorkspaceShell currentUser={mocks.user!} active="Dashboard" onNavigate={vi.fn()} onSignOut={vi.fn()}><p>Original workspace</p></WorkspaceShell>} /></Route>
  </Routes></MemoryRouter></QueryClientProvider>)
}

it('lists only authorized bookshops and uses explicit entry', async () => {
  mount('/platform/management')
  await userEvent.click(await screen.findByRole('button', { name: 'Open bookshop workspace' }))
  expect(mocks.enter).toHaveBeenCalledWith(7, expect.anything())
  expect(mocks.list).toHaveBeenCalled()
})

it('restores the original workspace modules and provides Return to Platform', async () => {
  mocks.user = { ...owner, management_context: { bookshop_id: 7, return_to: '/platform' }, bookshop_id: 7, bookshop: { id: 7, name: 'Hekima Bookshop', is_owner: true, status: 'active' } as BookshopUser['bookshop'] }
  mount('/dashboard')
  expect(screen.getByText('Original workspace')).toBeInTheDocument()
  const navigation = screen.getByLabelText('Main navigation')
  for (const name of ['Products & books', 'Inventory', 'Suppliers', 'Point of sale', 'Sales history', 'Customers', 'Users', 'Settings', 'Reports']) {
    expect(within(navigation).getByRole('button', { name: new RegExp(name, 'i') })).toBeInTheDocument()
  }
  await userEvent.click(screen.getByRole('button', { name: 'Return to Platform' }))
  expect(mocks.leave).toHaveBeenCalledOnce()
})

it('redirects an unmanaged platform owner away from direct tenant navigation', async () => {
  mount('/dashboard')
  expect(await screen.findByRole('link', { name: 'Bookshop Management' })).toBeInTheDocument()
  expect(screen.queryByText('Original workspace')).not.toBeInTheDocument()
})

it('does not expose bookshop management to platform administrators', async () => {
  mocks.user = { ...owner, role: 'platform_admin' }
  mount('/platform/management')
  expect(screen.getByText('Access restricted')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Open bookshop workspace' })).not.toBeInTheDocument()
  expect(mocks.list).not.toHaveBeenCalled()
})

it('lets platform administrators create a shop through the authenticated endpoint', async () => {
  mocks.user = { ...owner, role: 'platform_admin' }
  mocks.create.mockRejectedValue(new Error('Stop after verifying submission'))
  mount('/platform/bookshops/new')
  const user = userEvent.setup()
  for (const [name, value] of [['Full name', 'New Owner'], ['Email address', 'owner@new.test'], ['Your phone', '+254712345678'], ['Bookshop name', 'New Shop'], ['Business phone', '+254712345678'], ['Town or street', 'Nairobi']]) {
    await user.type(screen.getByRole('textbox', { name }), value)
  }
  await user.type(document.getElementById('bookshop-password')!, 'Strong-pass1!')
  await user.type(document.getElementById('bookshop-confirm')!, 'Strong-pass1!')
  await user.click(screen.getByRole('checkbox', { name: /I accept/ }))
  await user.click(screen.getByRole('button', { name: 'Create bookshop' }))
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ email: 'owner@new.test', bookshop_name: 'New Shop' }))
  expect(await screen.findByText('Stop after verifying submission')).toBeInTheDocument()
})
