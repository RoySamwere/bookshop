import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sessionStore, UNAUTHORIZED_EVENT } from './api'
import { sessionLoginUrl, startSessionMonitor } from './session'

const mocks = vi.hoisted(() => ({ api: vi.fn().mockResolvedValue({}), logout: vi.fn().mockResolvedValue({}) }))
vi.mock('./auth', () => ({ logout: mocks.logout }))
vi.mock('./api', async importOriginal => ({ ...await importOriginal<typeof import('./api')>(), api: mocks.api }))
let stop: (() => void) | undefined
beforeEach(() => {
  vi.useFakeTimers()
  sessionStore.start()
  sessionStore.markActivitySynced(Date.now())
  mocks.api.mockClear(); mocks.logout.mockClear()
})
afterEach(() => { stop?.(); vi.useRealTimers(); sessionStore.clear() })
describe('session monitor', () => {
  it('expires at ten minutes and asks the server to invalidate the cookie', async () => {
    const expired = vi.fn()
    stop = startSessionMonitor(expired)
    await vi.advanceTimersByTimeAsync(599_999)
    expect(expired).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(expired).toHaveBeenCalledExactlyOnceWith('idle')
    expect(mocks.logout).toHaveBeenCalledOnce()
  })
  it('does not send activity for background polling', async () => {
    stop = startSessionMonitor(vi.fn())
    await vi.advanceTimersByTimeAsync(300_000)
    expect(mocks.api).not.toHaveBeenCalled()
    sessionStore.touch()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.api).toHaveBeenCalledExactlyOnceWith('/auth/activity', { method: 'POST' })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.api).toHaveBeenCalledOnce()
  })
  it('detects sleep/wake without reviving an expired session', () => {
    const expired = vi.fn()
    stop = startSessionMonitor(expired)
    vi.setSystemTime(Date.now() + 600_001)
    window.dispatchEvent(new Event('focus'))
    expect(expired).toHaveBeenCalledWith('idle')
  })
  it('handles server expiry once and cleans up timers', async () => {
    const expired = vi.fn()
    stop = startSessionMonitor(expired)
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
    window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
    expect(expired).toHaveBeenCalledExactlyOnceWith('expired')
    stop()
    await vi.advanceTimersByTimeAsync(900_000)
    expect(expired).toHaveBeenCalledOnce()
  })
  it('preserves the complete return path', () => {
    const url = new URL(sessionLoginUrl('idle', { pathname: '/dashboard', search: '?section=Inventory', hash: '#levels' }), 'https://bookshop.test')
    expect(url.searchParams.get('next')).toBe('/dashboard?section=Inventory#levels')
  })
})
