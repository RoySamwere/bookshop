'use client'

import { Suspense, useEffect, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowUpRight } from 'lucide-react'
import BrandLoader from '../../components/brand-loader'
import { AuthHeading, AuthShell } from '../../components/auth/auth-shell'
import { PasswordInput } from '../../components/auth/password-field'
import { Field, FormAlert, inputClass, primaryButton } from '../../components/ui-kit'
import { ApiError, errorMessage, tokenStore } from '../../lib/api'
import { getCurrentUser, hasPermission, homeFor, login, safeNextPath } from '../../lib/auth'

export default function LoginPage() {
  return <Suspense fallback={<BrandLoader />}><LoginScreen /></Suspense>
}

function LoginScreen() {
  const router = useRouter()
  const params = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const [checking, setChecking] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [message, setMessage] = useState('')

  const notice = params.get('reset') ? 'Your password has been changed. Sign in with your new password.'
    : params.get('verified') ? 'Your email address is verified. Sign in to continue.'
    : params.get('expired') ? 'Your session has ended. Sign in again to continue.'
    : params.get('signed_out') ? 'You have signed out.'
    : ''

  // Someone who is already signed in goes straight to where they belong.
  useEffect(() => {
    if (!tokenStore.get()) { setChecking(false); return }
    getCurrentUser()
      .then(user => router.replace(hasPermission(user, 'workspace.access') && next ? next : homeFor(user)))
      .catch(() => setChecking(false))
  }, [router, next])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setPending(true); setError(null); setMessage('')
    try {
      const user = await login(email.trim(), password, remember)
      router.replace(hasPermission(user, 'workspace.access') ? (next || '/dashboard') : '/account')
    } catch (e) {
      setPending(false)
      if (e instanceof ApiError) {
        setError(e)
        setMessage(e.status === 429 ? 'Too many sign-in attempts. Wait a minute and try again.'
          : e.status === 0 ? e.message
          : e.field('email') || e.field('password') || e.message)
      } else setMessage(errorMessage(e, 'Unable to sign in.'))
    }
  }

  if (checking) return <BrandLoader />

  return <AuthShell story={{ title: 'Sign in to run the shop.', body: 'Sales, stock, suppliers and your team, in one place. Your access follows the role your administrator gave you.' }}>
    <AuthHeading title="Sign in">Use the email address and password for your bookshop account.</AuthHeading>
    {notice && !message && <FormAlert tone="success" message={notice} />}
    <form onSubmit={submit} noValidate className="mt-2">
      <Field label="Email address" error={error?.field('email') && message !== error.field('email') ? error.field('email') : undefined}>
        <input className={inputClass} type="email" inputMode="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
      </Field>
      <Field label="Password">
        <PasswordInput id="login-password" value={password} onChange={setPassword} autoComplete="current-password" />
      </Field>
      <div className="hk-auth-row">
        <label className="hk-check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /> Remember me on this device</label>
        <Link href="/forgot-password" className="hk-auth-link">Forgot password?</Link>
      </div>
      <FormAlert message={message} />
      <button className={`${primaryButton} w-full`} type="submit" disabled={pending || !email.trim() || !password}>
        {pending ? 'Signing in…' : 'Sign in'} {!pending && <ArrowUpRight size={16} />}
      </button>
      <p className="-mt-1 text-xs text-slate-500">Only tick “Remember me” on a device you don&apos;t share. You stay signed in for up to 7 days.</p>
    </form>
    <p className="hk-auth-alt">New here? <Link href="/register" className="hk-auth-link">Create an account</Link></p>
  </AuthShell>
}
