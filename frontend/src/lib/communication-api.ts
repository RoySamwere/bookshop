import { api } from './api'
import type { Page } from './billing-api'

export type CommunicationStatus = 'queued' | 'sending' | 'sent' | 'failed'
export type CommunicationLog = {
  id: number; event: string; bookshop_id: number | null; bookshop_name: string | null; announcement_id: number | null
  recipient_name: string | null; recipient_email: string; subject: string; body: string; status: CommunicationStatus
  attempts: number; last_error: string | null; sent_at: string | null; failed_at: string | null; created_at: string
}
export type CommunicationTemplate = {
  key: string; label: string; description: string; placeholders: string[]; subject: string; body: string
  is_enabled: boolean; customized: boolean; default_subject: string; default_body: string
}
export type AnnouncementCategory = 'update' | 'maintenance' | 'feature' | 'general'
export type RecipientGroup = 'owners' | 'staff'
export type Announcement = {
  id: number; subject: string; body: string; category: AnnouncementCategory; audience: 'all' | 'selected'; bookshop_ids: number[] | null
  recipients: RecipientGroup; recipient_count: number; sent_count: number; failed_count: number; created_at: string
}
export type AudienceRequest = { audience: 'all' | 'selected'; bookshop_ids: number[]; recipients: RecipientGroup }
export type LogFilters = { status?: string; event?: string; bookshop_id?: number; announcement_id?: number; search?: string; page?: number }

/** Human names for every message type, matching the template labels. */
export const EVENT_LABELS: Record<string, string> = {
  announcement: 'Announcement', welcome: 'Bookshop activated', trial_ending: 'Trial ending soon', renewal_due: 'Subscription ending soon',
  payment_due: 'Invoice ready for payment', payment_confirmed: 'Payment confirmed', subscription_updated: 'Subscription updated',
  subscription_expired: 'Subscription ended', bookshop_suspended: 'Bookshop suspended', bookshop_reactivated: 'Bookshop reactivated',
}
export const CATEGORY_LABELS: Record<AnnouncementCategory, string> = { update: 'System update', maintenance: 'Maintenance', feature: 'New feature', general: 'General' }

export const communicationApi = {
  summary: async () => (await api<{ data: { sent: number; queued: number; failed: number; last_30_days: number; announcements: number } }>('/platform/communications/summary')).data,
  logs: (filters: LogFilters) => api<Page<CommunicationLog>>('/platform/communications/logs', { query: filters }),
  retry: (id: number) => api<{ message: string; data: CommunicationLog }>(`/platform/communications/logs/${id}/retry`, { method: 'POST' }),
  retryFailed: () => api<{ message: string; count: number }>('/platform/communications/logs/retry-failed', { method: 'POST' }),
  templates: async () => (await api<{ data: CommunicationTemplate[] }>('/platform/communications/templates')).data,
  saveTemplate: (key: string, body: { subject: string; body: string; is_enabled: boolean }) => api<{ message: string }>(`/platform/communications/templates/${key}`, { method: 'PUT', body }),
  resetTemplate: (key: string) => api<{ message: string }>(`/platform/communications/templates/${key}`, { method: 'DELETE' }),
  announcements: (page = 1) => api<Page<Announcement>>('/platform/communications/announcements', { query: { page } }),
  audience: async (body: AudienceRequest) => (await api<{ data: { bookshops: number; recipients: number } }>('/platform/communications/announcements/audience', { method: 'POST', body })).data,
  announce: (body: AudienceRequest & { subject: string; body: string; category: AnnouncementCategory; idempotency_key: string }) =>
    api<{ message: string; duplicate: boolean; data: { id: number; recipient_count: number } }>('/platform/communications/announcements', { method: 'POST', body }),
}
