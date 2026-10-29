import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import BookshopRegisterPage from '../../pages/register/bookshop/page'
import { homeFor, type BookshopUser } from '../../lib/auth'

const mocks = vi.hoisted(() => ({ registerBookshop: vi.fn() }))
vi.mock('../../lib/auth', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/auth')>(), registerBookshop: mocks.registerBookshop }))
beforeEach(() => mocks.registerBookshop.mockReset())

const base: BookshopUser = {
  id: 1, name: 'Wanjiru Kamau', email: 'w@example.com', phone: null, role: 'bookshop_owner', role_label: 'Bookshop Owner', is_active: true,
  account_type: 'bookshop', bookshop_id: 7, email_verified: true, staff_access_status: null, staff_access_note: null,
  permissions: ['workspace.access'], assignable_roles: [], branches: [],
  bookshop: { id: 7, name: 'Kamau Readers', slug: 'kamau-readers', status: 'active', business_email: null, phone: null, location: null, country: 'Kenya', currency: 'KES', timezone: 'Africa/Nairobi', verified_at: null, suspended_at: null, suspension_reason: null, is_owner: true, subscription: null },
}

describe('tenant-aware destinations', () => {
  it('sends each kind of account to its own area', () => {
    expect(homeFor(base)).toBe('/dashboard')
    expect(homeFor({ ...base, email_verified: false })).toBe('/onboarding/verify-email')
    expect(homeFor({ ...base, role: 'platform_owner', account_type: 'platform', bookshop: null, bookshop_id: null, permissions: ['platform.access'] })).toBe('/platform')
    expect(homeFor({ ...base, role: 'customer', account_type: 'customer', bookshop: null, permissions: ['storefront.access'] })).toBe('/account')
    // A platform account without the console permission is never sent into a workspace.
    expect(homeFor({ ...base, role: 'platform_admin', account_type: 'platform', bookshop: null, permissions: [] })).toBe('/account')
  })
})

describe('bookshop registration', () => {
  it('submits owner and bookshop details without any privilege fields and continues to verification', async () => {
    const user = userEvent.setup()
    mocks.registerBookshop.mockResolvedValue({ message: 'Created', data: { email: 'w@example.com', verification_email_sent: true, signed_in: true, next: '/onboarding/verify-email', bookshop: { id: 7, name: 'Kamau Readers', slug: 'kamau-readers', status: 'pending_verification' } } })
    render(<MemoryRouter initialEntries={['/register/bookshop']}><Routes>
      <Route path="/register/bookshop" element={<BookshopRegisterPage />} />
      <Route path="/onboarding/verify-email" element={<p>Verify step</p>} />
    </Routes></MemoryRouter>)

    await user.type(screen.getByRole('textbox', { name: 'Full name' }), 'Wanjiru Kamau')
    await user.type(screen.getByRole('textbox', { name: 'Email address' }), 'w@example.com')
    await user.type(screen.getByRole('textbox', { name: 'Your phone' }), '+254712000111')
    await user.type(document.getElementById('bookshop-password')!, 'Strong-pass1!')
    await user.type(document.getElementById('bookshop-confirm')!, 'Strong-pass1!')
    await user.type(screen.getByRole('textbox', { name: 'Bookshop name' }), 'Kamau Readers')
    await user.type(screen.getByRole('textbox', { name: 'Business phone' }), '+254201112222')
    await user.type(screen.getByRole('textbox', { name: 'Town or street' }), 'Nakuru')
    const country = screen.getByRole('combobox', { name: 'Country' })
    await user.clear(country)
    await user.type(country, 'Uganda')
    expect(screen.getByRole('textbox', { name: 'Currency' })).toHaveValue('UGX')
    await user.click(screen.getByRole('checkbox', { name: /I accept/ }))
    await user.click(screen.getByRole('button', { name: /Create my bookshop/ }))

    expect(await screen.findByText('Verify step')).toBeInTheDocument()
    expect(mocks.registerBookshop).toHaveBeenCalledWith({
      owner_name: 'Wanjiru Kamau', email: 'w@example.com', phone: '+254712000111', password: 'Strong-pass1!', password_confirmation: 'Strong-pass1!',
      bookshop_name: 'Kamau Readers', business_phone: '+254201112222', business_location: 'Nakuru', country: 'Uganda', currency: 'UGX', terms: true,
    })
  })
})
