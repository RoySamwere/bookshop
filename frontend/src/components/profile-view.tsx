'use client'

import { useState, type FormEvent, type ReactNode } from 'react'
import { KeyRound, LogOut, ShoppingBag, UserRound } from 'lucide-react'
import { ApiError, errorMessage } from '../lib/api'
import { changePassword, updateProfile, type BookshopUser } from '../lib/auth'
import { Card, Field, FormAlert, PageHeader, inputClass, primaryButton, secondaryButton } from './ui-kit'
import { RoleBadge } from './users-view'
import { BrandMark } from './brand-mark'
import { brand } from '../lib/brand'

export function ProfileView({ currentUser, onUpdated, notify }: { currentUser: BookshopUser; onUpdated: (user: BookshopUser) => void; notify: (message: string) => void }) {
  return <div className="products-page">
    <PageHeader eyebrow="ACCOUNT" icon={<UserRound size={15} />} title="My profile" description="Your contact details and sign-in security." />
    <div className="grid gap-5 xl:grid-cols-2">
      <ProfileCard currentUser={currentUser} onUpdated={onUpdated} notify={notify} />
      <PasswordCard notify={notify} />
    </div>
  </div>
}

function ProfileCard({ currentUser, onUpdated, notify }: { currentUser: BookshopUser; onUpdated: (user: BookshopUser) => void; notify: (message: string) => void }) {
  const [name, setName] = useState(currentUser.name)
  const [phone, setPhone] = useState(currentUser.phone || '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [message, setMessage] = useState('')
  const dirty = name !== currentUser.name || phone !== (currentUser.phone || '')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null); setMessage('')
    try {
      const saved = await updateProfile({ name, phone: phone || null })
      onUpdated(saved.data); notify(saved.message)
    } catch (e) { if (e instanceof ApiError) { setError(e); setMessage(e.message) } else setMessage(errorMessage(e)) }
    finally { setBusy(false) }
  }

  return <Card title="Personal details" description="Your email and role are managed by your administrator.">
    <form onSubmit={submit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" error={error?.field('name')}><input className={inputClass} value={name} onChange={e => setName(e.target.value)} required /></Field>
        <Field label="Phone" error={error?.field('phone')}><input className={inputClass} type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+254 7XX XXX XXX" /></Field>
        <Field label="Email address"><input className={inputClass} value={currentUser.email} disabled /></Field>
        <div className="text-sm font-medium text-slate-700">Role and branches
          <div className="mt-2 flex min-h-11 flex-wrap items-center gap-2"><RoleBadge role={currentUser.role} />{currentUser.branches.map(branch => <span key={branch.id} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{branch.name}</span>)}</div>
        </div>
      </div>
      <FormAlert message={message} />
      <div className="mt-5 flex justify-end"><button type="submit" className={primaryButton} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save details'}</button></div>
    </form>
  </Card>
}

function PasswordCard({ notify }: { notify: (message: string) => void }) {
  const [form, setForm] = useState({ current_password: '', password: '', password_confirmation: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [message, setMessage] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (form.password !== form.password_confirmation) { setMessage('New passwords do not match.'); return }
    setBusy(true); setError(null); setMessage('')
    try {
      notify((await changePassword(form)).message)
      setForm({ current_password: '', password: '', password_confirmation: '' })
    } catch (e) { if (e instanceof ApiError) { setError(e); setMessage(e.status === 429 ? 'Too many attempts. Wait a minute and try again.' : e.message) } else setMessage(errorMessage(e)) }
    finally { setBusy(false) }
  }

  const input = (key: keyof typeof form) => ({ value: form[key], onChange: (e: { target: { value: string } }) => setForm(previous => ({ ...previous, [key]: e.target.value })) })
  return <Card title="Change password" description="Use at least 8 characters. Other devices will be signed out.">
    <form onSubmit={submit} noValidate>
      <div className="grid gap-4">
        <Field label="Current password" error={error?.field('current_password')}><input className={inputClass} type="password" autoComplete="current-password" {...input('current_password')} required /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New password" error={error?.field('password')} hint="8+ characters with upper and lower case, a number and a symbol."><input className={inputClass} type="password" autoComplete="new-password" {...input('password')} required minLength={8} /></Field>
          <Field label="Confirm new password"><input className={inputClass} type="password" autoComplete="new-password" {...input('password_confirmation')} required minLength={8} /></Field>
        </div>
      </div>
      <FormAlert message={message} />
      <div className="mt-5 flex justify-end"><button type="submit" className={primaryButton} disabled={busy || !form.current_password || !form.password}><KeyRound size={16} /> {busy ? 'Updating…' : 'Update password'}</button></div>
    </form>
  </Card>
}

/** Customers sign in to the online store; until it launches they get account management only. */
export function CustomerHome({ currentUser, onUpdated, notify, onSignOut, banner }: { currentUser: BookshopUser; onUpdated: (user: BookshopUser) => void; notify: (message: string) => void; onSignOut: () => void; banner?: ReactNode }) {
  return <div className="min-h-dvh bg-[#f8f8ff]">
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 sm:px-8">
      <a href="/" className="flex items-center gap-3 no-underline"><BrandMark size={38} /><strong className="text-[#13254a]">{brand.name}</strong></a>
      <button className={`${secondaryButton} h-10`} onClick={onSignOut}><LogOut size={16} /> Sign out</button>
    </header>
    <div className="mx-auto max-w-5xl">
      <section className="mx-4 mt-6 rounded-2xl bg-[#13254a] p-6 text-white shadow-sm sm:mx-8">
        <p className="flex items-center gap-2 text-sm font-semibold text-[#f2dfa7]"><ShoppingBag size={15} /> Your {brand.shortName} account</p>
        <h1 className="mt-2 text-2xl font-bold">Welcome, {currentUser.name.split(' ')[0]}</h1>
        <p className="mt-1 max-w-xl text-sm text-white/80">Online ordering opens after our launch. Until then you can keep your details and password up to date here.</p>
      </section>
      {banner && <div className="mx-4 mt-4 sm:mx-8">{banner}</div>}
      <div className="[&_.products-page]:px-4 sm:[&_.products-page]:px-8"><ProfileView currentUser={currentUser} onUpdated={onUpdated} notify={notify} /></div>
    </div>
  </div>
}
