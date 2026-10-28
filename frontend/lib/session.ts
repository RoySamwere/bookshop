import { api, IDLE_TIMEOUT_MS, tokenStore, UNAUTHORIZED_EVENT } from './api'
import { logout } from './auth'

/** Watches actual interaction, including sleep/wake and shared remembered sessions. */
export function startSessionMonitor(onExpired: (reason: 'idle' | 'expired') => void) {
  const sessionToken = tokenStore.get()
  if (!sessionToken) { onExpired('expired'); return () => undefined }
  let lastActivity = tokenStore.lastActivity() ?? Date.now()
  let lastSynced = tokenStore.syncedActivity()
  let timer: ReturnType<typeof setTimeout>
  let ended = false
  let syncing = false
  if (!tokenStore.lastActivity()) tokenStore.touch(lastActivity)

  function end(reason: 'idle' | 'expired') {
    if (ended) return
    ended = true
    clearTimeout(timer)
    // Clear locally immediately; revoke only this token in the background.
    if (tokenStore.get() === sessionToken) void logout().catch(() => undefined)
    onExpired(reason)
  }
  function check() {
    if (ended) return false
    const current = tokenStore.get()
    if (current !== sessionToken) { end('expired'); return false }
    lastActivity = Math.max(lastActivity, tokenStore.lastActivity() ?? 0)
    if (Date.now() - lastActivity >= IDLE_TIMEOUT_MS) { end('idle'); return false }
    clearTimeout(timer)
    timer = setTimeout(check, Math.max(1, IDLE_TIMEOUT_MS - (Date.now() - lastActivity)))
    return true
  }
  function activity(event: Event) {
    if (!event.isTrusted || document.visibilityState === 'hidden' || !check()) return
    // Avoid a storage write on every pointer movement.
    if (Date.now() - lastActivity < 1000) return
    lastActivity = Date.now()
    tokenStore.touch(lastActivity)
    check()
  }
  async function heartbeat() {
    if (!check() || syncing || lastActivity <= lastSynced) return
    syncing = true
    const snapshot = lastActivity
    try {
      await api('/auth/activity', { method: 'POST' })
      lastSynced = snapshot
      if (tokenStore.get() === sessionToken) tokenStore.markActivitySynced(snapshot)
    } catch { /* The API handles 401; temporary network failures retry next interval. */ }
    finally { syncing = false }
  }
  const unauthorized = (event: Event) => end((event as CustomEvent).detail?.reason === 'idle' ? 'idle' : 'expired')
  const recheck = () => { check() }
  const events = ['pointerdown', 'pointermove', 'keydown', 'scroll', 'touchstart']
  events.forEach(event => window.addEventListener(event, activity, { passive: true, capture: true }))
  window.addEventListener('focus', recheck)
  window.addEventListener('pageshow', recheck)
  window.addEventListener('storage', recheck)
  window.addEventListener(UNAUTHORIZED_EVENT, unauthorized)
  document.addEventListener('visibilitychange', recheck)
  const interval = setInterval(() => { void heartbeat() }, 30_000)
  void heartbeat()
  return () => {
    ended = true
    clearTimeout(timer); clearInterval(interval)
    events.forEach(event => window.removeEventListener(event, activity, true))
    window.removeEventListener('focus', recheck)
    window.removeEventListener('pageshow', recheck)
    window.removeEventListener('storage', recheck)
    window.removeEventListener(UNAUTHORIZED_EVENT, unauthorized)
    document.removeEventListener('visibilitychange', recheck)
  }
}

export function sessionLoginUrl(reason: 'idle' | 'expired', location: Pick<Location, 'pathname' | 'search' | 'hash'>) {
  return `/login?${reason}=1&next=${encodeURIComponent(location.pathname + location.search + location.hash)}`
}
