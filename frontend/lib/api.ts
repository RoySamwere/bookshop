export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000/api').replace(/\/$/, '')
const TOKEN_KEY = 'bookshop_token'
const REQUEST_TIMEOUT_MS = 15000

/** Fired when the API rejects the stored token, so the app can return to the sign-in screen. */
export const UNAUTHORIZED_EVENT = 'bookshop:unauthorized'

export type FieldErrors = Record<string, string[]>
export type Paginated<T> = { data: T[]; meta: { current_page: number; last_page: number; per_page: number; total: number; from: number | null; to: number | null } }

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly errors: FieldErrors = {}) {
    super(message)
  }

  /** First validation message for a field, including nested keys such as `branch_ids.0`. */
  field(name: string): string | undefined {
    const key = Object.keys(this.errors).find(item => item === name || item.startsWith(`${name}.`))
    return key ? this.errors[key][0] : undefined
  }
}

// Normal sign-ins live for this browser tab only; "Remember me" keeps the token across tabs and restarts.
function storage(kind: 'session' | 'local'): Storage | null {
  try { return kind === 'session' ? window.sessionStorage : window.localStorage } catch { return null }
}

export const tokenStore = {
  get: () => {
    try { return storage('session')?.getItem(TOKEN_KEY) || storage('local')?.getItem(TOKEN_KEY) || null } catch { return null }
  },
  set: (token: string, remember = false) => {
    tokenStore.clear()
    try { storage(remember ? 'local' : 'session')?.setItem(TOKEN_KEY, token) } catch { /* Storage may be disabled. */ }
  },
  clear: () => {
    for (const kind of ['session', 'local'] as const) {
      try { storage(kind)?.removeItem(TOKEN_KEY) } catch { /* Storage may be disabled. */ }
    }
  },
}

type RequestOptions = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; query?: Record<string, string | number | boolean | undefined | null>; auth?: boolean; token?: string }

export async function api<T>(path: string, { method = 'GET', body, query, auth = true, token: explicitToken }: RequestOptions = {}): Promise<T> {
  const params = new URLSearchParams()
  Object.entries(query || {}).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') params.set(key, String(value)) })
  const search = params.toString()
  const url = `${API_BASE}${path}${search ? `?${search}` : ''}`
  const token = explicitToken ?? (auth ? tokenStore.get() : null)

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
    throw new ApiError(timedOut ? 'The server took too long to respond. Try again.' : 'Cannot reach the Bookshop server. Check that the backend is running.', 0)
  }

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    // Ignore 401s from an older session's requests; only the current token ending the session counts.
    if (response.status === 401 && token && token === tokenStore.get()) {
      tokenStore.clear()
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    const message = data.message && data.message !== 'The given data was invalid.' ? data.message : 'Please check the highlighted fields.'
    throw new ApiError(response.status >= 500 ? 'Something went wrong on the server. Try again shortly.' : message, response.status, data.errors || {})
  }
  return data as T
}

export const errorMessage = (error: unknown, fallback = 'Something went wrong.') => error instanceof Error ? error.message : fallback
