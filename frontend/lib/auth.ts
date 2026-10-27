export type Permission = 'workspace.access' | 'users.manage' | 'users.assign_roles' | 'settings.manage'
export type BookshopUser = { id: number; name: string; email: string; role: string; permissions: Permission[]; assignable_roles: string[] }
export const roleLabel = (role: string) => ({ system_owner: 'System Owner', admin: 'Administrator', user: 'User', staff: 'Staff' }[role] || role)
export const hasPermission = (user: BookshopUser, permission: Permission) => user.permissions?.includes(permission) ?? false
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

export type SystemUser = { id: number; name: string; email: string; role: string; created_at: string }

export async function listUsers(token: string): Promise<SystemUser[]> {
  const response = await fetch(`${API_BASE}/users`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Failed to load users.')
  return data.users
}

export async function createUser(
  token: string,
  payload: { name: string; email: string; password: string; password_confirmation: string; role: string },
): Promise<SystemUser> {
  const response = await fetch(`${API_BASE}/users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const firstError = data.errors ? Object.values(data.errors as Record<string, string[]>)[0][0] : data.message
    throw new Error(firstError || 'Failed to create user.')
  }
  return data.user
}

export async function deleteUser(token: string, id: number): Promise<void> {
  const response = await fetch(`${API_BASE}/users/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Failed to delete user.')
}

export async function updateUserRole(token: string, id: number, role: string): Promise<SystemUser> {
  const response = await fetch(`${API_BASE}/users/${id}/role`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ role }),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.message || 'Failed to update role.')
  return data.user
}
