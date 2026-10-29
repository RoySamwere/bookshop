'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUpRight, BarChart3, Bell, BookOpen, Boxes, CheckCheck, ChevronDown, ChevronLeft,
  ChevronRight, FileText, History, LayoutDashboard, LogOut, Menu, Plus, Search, Settings,
  ShieldCheck, ShoppingCart, Truck, UserRound, Users, WalletCards, X,
} from 'lucide-react'
import { hasPermission, roleLabel, type BookshopUser, type Permission } from '../lib/auth'
import { notificationsApi, type AppNotification } from '../lib/workspace-api'
import { formatDate } from './ui-kit'
import { BrandMark } from './brand-mark'
import { brand } from '../lib/brand'

export const PROFILE_SECTION = 'My Profile'

const sections = [
  { label: 'Dashboard', description: 'Your shop at a glance', icon: LayoutDashboard, permission: 'dashboard.view' },
  { label: 'Point of Sale', description: 'Create a sale and collect payment', icon: ShoppingCart, permission: 'pos.access' },
  { label: 'Sales History', description: 'Receipts and transactions', icon: FileText, permission: 'sales.view' },
  { label: 'Products & Books', description: 'Browse and manage your catalogue', icon: BookOpen, permission: 'catalog.view' },
  { label: 'Inventory & Stock', description: 'Stock levels and replenishment', icon: Boxes, permission: 'inventory.view' },
  { label: 'Suppliers', description: 'Your suppliers and publishing partners', icon: Truck, permission: 'suppliers.view' },
  { label: 'Customers', description: 'Your customer directory', icon: Users, permission: 'customers.view' },
  { label: 'Reports & Analytics', description: 'Sales and performance insights', icon: BarChart3, permission: 'reports.view' },
  { label: 'Expenses', description: 'Shop expenses', icon: WalletCards, group: 'workspace', permission: 'expenses.manage' },
  { label: 'Users', description: 'Team accounts and access rights', icon: Users, group: 'workspace', permission: 'users.view' },
  { label: 'Audit Log', description: 'Sign-ins and account changes', icon: History, group: 'workspace', permission: 'audit.view' },
  { label: 'Settings', description: 'Business, branches, tax and receipts', icon: Settings, group: 'workspace', permission: 'settings.view' },
  { label: PROFILE_SECTION, description: 'Your details and password', icon: UserRound, group: 'account' },
] satisfies { label: string; description: string; icon: typeof BookOpen; group?: string; permission?: Permission }[]

/** Whether the user may open a section; the server enforces the same rules on its data. */
export function canOpenSection(user: BookshopUser, label: string) {
  const section = sections.find(item => item.label === label)
  if (!section) return false
  return !('permission' in section) || !section.permission || hasPermission(user, section.permission)
}

export function firstSection(user: BookshopUser) {
  return sections.find(section => canOpenSection(user, section.label))?.label || PROFILE_SECTION
}

// Polls unread notifications so the bell stays current without a page reload.
function useNotifications() {
  const [items, setItems] = useState<AppNotification[]>([])
  const [unread, setUnread] = useState(0)
  const refresh = useCallback(() => notificationsApi.list().then(result => { setItems(result.data); setUnread(result.meta.unread) }).catch(() => undefined), [])
  useEffect(() => {
    void refresh()
    const timer = window.setInterval(refresh, 60000)
    return () => window.clearInterval(timer)
  }, [refresh])
  return { items, unread, refresh }
}

