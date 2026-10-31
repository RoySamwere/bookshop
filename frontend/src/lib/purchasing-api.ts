import { API_BASE, ApiError, api, ensureCsrfCookie } from './api'

export type PurchaseOrderStatus = 'draft' | 'pending_approval' | 'approved' | 'confirmed' | 'sent' | 'partially_received' | 'completed' | 'cancelled'
export type EmailStatus = 'not_sent' | 'queued' | 'sending' | 'sent' | 'failed'
export type PurchaseTab = 'drafts' | 'pending' | 'sent' | 'partial' | 'completed' | 'cancelled'

export type OrderActions = {
  edit: boolean; delete: boolean; submit: boolean; approve: boolean; reject: boolean; confirm: boolean; amend: boolean
  send_email: boolean; mark_sent: boolean; download_pdf: boolean; receive: boolean; cancel: boolean
}

export type PurchaseOrderSummary = {
  id: number; lpo_number: string | null; status: PurchaseOrderStatus; supplier_id: number; branch_id: number
  order_date: string | null; expected_date: string | null; delivery_location: string | null; payment_terms: string | null
  internal_notes: string | null; supplier_notes: string | null; currency: string | null; tax_rate: number; prices_include_tax: boolean
  subtotal: number; discount_total: number; tax_total: number; total: number; version: number
  rejection_reason: string | null; cancellation_reason: string | null; delivery_method: 'email' | 'manual' | null
  email_status: EmailStatus; email_last_attempt_at: string | null; email_sent_at: string | null; has_pdf: boolean; is_overdue: boolean
  submitted_at: string | null; approved_at: string | null; confirmed_at: string | null; cancelled_at: string | null; completed_at: string | null
  created_at: string; updated_at: string
}

export type PurchaseOrderRow = PurchaseOrderSummary & {
  supplier: { id: number; name: string | null; email: string | null }
  branch: { id: number; name: string | null }
  created_by_name: string | null; line_count: number; ordered_quantity: number; received_quantity: number; outstanding_quantity: number
  actions: OrderActions
}

export type PurchaseOrderItem = {
  id: number; book_id: number; description: string; sku: string | null; isbn: string | null
  product_unit_id: number | null; unit_label: string | null; units_per_package: number
  quantity: number; received_quantity: number; cancelled_quantity: number; outstanding_quantity: number
  unit_cost: number; discount: number; line_total: number
}

export type PurchaseOrderDetail = PurchaseOrderSummary & {
  supplier: { id: number; name: string; contact_person: string | null; email: string | null; phone: string | null; address: string | null; payment_terms: string | null; lead_time_days: number | null; is_active: boolean }
  branch: { id: number; name: string; code: string }
  people: Record<'created_by' | 'submitted_by' | 'approved_by' | 'confirmed_by' | 'cancelled_by', string | null>
  items: PurchaseOrderItem[]
  receipts: { id: number; reference: string; delivery_note_number: string | null; received_on: string | null; notes: string | null; created_at: string; received_by: string | null; items: { purchase_order_item_id: number; quantity: number; damaged_quantity: number; notes: string | null }[] }[]
  events: { id: number; action: string; from_status: string | null; to_status: string | null; version: number; notes: string | null; created_at: string; user: string | null; has_snapshot: number }[]
  email_attempts: { id: number; recipient: string; status: 'queued' | 'sending' | 'sent' | 'failed'; error: string | null; attempted_at: string | null; sent_at: string | null; created_at: string; requested_by: string | null }[]
  actions: OrderActions
}

export type ProductUnit = { id: number; name: string; pieces_per_unit: number }
export type ReorderRow = {
  book_id: number; title: string; sku: string | null; isbn: string | null; branch_id: number
  current_stock: number; reserved: number; available: number; reorder_level: number; target_stock: number
  outstanding_quantity: number; draft_quantity: number; minimum_order_quantity: number | null; pack_size: number | null
  is_low_stock: boolean; suggested_quantity: number
  preferred_supplier: { id: number; name: string; email: string | null; is_active: boolean } | null
  last_unit_cost: number | null; last_purchase_date: string | null; default_unit_cost: number; units: ProductUnit[]
}

export type PurchasingSummary = {
  below_reorder_level: number; drafts: number; awaiting_approval: number; approved: number; confirmed: number; sent: number
  awaiting_delivery: number; partially_received: number; completed: number; cancelled: number
  outstanding_value: number; outstanding_quantity: number; overdue: number; email_failed: number; currency: string
}

export type PurchasingSettings = { approval_required: boolean; default_reorder_level: number; default_target_stock: number; default_payment_terms: string | null; default_delivery_location: string | null }

export type PurchasingReport = {
  totals: { orders: number; purchase_value: number; ordered_quantity: number; received_quantity: number; outstanding_quantity: number; outstanding_value: number; below_reorder_level: number }
  by_supplier: { supplier_id: number; supplier: string; orders: number; value: number; ordered_quantity: number; received_quantity: number; cancelled_quantity: number; outstanding_quantity: number; deliveries: number; on_time: number; fill_rate: number | null; on_time_rate: number | null; average_lead_days: number | null }[]
  overdue: { id: number; lpo_number: string | null; supplier: string; status: PurchaseOrderStatus; expected_date: string; days_late: number }[]
  price_changes: { book_id: number; title: string; sku: string | null; previous_cost: number; latest_cost: number; change_percent: number | null; supplier: string; date: string }[]
}

export type OrderLineInput = { id?: number; book_id: number; quantity: number; unit_cost: number; discount?: number; product_unit_id?: number | null }
export type OrderInput = {
  supplier_id: number; branch_id: number; order_date?: string | null; expected_date?: string | null; delivery_location?: string | null
  payment_terms?: string | null; internal_notes?: string | null; supplier_notes?: string | null; tax_rate?: number; prices_include_tax?: boolean
  items: OrderLineInput[]
}

