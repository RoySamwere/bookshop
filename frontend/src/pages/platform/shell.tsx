import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Building2, ChevronDown, CreditCard, Mail, Gauge, History, LayoutGrid, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Plus, ReceiptText, Search, Settings, Store, Users, X, Zap } from 'lucide-react'
import { useRouter } from '@/lib/navigation'
import BrandLoader from '../../components/brand-loader'
import { BrandMark } from '../../components/brand-mark'
import { useAuth } from '../../features/auth/auth-provider'
import { hasPermission, homeFor, logout, type BookshopUser, type Permission } from '../../lib/auth'
import { fieldClass } from './platform-ui'
import './platform.css'

type NavItem = { to: string; label: string; icon: typeof Gauge; permission: Permission; ownerOnly?: boolean; end?: boolean }

/** Every platform area, grouped by the job it serves. Plans and Bills now live inside Billing. */
export const NAV_GROUPS: { label?: string; items: NavItem[] }[] = [
  { items: [{ to: '/platform', label: 'Overview', icon: Gauge, permission: 'platform.access', end: true }] },
  { label: 'Bookshops', items: [
    { to: '/platform/bookshops', label: 'Bookshops', icon: Store, permission: 'platform.bookshops.view' },
    { to: '/platform/management', label: 'Bookshop management', icon: Building2, permission: 'platform.access', ownerOnly: true },
  ] },
  { label: 'Revenue', items: [{ to: '/platform/billing', label: 'Billing', icon: CreditCard, permission: 'platform.settings.view' }] },
  { label: 'Communication', items: [{ to: '/platform/communications', label: 'Communication', icon: Mail, permission: 'platform.communications.manage' }] },
  { label: 'Administration', items: [
    { to: '/platform/users', label: 'Platform users', icon: Users, permission: 'platform.users.view' },
    { to: '/platform/settings', label: 'Settings', icon: Settings, permission: 'platform.settings.view' },
    { to: '/platform/audit', label: 'Audit history', icon: History, permission: 'platform.audit.view' },
  ] },
]

const allowed = (user: BookshopUser, item: { permission: Permission; ownerOnly?: boolean }) => hasPermission(user, item.permission) && (!item.ownerOnly || user.role === 'platform_owner')
const COLLAPSE_KEY = 'pf-sidebar-collapsed'
function readCollapsed() { try { return localStorage.getItem(COLLAPSE_KEY) === '1' } catch { return false } }
function writeCollapsed(value: boolean) { try { localStorage.setItem(COLLAPSE_KEY, value ? '1' : '0') } catch { /* per-viewer convenience only */ } }

