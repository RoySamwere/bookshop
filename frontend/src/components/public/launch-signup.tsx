'use client'

import { useState, type FormEvent } from 'react'
import { ApiError } from '../../lib/api'
import { launchSubscribersApi } from '../../lib/workspace-api'

type State = { kind: 'idle' | 'sending' } | { kind: 'done'; email: string } | { kind: 'error'; message: string }

/** "Tell me when you open" signup. Email is optional to the visitor; nothing else is collected. */
export function LaunchSignup({ id = 'notify' }: { id?: string }) {
  const [email, setEmail] = useState('')
  const [website, setWebsite] = useState('')
  const [state, setState] = useState<State>({ kind: 'idle' })

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setState({ kind: 'error', message: 'Enter an email address like name@example.com.' }); return }
    setState({ kind: 'sending' })
    try {
      await launchSubscribersApi.subscribe(email.trim(), website)
      setState({ kind: 'done', email: email.trim() })
    } catch (error) {
      const message = error instanceof ApiError
        ? error.status === 429 ? 'Too many attempts. Try again in a minute.' : error.status === 0 ? 'We could not reach the server. Try again in a moment.' : (error.field('email') || error.message)
        : 'Something went wrong. Try again.'
      setState({ kind: 'error', message })
    }
  }

  if (state.kind === 'done') {
    return <p className="hk-signup-done" role="status">
      You&apos;re on the list. We&apos;ll write to <strong>{state.email}</strong> when the doors open.
    </p>
  }

  return <form id={id} className="hk-signup" onSubmit={submit} noValidate>
    <label className="hk-signup-label" htmlFor={`${id}-email`}>Get an email when we open</label>
    <div className="hk-signup-row">
      <input id={`${id}-email`} className="hk-signup-input" type="email" inputMode="email" autoComplete="email" required
        placeholder="you@example.com" value={email} onChange={event => setEmail(event.target.value)}
        aria-invalid={state.kind === 'error'} aria-describedby={`${id}-hint`} />
      <button className="hk-signup-button" type="submit" disabled={state.kind === 'sending'}>
        {state.kind === 'sending' ? 'Adding you…' : 'Notify me'}
      </button>
    </div>
    {/* Left empty by people; filled in by spam bots. */}
    <input className="hk-honeypot" type="text" name="website" tabIndex={-1} autoComplete="off" value={website} onChange={event => setWebsite(event.target.value)} aria-hidden="true" />
    <p id={`${id}-hint`} className={state.kind === 'error' ? 'hk-signup-error' : 'hk-signup-hint'} role={state.kind === 'error' ? 'alert' : undefined}>
      {state.kind === 'error' ? state.message : 'We only use your address to tell you about our opening.'}
    </p>
  </form>
}
