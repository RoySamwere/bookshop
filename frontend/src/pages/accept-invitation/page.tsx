import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CircleCheck, UserPlus } from 'lucide-react'
import { useSearchParams } from '@/lib/navigation'
import { AuthHeading, AuthShell } from '../../components/auth/auth-shell'
import { PasswordInput, PasswordRules } from '../../components/auth/password-field'
import { Field, FormAlert, primaryButton } from '../../components/ui-kit'
import { ApiError, errorMessage } from '../../lib/api'
import { acceptInvitation } from '../../lib/auth'

const story = { title: 'Join your team.', body: 'Your manager invited you to their bookshop workspace. Choose a password to finish setting up your account.' }

export default function AcceptInvitationPage() {
  const params = useSearchParams()
  const token = params.get('token') || ''
  const email = params.get('email') || ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setPending(true); setError(null); setMessage('')
    try { setDone((await acceptInvitation({ token, email, password, password_confirmation: confirm })).message) }
    catch (e) {
      if (e instanceof ApiError) { setError(e); setMessage(e.status === 429 ? 'Too many attempts. Wait a minute and try again.' : e.field('token') || e.message) }
      else setMessage(errorMessage(e))
    } finally { setPending(false) }
  }

  if (done) return <AuthShell story={story}>
    <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><CircleCheck size={24} /></span>
    <AuthHeading title="You're all set">{done}</AuthHeading>
    <Link to={`/login?email=${encodeURIComponent(email)}`} className={`${primaryButton} w-full`}>Sign in</Link>
  </AuthShell>

  if (!token || !email) return <AuthShell story={story}>
    <AuthHeading title="Invitation link incomplete">Open the link exactly as it appears in your invitation email, or ask your manager to resend it.</AuthHeading>
  </AuthShell>

  return <AuthShell story={story}>
    <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-blue-50 text-[#087df5]"><UserPlus size={24} /></span>
    <AuthHeading title="Accept your invitation">Signing in as <strong>{email}</strong>.</AuthHeading>
    <form onSubmit={submit} noValidate>
      <div>
        <Field label="Choose a password" error={error?.field('password')}>
          <PasswordInput id="invite-password" value={password} onChange={setPassword} autoComplete="new-password" invalid={Boolean(error?.field('password'))} describedBy="invite-password-rules" />
        </Field>
        <PasswordRules id="invite-password-rules" value={password} />
      </div>
      <Field label="Confirm password">
        <PasswordInput id="invite-confirm" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      </Field>
      <FormAlert message={message} />
      <button className={`${primaryButton} w-full`} type="submit" disabled={pending || !password || password !== confirm}>{pending ? 'Setting up…' : 'Join the team'}</button>
    </form>
  </AuthShell>
}
