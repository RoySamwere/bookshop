'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, Keyboard, LogOut, PauseCircle, ReceiptText, ShoppingBag, LayoutDashboard, Boxes, Users, Settings2, Menu, Store, ChartNoAxesColumnIncreasing, BookOpen, Truck } from 'lucide-react'
import { ApiError, errorMessage } from '../../lib/api'
import { hasPermission, type BookshopUser } from '../../lib/auth'
import { brand } from '../../lib/brand'
import { formatKes, posApi, toNumber, type PaymentMethod, type PosBranch, type PosCategory, type PosDaySummary, type PosProduct, type PosReceipt, type PosSale } from '../../lib/pos-api'
import { addToCart, available, cartTotal, cartUnits, draftStore, heldStore, newSaleKey, setQuantity, type CartLine, type HeldSale } from '../../lib/pos-store'
import type { BusinessProfile } from '../../lib/workspace-api'
import { BrandMark } from '../brand-mark'
import { canOpenSection } from '../workspace-shell'
import { PosCatalogue, type CatalogueHandle } from './pos-catalogue'
import { HeldSalesPanel, ShortcutsPanel, TodayPanel } from './pos-panels'
import { ReceiptView, SaleView, TenderView, tenderIsValid } from './pos-ticket'
import { printReceipt, receiptHtml } from './receipt-print'

type Stage = 'sale' | 'tender' | 'receipt'
type Panel = 'held' | 'today' | 'shortcuts' | null
type ShownReceipt = { data: PosReceipt; expectedTotal: number | null; reprint: boolean }

function useWideScreen() {
  const [wide, setWide] = useState(true)
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)')
    const update = () => setWide(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return wide
}

const typingInField = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
const cartSignature = (cart: CartLine[]) => cart.map(line => `${line.product.id}x${line.quantity}`).join(',')

