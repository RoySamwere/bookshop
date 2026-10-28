import { toNumber, type PaymentMethod, type PosProduct } from './pos-api'

export type CartLine = { product: PosProduct; quantity: number }

/** A sale parked on this till so the cashier can serve someone else, then pick it back up. */
export type HeldSale = { id: string; branch: string; label: string; cart: CartLine[]; createdAt: string }

/** The unfinished sale, restored after navigation, refresh or an idle sign-out. */
export type PosDraft = {
  branch: string; cart: CartLine[]; payment: PaymentMethod; reference: string; received: string
  key: string; stage: 'sale' | 'tender'
}

export const available = (product: PosProduct) => Math.max(0, Math.floor(toNumber(product.available)))
export const lineTotal = (line: CartLine) => toNumber(line.product.selling_price) * line.quantity
export const cartTotal = (cart: CartLine[]) => Math.round(cart.reduce((sum, line) => sum + lineTotal(line), 0) * 100) / 100
export const cartUnits = (cart: CartLine[]) => cart.reduce((sum, line) => sum + line.quantity, 0)

/** Adds one unit (or `quantity`), never beyond what the branch has in stock. Returns the new cart and whether it was capped. */
export function addToCart(cart: CartLine[], product: PosProduct, quantity = 1): { cart: CartLine[]; capped: boolean } {
  const limit = available(product)
  if (limit <= 0) return { cart, capped: true }
  const existing = cart.find(line => line.product.id === product.id)
  const wanted = (existing?.quantity ?? 0) + quantity
  const next = Math.min(wanted, limit)
  const updated = existing
    ? cart.map(line => line.product.id === product.id ? { product, quantity: next } : line)
    : [...cart, { product, quantity: next }]
  return { cart: updated, capped: wanted > limit }
}

export function setQuantity(cart: CartLine[], productId: number, quantity: number): CartLine[] {
  return cart.flatMap(line => {
    if (line.product.id !== productId) return [line]
    const next = Math.min(Math.floor(quantity), available(line.product))
    return next > 0 ? [{ ...line, quantity: next }] : []
  })
}

const isLine = (line: unknown): line is CartLine => {
  const value = line as CartLine
  return Boolean(value?.product?.id) && Number.isInteger(value.quantity) && value.quantity > 0
}

const read = <T>(key: string): T | null => {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : null } catch { return null }
}
const write = (key: string, value: unknown) => {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Storage can be full or disabled; the till still works. */ }
}
const remove = (key: string) => { try { localStorage.removeItem(key) } catch { /* ignore */ } }

/** Same key as the previous POS screen, so a sale started before this update is not lost. */
const draftKey = (userId: number) => `hekima_pos_draft_v1_${userId}`
const heldKey = (userId: number) => `hekima_pos_held_v1_${userId}`

export const draftStore = {
  load(userId: number): PosDraft | null {
    const raw = read<Partial<PosDraft> & { checkout?: boolean }>(draftKey(userId))
    if (!raw) return null
    const payment = raw.payment === 'mpesa' || raw.payment === 'card' ? raw.payment : 'cash'
    const cart = Array.isArray(raw.cart) ? raw.cart.filter(isLine) : []
    return {
      branch: typeof raw.branch === 'string' ? raw.branch : '',
      cart, payment,
      reference: typeof raw.reference === 'string' ? raw.reference : '',
      received: typeof raw.received === 'string' ? raw.received : '',
      key: typeof raw.key === 'string' ? raw.key : '',
      stage: (raw.stage === 'tender' || raw.checkout === true) && cart.length ? 'tender' : 'sale',
    }
  },
  save: (userId: number, draft: PosDraft) => write(draftKey(userId), draft),
  clear: (userId: number) => remove(draftKey(userId)),
}

export const heldStore = {
  load(userId: number): HeldSale[] {
    const rows = read<HeldSale[]>(heldKey(userId))
    return Array.isArray(rows) ? rows.filter(row => row?.id && Array.isArray(row.cart) && row.cart.every(isLine)) : []
  },
  save: (userId: number, rows: HeldSale[]) => rows.length ? write(heldKey(userId), rows) : remove(heldKey(userId)),
}

export const newSaleKey = () => {
  try { return crypto.randomUUID() } catch { return `sale-${Date.now()}-${Math.random().toString(36).slice(2)}` }
}

/** Round amounts a customer is likely to hand over for cash, above the amount due (the exact amount is offered separately). */
export function quickCashOptions(total: number) {
  if (total <= 0) return []
  const options = new Set<number>()
  for (const step of [50, 100, 200, 500, 1000]) {
    const rounded = Math.ceil(total / step) * step
    if (rounded > total) options.add(rounded)
  }
  return Array.from(options).sort((a, b) => a - b).slice(0, 4)
}

/** M-Pesa confirmation codes are 10 letters and digits; allow 8–12 in case the format changes. */
export const MPESA_CODE = /^[A-Z0-9]{8,12}$/
