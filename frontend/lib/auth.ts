export type BookshopUser = { id: number; name: string; email: string; role: string }
export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:8000/api').replace(/\/$/, '')

export async function login(email: string, password: string): Promise<{ token: string; user: BookshopUser }> {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || data.errors?.email?.[0] || 'Unable to sign in.')
  return data
}

export async function getCurrentUser(token: string): Promise<BookshopUser> {
  const response = await fetch(`${API_BASE}/auth/me`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
  if (!response.ok) throw new Error('Session expired')
  const data = await response.json()
  return data.user
}

export async function logout(token: string): Promise<void> {
  await fetch(`${API_BASE}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })
}
