'use client'

import { useState } from 'react'
import { Check, Eye, EyeOff } from 'lucide-react'
import { inputClass } from '../ui-kit'

export function PasswordInput({ id, value, onChange, autoComplete, invalid, describedBy }: {
  id: string; value: string; onChange: (value: string) => void; autoComplete: 'current-password' | 'new-password'; invalid?: boolean; describedBy?: string
}) {
  const [visible, setVisible] = useState(false)
  return <div className="relative">
    <input id={id} className={`${inputClass} pr-12`} type={visible ? 'text' : 'password'} autoComplete={autoComplete}
      value={value} onChange={event => onChange(event.target.value)} required aria-invalid={invalid || undefined} aria-describedby={describedBy} />
    <button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}
      className="absolute right-1.5 top-[calc(50%+4px)] grid size-9 -translate-y-1/2 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800">
      {visible ? <EyeOff size={17} /> : <Eye size={17} />}
    </button>
  </div>
}

/** Mirrors the server's password policy (backend AppServiceProvider: Password::defaults). */
export const PASSWORD_RULES = [
  { label: 'At least 8 characters', test: (value: string) => value.length >= 8 },
  { label: 'Upper and lower case letters', test: (value: string) => /[a-z]/.test(value) && /[A-Z]/.test(value) },
  { label: 'At least one number', test: (value: string) => /\d/.test(value) },
  { label: 'At least one symbol', test: (value: string) => /[^A-Za-z0-9\s]/.test(value) },
] as const

export const passwordIsStrong = (value: string) => PASSWORD_RULES.every(rule => rule.test(value)) && value.length <= 128

export function PasswordRules({ id, value }: { id: string; value: string }) {
  return <ul id={id} className="hk-password-rules" aria-label="Password requirements">
    {PASSWORD_RULES.map(rule => {
      const met = rule.test(value)
      return <li key={rule.label} data-met={met}>
        {met ? <Check size={13} aria-hidden="true" /> : <span aria-hidden="true" className="inline-block size-[13px] rounded-full border border-current opacity-60" />}
        {rule.label}<span className="sr-only">{met ? ' (met)' : ' (not met yet)'}</span>
      </li>
    })}
  </ul>
}
