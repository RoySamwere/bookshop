import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, clearLegacyCredentials, sessionStore, UNAUTHORIZED_EVENT } from './api'

const respond = (data: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data })
beforeEach(() => {
  sessionStore.clear()
  document.cookie = 'XSRF-TOKEN=; Max-Age=0; path=/'
})
afterEach(() => vi.unstubAllGlobals())

describe('cookie API client', () => {
  it('initializes CSRF before login and sends credentials and a decoded CSRF header', async () => {
    const fetcher = vi.fn().mockImplementationOnce(async () => {
      document.cookie = 'XSRF-TOKEN=encoded%2Bcsrf; path=/'
      return respond({}, 204)
    }).mockResolvedValueOnce(respond({ data: { user: { id: 1 } } }))
    vi.stubGlobal('fetch', fetcher)
    await api('/auth/login', { method: 'POST', body: { email: 'test@example.com' }, auth: false })
    expect(fetcher.mock.calls[0][0]).toBe('/sanctum/csrf-cookie')
    const [url, options] = fetcher.mock.calls[1]
    expect(url).toBe('/api/v1/auth/login')
    expect(options.credentials).toBe('include')
    expect(options.headers['X-XSRF-TOKEN']).toBe('encoded+csrf')
    expect(options.headers.Authorization).toBeUndefined()
  })
  it('preserves nested server validation messages', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({ message: 'Invalid', errors: { 'items.0.quantity': ['Insufficient stock'] } }, 422)))
    await expect(api('/pos/products')).rejects.toSatisfy((error: ApiError) => error.field('items') === 'Insufficient stock')
  })
  it.each([401, 419])('expires the active session on HTTP %s', async status => {
    sessionStore.start()
    const expired = vi.fn()
    window.addEventListener(UNAUTHORIZED_EVENT, expired)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(respond({}, status)))
    await expect(api('/auth/me')).rejects.toBeInstanceOf(ApiError)
    expect(sessionStore.get()).toBeNull()
    expect(expired).toHaveBeenCalledOnce()
    window.removeEventListener(UNAUTHORIZED_EVENT, expired)
  })
  it('does not destroy a newer session when an older request fails', async () => {
    sessionStore.start()
    let finish!: (value: unknown) => void
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finish = resolve })))
    const request = api('/auth/me')
    sessionStore.start()
    const newer = sessionStore.get()
    finish(respond({}, 401))
    await expect(request).rejects.toBeInstanceOf(ApiError)
    expect(sessionStore.get()).toBe(newer)
  })
  it('preserves signed email link paths and encodes filters', async () => {
    const fetcher = vi.fn().mockResolvedValue(respond({}))
    vi.stubGlobal('fetch', fetcher)
    await api('/auth/email/verify/1/hash', { legacy: true, auth: false, query: { signature: 'a+b', empty: '', omitted: undefined } })
    expect(fetcher.mock.calls[0][0]).toBe('/api/auth/email/verify/1/hash?signature=a%2Bb')
  })
  it('maps connectivity failures without losing the active session', async () => {
    sessionStore.start()
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network error')))
    await expect(api('/auth/me')).rejects.toMatchObject({ status: 0 })
    expect(sessionStore.get()).not.toBeNull()
  })
  it('removes legacy credentials from both storage locations', () => {
    for (const store of [localStorage, sessionStorage]) store.setItem('bookshop_token', 'old-secret')
    clearLegacyCredentials()
    expect(localStorage.getItem('bookshop_token')).toBeNull()
    expect(sessionStorage.getItem('bookshop_token')).toBeNull()
    sessionStore.start()
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
})
