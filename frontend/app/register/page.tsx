'use client'

import { useState, type FormEvent } from 'react'
import Link from 'next/link'
import { ArrowUpRight, MailCheck } from 'lucide-react'
import { AuthHeading, AuthShell } from '../../components/auth/auth-shell'
import { PasswordInput, PasswordRules, passwordIsStrong } from '../../components/auth/password-field'
import { Field, FormAlert, inputClass, primaryButton, secondaryButton } from '../../components/ui-kit'
import { ApiError, errorMessage } from '../../lib/api'
import { register } from '../../lib/auth'
import { brand } from '../../lib/brand'

type Errors = Partial<Record<'name' | 'email' | 'phone' | 'password' | 'password_confirmation' | 'terms', string>>

const PHONE = /^[0-9+()\s-]{7,30}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validate(form: { name: string; email: string; phone: string; password: string; confirm: string; terms: boolean }): Errors {
  const errors: Errors = {}
  if (form.name.trim().length < 2) errors.name = 'Enter your full name.'
  if (!EMAIL.test(form.email.trim())) errors.email = 'Enter a valid email address.'
  if (form.phone.trim() && !PHONE.test(form.phone.trim())) errors.phone = 'Enter a valid phone number, or leave it blank.'
  if (!passwordIsStrong(form.password)) errors.password = 'Choose a password that meets every requirement below.'
  if (form.confirm !== form.password) errors.password_confirmation = 'The passwords do not match.'
  if (!form.terms) errors.terms = 'Accept the terms of use to create an account.'
  return errors
}

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', confirm: '', terms: false, staff: false })
  const [errors, setErrors] = useState<Errors>({})
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState<{ email: string; message: string; staff: boolean } | null>(null)
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm(previous => ({ ...previous, [key]: value }))
    setErrors(previous => ({ ...previous, [key === 'confirm' ? 'password_confirmation' : key]: undefined }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    const found = validate(form)
    setErrors(found); setMessage('')
    if (Object.values(found).some(Boolean)) {
      setMessage('Check the highlighted fields.')
      return
    }
    setPending(true)
    try {
      const result = await register({
        name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() || null,
        password: form.password, password_confirmation: form.confirm, terms: form.terms, request_staff_access: form.staff,
      })
      setDone({ email: result.data.email, message: result.message, staff: result.data.staff_access_status === 'pending' })
    } catch (e) {
      if (e instanceof ApiError) {
        setErrors({ name: e.field('name'), email: e.field('email'), phone: e.field('phone'), password: e.field('password'), terms: e.field('terms') })
        setMessage(e.status === 429 ? 'Too many sign-up attempts from this connection. Wait a minute and try again.' : e.message)
      } else setMessage(errorMessage(e))
    } finally { setPending(false) }
  }

  const story = { title: `Create your ${brand.shortName} account.`, body: 'Customers get an account ready for when online ordering opens. Joining the team? Ask for staff access and an administrator will review it.' }

  if (done) return <AuthShell story={story}>
    <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><MailCheck size={24} /></span>
    <AuthHeading title="Check your email">{done.message}</AuthHeading>
    <div className="hk-auth-panel text-sm text-slate-600">
      <p className="m-0">We sent a verification link to <strong className="text-slate-900">{done.email}</strong>. Open it on this or any device to confirm your address.</p>
      {done.staff && <p className="mb-0 mt-3">Your staff access request is waiting for an administrator. You can sign in to the management system once it is approved and your email is verified.</p>}
    </div>
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      <Link href="/login" className={`${primaryButton} w-full`}>Go to sign in</Link>
      <Link href={`/verify-email?email=${encodeURIComponent(done.email)}`} className={`${secondaryButton} w-full`}>Didn&apos;t get the email?</Link>
    </div>
  </AuthShell>

  return <AuthShell story={story} topline={<span>Already registered? <Link href="/login">Sign in</Link></span>}>
    <AuthHeading title="Create an account">It takes a minute. We&apos;ll ask you to confirm your email address.</AuthHeading>
    <form onSubmit={submit} noValidate>
      <Field label="Full name" error={errors.name}>
        <input className={inputClass} autoComplete="name" value={form.name} onChange={e => set('name', e.target.value)} required aria-invalid={Boolean(errors.name) || undefined} />
      </Field>
      <Field label="Email address" error={errors.email}>
        <input className={inputClass} type="email" inputMode="email" autoComplete="email" value={form.email} onChange={e => set('email', e.target.value)} required aria-invalid={Boolean(errors.email) || undefined} />
      </Field>
      <Field label="Phone number (optional)" error={errors.phone}>
        <input className={inputClass} type="tel" autoComplete="tel" placeholder="+254 7XX XXX XXX" value={form.phone} onChange={e => set('phone', e.target.value)} aria-invalid={Boolean(errors.phone) || undefined} />
      </Field>
      <div>
        <Field label="Password" error={errors.password}>
          <PasswordInput id="register-password" value={form.password} onChange={value => set('password', value)} autoComplete="new-password" invalid={Boolean(errors.password)} describedBy="register-password-rules" />
        </Field>
        <PasswordRules id="register-password-rules" value={form.password} />
      </div>
      <Field label="Confirm password" error={errors.password_confirmation}>
        <PasswordInput id="register-confirm" value={form.confirm} onChange={value => set('confirm', value)} autoComplete="new-password" invalid={Boolean(errors.password_confirmation)} />
      </Field>
      <label className="hk-check">
        <input type="checkbox" checked={form.staff} onChange={e => set('staff', e.target.checked)} />
        <span>I work at {brand.name} and need staff access<small>An administrator reviews every request before any management access is given.</small></span>
      </label>
      <div>
        <label className="hk-check">
          <input type="checkbox" checked={form.terms} onChange={e => set('terms', e.target.checked)} aria-invalid={Boolean(errors.terms) || undefined} />
          <span>I accept the <Link href="/terms" className="hk-auth-link" target="_blank">terms of use</Link></span>
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
