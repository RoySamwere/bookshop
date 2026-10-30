import { api, type Paginated } from './api'
import type { BookshopStatus, Role, SubscriptionSummary, BookshopRegistrationPayload } from './auth'
import { queryClient } from '../app/query-client'
import type { AuditEntry, TeamMember } from './workspace-api'

type Saved<T> = { data: T; message: string }

export type BookshopProfile = {
  id: number; name: string; slug: string; status: BookshopStatus; business_email: string | null; phone: string | null; location: string | null
  country: string; currency: string; timezone: string; verified_at: string | null; suspended_at: string | null; suspension_reason: string | null
}
export type BookshopDetails = BookshopProfile & {
  owner: { id: number; name: string; email: string } | null
  registered_at: string | null
  subscription: SubscriptionSummary | null
  entitlements: { branches_limit: number | null; users_limit: number | null; can_add_branch: boolean; can_add_user: boolean }
  counts: { branches: number; active_branches: number; staff: number; active_staff: number; pending_invitations: number }
  onboarding: { email_verified: boolean; profile_completed: boolean; has_branch: boolean; has_staff: boolean }
}
export type BookshopProfilePayload = Partial<Pick<BookshopProfile, 'name' | 'business_email' | 'phone' | 'location' | 'country' | 'currency' | 'timezone'>>
export type InvitationPayload = { name: string; email: string; phone?: string | null; role: Role; branch_ids: number[] }

/** The signed-in user's own bookshop. */
export const bookshopApi = {
  get: async () => (await api<{ data: BookshopDetails }>('/bookshop')).data,
  update: (body: BookshopProfilePayload) => api<Saved<BookshopProfile>>('/bookshop', { method: 'PATCH', body }),
  activity: async () => (await api<{ data: AuditEntry[] }>('/bookshop/activity')).data,
  invite: (body: InvitationPayload) => api<Saved<TeamMember>>('/staff-invitations', { method: 'POST', body }),
  resendInvitation: (userId: number) => api<{ message: string }>(`/staff-invitations/${userId}/resend`, { method: 'POST' }),
}

export type PlatformBookshop = BookshopProfile & {
  registered_at: string | null
  owner: { id: number; name: string; email: string; email_verified: boolean; phone?: string | null; last_login_at?: string | null } | null
  branches_count: number | null; staff_count: number | null
  subscription: SubscriptionSummary | null
}
export type PlatformBookshopDetails = PlatformBookshop & {
  subscription_history: { event: string; from_status: string | null; to_status: string; note: string | null; created_at: string }[]
  history: AuditEntry[]
}
export type PlatformOverview = {
  bookshops: { total: number; active: number; pending_verification: number; suspended: number; registered_last_30_days: number }
  subscriptions: Record<string, number>
  users: { bookshop_staff: number; platform_staff: number; unassigned_legacy_staff: number }
  recent_bookshops: { id: number; name: string; slug: string; status: BookshopStatus; country: string; created_at: string }[]
}
export type PlatformStaff = { id: number; name: string; email: string; role: Role; role_label: string; is_active: boolean; last_login_at: string | null; created_at: string | null }
export type PlatformSettings = { bookshop_registration_open: boolean; support_email: string | null; trial_days: number | null; default_trial_days: number }

/** Platform administration. These endpoints never return bookshop business records. */
export const platformApi = {
  managedBookshops: async () => (await api<{ data: BookshopProfile[] }>('/platform/managed-bookshops')).data,
  createBookshop: (body: BookshopRegistrationPayload) => api<Saved<BookshopProfile>>('/platform/bookshops', { method: 'POST', body }),
  plans: async () => (await api<{ data: { id: number; name: string; description: string | null; price: string; currency: string; billing_interval: string; trial_days: number; is_active: boolean }[] }>('/platform/plans')).data,
  overview: async () => (await api<{ data: PlatformOverview }>('/platform/overview')).data,
  bookshops: (query: { search?: string; status?: string; page?: number }) => api<Paginated<PlatformBookshop>>('/platform/bookshops', { query }),
  bookshop: async (id: number) => (await api<{ data: PlatformBookshopDetails }>(`/platform/bookshops/${id}`)).data,
  updateBookshop: (id: number, body: { name: string; business_email: string; phone: string; location: string }) => api<Saved<PlatformBookshop>>(`/platform/bookshops/${id}`, { method: 'PATCH', body }),
  approve: (id: number) => api<Saved<PlatformBookshop>>(`/platform/bookshops/${id}/approve`, { method: 'POST' }),
  suspend: (id: number, reason: string) => api<Saved<PlatformBookshop>>(`/platform/bookshops/${id}/suspend`, { method: 'POST', body: { reason } }),
  reactivate: (id: number, note: string) => api<Saved<PlatformBookshop>>(`/platform/bookshops/${id}/reactivate`, { method: 'POST', body: { note: note || null } }),
  resendOwnerVerification: (id: number) => api<{ message: string }>(`/platform/bookshops/${id}/resend-owner-verification`, { method: 'POST' }),
  users: async () => (await api<{ data: PlatformStaff[] }>('/platform/users')).data,
  createUser: (body: { name: string; email: string; password: string; password_confirmation: string; role: Role }) => api<Saved<PlatformStaff>>('/platform/users', { method: 'POST', body }),
  setUserStatus: (id: number, is_active: boolean) => api<Saved<PlatformStaff>>(`/platform/users/${id}/status`, { method: 'PATCH', body: { is_active } }),
  settings: async () => (await api<{ data: PlatformSettings }>('/platform/settings')).data,
  updateSettings: (body: Partial<Omit<PlatformSettings, 'default_trial_days'>>) => api<Saved<PlatformSettings>>('/platform/settings', { method: 'PUT', body }),
  audit: (query: { search?: string; page?: number }) => api<Paginated<AuditEntry>>('/platform/audit-logs', { query }),
}

/** Discard cached tenant records and reload the UI after the server changes the session context. */
export async function enterBookshopManagement(id: number) {
  await api(`/platform/management/${id}/enter`, { method: 'POST' })
  await queryClient.cancelQueries()
  queryClient.clear()
  window.location.assign('/dashboard')
}

export async function returnToPlatform() {
  await api('/platform/management/leave', { method: 'POST' })
  await queryClient.cancelQueries()
  queryClient.clear()
  window.location.assign('/platform')
}

/** Common markets and their currencies; anything else can be typed in. */
export const COUNTRY_CURRENCIES: Record<string, string> = {
  Kenya: 'KES', Uganda: 'UGX', Tanzania: 'TZS', Rwanda: 'RWF', Burundi: 'BIF', Ethiopia: 'ETB',
  Nigeria: 'NGN', Ghana: 'GHS', 'South Africa': 'ZAR', Zambia: 'ZMW', Malawi: 'MWK',
}

export const BOOKSHOP_STATUS_LABELS: Record<BookshopStatus, string> = {
  pending_verification: 'Awaiting verification', active: 'Active', suspended: 'Suspended',
}
