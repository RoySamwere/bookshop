'use client'

import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { registrationSchema, type RegistrationValues } from '../../features/auth/schemas'
import { Link } from 'react-router-dom'
import { ArrowUpRight, MailCheck } from 'lucide-react'
import { AuthHeading, AuthShell } from '../../components/auth/auth-shell'
import { PasswordInput, PasswordRules } from '../../components/auth/password-field'
import { Field, FormAlert, inputClass, primaryButton, secondaryButton } from '../../components/ui-kit'
import { ApiError, errorMessage } from '../../lib/api'
import { register } from '../../lib/auth'
import { brand } from '../../lib/brand'

export default function RegisterPage() {
  const { watch, setValue, handleSubmit, setError, formState: { errors: fieldErrors } } = useForm<RegistrationValues>({
    resolver: zodResolver(registrationSchema), defaultValues: { name: '', email: '', phone: '', password: '', confirm: '', terms: false, staff: false, bookshop: '' },
  })
  const form = watch()
  const errors = {
    name: fieldErrors.name?.message, email: fieldErrors.email?.message, phone: fieldErrors.phone?.message,
    password: fieldErrors.password ? 'Choose a password that meets every requirement below.' : undefined,
    password_confirmation: fieldErrors.confirm?.message, terms: fieldErrors.terms?.message, bookshop: fieldErrors.bookshop?.message,
  }
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState<{ email: string; message: string; staff: boolean } | null>(null)

  async function submit(form: RegistrationValues) {
    setMessage('')
    setPending(true)
    try {
      const result = await register({
        name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() || null,
        password: form.password, password_confirmation: form.confirm, terms: form.terms, request_staff_access: form.staff,
        bookshop: form.staff ? form.bookshop?.trim() || null : null,
      })
      setDone({ email: result.data.email, message: result.message, staff: result.data.staff_access_status === 'pending' })
    } catch (e) {
      if (e instanceof ApiError) {
        for (const key of ['name', 'email', 'phone', 'password', 'terms', 'bookshop'] as const) {
          const message = e.field(key)
          if (message) setError(key, { message })
        }
        setMessage(e.status === 429 ? 'Too many sign-up attempts from this connection. Wait a minute and try again.' : e.message)
      } else setMessage(errorMessage(e))
    } finally { setPending(false) }
  }

  const story = { title: `Create your ${brand.shortName} account.`, body: 'Customers get an account ready for when online ordering opens. Joining a team? Ask for staff access and the bookshop will review it.' }

  if (done) return <AuthShell story={story}>
    <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><MailCheck size={24} /></span>
    <AuthHeading title="Check your email">{done.message}</AuthHeading>
    <div className="hk-auth-panel text-sm text-slate-600">
      <p className="m-0">We sent a verification link to <strong className="text-slate-900">{done.email}</strong>. Open it on this or any device to confirm your address.</p>
      {done.staff && <p className="mb-0 mt-3">Your staff access request is waiting for an administrator. You can sign in to the management system once it is approved and your email is verified.</p>}
    </div>
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      <Link to="/login" className={`${primaryButton} w-full`}>Go to sign in</Link>
      <Link to={`/verify-email?email=${encodeURIComponent(done.email)}`} className={`${secondaryButton} w-full`}>Didn&apos;t get the email?</Link>
    </div>
  </AuthShell>

  return <AuthShell story={story} topline={<span>Already registered? <Link to="/login">Sign in</Link></span>}>
    <AuthHeading title="Create an account">It takes a minute. We&apos;ll ask you to confirm your email address.</AuthHeading>
    <p className="hk-auth-panel mb-5 text-sm text-slate-600">Own a bookshop? <Link to="/register/bookshop" className="hk-auth-link">Register your bookshop</Link> to get your own private workspace.</p>
    <form onSubmit={handleSubmit(submit)} noValidate>
      <Field label="Full name" error={errors.name}>
        <input className={inputClass} autoComplete="name" value={form.name} onChange={e => setValue('name', e.target.value)} required aria-invalid={Boolean(errors.name) || undefined} />
      </Field>
      <Field label="Email address" error={errors.email}>
        <input className={inputClass} type="email" inputMode="email" autoComplete="email" value={form.email} onChange={e => setValue('email', e.target.value)} required aria-invalid={Boolean(errors.email) || undefined} />
      </Field>
      <Field label="Phone number (optional)" error={errors.phone}>
        <input className={inputClass} type="tel" autoComplete="tel" placeholder="+254 7XX XXX XXX" value={form.phone} onChange={e => setValue('phone', e.target.value)} aria-invalid={Boolean(errors.phone) || undefined} />
      </Field>
      <div>
        <Field label="Password" error={errors.password}>
          <PasswordInput id="register-password" value={form.password} onChange={value => setValue('password', value)} autoComplete="new-password" invalid={Boolean(errors.password)} describedBy="register-password-rules" />
        </Field>
        <PasswordRules id="register-password-rules" value={form.password} />
      </div>
      <Field label="Confirm password" error={errors.password_confirmation}>
        <PasswordInput id="register-confirm" value={form.confirm} onChange={value => setValue('confirm', value)} autoComplete="new-password" invalid={Boolean(errors.password_confirmation)} />
      </Field>
      <label className="hk-check">
        <input type="checkbox" checked={form.staff} onChange={e => setValue('staff', e.target.checked)} />
        <span>I work at a bookshop and need staff access<small>The bookshop&apos;s owner or administrator reviews every request before any management access is given.</small></span>
      </label>
      {form.staff && <Field label="Bookshop code" error={errors.bookshop} hint="Ask your manager for the code shown on their bookshop profile.">
        <input className={inputClass} autoCapitalize="none" value={form.bookshop} onChange={e => setValue('bookshop', e.target.value)} aria-invalid={Boolean(errors.bookshop) || undefined} />
      </Field>}
      <div>
        <label className="hk-check">
          <input type="checkbox" checked={form.terms} onChange={e => setValue('terms', e.target.checked)} aria-invalid={Boolean(errors.terms) || undefined} />
          <span>I accept the <Link to="/terms" className="hk-auth-link" target="_blank">terms of use</Link></span>
        </label>
        {errors.terms && <p className="mt-1.5 text-xs text-rose-600">{errors.terms}</p>}
      </div>
      <FormAlert message={message} />
      <button className={`${primaryButton} w-full`} type="submit" disabled={pending}>
        {pending ? 'Creating your account…' : 'Create account'} {!pending && <ArrowUpRight size={16} />}
      </button>
    </form>
  </AuthShell>
}
