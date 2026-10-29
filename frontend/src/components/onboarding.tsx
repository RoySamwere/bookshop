import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpRight, Building2, CircleCheck, Circle, MailWarning, RefreshCw, ShieldAlert, Store, Users } from 'lucide-react'
import { useRouter } from '@/lib/navigation'
import BrandLoader from './brand-loader'
import { AuthHeading, AuthShell } from './auth/auth-shell'
import { ErrorState, Field, FormAlert, LoadingState, inputClass, primaryButton, secondaryButton } from './ui-kit'
import { useAuth } from '../features/auth/auth-provider'
import { ApiError, errorMessage } from '../lib/api'
import { logout, resendMyVerification, type BookshopUser } from '../lib/auth'
import { bookshopApi, COUNTRY_CURRENCIES, type BookshopProfilePayload } from '../lib/tenancy-api'

const story = { title: 'Set up your bookshop.', body: 'Confirm your email, check your shop details and invite your team. Your records stay private to your bookshop.' }

/** Onboarding is for bookshop owners; everyone else is sent where they belong. */
function OwnerGate({ children }: { children: (user: BookshopUser) => ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <BrandLoader />
  if (!user) return <Navigate replace to={`/login?next=${encodeURIComponent(location.pathname)}`} />
  if (user.account_type === 'platform') return <Navigate replace to="/platform" />
  if (!user.bookshop?.is_owner) return <Navigate replace to={user.account_type === 'bookshop' ? '/dashboard' : '/account'} />
  if (user.bookshop.status === 'suspended') return <AuthShell story={story}><SuspendedNotice reason={user.bookshop.suspension_reason} /><SignOutLink /></AuthShell>
  return <>{children(user)}</>
}

export function SuspendedNotice({ reason }: { reason: string | null }) {
  return <>
    <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-rose-50 text-rose-600"><ShieldAlert size={24} /></span>
    <AuthHeading title="This bookshop is suspended">Your records are safe, but the workspace is unavailable until platform support restores access.</AuthHeading>
    {reason && <div className="hk-auth-panel text-sm text-slate-600"><p className="m-0"><strong className="text-slate-900">Reason:</strong> {reason}</p></div>}
  </>
}

function SignOutLink() {
  const router = useRouter()
  return <p className="hk-auth-alt"><button type="button" className="hk-auth-link" onClick={() => void logout().then(() => router.replace('/login?signed_out=1'))}>Sign out</button></p>
}

export function VerifyEmailStep() {
  return <OwnerGate>{user => <VerifyEmailScreen user={user} />}</OwnerGate>
}

function VerifyEmailScreen({ user }: { user: BookshopUser }) {
  const client = useQueryClient()
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; message: string } | null>(null)
  const [pending, setPending] = useState(false)

  async function resend() {
    setPending(true); setNotice(null)
    try { setNotice({ tone: 'success', message: (await resendMyVerification()).message }) }
    catch (e) { setNotice({ tone: 'error', message: e instanceof ApiError && e.status === 429 ? 'Too many requests. Wait a minute and try again.' : errorMessage(e) }) }
    finally { setPending(false) }
  }

  if (user.email_verified) return <AuthShell story={story}>
    <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><CircleCheck size={24} /></span>
    <AuthHeading title="Email verified">{user.bookshop?.name} is active. Finish a few setup steps to start selling.</AuthHeading>
    <Link to="/onboarding/setup" className={`${primaryButton} w-full`}>Continue setup <ArrowUpRight size={16} /></Link>
  </AuthShell>

  return <AuthShell story={story}>
    <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-amber-50 text-amber-600"><MailWarning size={24} /></span>
    <AuthHeading title="Confirm your email">We sent a link to <strong>{user.email}</strong>. Open it to activate {user.bookshop?.name}. Until then you can review your shop details, but sales and stock stay locked.</AuthHeading>
    {notice && <FormAlert tone={notice.tone} message={notice.message} />}
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      <button type="button" className={`${primaryButton} w-full`} onClick={() => void client.invalidateQueries({ queryKey: ['auth', 'me'] })}><RefreshCw size={16} /> I&apos;ve verified</button>
      <button type="button" className={`${secondaryButton} w-full`} onClick={() => void resend()} disabled={pending}>{pending ? 'Sending…' : 'Resend the email'}</button>
    </div>
    <p className="hk-auth-alt"><Link to="/onboarding/bookshop" className="hk-auth-link">Review shop details</Link></p>
    <SignOutLink />
  </AuthShell>
}

export function SetupStep() {
  return <OwnerGate>{user => <SetupScreen user={user} />}</OwnerGate>
}

