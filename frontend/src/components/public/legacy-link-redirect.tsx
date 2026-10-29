'use client'

import { useEffect } from 'react'
import { useRouter } from '@/lib/navigation'

/** Password reset emails sent before the site moved linked to /?reset_token=…; send them to the new page. */
export function LegacyLinkRedirect() {
  const router = useRouter()
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('reset_token')
    const email = params.get('email')
    if (token && email) router.replace(`/reset-password?${new URLSearchParams({ token, email })}`)
  }, [router])
  return null
}
