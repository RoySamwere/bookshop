import { api, sessionStore } from './api'
import { queryClient } from '../app/query-client'

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

export type StaffAccessStatus = 'pending' | 'approved' | 'rejected' | null

export type BookshopUser = {
  bookshop_id: number | null
  id: number; name: string; email: string; phone: string | null; role: Role; role_label: string; is_active: boolean
  email_verified: boolean; staff_access_status: StaffAccessStatus; staff_access_note: string | null
  permissions: Permission[]; assignable_roles: Role[]; branches: BranchSummary[]
}

const ROLE_LABELS: Record<string, string> = {
  system_owner: 'System Owner', admin: 'Administrator', store_manager: 'Store Manager',
  cashier: 'Cashier', inventory_officer: 'Inventory Officer', customer: 'Customer',
}
export const roleLabel = (role: string) => ROLE_LABELS[role] || role
export const hasPermission = (user: BookshopUser, permission: Permission) => user.permissions?.includes(permission) ?? false

export async function login(email: string, password: string, remember = false) {
  const { data } = await api<{ data: { user: BookshopUser } }>('/auth/login', { method: 'POST', body: { email, password, remember }, auth: false })
  sessionStore.start()
  await queryClient.cancelQueries({ queryKey: ['auth', 'me'] })
  queryClient.setQueryData(['auth', 'me'], data.user)
  return data.user
}

/** Where a signed-in account belongs: staff go to the management system, everyone else to their account page. */
export const homeFor = (user: BookshopUser) => hasPermission(user, 'workspace.access') ? '/dashboard' : '/account'

/** Only follow same-site paths after sign-in, never another host. */
export function safeNextPath(next: string | null) {
  return next && next.startsWith('/') && !next.startsWith('//') && !/[\\\u0000-\u001f\u007f]/.test(next) ? next : null
}

export type RegisterPayload = { name: string; email: string; phone: string | null; password: string; password_confirmation: string; terms: boolean; request_staff_access: boolean }

export function register(payload: RegisterPayload) {
  return api<{ message: string; data: { email: string; verification_email_sent: boolean; staff_access_status: StaffAccessStatus } }>('/auth/register', { method: 'POST', body: payload, auth: false })
}

export type VerificationLink = { id: string; hash: string; expires: string; signature: string }

export function verifyEmail(link: VerificationLink) {
  return api<{ message: string; status: 'verified' | 'already_verified' }>(`/auth/email/verify/${encodeURIComponent(link.id)}/${encodeURIComponent(link.hash)}`, {
    // Existing signed links include /api in their signature. Preserve that canonical path.
    query: { expires: link.expires, signature: link.signature }, auth: false, legacy: true,
  })
}

export function resendVerification(email: string) {
  return api<{ message: string }>('/auth/email/resend', { method: 'POST', body: { email }, auth: false })
}

export function resendMyVerification() {
  return api<{ message: string }>('/auth/email/verification-notification', { method: 'POST' })
}

export async function getCurrentUser() {
  const user = (await api<{ data: BookshopUser }>('/auth/me')).data
  if (!sessionStore.get()) sessionStore.start()
  return user
}

export async function logout() {
  try {
    await api('/auth/logout', { method: 'POST' })
  } catch (error) {
    if (!(error instanceof Error && 'status' in error && [401, 419].includes(Number(error.status)))) throw error
  }
  sessionStore.clear()
  queryClient.removeQueries({ predicate: query => query.queryKey[0] !== 'auth' })
  queryClient.setQueryData(['auth', 'me'], null)
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
