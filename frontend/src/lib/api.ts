export const API_BASE = (import.meta.env.VITE_API_URL || '/api/v1').replace(/\/$/, '')
const API_ORIGIN = API_BASE.replace(/\/api(?:\/v1)?$/, '')
export const IDLE_TIMEOUT_MS = 10 * 60 * 1000
export const UNAUTHORIZED_EVENT = 'bookshop:unauthorized'
export type FieldErrors = Record<string, string[]>
export type Paginated<T> = { data: T[]; meta: { current_page: number; last_page: number; per_page: number; total: number; from: number | null; to: number | null } }
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly errors: FieldErrors = {}) { super(message) }
  field(name: string) {
    const key = Object.keys(this.errors).find(item => item === name || item.startsWith(`${name}.`))
    return key ? this.errors[key][0] : undefined
  }
}

// Non-secret interaction metadata only. Authentication lives in HttpOnly cookies.
let sessionId: string | null = null
let lastActivity: number | null = null
let syncedActivity = 0
export const sessionStore = {
  get: () => sessionId,
  start: () => { sessionId = crypto.randomUUID(); lastActivity = Date.now(); syncedActivity = 0 },
  lastActivity: () => lastActivity,
  touch: (now = Date.now()) => { lastActivity = now },
  syncedActivity: () => syncedActivity,
  markActivitySynced: (timestamp: number) => { syncedActivity = Math.max(syncedActivity, timestamp) },
  clear: () => { sessionId = null; lastActivity = null; syncedActivity = 0 },
}
export function clearLegacyCredentials() {
  for (const kind of ['localStorage', 'sessionStorage'] as const) {
    try {
      for (const key of ['bookshop_token', 'bookshop_last_activity', 'bookshop_synced_activity']) window[kind].removeItem(key)
    } catch { /* Cookie auth works without browser storage. */ }
  }
}
function csrfToken() {
  const value = document.cookie.split('; ').find(cookie => cookie.startsWith('XSRF-TOKEN='))?.slice(11)
  return value ? decodeURIComponent(value) : null
}
let csrfRequest: Promise<void> | null = null
export async function ensureCsrfCookie() {
  if (csrfToken()) return
  if (!csrfRequest) csrfRequest = (async () => {
    let response: Response
    try {
      response = await fetch(`${API_ORIGIN}/sanctum/csrf-cookie`, { credentials: 'include', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) })
    } catch { throw new ApiError('Cannot reach the Bookshop server.', 0) }
    if (!response.ok) throw new ApiError('Unable to initialize a secure session. Refresh and try again.', response.status)
  })().finally(() => { csrfRequest = null })
  return csrfRequest
}
type RequestOptions = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; query?: Record<string, string | number | boolean | undefined | null>; auth?: boolean; legacy?: boolean }
export async function api<T>(path: string, { method = 'GET', body, query, auth = true, legacy = false }: RequestOptions = {}): Promise<T> {
  const params = new URLSearchParams()
  Object.entries(query || {}).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') params.set(key, String(value)) })
  const search = params.toString()
  const session = sessionStore.get()
  if (method !== 'GET') await ensureCsrfCookie()
  const csrf = csrfToken()
  let response: Response
  try {
    response = await fetch(`${legacy ? API_BASE.replace(/\/v1$/, '') : API_BASE}${path}${search ? `?${search}` : ''}`, {
      method, credentials: 'include',
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(csrf ? { 'X-XSRF-TOKEN': csrf } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000), keepalive: path === '/auth/logout',
    })
  } catch (error) {
    throw new ApiError(error instanceof DOMException && error.name === 'TimeoutError' ? 'The server took too long to respond. Try again.' : 'Cannot reach the Bookshop server. Check that the backend is running.', 0)
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (auth && session !== null && [401, 419].includes(response.status) && session === sessionStore.get()) {
      sessionStore.clear()
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail: { reason: data.reason } }))
    }
    const message = response.status === 419 ? 'Your secure session expired. Sign in again.' : data.message || 'Please check the highlighted fields.'
    throw new ApiError(response.status >= 500 ? 'Something went wrong on the server. Try again shortly.' : message, response.status, data.errors || {})
  }
  return data as T
}
export const errorMessage = (error: unknown, fallback = 'Something went wrong.') => error instanceof Error ? error.message : fallback
