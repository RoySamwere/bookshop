import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import LoginPage from '../../pages/login/page'
import RegisterPage from '../../pages/register/page'
import { ApiError } from '../../lib/api'

const mocks = vi.hoisted(() => ({ login: vi.fn(), register: vi.fn() }))
vi.mock('../../lib/auth', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/auth')>(), login: mocks.login, register: mocks.register }))
vi.mock('./auth-provider', () => ({ useAuth: () => ({ user: null, loading: false }) }))
beforeEach(() => { mocks.login.mockReset(); mocks.register.mockReset() })
describe('authentication forms', () => {
  it('validates login and routes a staff member to the requested section', async () => {
    const user = userEvent.setup()
    mocks.login.mockResolvedValue({ permissions: ['workspace.access'] })
    render(<MemoryRouter initialEntries={['/login?next=%2Fdashboard%3Fsection%3DUsers']}><Routes>
      <Route path="/login" element={<LoginPage />} /><Route path="/dashboard" element={<p>Staff dashboard</p>} />
    </Routes></MemoryRouter>)
    await user.click(screen.getByRole('button', { name: /^Sign in/ }))
    expect(mocks.login).not.toHaveBeenCalled()
    await user.type(screen.getByRole('textbox', { name: /Email address/ }), 'staff@example.com')
    await user.type(document.getElementById('login-password')!, 'Secret-1!')
    await user.click(screen.getByRole('button', { name: /^Sign in/ }))
    await screen.findByText('Staff dashboard')
    expect(mocks.login).toHaveBeenCalledWith('staff@example.com', 'Secret-1!', false)
  })
  it('shows backend login errors and allows another attempt', async () => {
    const user = userEvent.setup()
    mocks.login.mockRejectedValue(new ApiError('Incorrect credentials', 422, { email: ['The email or password is incorrect.'] }))
    render(<MemoryRouter><LoginPage /></MemoryRouter>)
    await user.type(screen.getByRole('textbox', { name: /Email address/ }), 'reader@example.com')
    await user.type(document.getElementById('login-password')!, 'wrong')
    await user.click(screen.getByRole('button', { name: /^Sign in/ }))
    await waitFor(() => expect(screen.getAllByText('The email or password is incorrect.').length).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: /^Sign in/ })).toBeEnabled()
  })
  it('submits registration to the real contract without privilege fields', async () => {
    const user = userEvent.setup()
    mocks.register.mockResolvedValue({ message: 'Check your email.', data: { email: 'mary@example.com', verification_email_sent: true, staff_access_status: 'pending' } })
    render(<MemoryRouter><RegisterPage /></MemoryRouter>)
    await user.type(screen.getByRole('textbox', { name: /Full name/ }), 'Mary Wanjiku')
    await user.type(screen.getByRole('textbox', { name: /Email address/ }), 'mary@example.com')
    await user.type(document.getElementById('register-password')!, 'Strong-pass1!')
    await user.type(document.getElementById('register-confirm')!, 'Strong-pass1!')
    await user.click(screen.getByRole('checkbox', { name: /need staff access/ }))
    await user.click(screen.getByRole('checkbox', { name: /I accept/ }))
    await user.click(screen.getByRole('button', { name: /Create account/ }))
    await screen.findByRole('heading', { name: 'Check your email' })
    expect(mocks.register).toHaveBeenCalledWith({ name: 'Mary Wanjiku', email: 'mary@example.com', phone: null, password: 'Strong-pass1!', password_confirmation: 'Strong-pass1!', terms: true, request_staff_access: true })
  })
})
