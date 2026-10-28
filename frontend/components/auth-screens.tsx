'use client'

import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import { ApiError, errorMessage } from '../lib/api'
import { login, requestPasswordReset, resetPassword, type BookshopUser } from '../lib/auth'

type Mode = 'login' | 'forgot' | 'reset'
export type ResetLink = { token: string; email: string }

export function LoginPage({ onLogin, resetLink, onResetHandled }: { onLogin: (user: BookshopUser) => void; resetLink: ResetLink | null; onResetHandled: () => void }) {
  const [mode, setMode] = useState<Mode>(resetLink ? 'reset' : 'login')
  const [notice, setNotice] = useState('')

  function finishReset(message: string) {
    onResetHandled()
    setNotice(message)
    setMode('login')
  }

  return <main className="login-screen">
    <section className="login-brand-panel">
      <div className="login-brand"><img className="nifunze-full-logo" src="/logo.png" alt="Nifunze Lessons" /></div>
      <div className="login-story"><div className="eyebrow">MADE FOR KENYAN BOOKSELLERS</div><h1 tabIndex={-1}>Keep every shelf, sale, and school order moving.</h1><p>One calm workspace for M-Pesa sales, curriculum stock, suppliers, and your regular readers.</p><div className="login-points"><span><i /> KSh-ready checkout with M-Pesa</span><span><i /> KCSE and CBC catalogue tracking</span><span><i /> School account management</span></div></div>
      <small className="login-footer">Nifunze Bookshop · Kenya</small>
    </section>
    <section className="login-form-panel"><div className="login-form-wrap">
      <div className="mobile-login-logo"><div className="brand-mark"><img src="/favicon.png" alt="" /></div><strong>Nifunze Bookshop</strong></div>
      {mode === 'login' && <SignInForm onLogin={onLogin} notice={notice} onForgot={() => { setNotice(''); setMode('forgot') }} />}
      {mode === 'forgot' && <ForgotForm onBack={() => setMode('login')} />}
      {mode === 'reset' && resetLink && <ResetForm link={resetLink} onDone={finishReset} onCancel={() => finishReset('')} />}
    </div></section>
  </main>
}

function Heading({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return <><div className="eyebrow">{eyebrow}</div><h2>{title}</h2><p className="login-muted">{body}</p></>
}

function Message({ tone, children }: { tone: 'error' | 'success'; children: ReactNode }) {
  return <p role={tone === 'error' ? 'alert' : 'status'} className={`mb-3 rounded-lg px-3 py-2.5 text-[13px] ${tone === 'error' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{children}</p>
}

function PasswordInput({ value, onChange, autoComplete, minLength }: { value: string; onChange: (value: string) => void; autoComplete: string; minLength?: number }) {
  const [visible, setVisible] = useState(false)
  return <div className="password-field">
    <input className="text-input" type={visible ? 'text' : 'password'} autoComplete={autoComplete} value={value} onChange={event => onChange(event.target.value)} required minLength={minLength} />
    <button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? 'Hide password' : 'Show password'}>{visible ? 'Hide' : 'Show'}</button>
  </div>
}

function SignInForm({ onLogin, onForgot, notice }: { onLogin: (user: BookshopUser) => void; onForgot: () => void; notice: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true); setError('')
    try {
      onLogin(await login(email, password))
    } catch (e) {
      setError(e instanceof ApiError && e.status === 429 ? 'Too many sign-in attempts. Wait a minute and try again.' : e instanceof ApiError ? (e.field('email') || e.message) : errorMessage(e, 'Unable to sign in.'))
    } finally {
      setPending(false)
    }
  }

  return <>
    <Heading eyebrow="WELCOME BACK" title="Sign in to your shop" body="Sign in with your assigned account. Access follows your role." />
    {notice && <Message tone="success">{notice}</Message>}
    <form onSubmit={submit}>
      <label className="field-label">Email address<input className="text-input" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
      <label className="field-label">Password<PasswordInput value={password} onChange={setPassword} autoComplete="current-password" /></label>
      <div className="mb-4 flex justify-end"><button type="button" className="text-xs font-semibold text-[#087df5] hover:underline" onClick={onForgot}>Forgot password?</button></div>
      {error && <Message tone="error">{error}</Message>}
      <button className="primary-button full" type="submit" disabled={pending}>{pending ? 'Signing in…' : 'Sign in to Bookshop'} <ArrowUpRight size={16} /></button>
    </form>
  </>
}

function ForgotForm({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('')
  const [pending, setPending] = useState(false)
  const [sent, setSent] = useState('')
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true); setError('')
    try {
      setSent((await requestPasswordReset(email)).message)
    } catch (e) {
      setError(e instanceof ApiError && e.status === 429 ? 'Too many requests. Wait a minute and try again.' : errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  return <>
    <Heading eyebrow="ACCOUNT RECOVERY" title="Reset your password" body="Enter your account email and we will send you a link to choose a new password." />
    {sent ? <Message tone="success">{sent}</Message> : <form onSubmit={submit}>
      <label className="field-label">Email address<input className="text-input" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required autoFocus /></label>
      {error && <Message tone="error">{error}</Message>}
      <button className="primary-button full" type="submit" disabled={pending}>{pending ? 'Sending link…' : 'Send reset link'} <ArrowUpRight size={16} /></button>
    </form>}
    <button type="button" className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800" onClick={onBack}><ArrowLeft size={14} /> Back to sign in</button>
  </>
}

function ResetForm({ link, onDone, onCancel }: { link: ResetLink; onDone: (message: string) => void; onCancel: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password !== confirm) { setError('Passwords do not match.'); return }
    setPending(true); setError('')
    try {
      onDone((await resetPassword({ token: link.token, email: link.email, password, password_confirmation: confirm })).message)
    } catch (e) {
      setError(e instanceof ApiError ? (e.field('email') || e.field('password') || e.message) : errorMessage(e))
    } finally {
      setPending(false)
    }
  }

  return <>
    <Heading eyebrow="ACCOUNT RECOVERY" title="Choose a new password" body={`Set a new password for ${link.email}. You will be signed out of other devices.`} />
    <form onSubmit={submit}>
      <label className="field-label">New password<PasswordInput value={password} onChange={setPassword} autoComplete="new-password" minLength={8} /></label>
      <label className="field-label">Confirm new password<PasswordInput value={confirm} onChange={setConfirm} autoComplete="new-password" minLength={8} /></label>
      {error && <Message tone="error">{error}</Message>}
      <button className="primary-button full" type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save new password'} <ArrowUpRight size={16} /></button>
    </form>
    <button type="button" className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800" onClick={onCancel}><ArrowLeft size={14} /> Back to sign in</button>
  </>
}
