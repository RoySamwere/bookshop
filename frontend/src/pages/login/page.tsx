'use client'

import { Suspense, useEffect, useState } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { loginSchema, type LoginValues } from '../../features/auth/schemas'
import { useAuth } from '../../features/auth/auth-provider'
import { Link } from 'react-router-dom'
import { useRouter, useSearchParams } from '@/lib/navigation'
import { ArrowUpRight } from 'lucide-react'
import BrandLoader from '../../components/brand-loader'
import { AuthHeading, AuthShell } from '../../components/auth/auth-shell'
import { PasswordInput } from '../../components/auth/password-field'
import { Field, FormAlert, inputClass, primaryButton } from '../../components/ui-kit'
import { ApiError, errorMessage } from '../../lib/api'
import { homeFor, login, safeNextPath, type BookshopUser } from '../../lib/auth'

export default function LoginPage() {
  return <Suspense fallback={<BrandLoader />}><LoginScreen /></Suspense>
}

function LoginScreen() {
  const router = useRouter()
  const params = useSearchParams()
  const next = safeNextPath(params.get('next'))
  const { user: existingUser, loading: checking } = useAuth()
  const { register, control, handleSubmit, formState: { errors } } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '', remember: false },
  })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [message, setMessage] = useState('')

  const notice = params.get('reset') ? 'Your password has been changed. Sign in with your new password.'
    : params.get('verified') ? 'Your email address is verified. Sign in to continue.'
    : params.get('idle') ? 'You were signed out after 10 minutes of inactivity. Sign in to return to your last page.'
    : params.get('expired') ? 'Your session has ended. Sign in again to continue.'
    : params.get('signed_out') ? 'You have signed out.'
    : ''

  // A return path is only followed inside the area the account belongs to (workspace or platform console).
  const destination = (user: BookshopUser) => {
    const home = homeFor(user)
    return next && (home === '/dashboard' || next.startsWith(home)) ? next : home
  }

  // Someone who is already signed in goes straight to where they belong.
  useEffect(() => {
    if (existingUser) router.replace(destination(existingUser))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, next, existingUser])

  async function submit({ email, password, remember }: LoginValues) {
    setPending(true); setError(null); setMessage('')
    try {
      const user = await login(email.trim(), password, remember)
      router.replace(destination(user))
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
    <form onSubmit={handleSubmit(submit)} noValidate className="mt-2">
      <Field label="Email address" error={errors.email?.message || error?.field('email')}>
        <input className={inputClass} type="email" inputMode="email" autoComplete="username" {...register('email')} aria-invalid={!!errors.email || undefined} required autoFocus />
      </Field>
      <Field label="Password" error={errors.password?.message}>
        <Controller name="password" control={control} render={({ field }) => <PasswordInput id="login-password" value={field.value} onChange={field.onChange} autoComplete="current-password" invalid={!!errors.password} />} />
      </Field>
      <div className="hk-auth-row">
        <label className="hk-check"><input type="checkbox" {...register('remember')} /> Remember me on this device</label>
        <Link to="/forgot-password" className="hk-auth-link">Forgot password?</Link>
      </div>
      <FormAlert message={message} />
      <button className={`${primaryButton} w-full`} type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'} {!pending && <ArrowUpRight size={16} />}
      </button>
      <p className="-mt-1 text-xs text-slate-500">Only tick “Remember me” on a device you don&apos;t share. All sessions sign out after 10 minutes of inactivity.</p>
    </form>
    <p className="hk-auth-alt">New here? <Link to="/register" className="hk-auth-link">Create an account</Link></p>
  </AuthShell>
}
