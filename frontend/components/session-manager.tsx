'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { sessionLoginUrl, startSessionMonitor } from '../lib/session'

export function SessionManager() {
  const pathname = usePathname()
  const protectedPage = pathname === '/account' || pathname === '/dashboard' || pathname.startsWith('/dashboard/')
  useEffect(() => {
    if (!protectedPage) return
    return startSessionMonitor(reason => {
      // A full navigation clears protected page state, including open dialogs.
      window.location.replace(sessionLoginUrl(reason, window.location))
    })
  }, [protectedPage])
  return null
}