// Shared dismissal and focus behavior for the drawer, search, and popovers.
function useOverlay<T extends HTMLElement>(open: boolean, close: () => void, modal = false) {
  const panelRef = useRef<T>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef(close)
  useEffect(() => { closeRef.current = close }, [close])

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    const focusable = () => Array.from(panel?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), a[href], [tabindex="0"]',
    ) || []).filter(element => element.getClientRects().length > 0)
    if (modal) (focusable()[0] || panel)?.focus()
    function keydown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeRef.current()
      }
      if (modal && event.key === 'Tab') {
        const items = focusable()
        const first = items[0]
        const last = items[items.length - 1]
        if (event.shiftKey && (document.activeElement === first || !panel?.contains(document.activeElement))) {
          event.preventDefault(); last?.focus()
        } else if (!event.shiftKey && (document.activeElement === last || !panel?.contains(document.activeElement))) {
          event.preventDefault(); first?.focus()
        }
      }
    }
    function outside(event: PointerEvent) {
      if (!modal && !panel?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) closeRef.current()
    }
    function focusout(event: FocusEvent) {
      if (!modal && !panel?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) closeRef.current()
    }
    document.addEventListener('keydown', keydown)
    document.addEventListener('pointerdown', outside)
    document.addEventListener('focusin', focusout)
    return () => {
      document.removeEventListener('keydown', keydown)
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('focusin', focusout)
      // Do not steal focus from the next control after an outside click.
      if (modal || panel?.contains(document.activeElement)) {
        if (previous?.isConnected && !previous.closest('[inert]')) previous.focus()
      }
    }
  }, [open, modal])
  return { panelRef, triggerRef }
}

