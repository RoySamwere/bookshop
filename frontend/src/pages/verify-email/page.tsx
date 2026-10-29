'use client'

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useSearchParams } from '@/lib/navigation'
import { CircleCheck, MailWarning } from 'lucide-react'
import BrandLoader from '../../components/brand-loader'
import { AuthHeading, AuthShell } from '../../components/auth/auth-shell'
import { Field, FormAlert, LoadingState, inputClass, primaryButton, secondaryButton } from '../../components/ui-kit'
import { ApiError, errorMessage } from '../../lib/api'
import { resendVerification, verifyEmail } from '../../lib/auth'
import { queryClient } from '../../app/query-client'

const story = { title: 'One quick check.', body: 'Confirming your email address keeps your account secure and lets us reach you about orders and access requests.' }

export default function VerifyEmailPage() {
  return <Suspense fallback={<BrandLoader />}><VerifyEmailScreen /></Suspense>
}

type Result = { state: 'checking' } | { state: 'verified'; message: string; next?: string | null } | { state: 'failed'; message: string } | { state: 'none' }

function VerifyEmailScreen() {
  const params = useSearchParams()
  const link = { id: params.get('id') || '', hash: params.get('hash') || '', expires: params.get('expires') || '', signature: params.get('signature') || '' }
  const hasLink = Boolean(link.id && link.hash && link.expires && link.signature)
  const [result, setResult] = useState<Result>(hasLink ? { state: 'checking' } : { state: 'none' })
  const started = useRef(false)

  useEffect(() => {
    if (!hasLink || started.current) return
    started.current = true
    verifyEmail(link)
      .then(response => {
        setResult({ state: 'verified', message: response.message, next: response.next })
        void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
      })
      .catch(error => setResult({ state: 'failed', message: error instanceof ApiError && error.status === 429 ? 'Too many attempts. Wait a minute and open the link again.' : errorMessage(error) }))
    // The link is read once from the URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasLink])

  if (result.state === 'checking') return <AuthShell story={story}><LoadingState label="Verifying your email address" /></AuthShell>

  if (result.state === 'verified') return <AuthShell story={story}>
    <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><CircleCheck size={24} /></span>
    <AuthHeading title="Email verified">{result.message}</AuthHeading>
    {/* Bookshop owners continue onboarding (sign-in is asked for there if needed). */}
    <Link to={result.next || '/login?verified=1'} className={`${primaryButton} w-full`}>{result.next ? 'Continue setting up your bookshop' : 'Sign in'}</Link>
  </AuthShell>

  return <AuthShell story={story}>
    {result.state === 'failed' ? <>
      <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-amber-50 text-amber-600"><MailWarning size={24} /></span>
      <AuthHeading title="This link didn't work">{result.message}</AuthHeading>
    </> : <AuthHeading title="Verify your email">Open the link we emailed you. If it hasn&apos;t arrived, or it has expired, send a new one.</AuthHeading>}
    <ResendForm initialEmail={params.get('email') || ''} />
    <p className="hk-auth-alt"><Link to="/login" className="hk-auth-link">Back to sign in</Link></p>
  </AuthShell>
}

function ResendForm({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail)
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setPending(true); setError('')
    try { setSent((await resendVerification(email.trim())).message) }
    catch (e) { setError(e instanceof ApiError && e.status === 429 ? 'Too many requests. Wait a minute and try again.' : e instanceof ApiError ? (e.field('email') || e.message) : errorMessage(e)) }
    finally { setPending(false) }
  }

  if (sent) return <FormAlert tone="success" message={sent} />
  return <form onSubmit={submit} noValidate>
    <Field label="Email address">
      <input className={inputClass} type="email" inputMode="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} required />
    </Field>
    <FormAlert message={error} />
    <button className={`${secondaryButton} w-full`} type="submit" disabled={pending || !email.trim()}>{pending ? 'Sending…' : 'Send a new verification link'}</button>
  </form>
}
