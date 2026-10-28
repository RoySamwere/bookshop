import { api, tokenStore } from './api'

export type Permission =
  | 'workspace.access' | 'dashboard.view'
  | 'pos.access' | 'sales.view' | 'returns.process'
  | 'catalog.view' | 'catalog.manage' | 'inventory.view' | 'inventory.manage'
  | 'suppliers.view' | 'suppliers.manage' | 'customers.view' | 'customers.manage'
  | 'reports.view' | 'finance.view' | 'expenses.manage'
  | 'users.view' | 'users.manage' | 'branches.view' | 'branches.manage'
  | 'settings.view' | 'settings.manage' | 'audit.view'
  | 'storefront.access'

export type Role = 'system_owner' | 'admin' | 'store_manager' | 'cashier' | 'inventory_officer' | 'customer'
export type BranchSummary = { id: number; name: string; code: string; is_main?: boolean }

export type BookshopUser = {
  id: number; name: string; email: string; phone: string | null; role: Role; role_label: string; is_active: boolean
  permissions: Permission[]; assignable_roles: Role[]; branches: BranchSummary[]
}

const ROLE_LABELS: Record<string, string> = {
  system_owner: 'System Owner', admin: 'Administrator', store_manager: 'Store Manager',
  cashier: 'Cashier', inventory_officer: 'Inventory Officer', customer: 'Customer',
}
export const roleLabel = (role: string) => ROLE_LABELS[role] || role
export const hasPermission = (user: BookshopUser, permission: Permission) => user.permissions?.includes(permission) ?? false

export async function login(email: string, password: string) {
  const { data } = await api<{ data: { token: string; user: BookshopUser } }>('/auth/login', { method: 'POST', body: { email, password }, auth: false })
  tokenStore.set(data.token)
  return data.user
}

export async function getCurrentUser() {
  return (await api<{ data: BookshopUser }>('/auth/me')).data
}

export async function logout() {
  // Forget the token first so a quick next sign-in on this device is never cleared by this request.
  const token = tokenStore.get()
  tokenStore.clear()
  if (token) await api('/auth/logout', { method: 'POST', token })
}

export async function updateProfile(payload: { name: string; phone: string | null }) {
  return (await api<{ data: BookshopUser; message: string }>('/auth/profile', { method: 'PATCH', body: payload }))
}

export function changePassword(payload: { current_password: string; password: string; password_confirmation: string }) {
  return api<{ message: string }>('/auth/password', { method: 'PUT', body: payload })
}

export function requestPasswordReset(email: string) {
  return api<{ message: string }>('/auth/forgot-password', { method: 'POST', body: { email }, auth: false })
}

export function resetPassword(payload: { token: string; email: string; password: string; password_confirmation: string }) {
  return api<{ message: string }>('/auth/reset-password', { method: 'POST', body: payload, auth: false })
}
