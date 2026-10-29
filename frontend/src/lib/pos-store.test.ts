import { describe, expect, it } from 'vitest'
import { addToCart, cartTotal, setQuantity } from './pos-store'
import { receiptHtml } from '../components/pos/receipt-print'
import type { PosProduct, PosReceipt } from './pos-api'

const product: PosProduct = { id: 1, title: 'Learning & <script>alert(1)</script>', sku: 'BOOK-1', isbn: null, selling_price: '125.50', available: 3, category: null, subcategory: null }
describe('preserved POS operations', () => {
  it('caps cart quantity to stock, calculates totals and removes zero quantity', () => {
    const result = addToCart([], product, 5)
    expect(result.capped).toBe(true)
    expect(result.cart[0].quantity).toBe(3)
    expect(cartTotal(result.cart)).toBe(376.5)
    expect(setQuantity(result.cart, 1, 0)).toEqual([])
  })
  it('never adds out of stock products', () => expect(addToCart([], { ...product, available: 0 }).cart).toEqual([]))
  it('escapes receipt fields and uses server totals', () => {
    const receipt: PosReceipt = { sale: { id: 1, receipt_number: 'REC-1', branch_id: 1, cashier_id: 1, subtotal: 125.5, total: 125.5, payment_method: 'cash', payment_reference: null, amount_received: 200, change_due: 74.5, created_at: '2026-10-29 10:00:00' }, items: [{ title: product.title, sku: product.sku, quantity: 1, unit_price: 125.5, line_total: 125.5 }] }
    const html = receiptHtml(receipt, null, { shopName: 'Hekima' })
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).toContain('125.50')
    expect(html).toContain('74.50')
  })
})
