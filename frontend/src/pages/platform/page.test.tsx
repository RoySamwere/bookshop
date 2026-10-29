import { expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '../../features/auth/auth-provider'
import { ProtectedRoute } from '../../routes/protected-route'
import PlatformPage from './page'

vi.mock('../../lib/auth', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/auth')>(),
  getCurrentUser: vi.fn(async () => ({ id: 1, name: 'Original administrator', role: 'platform_owner', role_label: 'Platform Owner', account_type: 'platform', bookshop: null, bookshop_id: null, email_verified: true,
    permissions: ['platform.access', 'platform.bookshops.view', 'platform.users.view', 'platform.plans.view', 'platform.settings.view', 'platform.audit.view'] })),
}))
vi.mock('../../lib/tenancy-api', async importOriginal => ({
  ...await importOriginal<typeof import('../../lib/tenancy-api')>(),
  platformApi: {
    overview: vi.fn(async () => ({ bookshops: { total: 0, active: 0, pending_verification: 0, suspended: 0, registered_last_30_days: 0 }, subscriptions: { trialing: 0 }, users: { bookshop_staff: 0, platform_staff: 1, unassigned_legacy_staff: 0 }, recent_bookshops: [] })),
    plans: vi.fn(async () => [{ id: 1, name: 'Starter', description: 'Starter plan', price: '0.00', currency: 'KES', billing_interval: 'monthly', trial_days: 14, is_active: true }]),
  },
}))

it.each(['/platform', '/dashboard', '/dashboard/catalog'])('restores a session at %s and renders the platform console', async path => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter initialEntries={[path]}><AuthProvider><Routes>
    <Route element={<ProtectedRoute permission="platform.access" />}><Route path="/platform/*" element={<PlatformPage />} /></Route>
    <Route element={<ProtectedRoute permission="workspace.access" />}><Route path="/dashboard/*" element={<p>Tenant workspace</p>} /></Route>
  </Routes></AuthProvider></MemoryRouter></QueryClientProvider>)
  expect(await screen.findByRole('heading', { name: 'Platform overview' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Subscription plans' })).toBeInTheDocument()
  expect(screen.queryByText('Not linked to a bookshop')).not.toBeInTheDocument()
  expect(screen.queryByText('Tenant workspace')).not.toBeInTheDocument()
})

it('opens the subscription plan overview directly after session restoration', async () => {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter initialEntries={['/platform/plans']}><AuthProvider><Routes><Route path="/platform/*" element={<PlatformPage />} /></Routes></AuthProvider></MemoryRouter></QueryClientProvider>)
  expect(await screen.findByText('Starter')).toBeInTheDocument()
  expect(screen.getByText('KES 0.00 / monthly')).toBeInTheDocument()
})
