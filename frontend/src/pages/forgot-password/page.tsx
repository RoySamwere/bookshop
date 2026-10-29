'use client'

import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import { AuthHeading, AuthShell } from '../../components/auth/auth-shell'
import { Field, FormAlert, inputClass, primaryButton } from '../../components/ui-kit'
import { ApiError, errorMessage } from '../../lib/api'
import { requestPasswordReset } from '../../lib/auth'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setPending(true); setError('')
    try {
      setSent((await requestPasswordReset(email.trim())).message)
    } catch (e) {
      setError(e instanceof ApiError && e.status === 429 ? 'Too many requests. Wait a minute and try again.' : e instanceof ApiError ? (e.field('email') || e.message) : errorMessage(e))
    } finally { setPending(false) }
  }

  return <AuthShell story={{ title: 'Locked out? It happens.', body: 'We will email you a link to choose a new password. The link works once and expires after an hour.' }}>
    <AuthHeading title="Reset your password">Enter the email address for your account.</AuthHeading>
    {sent ? <>
      <FormAlert tone="success" message={sent} />
      <p className="mt-4 text-sm text-slate-500">Check your spam folder if nothing arrives within a few minutes.</p>
    </> : <form onSubmit={submit} noValidate>
      <Field label="Email address">
        <input className={inputClass} type="email" inputMode="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
      </Field>
      <FormAlert message={error} />
      <button className={`${primaryButton} w-full`} type="submit" disabled={pending || !email.trim()}>
        {pending ? 'Sending link…' : 'Email me a reset link'} {!pending && <ArrowUpRight size={16} />}
      </button>
    </form>}
    <p className="hk-auth-alt"><Link to="/login" className="hk-auth-link inline-flex items-center gap-1.5"><ArrowLeft size={14} /> Back to sign in</Link></p>
  </AuthShell>
}
