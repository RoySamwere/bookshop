import { api } from './api'
import { businessApi, type BusinessProfile } from './workspace-api'

/** Payment methods the backend records for a sale. */
export type PaymentMethod = 'cash' | 'mpesa' | 'card'

export type PosBranch = { id: number; name: string }
export type PosCategory = { id: number; name: string }
export type PosProduct = {
  id: number; title: string; sku: string; isbn: string | null; selling_price: string | number
  available: number | string; category: string | null; subcategory: string | null; category_id?: number | null
}
export type PosProductPage = { data: PosProduct[]; current_page: number; last_page: number; total: number }

export type PosSale = {
  id: number; receipt_number: string; branch_id: number; cashier_id: number; subtotal: string | number; total: string | number
  payment_method: PaymentMethod; payment_reference: string | null; amount_received: string | number; change_due: string | number
  created_at: string; branch_name?: string | null; cashier_name?: string | null
}
export type PosSaleItem = { title: string; sku: string; quantity: number; unit_price: string | number; line_total: string | number }
export type PosReceipt = { sale: PosSale; items: PosSaleItem[] }
export type PosDaySummary = { transactions: number; revenue: string | number; cash: string | number; mpesa: string | number; card: string | number }

export type CheckoutPayload = {
  idempotency_key: string; branch_id: number; items: { book_id: number; quantity: number }[]
  payment_method: PaymentMethod; payment_reference: string | null; amount_received: number
}

/** Local calendar date (the till's day), as the API expects: YYYY-MM-DD. */
export function localDate(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const posApi = {
  branches: () => api<PosBranch[]>('/pos/branches'),
  products: (query: { branch_id: number; search?: string; category_id?: number | null; page?: number }) =>
    api<PosProductPage>('/pos/products', { query: { ...query, search: query.search?.trim() || undefined } }),
  /** Top-level product categories for the category rail; empty if the role cannot read the catalogue. */
  categories: async (): Promise<PosCategory[]> => {
    const rows = await api<{ id: number; name: string }[]>('/product-hierarchy')
    return rows.map(row => ({ id: row.id, name: row.name }))
  },
  checkout: (payload: CheckoutPayload) => api<PosReceipt>('/pos/checkout', { method: 'POST', body: payload }),
  today: (branchId: number) => api<{ data: PosSale[]; total: number; summary: PosDaySummary }>('/pos/sales', { query: { date: localDate(), branch_id: branchId } }),
  receipt: (saleId: number) => api<PosReceipt>(`/pos/sales/${saleId}`),
  business: (): Promise<BusinessProfile> => businessApi.get(),
}

export const toNumber = (value: string | number | null | undefined) => {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}

export const formatKes = (value: number) => `KSh ${value.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export const METHOD_LABELS: Record<PaymentMethod, string> = { cash: 'Cash', mpesa: 'M-Pesa', card: 'Card' }

/** VAT already inside a tax-inclusive price (prices are stored tax-inclusive when the business says so). */
export function includedVat(total: number, profile: Pick<BusinessProfile, 'prices_include_tax' | 'default_tax'> | null) {
  const rate = toNumber(profile?.default_tax?.rate)
  if (!profile?.prices_include_tax || rate <= 0) return null
  return { rate, amount: total - total / (1 + rate / 100), label: profile.default_tax?.name || `VAT ${rate}%` }
}
