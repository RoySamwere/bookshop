import { api, type Paginated } from './api'
import type { BranchSummary, Permission, Role } from './auth'

export type TeamMember = {
  id: number; name: string; email: string; phone: string | null; role: Role; role_label: string; is_active: boolean
  last_login_at: string | null; created_at: string; branches: BranchSummary[]; can_manage: boolean; can_review: boolean
  email_verified: boolean; email_verified_at: string | null; registration_source: 'public' | 'bookshop_registration' | 'invitation' | null
  staff_access_status: 'pending' | 'approved' | 'rejected' | null; staff_access_requested_at: string | null
  staff_access_reviewed_at: string | null; staff_access_note: string | null
}
export type UserCounts = { active: number; inactive: number; pending: number; unverified: number }
export type RoleInfo = { value: Role; label: string; description: string; permissions: Permission[]; uses_branches: boolean; assignable: boolean }
export type Branch = { id: number; name: string; code: string; email: string | null; phone: string | null; address: string | null; city: string | null; is_main: boolean; is_active: boolean; users_count?: number }
export type TaxRate = { id: number; name: string; code: string; rate: string; is_default: boolean; is_active: boolean }
export type BusinessProfile = {
  name: string; legal_name: string | null; kra_pin: string | null; email: string | null; phone: string | null; website: string | null
  address: string | null; city: string | null; country: string; currency: string; timezone: string; prices_include_tax: boolean
  receipt_prefix: string; receipt_header: string | null; receipt_footer: string | null; low_stock_threshold: number
  default_tax: Pick<TaxRate, 'id' | 'name' | 'code' | 'rate'> | null
}
export type AuditEntry = { id: number; action: string; description: string; metadata: Record<string, unknown> | null; ip_address: string | null; subject_type: string | null; subject_id: number | null; user: { id: number; name: string; email: string; role: Role } | null; created_at: string }
export type AppNotification = { id: string; title: string; body: string; level: 'info' | 'warning' | 'success'; section: string | null; read_at: string | null; created_at: string }

type Saved<T> = { data: T; message: string }
export type UserPayload = { name?: string; email?: string; phone?: string | null; role?: Role; branch_ids?: number[]; password?: string; password_confirmation?: string }

export const usersApi = {
  list: (query: { search?: string; role?: string; status?: string; branch_id?: number | string; page?: number; per_page?: number }) => api<Paginated<TeamMember> & { counts: UserCounts }>('/users', { query }),
  create: (body: UserPayload) => api<Saved<TeamMember>>('/users', { method: 'POST', body }),
  update: (id: number, body: UserPayload) => api<Saved<TeamMember>>(`/users/${id}`, { method: 'PATCH', body }),
  setStatus: (id: number, is_active: boolean) => api<Saved<TeamMember>>(`/users/${id}/status`, { method: 'PATCH', body: { is_active } }),
  resetPassword: (id: number, password: string, password_confirmation: string) => api<{ message: string }>(`/users/${id}/reset-password`, { method: 'POST', body: { password, password_confirmation } }),
  remove: (id: number) => api<{ message: string }>(`/users/${id}`, { method: 'DELETE' }),
  roles: async () => (await api<{ data: RoleInfo[] }>('/roles')).data,
  approve: (id: number, body: { role: Role; branch_ids: number[] }) => api<Saved<TeamMember>>(`/users/${id}/approve`, { method: 'POST', body }),
  reject: (id: number, note: string) => api<Saved<TeamMember>>(`/users/${id}/reject`, { method: 'POST', body: { note: note || null } }),
  resendVerification: (id: number) => api<{ message: string }>(`/users/${id}/resend-verification`, { method: 'POST' }),
  history: async (id: number) => (await api<{ data: AuditEntry[] }>(`/users/${id}/audit-logs`)).data,
}

export const launchSubscribersApi = {
  subscribe: (email: string, website = '') => api<{ message: string }>('/public/launch-subscribers', { method: 'POST', body: { email, website }, auth: false }),
}

export const branchesApi = {
  list: async (activeOnly = false) => (await api<{ data: Branch[] }>('/branches', { query: { active_only: activeOnly ? 1 : undefined } })).data,
  create: (body: Partial<Branch>) => api<Saved<Branch>>('/branches', { method: 'POST', body }),
  update: (id: number, body: Partial<Branch>) => api<Saved<Branch>>(`/branches/${id}`, { method: 'PATCH', body }),
}

export const businessApi = {
  get: async () => (await api<{ data: BusinessProfile }>('/business')).data,
  update: (body: Partial<BusinessProfile>) => api<Saved<BusinessProfile>>('/business', { method: 'PUT', body }),
  taxRates: async () => (await api<{ data: TaxRate[] }>('/tax-rates')).data,
  createTaxRate: (body: Partial<TaxRate>) => api<Saved<TaxRate>>('/tax-rates', { method: 'POST', body }),
  updateTaxRate: (id: number, body: Partial<TaxRate>) => api<Saved<TaxRate>>(`/tax-rates/${id}`, { method: 'PATCH', body }),
  deleteTaxRate: (id: number) => api<{ message: string }>(`/tax-rates/${id}`, { method: 'DELETE' }),
}

export const auditApi = {
  list: (query: { search?: string; action?: string; from?: string; to?: string; page?: number }) => api<Paginated<AuditEntry>>('/audit-logs', { query }),
}

export const notificationsApi = {
  list: () => api<{ data: AppNotification[]; meta: { unread: number } }>('/notifications'),
  markRead: (id: string) => api(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => api('/notifications/read-all', { method: 'POST' }),
}
