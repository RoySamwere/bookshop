import { API_BASE, ApiError, api } from './api'
import type { SubscriptionSummary } from './auth'

export type Page<T> = { data: T[]; current_page: number; last_page: number; total: number }
export type Invoice = {
  id: number; bookshop_id: number; account_number: string; amount: string; paid: string; currency: string
  environment: 'sandbox' | 'production' | 'legacy'; status: string; billing_months: number
  period_starts_at: string; period_ends_at: string; created_at: string
}
export type PaymentContext = { environment: string; paybill: string | null; can_pay?: boolean; test_mode?: boolean }
export type SubscriptionRow = SubscriptionSummary & { id: number; bookshop_id: number; bookshop_name: string }
export type LedgerPayment = Payment & { account_number: string; bookshop_id: number; statement_reference: string | null; verified_by: number | null }
export type Plan = { is_active?: boolean; id: number; name: string; price: string; billing_interval: string }
export type Payment = { id: number; status: string; channel: string; amount: string; mpesa_receipt: string | null; result_code?: string | null; environment: string; created_at: string }
export type Attempt = Payment & { account_number: string; checkout_request_id: string; merchant_request_id?: string | null; bookshop_id: number }
export type Reconciliation = { id: number; source: string; status: string; environment: string; provider_transaction_id: string; account_number: string; amount: string; destination_shortcode: string }
export type Evidence = { verified_receipt: string; verified_amount: number; verified_at: string; verified_shortcode: string; verified_account?: string; statement_reference: string; statement_verified: boolean }
export const billingApi = {
  overview: (page = 1) => api<{ invoices: Page<Invoice>; subscription: SubscriptionSummary | null; plans: Plan[]; paybill: string | null; environment: string; can_pay?: boolean }>(`/billing?page=${page}`),
  create: (plan_id: number) => api<{ data: Invoice }>('/billing/invoices', { method: 'POST', body: { plan_id } }),
  invoice: (id: number) => api<{ data: Invoice; payments: Payment[]; paid: number; balance: number; overpayment: number; paybill: string | null; environment?: string; can_pay?: boolean }>(`/billing/invoices/${id}`),
  stk: (id: number, phone: string, amount: number) => api<{ message: string }>(`/billing/invoices/${id}/stk`, { method: 'POST', body: { phone, amount } }),
  context: () => api<PaymentContext>('/platform/billing/context'),
  subscriptions: (page = 1, state = '') => api<Page<SubscriptionRow>>(`/platform/billing/subscriptions?page=${page}&state=${state}`),
  payments: (page = 1, environment = '') => api<Page<LedgerPayment>>(`/platform/billing/payments?page=${page}&environment=${environment}`),
  updatePlan: (id: number, body: { name: string; price: number; billing_interval: string; is_active: boolean }) => api(`/platform/billing/plans/${id}`, { method: 'PATCH', body }),
  plan: (body: { code: string; name: string; price: number; billing_interval: string }) => api('/platform/billing/plans', { method: 'POST', body }),
  invoices: (page = 1, environment = '') => api<Page<Invoice>>(`/platform/billing/invoices?page=${page}${environment ? `&environment=${environment}` : ''}`),
  attempts: (page = 1, environment = '') => api<Page<Attempt>>(`/platform/billing/stk-attempts?page=${page}&environment=${environment}`),
  reconciliation: (page = 1, environment = '') => api<Page<Reconciliation>>(`/platform/billing/reconciliation?page=${page}&environment=${environment}`),
  resolveOverpayment: (id: number, body: { refund_reference: string; refund_verified: boolean }) => api(`/platform/billing/reconciliation/${id}/resolve-overpayment`, { method: 'POST', body }),
  resolveUnknown: (id: number, body: { statement_reference: string; no_payment_verified: boolean }) => api(`/platform/billing/stk-attempts/${id}/resolve-unknown`, { method: 'POST', body }),
  confirm: (kind: 'stk-attempts' | 'reconciliation' | 'statement-payments', id: number, body: Evidence) => api<{ invoice_status: string }>(kind === 'statement-payments' ? '/platform/billing/statement-payments' : `/platform/billing/${kind}/${id}/confirm`, { method: 'POST', body }),
}

