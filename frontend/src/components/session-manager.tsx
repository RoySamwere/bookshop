'use client'

import { useEffect } from 'react'
import { usePathname } from '@/lib/navigation'
import { sessionLoginUrl, startSessionMonitor } from '../lib/session'
import { useAuth } from '../features/auth/auth-provider'

export function SessionManager() {
  const pathname = usePathname()
  const { user } = useAuth()
  const protectedPage = pathname === '/account' || pathname === '/dashboard' || pathname.startsWith('/dashboard/')
  useEffect(() => {
    if (!protectedPage || !user) return
    return startSessionMonitor(reason => {
      // A full navigation clears protected page state, including open dialogs.
      window.location.replace(sessionLoginUrl(reason, window.location))
    })
  }, [protectedPage, user?.id])
  return null
}
