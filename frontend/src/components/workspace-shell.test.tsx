import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { WorkspaceShell } from './workspace-shell'
import type { BookshopUser, Role } from '../lib/auth'

vi.mock('../lib/workspace-api', () => ({ notificationsApi: { list: vi.fn(async () => ({ data: [], meta: { unread: 0 } })) } }))

const scrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
beforeEach(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
})
afterEach(() => {
  vi.unstubAllGlobals()
  if (scrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollTo)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
})

function mount(role: Role) {
  const user: BookshopUser = { id: 1, name: 'Test User', email: 'user@example.test', phone: null, role, role_label: role, is_active: true,
    account_type: 'bookshop', bookshop_id: 1, bookshop: null, email_verified: true, staff_access_status: null, staff_access_note: null,
    permissions: ['dashboard.view', 'settings.view'], assignable_roles: [], branches: [] }
  const navigate = vi.fn()
  render(<MemoryRouter initialEntries={['/dashboard']}><Routes>
    <Route path="/dashboard" element={<WorkspaceShell currentUser={user} active="Dashboard" onNavigate={navigate} onSignOut={vi.fn()}><h1>Dashboard</h1></WorkspaceShell>} />
    <Route path="/billing" element={<h1>Billing destination</h1>} />
  </Routes></MemoryRouter>)
  return navigate
}

describe('sidebar subscription billing', () => {
  it.each(['bookshop_owner', 'system_owner'] as const)('opens billing from the Admin sidebar for %s', async role => {
    const user = userEvent.setup()
    const navigate = mount(role)
    const admin = screen.getByRole('navigation', { name: 'Admin' })
    const link = within(admin).getByRole('link', { name: 'Subscription Billing' })
    expect(link).toHaveAttribute('href', '/billing')
    await user.click(link)
    expect(screen.getByRole('heading', { name: 'Billing destination' })).toBeInTheDocument()
    expect(navigate).not.toHaveBeenCalled()
  })

  it('opens billing from the mobile navigation drawer', async () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList)
    const user = userEvent.setup()
    mount('bookshop_owner')
    await user.click(screen.getByRole('button', { name: 'Open navigation' }))
    const drawer = screen.getByRole('dialog', { name: 'Main navigation' })
    await user.click(within(drawer).getByRole('link', { name: 'Subscription Billing' }))
    expect(screen.getByRole('heading', { name: 'Billing destination' })).toBeInTheDocument()
  })

  it.each(['cashier', 'inventory_officer', 'admin'] as const)('does not offer owner billing to %s', role => {
    mount(role)
    expect(screen.queryByRole('link', { name: 'Subscription Billing' })).not.toBeInTheDocument()
  })
})