export type BillStatus = 'pending' | 'verified' | 'reconciled' | 'unmatched' | 'rejected'
export type Bill = {
  id: number; transaction_date: string; bookshop_id: number | null; bookshop_name: string | null; invoice_id: number | null; invoice_status: string | null
  account_number: string | null; mpesa_receipt_number: string | null; phone_number: string | null; amount: number; allocated_amount: number; excess_amount: number
  shortcode: string | null; payment_channel: 'stk' | 'paybill'; environment: 'production' | 'sandbox' | 'legacy'; status: BillStatus
  verification_source: string | null; verification_reference: string | null; verified_at: string | null; verification_attempts: number; next_verification_at: string | null
  exception_reason: string | null; claimed_account: string | null; resolution_note: string | null; resolved_by: string | null; reconciled_at: string | null; confirmation_sent_at: string | null; created_at: string
}
export type BillDetail = Bill & {
  provider_payload: Record<string, unknown>; verification_request_id: string | null
  invoice: { id: number; account_number: string; amount: number; status: string; paid: number; balance: number; period_starts_at: string; period_ends_at: string } | null
  candidate_invoices: { id: number; account_number: string; amount: string; status: string; bookshop: string }[]
  history: { id: number; action: string; description: string; created_at: string; user_id: number | null }[]
}
export type BillsSummary = {
  environment: string; paybill: string; verified_collections: number; verified_count: number; today_collections: number; today_count: number
  pending_count: number; pending_amount: number; unmatched_count: number; unmatched_amount: number; excess_amount: number
  outstanding_invoices: number; outstanding_balance: number
}
export type BillFilters = { search?: string; status?: string; channel?: string; environment?: string; from?: string; to?: string; page?: number }
export type MyPayment = {
  id: number; date: string; amount: number; allocated_amount: number; excess_amount: number; invoice_id: number | null; invoice_status: string | null
  account_number: string | null; mpesa_receipt_number: string | null; phone: string | null; channel: string; environment: string
  status: 'confirmed' | 'processing' | 'under_review' | 'failed'; has_receipt: boolean
}

export const billsApi = {
  list: (filters: BillFilters) => api<Page<Bill> & { from: number | null; to: number | null; summary: BillsSummary }>('/platform/bills', { query: filters }),
  export: (filters: BillFilters) => api<{ data: Bill[]; truncated: boolean }>('/platform/bills/export', { query: { ...filters, page: undefined } }),
  show: (id: number) => api<{ data: BillDetail }>(`/platform/bills/${id}`),
  retry: (id: number) => api<{ data: BillDetail }>(`/platform/bills/${id}/retry`, { method: 'POST' }),
  assign: (id: number, account_number: string, note: string) => api<{ data: BillDetail }>(`/platform/bills/${id}/assign`, { method: 'POST', body: { account_number, note } }),
  confirmCode: (mpesa_code: string, account_number: string, note: string) => api<{ data: BillDetail }>('/platform/bills/confirm-code', { method: 'POST', body: { mpesa_code, account_number, note } }),
  reject: (id: number, reason: string) => api<{ data: BillDetail }>(`/platform/bills/${id}/reject`, { method: 'POST', body: { reason } }),
  confirmMyPayment: (invoiceId: number, mpesa_code: string) => api<{ status: 'confirmed' | 'processing' | 'review'; message: string }>(`/billing/invoices/${invoiceId}/confirm-payment`, { method: 'POST', body: { mpesa_code } }),
  myPayments: (page = 1) => api<Page<MyPayment> & { totals: { payments: number; total: number } }>('/billing/payments', { query: { page } }),
}

/** Downloads a payment receipt PDF with the session cookie. */
export async function downloadPaymentReceipt(id: number, filename: string) {
  const response = await fetch(`${API_BASE}/billing/payments/${id}/receipt`, { credentials: 'include', headers: { Accept: 'application/pdf' } })
  if (!response.ok) throw new ApiError('Receipt is not available.', response.status)
  const url = URL.createObjectURL(await response.blob())
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

/** The 10-character code in the M-Pesa SMS, e.g. TJ4K8L2M9P. */
export const MPESA_CODE_PATTERN = /^[A-Z0-9]{10}$/
export const normalizeMpesaCode = (value: string) => value.replace(/\s+/g, '').toUpperCase()

export const BILL_STATUS_LABELS: Record<BillStatus, string> = {
  pending: 'Pending verification', verified: 'Verified', reconciled: 'Reconciled', unmatched: 'Unmatched', rejected: 'Rejected',
}
export const VERIFICATION_SOURCES: Record<string, string> = {
  daraja_stk_query: 'Safaricom STK query', daraja_transaction_status: 'Safaricom transaction status', daraja_pull_api: 'Safaricom Pull API',
  statement_attestation: 'Merchant statement (operator)', legacy_record: 'Legacy record',
}

export function paymentStatus(payment: Pick<Payment, 'status' | 'result_code'>): string {
  if (payment.status === 'awaiting_verification' && payment.result_code === '0') return 'Confirmed by Safaricom — applying to invoice'
  return ({ pending: 'Waiting for Safaricom confirmation', awaiting_verification: 'Being verified with Safaricom',
    unknown: 'Unknown outcome — platform team is checking', confirmed: 'Verified payment', reconciled: 'Reconciled request',
    cancelled: 'Cancelled by payer', timed_out: 'Timed out — no verified payment', failed: 'Payment failed' } as Record<string, string>)[payment.status] ?? payment.status
}
