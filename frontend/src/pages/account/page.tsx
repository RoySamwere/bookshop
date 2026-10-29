'use client'

import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useRouter } from '@/lib/navigation'
import { Clock3, MailWarning, ShieldX } from 'lucide-react'
import BrandLoader from '../../components/brand-loader'
import { CustomerHome } from '../../components/profile-view'
import { ErrorState, secondaryButton } from '../../components/ui-kit'
import { ApiError, UNAUTHORIZED_EVENT, errorMessage, sessionStore } from '../../lib/api'
import { getCurrentUser, hasPermission, logout, resendMyVerification, type BookshopUser } from '../../lib/auth'
import { sessionLoginUrl } from '../../lib/session'

/** Signed-in customers and staff applicants. Staff with workspace access are sent to /dashboard. */
export default function AccountPage() {
  const router = useRouter()
  const [user, setUser] = useState<BookshopUser | null>(null)
  const [bootError, setBootError] = useState('')
  const [toast, setToast] = useState('')

  const notify = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(current => current === message ? '' : current), 3500)
  }, [])

  const load = useCallback(() => {
    setBootError('')
    getCurrentUser()
      .then(current => hasPermission(current, 'workspace.access') ? router.replace('/dashboard') : setUser(current))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 0) { setBootError(error.message); return }
        sessionStore.clear()
        router.replace('/login?next=/account')
      })
  }, [router])

  useEffect(() => {
    load()
    const expired = (event: Event) => { setUser(null); router.replace(sessionLoginUrl((event as CustomEvent).detail?.reason === 'idle' ? 'idle' : 'expired', window.location)) }
    window.addEventListener(UNAUTHORIZED_EVENT, expired)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, expired)
  }, [load, router])

  async function signOut() {
    try { await logout(); router.replace('/login?signed_out=1') }
    catch (error) { notify(errorMessage(error, 'Unable to sign out. Try again.')) }
  }

  if (bootError) return <main className="brand-loading-screen"><div className="w-full max-w-md rounded-2xl bg-white shadow-sm"><ErrorState message={bootError} onRetry={load} /></div></main>
  if (!user) return <BrandLoader />

  return <>
    <CustomerHome currentUser={user} onUpdated={setUser} notify={notify} onSignOut={() => void signOut()} banner={<AccountStatus user={user} notify={notify} />} />
    {toast && <div className="toast" role="status"><span className="toast-check">✓</span>{toast}</div>}
  </>
}

function AccountStatus({ user, notify }: { user: BookshopUser; notify: (message: string) => void }) {
  const [sending, setSending] = useState(false)

  async function resend() {
    setSending(true)
    try { notify((await resendMyVerification()).message) } catch (error) { notify(errorMessage(error)) } finally { setSending(false) }
  }

  const items = []
  if (!user.email_verified) items.push(<Notice key="verify" tone="amber" icon={<MailWarning size={18} />} title="Confirm your email address"
    action={<button className={`${secondaryButton} h-9 shrink-0`} onClick={() => void resend()} disabled={sending}>{sending ? 'Sending…' : 'Resend link'}</button>}>
    We sent a verification link to {user.email}.{user.staff_access_status === 'pending' ? ' Your staff request can only be approved after this.' : ''}
  </Notice>)
  if (user.staff_access_status === 'pending') items.push(<Notice key="pending" tone="blue" icon={<Clock3 size={18} />} title="Staff access is awaiting approval">
    An administrator will review your request. Once approved, sign in again to open the management system.
  </Notice>)
  if (user.staff_access_status === 'rejected') items.push(<Notice key="rejected" tone="rose" icon={<ShieldX size={18} />} title="Staff access was not approved">
    {user.staff_access_note ? `Reviewer's note: ${user.staff_access_note}` : 'Your customer account is unaffected. Contact the shop management if you think this is a mistake.'}
  </Notice>)
  if (!items.length) return <p className="m-0 text-sm text-slate-500">This is a customer account. Team members sign in at <Link to="/login" className="font-semibold text-[#0a6fd8]">the management system</Link> with the account their administrator created or approved.</p>
  return <div className="grid gap-3">{items}</div>
}

function Notice({ tone, icon, title, action, children }: { tone: 'amber' | 'blue' | 'rose'; icon: React.ReactNode; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  const tones = { amber: 'border-amber-200 bg-amber-50 text-amber-900', blue: 'border-blue-200 bg-blue-50 text-blue-900', rose: 'border-rose-200 bg-rose-50 text-rose-900' }
  return <div className={`flex flex-col gap-3 rounded-2xl border px-4 py-3.5 sm:flex-row sm:items-center ${tones[tone]}`} role="status">
    <span className="shrink-0">{icon}</span>
    <div className="min-w-0 flex-1"><p className="m-0 text-sm font-semibold">{title}</p><p className="m-0 mt-0.5 text-sm opacity-85">{children}</p></div>
    {action}
  </div>
}