export function PlatformShell() {
  const { user, loading } = useAuth()
  const location = useLocation()
  const [drawer, setDrawer] = useState(false)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  useEffect(() => { setDrawer(false) }, [location.pathname])

  if (loading) return <BrandLoader />
  if (!user) return <Navigate replace to={`/login?next=${encodeURIComponent(location.pathname)}`} />
  if (user.account_type !== 'platform' || !hasPermission(user, 'platform.access')) return <Navigate replace to={homeFor(user)} />

  const toggleCollapsed = () => setCollapsed(current => { writeCollapsed(!current); return !current })
  const rail = collapsed && !drawer

  return <div className="pf min-h-screen">
    <a className="skip-link" href="#platform-content">Skip to content</a>
    <TopBar user={user} onMenu={() => setDrawer(true)} collapsed={collapsed} onCollapse={toggleCollapsed} />
    <aside aria-label="Platform console"
      className={`fixed bottom-0 left-0 top-0 z-40 flex flex-col border-r border-[var(--pf-line)] bg-white transition-[width,transform] duration-200 lg:top-14 lg:z-20 lg:translate-x-0 ${drawer ? 'w-72 translate-x-0 shadow-2xl' : '-translate-x-full'} ${rail ? 'lg:w-[72px]' : 'lg:w-60'}`}>
      <div className="flex h-14 items-center gap-3 border-b border-[var(--pf-line)] px-4 lg:hidden">
        <BrandMark size={30} /><span className="font-semibold">Hekima Platform</span>
        <button className="ml-auto grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100" onClick={() => setDrawer(false)} aria-label="Close navigation"><X size={18} /></button>
      </div>
      <nav aria-label="Platform navigation" className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {NAV_GROUPS.map((group, index) => {
          const items = group.items.filter(item => allowed(user, item))
          if (!items.length) return null
          return <div key={group.label ?? index} className="mb-5">
            {group.label && <p className={`mb-1.5 px-3 text-xs font-medium text-slate-400 ${rail ? 'lg:sr-only' : ''}`}>{group.label}</p>}
            <ul className="m-0 grid list-none gap-0.5 p-0">{items.map(({ to, label, icon: Icon, end }) => <li key={to}>
              <NavLink to={to} end={end} title={rail ? label : undefined}
                className={({ isActive }) => `relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition ${rail ? 'lg:justify-center lg:px-0' : ''} ${isActive ? 'bg-blue-50 text-[var(--pf-ink)] before:absolute before:inset-y-2 before:left-0 before:w-[3px] before:rounded-full before:bg-[var(--pf-brand)]' : 'text-[var(--pf-muted)] hover:bg-slate-50 hover:text-[var(--pf-ink)]'}`}>
                {({ isActive }) => <><Icon size={18} aria-hidden="true" className={isActive ? 'text-[var(--pf-brand)]' : ''} /><span className={rail ? 'lg:sr-only' : ''}>{label}</span></>}
              </NavLink>
            </li>)}</ul>
          </div>
        })}
      </nav>
      <div className={`border-t border-[var(--pf-line)] p-3 text-xs text-[var(--pf-muted)] ${rail ? 'lg:hidden' : ''}`}>
        <p className="m-0 truncate font-semibold text-[var(--pf-ink)]">{user.name}</p>
        <p className="m-0">{user.role_label}</p>
      </div>
    </aside>
    {drawer && <div className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" onClick={() => setDrawer(false)} aria-hidden="true" />}
    <main id="platform-content" tabIndex={-1} className={`pb-24 pt-14 transition-[padding] duration-200 lg:pb-10 ${collapsed ? 'lg:pl-[72px]' : 'lg:pl-60'}`}>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-8"><Outlet /></div>
    </main>
    <BottomBar user={user} onMenu={() => setDrawer(true)} />
  </div>
}

function TopBar({ user, onMenu, collapsed, onCollapse }: { user: BookshopUser; onMenu: () => void; collapsed: boolean; onCollapse: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const canSearch = hasPermission(user, 'platform.bookshops.view')
  function search(event: FormEvent) {
    event.preventDefault()
    const q = query.trim()
    navigate(q ? `/platform/bookshops?q=${encodeURIComponent(q)}` : '/platform/bookshops')
    setQuery('')
  }
  return <header className="fixed inset-x-0 top-0 z-30 flex h-14 items-center gap-2 border-b border-[var(--pf-line)] bg-white/95 px-3 backdrop-blur sm:px-4">
    <button className="grid size-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 lg:hidden" onClick={onMenu} aria-label="Open navigation"><Menu size={20} /></button>
    <button className="hidden size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 lg:grid" onClick={onCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-pressed={collapsed}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
    <Link to="/platform" className="flex items-center gap-2.5 rounded-lg px-1 py-1" aria-label="Hekima Platform home">
      <BrandMark size={30} />
      <span className="hidden leading-tight sm:block"><span className="block text-sm font-semibold text-[var(--pf-ink)]">Hekima Bookshop</span><span className="block text-xs text-[var(--pf-muted)]">Platform console</span></span>
    </Link>
    {canSearch && <form role="search" onSubmit={search} className="relative ml-4 hidden w-full max-w-sm md:block">
      <label htmlFor="pf-global-search" className="sr-only">Find a bookshop</label>
      <Search size={15} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
      <input id="pf-global-search" className={`${fieldClass} h-9 bg-slate-50 pl-9`} value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a bookshop by name, code or email" />
    </form>}
    <div className="ml-auto flex items-center gap-1.5">
      {canSearch && <Link to="/platform/bookshops" className="grid size-9 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 md:hidden" aria-label="Search bookshops"><Search size={18} /></Link>}
      {hasPermission(user, 'platform.bookshops.onboard') && <Link to="/platform/bookshops?create=1" className="hidden h-9 items-center gap-1.5 rounded-lg bg-[var(--pf-brand)] px-3 text-sm font-semibold text-white hover:brightness-105 sm:inline-flex"><Plus size={16} /> New bookshop</Link>}
      <QuickAccess user={user} />
      <AccountMenu user={user} />
    </div>
  </header>
}

/** Small accessible dropdown: closes on outside click, Escape or choosing an item. */
function Dropdown({ label, trigger, children, triggerClass }: { label: string; trigger: ReactNode; children: (close: () => void) => ReactNode; triggerClass: string }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside); document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  return <div ref={root} className="relative">
    <button type="button" className={triggerClass} aria-label={label} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(value => !value)}>{trigger}</button>
    {open && <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-64 overflow-hidden rounded-xl border border-[var(--pf-line)] bg-white py-1.5 shadow-xl shadow-slate-900/10">{children(() => setOpen(false))}</div>}
  </div>
}
const menuItem = 'flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-[var(--pf-ink)] hover:bg-slate-50'

function QuickAccess({ user }: { user: BookshopUser }) {
  const links = [
    { to: '/platform/billing/payments', label: 'M-Pesa payments', icon: ReceiptText, ok: hasPermission(user, 'platform.settings.view') },
    { to: '/platform/billing/invoices', label: 'Invoices', icon: CreditCard, ok: hasPermission(user, 'platform.settings.view') },
    { to: '/platform/billing/trials', label: 'Trial management', icon: Zap, ok: hasPermission(user, 'platform.subscriptions.extend_trial') },
    { to: '/platform/bookshops?status=pending_verification', label: 'Bookshops awaiting approval', icon: Store, ok: hasPermission(user, 'platform.bookshops.view') },
    { to: '/platform/communications/announcements', label: 'Send an announcement', icon: Mail, ok: hasPermission(user, 'platform.communications.manage') },
    { to: '/platform/audit', label: 'Audit history', icon: History, ok: hasPermission(user, 'platform.audit.view') },
  ].filter(link => link.ok)
  if (!links.length) return null
  return <Dropdown label="Quick access" triggerClass="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100" trigger={<><LayoutGrid size={17} /><span className="hidden xl:inline">Quick access</span></>}>
    {close => <ul className="m-0 list-none p-0">{links.map(({ to, label, icon: Icon }) => <li key={to}><Link to={to} className={menuItem} onClick={close}><Icon size={16} className="text-slate-400" />{label}</Link></li>)}</ul>}
  </Dropdown>
}

function AccountMenu({ user }: { user: BookshopUser }) {
  const router = useRouter()
  const initials = user.name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('')
  return <Dropdown label="Account menu" triggerClass="flex h-9 items-center gap-2 rounded-lg pl-1 pr-2 hover:bg-slate-100"
    trigger={<><span aria-hidden="true" className="grid size-7 place-items-center rounded-full bg-[var(--pf-ink)] text-xs font-semibold text-white">{initials || '?'}</span><ChevronDown size={14} className="hidden text-slate-400 sm:block" /></>}>
    {close => <>
      <div className="border-b border-[var(--pf-line)] px-3.5 pb-2.5 pt-1.5">
        <p className="m-0 truncate text-sm font-semibold">{user.name}</p>
        <p className="m-0 truncate text-xs text-[var(--pf-muted)]">{user.email}</p>
        <p className="m-0 mt-1 text-xs text-[var(--pf-muted)]">{user.role_label}</p>
      </div>
      <div className="py-1">
        {hasPermission(user, 'platform.settings.view') && <Link to="/platform/settings" className={menuItem} onClick={close}><Settings size={16} className="text-slate-400" />Platform settings</Link>}
        {hasPermission(user, 'platform.audit.view') && <Link to="/platform/audit" className={menuItem} onClick={close}><History size={16} className="text-slate-400" />Audit history</Link>}
      </div>
      <div className="border-t border-[var(--pf-line)] pt-1">
        <button type="button" className={`${menuItem} text-rose-700`} onClick={() => { close(); void logout().then(() => router.replace('/login?signed_out=1')) }}><LogOut size={16} />Sign out</button>
      </div>
    </>}
  </Dropdown>
}

/** Phone-only quick access along the bottom edge, using the same names as the sidebar. */
function BottomBar({ user, onMenu }: { user: BookshopUser; onMenu: () => void }) {
  const items = [
    { to: '/platform', label: 'Overview', icon: Gauge, end: true, ok: true },
    { to: '/platform/bookshops', label: 'Bookshops', icon: Store, ok: hasPermission(user, 'platform.bookshops.view') },
    { to: '/platform/billing', label: 'Billing', icon: CreditCard, end: true, ok: hasPermission(user, 'platform.settings.view') },
    { to: '/platform/billing/payments', label: 'Payments', icon: ReceiptText, ok: hasPermission(user, 'platform.settings.view') },
  ].filter(item => item.ok)
  return <nav aria-label="Quick navigation" className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--pf-line)] bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
    <ul className="m-0 grid list-none p-0" style={{ gridTemplateColumns: `repeat(${items.length + 1}, minmax(0, 1fr))` }}>
      {items.map(({ to, label, icon: Icon, end }) => <li key={to}><NavLink to={to} end={end} className={({ isActive }) => `flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium ${isActive ? 'text-[var(--pf-brand)]' : 'text-[var(--pf-muted)]'}`}><Icon size={20} aria-hidden="true" /><span className="text-[11px] leading-none">{label}</span></NavLink></li>)}
      <li><button type="button" onClick={onMenu} className="flex h-16 w-full flex-col items-center justify-center gap-1 text-[11px] font-medium text-[var(--pf-muted)]"><Menu size={20} aria-hidden="true" /><span className="text-[11px] leading-none">More</span></button></li>
    </ul>
  </nav>
}
