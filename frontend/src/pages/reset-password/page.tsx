'use client'

import { Suspense, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { useRouter, useSearchParams } from '@/lib/navigation'
import BrandLoader from '../../components/brand-loader'
import { AuthHeading, AuthShell } from '../../components/auth/auth-shell'
import { PasswordInput, PasswordRules, passwordIsStrong } from '../../components/auth/password-field'
import { Field, FormAlert, primaryButton } from '../../components/ui-kit'
import { ApiError, errorMessage } from '../../lib/api'
import { resetPassword } from '../../lib/auth'

const story = { title: 'Choose a new password.', body: 'Once it is saved you will be signed out on every other device, and the reset link stops working.' }

export default function ResetPasswordPage() {
  return <Suspense fallback={<BrandLoader />}><ResetPasswordScreen /></Suspense>
}

function ResetPasswordScreen() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get('token') || ''
  const email = params.get('email') || ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [linkInvalid, setLinkInvalid] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!passwordIsStrong(password)) { setError('Choose a password that meets every requirement.'); return }
    if (password !== confirm) { setError('The passwords do not match.'); return }
    setPending(true); setError('')
    try {
      await resetPassword({ token, email, password, password_confirmation: confirm })
      router.replace('/login?reset=1')
    } catch (e) {
      setPending(false)
      if (e instanceof ApiError && (e.field('token') || e.field('email'))) { setLinkInvalid(true); return }
      setError(e instanceof ApiError ? (e.field('password') || (e.status === 429 ? 'Too many attempts. Wait a minute and try again.' : e.message)) : errorMessage(e))
    }
  }

  if (!token || !email || linkInvalid) return <AuthShell story={story}>
    <AuthHeading title="This link can't be used">{linkInvalid ? 'The reset link has expired or was already used.' : 'The reset link is incomplete. Open it again from the email, or request a new one.'}</AuthHeading>
    <Link to="/forgot-password" className={`${primaryButton} w-full`}>Request a new link</Link>
    <p className="hk-auth-alt"><Link to="/login" className="hk-auth-link">Back to sign in</Link></p>
  </AuthShell>

  return <AuthShell story={story}>
    <AuthHeading title="Set a new password">For <strong className="text-slate-800">{email}</strong></AuthHeading>
    <form onSubmit={submit} noValidate>
      <div>
        <Field label="New password">
          <PasswordInput id="reset-password" value={password} onChange={setPassword} autoComplete="new-password" describedBy="reset-password-rules" />
        </Field>
        <PasswordRules id="reset-password-rules" value={password} />
      </div>
      <Field label="Confirm new password">
        <PasswordInput id="reset-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      </Field>
      <FormAlert message={error} />
      <button className={`${primaryButton} w-full`} type="submit" disabled={pending || !password || !confirm}>{pending ? 'Saving…' : 'Save new password'}</button>
    </form>
    <p className="hk-auth-alt"><Link to="/login" className="hk-auth-link">Back to sign in</Link></p>
  </AuthShell>
}