/** Laravel paginator as returned by the purchase order list. */
export type LaravelPage<T> = { data: T[]; current_page: number; last_page: number; per_page: number; total: number; from: number | null; to: number | null }

const base = '/purchase-orders'
type Detail = { data: PurchaseOrderDetail; message?: string }

export const purchasingApi = {
  list: (query: Record<string, string | number | boolean | undefined>) => api<LaravelPage<PurchaseOrderRow>>(base, { query }),
  summary: () => api<{ data: PurchasingSummary }>(`${base}/summary`),
  reports: (query: { from?: string; to?: string }) => api<{ data: PurchasingReport }>(`${base}/reports`, { query }),
  suggestions: (query: { branch_id?: number; search?: string; supplier_id?: number }) => api<{ data: ReorderRow[]; branch_id: number }>(`${base}/suggestions`, { query }),
  catalogue: (search: string, branchId?: number) => api<{ data: ReorderRow[] }>(`${base}/catalogue`, { query: { search, branch_id: branchId } }),
  priceHistory: (bookId: number) => api<{ data: { purchase_order_id: number; lpo_number: string | null; supplier: string; unit_cost: number; unit_label: string | null; units_per_package: number; cost_per_piece: number; quantity: number; date: string }[] }>(`${base}/price-history/${bookId}`),
  settings: () => api<{ data: PurchasingSettings }>(`${base}/settings`),
  updateSettings: (body: Partial<PurchasingSettings>) => api<{ data: PurchasingSettings }>(`${base}/settings`, { method: 'PUT', body }),
  updateReorderSettings: (bookId: number, body: { reorder_level?: number | null; target_stock?: number | null; preferred_supplier_id?: number | null; minimum_order_quantity?: number | null; pack_size?: number | null }) =>
    api(`${base}/reorder-settings/${bookId}`, { method: 'PUT', body }),
  generate: (body: { branch_id: number; allow_outstanding?: boolean; items: (OrderLineInput & { supplier_id: number })[] }) => api<{ data: { ids: number[] }; message: string }>(`${base}/generate`, { method: 'POST', body }),
  show: (id: number) => api<Detail>(`${base}/${id}`),
  create: (body: OrderInput) => api<Detail>(base, { method: 'POST', body }),
  update: (id: number, body: Partial<OrderInput>) => api<Detail>(`${base}/${id}`, { method: 'PUT', body }),
  remove: (id: number) => api<{ message: string }>(`${base}/${id}`, { method: 'DELETE' }),
  submit: (id: number) => api<Detail>(`${base}/${id}/submit`, { method: 'POST' }),
  approve: (id: number) => api<Detail>(`${base}/${id}/approve`, { method: 'POST' }),
  reject: (id: number, reason: string) => api<Detail>(`${base}/${id}/reject`, { method: 'POST', body: { reason } }),
  confirm: (id: number, body: { send_email?: boolean; acknowledge_outstanding?: boolean }) => api<Detail>(`${base}/${id}/confirm`, { method: 'POST', body }),
  send: (id: number, resend = false) => api<Detail>(`${base}/${id}/send`, { method: 'POST', body: { resend } }),
  markSent: (id: number, notes?: string) => api<Detail>(`${base}/${id}/mark-sent`, { method: 'POST', body: { notes } }),
  amend: (id: number, body: Partial<OrderInput> & { reason: string }) => api<Detail>(`${base}/${id}/amend`, { method: 'POST', body }),
  cancel: (id: number, reason: string) => api<Detail>(`${base}/${id}/cancel`, { method: 'POST', body: { reason } }),
  receive: (id: number, body: { submission_key: string; delivery_note_number?: string; received_on?: string; notes?: string; items: { purchase_order_item_id: number; quantity: number; damaged_quantity?: number; notes?: string }[] }) =>
    api<Detail & { duplicate: boolean; status: PurchaseOrderStatus }>(`${base}/${id}/receive`, { method: 'POST', body }),
}

/** Downloads (or opens for printing) the stored LPO PDF using the session cookie. */
export async function downloadLpoPdf(id: number, filename: string, mode: 'download' | 'print' = 'download') {
  await ensureCsrfCookie().catch(() => undefined)
  const response = await fetch(`${API_BASE}${base}/${id}/pdf${mode === 'print' ? '?inline=1' : ''}`, { credentials: 'include', headers: { Accept: 'application/pdf' } })
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new ApiError(data.message || 'Unable to load the LPO document.', response.status)
  }
  const url = URL.createObjectURL(await response.blob())
  if (mode === 'print') {
    window.open(url, '_blank', 'noopener')
  } else {
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    link.click()
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  draft: 'Draft', pending_approval: 'Pending approval', approved: 'Approved', confirmed: 'Confirmed', sent: 'Sent',
  partially_received: 'Partially received', completed: 'Completed', cancelled: 'Cancelled',
}

export const EMAIL_LABELS: Record<EmailStatus, string> = { not_sent: 'Not sent', queued: 'Queued', sending: 'Sending', sent: 'Emailed', failed: 'Email failed' }

export function formatMoney(value: number, currency = 'KES') {
  return `${currency} ${Number(value || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** Mirrors the server: target - available - on order, never negative, raised to the minimum and rounded up to packs. */
export function suggestedQuantity(available: number, target: number, outstanding: number, minimum?: number | null, packSize?: number | null) {
  let needed = Math.max(0, target - available - outstanding)
  if (needed === 0) return 0
  if (minimum) needed = Math.max(needed, minimum)
  if (packSize && packSize > 1) needed = Math.ceil(needed / packSize) * packSize
  return needed
}