/** The cashier's till: scan or tap products, take payment and hand over a receipt. */
export function PosTerminal({ currentUser, notify, onExit, onNavigate }: { currentUser: BookshopUser; notify: (message: string) => void; onExit: () => void; onNavigate: (section: string) => void }) {
  const [navOpen, setNavOpen] = useState(false)
  useEffect(() => {
    if (!navOpen) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setNavOpen(false) } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [navOpen])
  const userId = currentUser.id
  const canSeeSales = hasPermission(currentUser, 'sales.view')
  const wide = useWideScreen()
  const catalogue = useRef<CatalogueHandle>(null)

  const [branches, setBranches] = useState<PosBranch[]>([])
  const [branch, setBranch] = useState('')
  const [branchError, setBranchError] = useState('')
  const [categories, setCategories] = useState<PosCategory[]>([])
  const [profile, setProfile] = useState<BusinessProfile | null>(null)

  const [cart, setCart] = useState<CartLine[]>([])
  const [stage, setStage] = useState<Stage>('sale')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [received, setReceived] = useState('')
  const [reference, setReference] = useState('')
  const [saleKey, setSaleKey] = useState('')
  const [keyFor, setKeyFor] = useState('')
  const [busy, setBusy] = useState(false)
  const [tenderError, setTenderError] = useState('')
  const [receipt, setReceipt] = useState<ShownReceipt | null>(null)
  const [flashId, setFlashId] = useState<number | null>(null)

  const [held, setHeld] = useState<HeldSale[]>([])
  const [panel, setPanel] = useState<Panel>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [restored, setRestored] = useState(false)

  const [todaySales, setTodaySales] = useState<PosSale[]>([])
  const [todaySummary, setTodaySummary] = useState<PosDaySummary | null>(null)
  const [todayLoading, setTodayLoading] = useState(false)
  const [todayError, setTodayError] = useState('')

  // Latest cart for event handlers, so state updaters stay pure (no notifications from inside them).
  const cartRef = useRef<CartLine[]>([])
  useEffect(() => { cartRef.current = cart }, [cart])

  const branchId = branch ? Number(branch) : null
  const branchName = useCallback((id: string) => branches.find(row => String(row.id) === id)?.name || 'Branch', [branches])
  const total = cartTotal(cart)
  const units = cartUnits(cart)
  const inCart = useMemo(() => new Map(cart.map(line => [line.product.id, line.quantity])), [cart])

  /* ----------------------------------------------------------- loading ----------------------------------------------------------- */

  useEffect(() => {
    const draft = draftStore.load(userId)
    if (draft) {
      setCart(draft.cart); setMethod(draft.payment); setReceived(draft.received); setReference(draft.reference)
      setSaleKey(draft.key); setKeyFor(draft.key ? cartSignature(draft.cart) : ''); setStage(draft.stage)
      if (draft.branch) setBranch(draft.branch)
    }
    setHeld(heldStore.load(userId))
    setRestored(true)

    posApi.branches()
      .then(rows => { setBranches(rows); setBranch(old => rows.some(row => String(row.id) === old) ? old : String(rows[0]?.id ?? '')); if (!rows.length) setBranchError('You are not assigned to an active branch. Ask an administrator to add you to one.') })
      .catch(e => setBranchError(errorMessage(e)))
    posApi.categories().then(setCategories).catch(() => setCategories([]))
    posApi.business().then(setProfile).catch(() => setProfile(null))
  }, [userId])

  // Keep the unfinished sale on this device until it is completed.
  useEffect(() => {
    if (!restored) return
    if (!cart.length && stage !== 'tender') { draftStore.clear(userId); return }
    draftStore.save(userId, { branch, cart, payment: method, reference, received, key: saleKey, stage: stage === 'tender' ? 'tender' : 'sale' })
  }, [restored, userId, branch, cart, method, reference, received, saleKey, stage])

  useEffect(() => { if (restored) heldStore.save(userId, held) }, [restored, userId, held])

  const loadToday = useCallback(() => {
    if (!canSeeSales || !branchId) return
    setTodayLoading(true); setTodayError('')
    posApi.today(branchId)
      .then(result => { setTodaySales(result.data); setTodaySummary(result.summary) })
      .catch(e => setTodayError(errorMessage(e)))
      .finally(() => setTodayLoading(false))
  }, [canSeeSales, branchId])
  useEffect(() => { loadToday() }, [loadToday])

  useEffect(() => { if (wide && branchId) catalogue.current?.focusSearch() }, [wide, branchId])
  useEffect(() => { if (!flashId) return; const timer = window.setTimeout(() => setFlashId(null), 1200); return () => window.clearTimeout(timer) }, [flashId])
  // On phones and tablets, payment and receipt need the ticket sheet open.
  useEffect(() => { if (!wide && (stage === 'tender' || stage === 'receipt')) setSheetOpen(true) }, [wide, stage])

  /* ----------------------------------------------------------- the sale ---------------------------------------------------------- */

  const startNewSale = useCallback(() => {
    setReceipt(null); setStage('sale'); setTenderError(''); setReference(''); setReceived(''); setMethod('cash')
    if (!wide) setSheetOpen(false)
    window.requestAnimationFrame(() => catalogue.current?.focusSearch())
  }, [wide])

  const add = useCallback((product: PosProduct, source: 'tap' | 'scan') => {
    if (stage === 'tender') return
    if (stage === 'receipt') { setReceipt(null); setStage('sale') }
    const result = addToCart(cartRef.current, product)
    cartRef.current = result.cart
    setCart(result.cart)
    if (result.capped) notify(available(product) > 0 ? `Only ${available(product)} of “${product.title}” in stock here` : `“${product.title}” is out of stock`)
    setFlashId(product.id)
    if (source === 'scan') catalogue.current?.focusSearch()
  }, [stage, notify])

  const changeQuantity = useCallback((productId: number, quantity: number) => {
    const line = cartRef.current.find(row => row.product.id === productId)
    const next = setQuantity(cartRef.current, productId, quantity)
    cartRef.current = next
    setCart(next)
    if (line && quantity > available(line.product)) notify(`Only ${available(line.product)} of “${line.product.title}” in stock here`)
  }, [notify])

  const charge = useCallback(() => {
    if (!cart.length || !branchId) return
    const signature = cartSignature(cart)
    // A new key per distinct basket, so a retry after a dropped connection cannot charge twice.
    if (!saleKey || keyFor !== signature) { setSaleKey(newSaleKey()); setKeyFor(signature) }
    setMethod('cash'); setReceived(cartTotal(cart).toFixed(2)); setReference(''); setTenderError('')
    setStage('tender')
  }, [cart, branchId, saleKey, keyFor])

  const complete = useCallback(async () => {
    if (busy || !branchId || !cart.length || !tenderIsValid(total, method, received, reference)) return
    setBusy(true); setTenderError('')
    try {
      const result = await posApi.checkout({
        idempotency_key: saleKey || newSaleKey(), branch_id: branchId,
        items: cart.map(line => ({ book_id: line.product.id, quantity: line.quantity })),
        payment_method: method, payment_reference: method === 'cash' ? null : reference.trim(),
        amount_received: method === 'cash' ? toNumber(received) : total,
      })
      const withNames: PosReceipt = { ...result, sale: { ...result.sale, cashier_name: result.sale.cashier_name ?? currentUser.name, branch_name: result.sale.branch_name ?? branchName(branch) } }
      setReceipt({ data: withNames, expectedTotal: total, reprint: false })
      setStage('receipt'); setCart([]); setSaleKey(''); setKeyFor('')
      draftStore.clear(userId)
      catalogue.current?.refresh()
      loadToday()
    } catch (e) {
      setTenderError(e instanceof ApiError
        ? (e.field('items') || e.field('quantity') || e.field('amount_received') || e.field('payment_reference') || e.message)
        : errorMessage(e, 'The sale could not be completed. Try again.'))
    } finally { setBusy(false) }
  }, [busy, branchId, cart, total, method, received, reference, saleKey, currentUser.name, branch, branchName, userId, loadToday])

  const hold = useCallback(() => {
    if (!cart.length || stage !== 'sale') return
    const first = cart[0].product.title
    const label = cart.length > 1 ? `${first} +${cart.length - 1} more` : first
    setHeld(current => [{ id: newSaleKey(), branch, label, cart, createdAt: new Date().toISOString() }, ...current].slice(0, 20))
    setCart([]); setSaleKey(''); setKeyFor('')
    notify('Sale held. Find it under Held sales.')
    catalogue.current?.focusSearch()
  }, [cart, stage, branch, notify])

  function resume(sale: HeldSale) {
    // Swap: the sale in progress is held so nothing is lost.
    const current = cart
    setHeld(rows => {
      const rest = rows.filter(row => row.id !== sale.id)
      if (!current.length) return rest
      const first = current[0].product.title
      return [{ id: newSaleKey(), branch, label: current.length > 1 ? `${first} +${current.length - 1} more` : first, cart: current, createdAt: new Date().toISOString() }, ...rest]
    })
    setBranch(sale.branch); setCart(sale.cart); setReceipt(null); setStage('sale'); setSaleKey(''); setKeyFor(''); setPanel(null)
    notify(current.length ? 'Sale resumed. The previous sale was held.' : 'Sale resumed')
    if (!wide) setSheetOpen(true)
  }

  async function openPastReceipt(sale: PosSale) {
    try {
      const data = await posApi.receipt(sale.id)
      const shown: ShownReceipt = { data: { ...data, sale: { ...data.sale, cashier_name: sale.cashier_name ?? data.sale.cashier_name, branch_name: sale.branch_name ?? data.sale.branch_name } }, expectedTotal: null, reprint: true }
      setPanel(null)
      // With a sale in progress, reprint straight away rather than replacing the ticket.
      if (cart.length || stage === 'tender') { print(shown); notify(`Printing ${sale.receipt_number}`); return }
      setReceipt(shown); setStage('receipt')
      if (!wide) setSheetOpen(true)
    } catch (e) { notify(errorMessage(e)) }
  }

  function print(shown: ShownReceipt) {
    printReceipt(receiptHtml(shown.data, profile, { shopName: brand.name, branch: shown.data.sale.branch_name || branchName(branch), cashier: shown.data.sale.cashier_name || currentUser.name }))
  }

  /* ---------------------------------------------------------- keyboard ----------------------------------------------------------- */

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (panel) return
      if (event.key === 'F2') { event.preventDefault(); if (stage === 'receipt') startNewSale(); else if (stage === 'sale') catalogue.current?.focusSearch() }
      else if (event.key === 'F9') { event.preventDefault(); if (stage === 'sale') charge(); else if (stage === 'tender') void complete() }
      else if (event.key === 'F8') { event.preventDefault(); hold() }
      else if (event.key === 'Escape') {
        if (stage === 'tender' && !busy) { event.preventDefault(); setStage('sale') }
        else if (stage === 'receipt') { event.preventDefault(); startNewSale() }
      } else if (stage === 'tender' && !typingInField(event.target) && ['1', '2', '3'].includes(event.key)) {
        event.preventDefault(); setMethod((['cash', 'mpesa', 'card'] as const)[Number(event.key) - 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [panel, stage, busy, charge, complete, hold, startNewSale])

  /* ------------------------------------------------------------ view ------------------------------------------------------------- */

  const shownReceipt = stage === 'receipt' ? receipt : null
  const ticket = shownReceipt
    ? <ReceiptView receipt={shownReceipt.data} expectedTotal={shownReceipt.expectedTotal} profile={profile} reprint={shownReceipt.reprint} onPrint={() => print(shownReceipt)} onNewSale={startNewSale} />
    : stage === 'tender'
      ? <TenderView cart={cart} method={method} received={received} reference={reference} busy={busy} error={tenderError}
          onMethod={value => { setMethod(value); setTenderError('') }} onReceived={setReceived} onReference={setReference}
          onBack={() => { setStage('sale'); setTenderError('') }} onComplete={() => void complete()} />
      : <SaleView cart={cart} flashId={flashId} profile={profile} onQuantity={changeQuantity}
          onRemove={id => setCart(current => current.filter(line => line.product.id !== id))}
          onHold={hold} onClear={() => { setCart([]); setSaleKey(''); setKeyFor('') }} onCharge={charge} />

  const initials = currentUser.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase()

  // Labels match the workspace sections, so the rail opens the same pages as the main sidebar.
  const navItems: { label: string; icon: typeof Store }[] = [
    { label: 'Dashboard', icon: LayoutDashboard },
    { label: 'Point of Sale', icon: Store },
    { label: 'Sales History', icon: ReceiptText },
    { label: 'Products & Books', icon: BookOpen },
    { label: 'Inventory & Stock', icon: Boxes },
    { label: 'Suppliers', icon: Truck },
    { label: 'Customers', icon: Users },
    { label: 'Reports & Analytics', icon: ChartNoAxesColumnIncreasing },
    { label: 'Settings', icon: Settings2 },
  ]
  const posNav = navItems.filter(item => item.label === 'Point of Sale' || canOpenSection(currentUser, item.label))
  function goToSection(section: string) {
    setNavOpen(false)
    // The unfinished sale stays saved on this device, so leaving the till loses nothing.
    if (section !== 'Point of Sale') onNavigate(section)
  }

  return <div className="pos-root flex h-dvh overflow-hidden bg-[#f4f7fc] text-[#162c4c]">
    {navOpen && <button type="button" className="fixed inset-0 z-40 bg-[#13254a]/40 md:hidden" onClick={() => setNavOpen(false)} aria-label="Close navigation" />}
    <aside className={`z-50 flex w-[76px] shrink-0 flex-col items-center border-r border-white/10 bg-[#142341] py-5 text-white shadow-lg max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:transition-transform ${navOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full'} md:relative md:translate-x-0`} aria-label="POS navigation">
      <div className="mb-7 flex size-11 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15"><BrandMark size={34} /></div>
      <nav className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto px-2 py-1 [scrollbar-width:none]" aria-label="Quick navigation">
        {posNav.map(item => { const Icon = item.icon; const active = item.label === 'Point of Sale'; return <button key={item.label} type="button" title={item.label} aria-label={item.label} aria-current={active ? 'page' : undefined} onClick={() => goToSection(item.label)} className={`relative flex size-12 items-center justify-center rounded-xl transition ${active ? 'bg-[#176cf4] text-white shadow-lg' : 'text-[#b9c9e3] hover:bg-white/10 hover:text-white'}`}><Icon size={21} aria-hidden="true" />{active && <span className="absolute -left-2 h-7 w-1 rounded-r-full bg-[#e3b450]" />}</button> })}
      </nav>
      <button type="button" title="Exit till" aria-label="Exit till" onClick={onExit} className="mt-3 flex size-11 items-center justify-center rounded-xl text-[#b9c9e3] hover:bg-white/10 hover:text-white"><LogOut size={21}/></button>
    </aside>
    <div className="flex min-w-0 flex-1 flex-col">
    <header className="flex h-[76px] shrink-0 items-center gap-3 border-b border-[#e5ebf5] bg-white px-3 text-[#13254a] shadow-sm sm:px-6">
      <button type="button" onClick={() => setNavOpen(true)} className="grid size-10 shrink-0 place-items-center rounded-xl border border-slate-200 md:hidden" aria-label="Open navigation"><Menu size={21}/></button>
      <div className="hidden shrink-0 items-center gap-3 sm:flex"><BrandMark size={38} className="rounded-lg" /><div><p className="truncate text-[17px] font-extrabold leading-tight">{brand.name}</p><p className="text-[11px] font-medium text-slate-500">Books · Knowledge · A Better You</p></div></div>
      <div className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-200 bg-[#f7f9fd] px-3 py-2 sm:ml-5"><Store size={17} className="shrink-0 text-[#176cf4]" /><label className="flex min-w-0 items-center gap-1 text-[12px] font-semibold"><span className="hidden text-slate-500 lg:inline">Branch</span><select value={branch} onChange={event => setBranch(event.target.value)} disabled={cart.length > 0 || stage === 'tender' || branches.length < 2} title={cart.length ? 'Finish or hold the current sale to switch branch' : undefined} className="max-w-[125px] cursor-pointer truncate bg-transparent text-[#13254a] outline-none focus-visible:ring-2 focus-visible:ring-blue-400 disabled:cursor-default sm:max-w-[180px]" aria-label="Branch">{branches.length === 0 && <option value="">No branch</option>}{branches.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label></div>
      <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
        {canSeeSales && <button type="button" onClick={() => { setPanel('today'); loadToday() }} className="hidden h-11 items-center gap-2 rounded-xl border border-slate-200 bg-[#f7f9fd] px-3 text-left transition hover:bg-blue-50 md:flex">
          <ReceiptText size={18} className="text-slate-500" aria-hidden="true" />
          <span className="leading-tight"><span className="block text-[11.5px] text-slate-500">Today at this branch</span>
            <span className="block text-[13.5px] font-bold tabular-nums">{todaySummary ? `${todaySummary.transactions} ${Number(todaySummary.transactions) === 1 ? 'sale' : 'sales'} · ${formatKes(toNumber(todaySummary.revenue))}` : '—'}</span></span>
        </button>}
        <button type="button" onClick={() => setPanel('held')} className="relative flex h-11 items-center gap-2 rounded-xl px-3 text-[14px] font-semibold transition hover:bg-blue-50" aria-label={`Held sales, ${held.length}`}>
          <PauseCircle size={19} aria-hidden="true" /><span className="hidden sm:inline">Held</span>
          {held.length > 0 && <span className="grid min-w-5 place-items-center rounded-full bg-[#d4a52b] px-1.5 text-[12px] font-bold tabular-nums text-[#13254a]">{held.length}</span>}
        </button>
        {canSeeSales && <button type="button" onClick={() => { setPanel('today'); loadToday() }} className="grid size-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 md:hidden" aria-label="Today's sales"><ReceiptText size={19} /></button>}
        <button type="button" onClick={() => setPanel('shortcuts')} className="hidden size-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 sm:grid" aria-label="Keyboard shortcuts" title="Keyboard shortcuts"><Keyboard size={19} /></button>
        <div className="mx-1 hidden h-8 w-px bg-slate-200 lg:block" aria-hidden="true" />
        <div className="hidden items-center gap-2 lg:flex">
          <span className="grid size-9 place-items-center rounded-full bg-[#e9f0ff] text-[12.5px] font-bold">{initials}</span>
          <span className="leading-tight"><span className="block max-w-[9rem] truncate text-[13.5px] font-semibold">{currentUser.name}</span><span className="block text-[11.5px] text-slate-500">{currentUser.role_label}</span></span>
        </div>
        <button type="button" onClick={onExit} className="flex h-11 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-[13.5px] font-semibold transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700">
          <LogOut size={16} aria-hidden="true" /><span className="hidden sm:inline">Exit till</span>
        </button>
      </div>
    </header>

    {branchError ? <div className="m-6 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-[14px] text-amber-900" role="alert">{branchError}</div>
      : <div className="flex min-h-0 flex-1">
        <PosCatalogue ref={catalogue} branchId={branchId} categories={categories} inCart={inCart} locked={stage === 'tender'} onAdd={add} />
        {wide && <aside className="flex w-[420px] shrink-0 flex-col pr-5 pb-4 pt-4 xl:w-[460px]">{ticket}</aside>}
      </div>}

    {!wide && !branchError && <>
      {!sheetOpen && <button type="button" onClick={() => setSheetOpen(true)}
        className="fixed inset-x-3 bottom-3 z-30 flex h-16 items-center justify-between gap-3 rounded-2xl bg-[#13254a] px-5 text-white shadow-[0_12px_30px_-10px_rgba(13,27,55,.6)]">
        <span className="flex items-center gap-2.5 text-[15px] font-semibold"><ShoppingBag size={20} aria-hidden="true" />{units ? `${units} ${units === 1 ? 'item' : 'items'}` : 'Current sale'}</span>
        <span className="text-[18px] font-extrabold tabular-nums">{formatKes(total)}</span>
      </button>}
      {sheetOpen && <div className="fixed inset-0 z-40 flex flex-col bg-[#eef1f6]" role="dialog" aria-modal="true" aria-label="Current sale">
        <div className="flex h-14 shrink-0 items-center px-2">
          <button type="button" onClick={() => setSheetOpen(false)} disabled={busy} className="inline-flex h-10 items-center gap-1 rounded-lg px-2.5 text-[14px] font-semibold text-slate-700 hover:bg-white">
            <ChevronLeft size={18} /> Products
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col px-3">{ticket}</div>
      </div>}
    </>}

    {panel === 'held' && <HeldSalesPanel held={held} branchName={branchName} onResume={resume} onClose={() => setPanel(null)}
      onDiscard={sale => { setHeld(rows => rows.filter(row => row.id !== sale.id)); notify('Held sale discarded') }} />}
    {panel === 'today' && <TodayPanel sales={todaySales} summary={todaySummary} loading={todayLoading} error={todayError} onRetry={loadToday} onOpen={sale => void openPastReceipt(sale)} onClose={() => setPanel(null)} />}
    {panel === 'shortcuts' && <ShortcutsPanel onClose={() => setPanel(null)} />}
    </div>
  </div>
}