export function WorkspaceShell({ currentUser, active, onNavigate, onSignOut, children }: {
  currentUser: BookshopUser; active: string; onNavigate: (section: string) => void
  onSignOut: () => Promise<void>; children: ReactNode
}) {
  const posMode = active === 'Point of Sale'
  const [collapsed, setCollapsed] = useState(false)
  const [mobile, setMobile] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [accountOpen, setAccountOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [today, setToday] = useState('')
  const mainRef = useRef<HTMLDivElement>(null)
  const drawer = useOverlay<HTMLElement>(drawerOpen, () => setDrawerOpen(false), true)
  const account = useOverlay<HTMLDivElement>(accountOpen, () => setAccountOpen(false))
  const notifications = useOverlay<HTMLDivElement>(notificationsOpen, () => setNotificationsOpen(false))
  const command = useOverlay<HTMLDivElement>(searchOpen, () => setSearchOpen(false), true)
  const visibleSections = sections.filter(section => canOpenSection(currentUser, section.label))
  const initials = currentUser.name.split(' ').map(word => word[0]).slice(0, 2).join('').toUpperCase()
  const modalOpen = drawerOpen || searchOpen
  const branchLabel = currentUser.role === 'system_owner' ? 'All branches' : currentUser.branches.map(branch => branch.name).join(' · ') || 'No branch assigned'
  const alerts = useNotifications()

  async function openNotification(item: AppNotification) {
    if (!item.read_at) await notificationsApi.markRead(item.id).catch(() => undefined)
    void alerts.refresh()
    if (item.section && canOpenSection(currentUser, item.section)) navigate(item.section)
  }

  useEffect(() => {
    try { setCollapsed(localStorage.getItem('bookshop_sidebar_v1') === 'collapsed') } catch { /* Storage may be disabled. */ }
    const media = window.matchMedia('(max-width: 1023px)')
    const resize = () => { setMobile(media.matches); setDrawerOpen(false) }
    resize()
    media.addEventListener('change', resize)
    const updateDate = () => setToday(new Intl.DateTimeFormat('en-KE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date()))
    updateDate()
    const timer = window.setInterval(updateDate, 60000)
    return () => { media.removeEventListener('change', resize); window.clearInterval(timer) }
  }, [])

  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 })
  }, [active])

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setDrawerOpen(false); setAccountOpen(false); setNotificationsOpen(false)
        setSearchOpen(previous => !previous)
      }
      if (event.key === 'F9' && !posMode && hasPermission(currentUser, 'pos.access')) {
        event.preventDefault()
        onNavigate('Point of Sale')
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [posMode, currentUser, onNavigate])

  function navigate(section: string) {
    onNavigate(section)
    setDrawerOpen(false); setAccountOpen(false); setNotificationsOpen(false); setSearchOpen(false)
    mainRef.current?.scrollTo({ top: 0 })
    // The next page heading provides context to keyboard and screen-reader users.
    window.requestAnimationFrame(() => mainRef.current?.querySelector<HTMLElement>('h1')?.focus())
  }

  function toggleCollapse() {
    setCollapsed(previous => {
      const next = !previous
      try { localStorage.setItem('bookshop_sidebar_v1', next ? 'collapsed' : 'expanded') } catch { /* Optional preference. */ }
      return next
    })
  }

  useEffect(() => { if (posMode) { setDrawerOpen(false); setSearchOpen(false); setNotificationsOpen(false); setAccountOpen(false) } }, [posMode])

  const results = visibleSections.filter(section => `${section.label} ${section.description}`.toLowerCase().includes(search.toLowerCase()))
  const groups = [
    { name: 'Sell', labels: ['Dashboard', 'Point of Sale', 'Sales History'] },
    { name: 'Stock', labels: ['Products & Books', 'Inventory & Stock', 'Suppliers'] },
    { name: 'People', labels: ['Customers', 'Users'] },
    { name: 'Insights', labels: ['Reports & Analytics', 'Expenses'] },
    { name: 'Admin', labels: ['Audit Log', 'Settings'] },
  ]
  const displayLabel: Record<string, string> = { 'Point of Sale': 'Point of sale', 'Sales History': 'Sales history', 'Products & Books': 'Products & books', 'Inventory & Stock': 'Inventory', 'Users': 'Team & access', 'Reports & Analytics': 'Reports', 'Audit Log': 'Audit log' }

  function navButton(section: typeof sections[number]) {
    const Icon = section.icon
    return <button key={section.label} className={`sidebar-link ${active === section.label ? 'is-active' : ''}`}
      onClick={() => navigate(section.label)} aria-label={section.label} aria-current={active === section.label ? 'page' : undefined}
      title={collapsed && !mobile ? section.label : undefined}>
      <Icon size={19} aria-hidden="true" /><span className="sidebar-link-label">{displayLabel[section.label] || section.label}</span>
      {active === section.label && <span className="sidebar-active-dot" aria-hidden="true" />}
    </button>
  }

  return <div className={`workspace-shell ${active === 'Dashboard' ? 'dashboard-mode' : ''} ${posMode ? 'pos-focus-mode' : ''} ${collapsed ? 'nav-collapsed' : ''} ${drawerOpen ? 'drawer-open' : ''} ${modalOpen ? 'overlay-open' : ''}`}>
    <a className="skip-link" href="#workspace-content">Skip to content</a>
    {drawerOpen && <div className="sidebar-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}
    {!posMode && <aside id="app-navigation" className="app-sidebar" ref={drawer.panelRef} tabIndex={-1}
      role={mobile && drawerOpen ? 'dialog' : undefined} aria-modal={mobile && drawerOpen ? true : undefined}
      aria-label="Main navigation" inert={(mobile && !drawerOpen) || searchOpen}>
      <div className="sidebar-brand">
        <BrandMark size={46} className="flex-none" />
        <div className="sidebar-brand-copy"><strong>{brand.shortName}<span>Bookshop</span></strong></div>
        <button className="sidebar-collapse" onClick={toggleCollapse} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} aria-controls="app-navigation">{collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}</button>
        <button className="header-icon drawer-close" aria-label="Close navigation" onClick={() => setDrawerOpen(false)}><X size={21} /></button>
      </div>
      <div className="sidebar-scroll">
        <div className="shop-indicator" title={branchLabel}><span className="shop-icon"><ShoppingCart size={18} /></span><div><strong>{branchLabel}</strong><small><span className="status-dot" /> Bookshop workspace</small></div><ChevronDown size={14} /></div>
        {hasPermission(currentUser, 'pos.access') && <button className="sidebar-new-sale" onClick={() => navigate('Point of Sale')} title="New sale"><Plus size={19} /><span>New sale</span></button>}
        {groups.map(group => { const items = visibleSections.filter(section => group.labels.includes(section.label)); return items.length > 0 && <div className="sidebar-nav-group" key={group.name}><div className="sidebar-group-label">{group.name}</div><nav className="sidebar-links" aria-label={group.name}>{items.map(navButton)}</nav></div> })}
      </div>
      <div className="sidebar-footer">
        <div className="sidebar-identity"><button className="user-avatar" onClick={() => navigate(PROFILE_SECTION)} aria-label="My profile">{initials}</button><div><strong>{currentUser.name}</strong><span>{roleLabel(currentUser.role)}</span></div><button className="sidebar-signout" onClick={() => void onSignOut()} aria-label="Sign out"><LogOut size={18} /></button></div>
      </div>
    </aside>}

    <div className={`workspace-main ${posMode ? '!ml-0 !w-full !max-w-none' : ''}`} ref={mainRef} inert={modalOpen}>
      {/* The till draws its own top bar (brand, branch, held sales, exit). */}
      {!posMode && <header className="app-header">
        <div className="header-leading">
          <button ref={drawer.triggerRef} className="header-icon mobile-nav-trigger" aria-label="Open navigation" aria-expanded={drawerOpen} aria-controls="app-navigation" onClick={() => { setDrawerOpen(true); setAccountOpen(false); setNotificationsOpen(false) }}><Menu size={22} /></button>
          {active === 'Dashboard' ? <div className="dashboard-greeting"><p>{today}</p><h1>{new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'}, {currentUser.name.split(' ')[0]}</h1></div> : <div className="header-breadcrumb"><span>{currentUser.role === 'system_owner' ? 'All branches' : currentUser.branches[0]?.name || 'Workspace'}</span><ChevronRight size={13} aria-hidden="true" /><strong>{active}</strong></div>}
        </div>
        <div className="header-actions">
          <button ref={command.triggerRef} className="workspace-search" aria-label="Search workspace" aria-haspopup="dialog" aria-expanded={searchOpen} aria-keyshortcuts="Control+k Meta+k" onClick={() => { setSearch(''); setSearchOpen(true); setAccountOpen(false); setNotificationsOpen(false) }}>
            <Search size={17} /><span>Search products, receipts or people</span><kbd>Ctrl K</kbd>
          </button>
          <time className="header-date">{today}</time>
          {hasPermission(currentUser, 'pos.access') && <button className="header-pos" onClick={() => navigate('Point of Sale')} aria-label="New sale"><Plus size={17} /><span>New sale</span></button>}
          <div className="header-popover-wrap notification-wrap">
            <button ref={notifications.triggerRef} className={`header-icon ${notificationsOpen ? 'is-open' : ''}`} aria-label={`Notifications${alerts.unread ? `, ${alerts.unread} unread` : ''}`} aria-expanded={notificationsOpen} aria-controls="workspace-notifications"
              onClick={() => { setNotificationsOpen(previous => !previous); setAccountOpen(false); void alerts.refresh() }}><Bell size={19} />{alerts.unread > 0 && <span className="notification-indicator" />}</button>
            {notificationsOpen && <div ref={notifications.panelRef} id="workspace-notifications" className="header-popover notification-popover">
              <div className="popover-title"><strong>Notifications</strong><span>{alerts.unread ? `${alerts.unread} unread` : 'You are all caught up'}</span></div>
              <div className="max-h-80 overflow-y-auto">
                {alerts.items.length === 0 ? <div className="notification-content"><span className="notification-symbol"><Bell size={20} /></span><div><strong>No notifications yet</strong><p>Account and team updates will appear here.</p></div></div>
                  : alerts.items.map(item => <button key={item.id} className={`flex w-full gap-3 rounded-lg px-2 py-2.5 text-left transition hover:bg-slate-50 ${item.read_at ? 'opacity-70' : ''}`} onClick={() => void openNotification(item)}>
                    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${item.read_at ? 'bg-slate-200' : item.level === 'warning' ? 'bg-amber-500' : 'bg-[#087df5]'}`} />
                    <span className="min-w-0"><strong className="block text-[13px] text-slate-800">{item.title}</strong><span className="mt-0.5 block text-xs text-slate-500">{item.body}</span><small className="mt-1 block text-[11px] text-slate-400">{formatDate(item.created_at, true)}</small></span>
                  </button>)}
              </div>
              {alerts.unread > 0 && <button className="popover-link" onClick={() => { void notificationsApi.markAllRead().then(alerts.refresh) }}>Mark all as read <CheckCheck size={16} /></button>}
            </div>}
          </div>
          <div className="header-divider" />
          <div className="header-popover-wrap">
            <button ref={account.triggerRef} className={`profile-trigger ${accountOpen ? 'is-open' : ''}`} aria-label="Account options" aria-expanded={accountOpen} aria-controls="account-options" onClick={() => { setAccountOpen(previous => !previous); setNotificationsOpen(false) }}>
              <span className="user-avatar">{initials}</span><span className="profile-trigger-copy"><strong>{currentUser.name}</strong><small>{roleLabel(currentUser.role)}</small></span><ChevronDown size={15} className="profile-chevron" />
            </button>
            {accountOpen && <div ref={account.panelRef} id="account-options" className="header-popover profile-popover">
              <div className="popover-title"><strong>{currentUser.name}</strong><span>{currentUser.email}</span><small>{roleLabel(currentUser.role)} · {branchLabel}</small></div>
              <button className="popover-action" onClick={() => navigate(PROFILE_SECTION)}><UserRound size={17} /> My profile and password</button>
              {hasPermission(currentUser, 'users.view') && <button className="popover-action" onClick={() => navigate('Users')}><Users size={17} /> Manage team</button>}
              {hasPermission(currentUser, 'settings.view') && <button className="popover-action" onClick={() => navigate('Settings')}><Settings size={17} /> Workspace settings</button>}
              <button className="popover-action signout-action" onClick={() => { setAccountOpen(false); void onSignOut() }}><LogOut size={17} /> Sign out</button>
            </div>}
          </div>
        </div>
      </header>}
      <main id="workspace-content" tabIndex={-1}>{children}</main>
    </div>

    {searchOpen && <div className="command-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSearchOpen(false) }}>
      <div ref={command.panelRef} className="command-dialog" role="dialog" aria-modal="true" aria-labelledby="workspace-search-title" tabIndex={-1}>
        <div className="command-input-row"><Search size={21} aria-hidden="true" /><label className="sr-only" id="workspace-search-title" htmlFor="workspace-search-input">Search workspace</label>
          <input id="workspace-search-input" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Where would you like to go?"
            onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); command.panelRef.current?.querySelector<HTMLButtonElement>('[data-search-result]')?.focus() } if (event.key === 'Enter' && results[0]) navigate(results[0].label) }} />
          <button className="header-icon" aria-label="Close search" onClick={() => setSearchOpen(false)}><X size={19} /></button>
        </div>
        <div className="command-results" onKeyDown={event => {
          if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
          event.preventDefault()
          const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-search-result]'))
          const index = items.indexOf(document.activeElement as HTMLButtonElement)
          items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
        }}>
          <p className="command-caption">WORKSPACES <span aria-live="polite">{results.length} results</span></p>
          {results.map(({ label, description, icon: Icon }) => <button key={label} className="command-result" data-search-result onClick={() => navigate(label)}><span className="command-result-icon"><Icon size={19} /></span><span><strong>{label}</strong><small>{description}</small></span><ChevronRight size={16} /></button>)}
          {results.length === 0 && <div className="command-empty">No workspaces match “{search}”. Try products, stock, or sales.</div>}
        </div>
        <div className="command-footer"><span>↑ ↓ to move · Enter to open</span><span>Esc to close</span></div>
      </div>
    </div>}
  </div>
}
