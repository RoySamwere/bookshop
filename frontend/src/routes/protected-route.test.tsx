import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { ProtectedRoute } from './protected-route'
import { ApiError } from '../lib/api'

const state = vi.hoisted(() => ({ user: null as null | { permissions: string[]; account_type?: string }, loading: false, error: null as Error | null, retry: vi.fn() }))
vi.mock('../features/auth/auth-provider', () => ({ useAuth: () => state }))
function Login() { return <p>Login destination: {useLocation().search}</p> }
function mount() {
  render(<MemoryRouter initialEntries={['/dashboard?section=Users']}><Routes>
    <Route path="/login" element={<Login />} />
    <Route path="/platform" element={<p>Platform console</p>} />
    <Route element={<ProtectedRoute permission="users.view" />}><Route path="/dashboard" element={<p>Team directory</p>} /></Route>
  </Routes></MemoryRouter>)
}
describe('permission routes', () => {
  it('redirects a restored platform session from a direct dashboard URL before checking tenant permissions', () => {
    state.user = { account_type: 'platform', permissions: ['platform.access'] }; state.error = null; mount()
    expect(screen.getByText('Platform console')).toBeInTheDocument()
    expect(screen.queryByText('Not linked to a bookshop')).not.toBeInTheDocument()
  })
  it('redirects guests and preserves the return path', () => {
    state.user = null; state.error = null; mount()
    expect(screen.getByText(/Login destination/)).toHaveTextContent('next=%2Fdashboard%3Fsection%3DUsers')
  })
  it('blocks an authenticated user without permission', () => {
    state.user = { permissions: ['workspace.access'] }; mount()
    expect(screen.getByRole('heading', { name: 'Access restricted' })).toBeInTheDocument()
    expect(screen.queryByText('Team directory')).not.toBeInTheDocument()
  })
  it('renders the protected page for an authorized user', () => {
    state.user = { permissions: ['users.view'] }; mount()
    expect(screen.getByText('Team directory')).toBeInTheDocument()
  })
  it('keeps a recoverable connection failure distinct from signed out', () => {
    state.user = null; state.error = new ApiError('Offline', 0); mount()
    expect(screen.getByRole('alert')).toHaveTextContent('Offline')
    expect(screen.getByRole('button', { name: 'Retry connection' })).toBeInTheDocument()
    state.error = null
  })
})
