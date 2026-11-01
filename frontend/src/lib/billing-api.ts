import { api } from './api'
import type { SubscriptionSummary } from './auth'

export type Page<T> = { data: T[]; current_page: number; last_page: number; total: number }
export type Invoice = {
  id: number; bookshop_id: number; account_number: string; amount: string; paid: string; currency: string
  environment: 'sandbox' | 'production' | 'legacy'; status: string; billing_months: number
  period_starts_at: string; period_ends_at: string; created_at: string
}
export type Plan = { id: number; name: string; price: string; billing_interval: string }
export type Payment = { id: number; status: string; channel: string; amount: string; mpesa_receipt: string | null; environment: string; created_at: string }
export type Attempt = Payment & { account_number: string; checkout_request_id: string; bookshop_id: number }
export type Reconciliation = { id: number; source: string; status: string; environment: string; provider_transaction_id: string; account_number: string; amount: string; destination_shortcode: string }
export type Evidence = { verified_receipt: string; verified_amount: number; verified_at: string; verified_shortcode: string; verified_account?: string; statement_reference: string; statement_verified: boolean }
export const billingApi = {
  overview: (page = 1) => api<{ invoices: Page<Invoice>; subscription: SubscriptionSummary | null; plans: Plan[]; paybill: string; environment: string }>(`/billing?page=${page}`),
  create: (plan_id: number) => api<{ data: Invoice }>('/billing/invoices', { method: 'POST', body: { plan_id } }),
  invoice: (id: number) => api<{ data: Invoice; payments: Payment[]; paid: number; balance: number; overpayment: number; paybill: string }>(`/billing/invoices/${id}`),
  stk: (id: number, phone: string, amount: number) => api<{ message: string }>(`/billing/invoices/${id}/stk`, { method: 'POST', body: { phone, amount } }),
  plan: (body: { code: string; name: string; price: number; billing_interval: string }) => api('/platform/billing/plans', { method: 'POST', body }),
  invoices: (page = 1, environment = '') => api<Page<Invoice>>(`/platform/billing/invoices?page=${page}${environment ? `&environment=${environment}` : ''}`),
  attempts: (page = 1) => api<Page<Attempt>>(`/platform/billing/stk-attempts?page=${page}`),
  reconciliation: (page = 1) => api<Page<Reconciliation>>(`/platform/billing/reconciliation?page=${page}`),
  resolveOverpayment: (id: number, body: { refund_reference: string; refund_verified: boolean }) => api(`/platform/billing/reconciliation/${id}/resolve-overpayment`, { method: 'POST', body }),
  resolveUnknown: (id: number, body: { statement_reference: string; no_payment_verified: boolean }) => api(`/platform/billing/stk-attempts/${id}/resolve-unknown`, { method: 'POST', body }),
  confirm: (kind: 'stk-attempts' | 'reconciliation' | 'statement-payments', id: number, body: Evidence) => api<{ invoice_status: string }>(kind === 'statement-payments' ? '/platform/billing/statement-payments' : `/platform/billing/${kind}/${id}/confirm`, { method: 'POST', body }),
}