function SetupScreen({ user }: { user: BookshopUser }) {
  const details = useQuery({ queryKey: ['bookshop'], queryFn: bookshopApi.get })
  if (details.isPending) return <AuthShell story={story}><LoadingState label="Loading your bookshop" /></AuthShell>
  if (details.error) return <AuthShell story={story}><ErrorState message={errorMessage(details.error)} onRetry={() => void details.refetch()} /></AuthShell>
  const shop = details.data
  const steps = [
    { done: shop.onboarding.email_verified, title: 'Confirm your email address', body: 'Activates your bookshop.', icon: <MailWarning size={18} />, to: '/onboarding/verify-email', action: 'Verify' },
    { done: shop.onboarding.profile_completed, title: 'Check your shop details', body: 'Name, phone, location and currency used on receipts.', icon: <Store size={18} />, to: '/onboarding/bookshop', action: 'Edit details' },
    { done: shop.onboarding.has_branch, title: 'Your main branch', body: `${shop.counts.branches} branch${shop.counts.branches === 1 ? '' : 'es'} set up. Add more in Settings.`, icon: <Building2 size={18} />, to: '/dashboard?section=Settings', action: 'Branches' },
    { done: shop.onboarding.has_staff, title: 'Invite your team', body: 'Give cashiers and managers their own sign-in, limited to their branches.', icon: <Users size={18} />, to: '/dashboard?section=My%20Bookshop', action: 'Invite' },
  ]
  const trial = shop.subscription?.status === 'trialing' && shop.subscription.trial_days_left !== null

  return <AuthShell story={story}>
    <AuthHeading title={`Welcome, ${user.name.split(' ')[0]}`}>{shop.name} · {trial ? `${shop.subscription?.trial_days_left} days left in your free trial` : 'Bookshop workspace'}</AuthHeading>
    <ol className="m-0 grid list-none gap-3 p-0">
      {steps.map(step => <li key={step.title} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <span className={`mt-0.5 ${step.done ? 'text-emerald-600' : 'text-slate-300'}`} aria-label={step.done ? 'Done' : 'To do'}>{step.done ? <CircleCheck size={20} /> : <Circle size={20} />}</span>
        <div className="min-w-0 flex-1"><p className="m-0 text-sm font-semibold text-slate-900">{step.title}</p><p className="m-0 mt-0.5 text-xs text-slate-500">{step.body}</p></div>
        {!step.done && (shop.onboarding.email_verified || step.to.startsWith('/onboarding')) && <Link to={step.to} className="shrink-0 text-xs font-semibold text-[#087df5]">{step.action}</Link>}
      </li>)}
    </ol>
    {shop.onboarding.email_verified
      ? <Link to="/dashboard" className={`${primaryButton} mt-6 w-full`}>Open my dashboard <ArrowUpRight size={16} /></Link>
      : <p className="mt-6 text-center text-sm text-slate-500">Confirm your email to open the dashboard.</p>}
  </AuthShell>
}

export function BookshopProfileStep() {
  return <OwnerGate>{() => <BookshopProfileScreen />}</OwnerGate>
}

function BookshopProfileScreen() {
  const router = useRouter()
  const client = useQueryClient()
  const details = useQuery({ queryKey: ['bookshop'], queryFn: bookshopApi.get })
  const [form, setForm] = useState<Required<BookshopProfilePayload> | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (details.data && !form) {
      const { name, business_email, phone, location, country, currency, timezone } = details.data
      setForm({ name, business_email, phone, location, country, currency, timezone })
    }
  }, [details.data, form])

  if (details.error) return <AuthShell story={story}><ErrorState message={errorMessage(details.error)} onRetry={() => void details.refetch()} /></AuthShell>
  if (!form) return <AuthShell story={story}><LoadingState label="Loading your bookshop" /></AuthShell>
  const set = (key: keyof BookshopProfilePayload, value: string) => setForm(current => current && ({ ...current, [key]: value }))

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!form) return
    setPending(true); setError(null); setMessage('')
    try {
      await bookshopApi.update({ ...form, business_email: form.business_email || null })
      await Promise.all([client.invalidateQueries({ queryKey: ['bookshop'] }), client.invalidateQueries({ queryKey: ['auth', 'me'] })])
      router.replace('/onboarding/setup')
    } catch (e) {
      if (e instanceof ApiError) { setError(e); setMessage(e.message) } else setMessage(errorMessage(e))
    } finally { setPending(false) }
  }

  return <AuthShell story={story}>
    <AuthHeading title="Shop details">These appear on receipts and help platform support reach you.</AuthHeading>
    <form onSubmit={submit} noValidate>
      <Field label="Bookshop name" error={error?.field('name')}><input className={inputClass} value={form.name} onChange={e => set('name', e.target.value)} required /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business phone" error={error?.field('phone')}><input className={inputClass} type="tel" value={form.phone ?? ''} onChange={e => set('phone', e.target.value)} /></Field>
        <Field label="Business email (optional)" error={error?.field('business_email')}><input className={inputClass} type="email" value={form.business_email ?? ''} onChange={e => set('business_email', e.target.value)} /></Field>
      </div>
      <Field label="Town or street" error={error?.field('location')}><input className={inputClass} value={form.location ?? ''} onChange={e => set('location', e.target.value)} /></Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
        <Field label="Country" error={error?.field('country')}>
          <input className={inputClass} list="profile-countries" value={form.country} onChange={e => { set('country', e.target.value); if (COUNTRY_CURRENCIES[e.target.value]) set('currency', COUNTRY_CURRENCIES[e.target.value]) }} />
          <datalist id="profile-countries">{Object.keys(COUNTRY_CURRENCIES).map(country => <option key={country} value={country} />)}</datalist>
        </Field>
        <Field label="Currency" error={error?.field('currency')}><input className={`${inputClass} uppercase`} maxLength={3} value={form.currency} onChange={e => set('currency', e.target.value.toUpperCase())} /></Field>
      </div>
      <Field label="Time zone" error={error?.field('timezone')} hint="Used for daily sales totals, e.g. Africa/Nairobi."><input className={inputClass} value={form.timezone} onChange={e => set('timezone', e.target.value)} /></Field>
      <FormAlert message={message} />
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link to="/onboarding/setup" className={`${secondaryButton} w-full`}>Back</Link>
        <button type="submit" className={`${primaryButton} w-full`} disabled={pending}>{pending ? 'Saving…' : 'Save details'}</button>
      </div>
    </form>
  </AuthShell>
}
