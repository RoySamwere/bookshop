import { beforeEach, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SessionManager } from './session-manager'

const state = vi.hoisted(() => ({ user: { id: 1 } as { id: number } | null, monitor: vi.fn(), stop: vi.fn() }))
vi.mock('../features/auth/auth-provider', () => ({ useAuth: () => ({ user: state.user }) }))
vi.mock('../lib/session', async original => ({ ...await original<typeof import('../lib/session')>(), startSessionMonitor: state.monitor }))

beforeEach(() => { state.user = { id: 1 }; state.stop.mockReset(); state.monitor.mockReset().mockReturnValue(state.stop) })

it.each(['/platform', '/platform/bookshops', '/platform/bookshops/7', '/platform/settings', '/platform/audit', '/dashboard', '/dashboard/catalog', '/account'])('monitors activity on authenticated %s', path => {
  const { unmount } = render(<MemoryRouter initialEntries={[path]}><SessionManager /></MemoryRouter>)
  expect(state.monitor).toHaveBeenCalledOnce()
  expect(state.monitor).toHaveBeenCalledWith(expect.any(Function))
  unmount()
  expect(state.stop).toHaveBeenCalledOnce()
})

it.each(['/login', '/', '/register', '/platform-public'])('does not start protected-session monitoring on %s', path => {
  render(<MemoryRouter initialEntries={[path]}><SessionManager /></MemoryRouter>)
  expect(state.monitor).not.toHaveBeenCalled()
})

it('waits for the authenticated user before starting the platform heartbeat', () => {
  state.user = null
  render(<MemoryRouter initialEntries={['/platform']}><SessionManager /></MemoryRouter>)
  expect(state.monitor).not.toHaveBeenCalled()
})
