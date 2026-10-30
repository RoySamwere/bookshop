import { useState, type ReactNode } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Link } from 'react-router-dom'
import { ArrowUpRight, MailCheck, Store } from 'lucide-react'
import { useRouter } from '@/lib/navigation'
import { AuthHeading, AuthShell } from '../../../components/auth/auth-shell'
import { PasswordInput, PasswordRules } from '../../../components/auth/password-field'
import { Card, Field, FormAlert, inputClass, primaryButton, secondaryButton } from '../../../components/ui-kit'
import { bookshopRegistrationSchema, type BookshopRegistrationValues } from '../../../features/auth/schemas'
import { ApiError, errorMessage } from '../../../lib/api'
import { registerBookshop } from '../../../lib/auth'
import { COUNTRY_CURRENCIES, platformApi } from '../../../lib/tenancy-api'

const story = { title: 'Run your bookshop on Hekima.', body: 'Register your shop in a few minutes: point of sale, stock, suppliers and staff, with your records kept private to your business.' }

// Applicants can inspect the shared reference catalogue without a staff account.
const FIELDS = ['owner_name', 'email', 'phone', 'password', 'bookshop_name', 'business_phone', 'business_location', 'country', 'currency', 'terms'] as const

function RegistrationShell({ platformMode, embedded, children }: { platformMode: boolean; embedded: boolean; children: ReactNode }) {
  if (embedded) return <>{children}</>
  return platformMode ? <Card title="Create bookshop" description="Create a separate bookshop owner account. The owner will verify their email before trading.">{children}</Card> : <AuthShell story={story} topline={<span>Already registered? <Link to="/login">Sign in</Link> · <Link to="/products">Browse Products &amp; Books</Link></span>}>{children}</AuthShell>
}

export default function BookshopRegisterPage({ platformMode = false, embedded = false, onCreated, onPendingChange, onCancel }: {
  platformMode?: boolean; embedded?: boolean; onCreated?: (message: string) => void
  onPendingChange?: (pending: boolean) => void; onCancel?: () => void
}) {
  const router = useRouter()
  const { watch, setValue, handleSubmit, setError, formState: { errors } } = useForm<BookshopRegistrationValues>({
    resolver: zodResolver(bookshopRegistrationSchema),
    defaultValues: { owner_name: '', email: '', phone: '', password: '', confirm: '', bookshop_name: '', business_phone: '', business_location: '', country: 'Kenya', currency: 'KES', terms: false },
  })
  const form = watch()
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const [done, setDone] = useState<{ email: string; message: string } | null>(null)
  const error = (key: keyof BookshopRegistrationValues) => key === 'password' && errors.password ? 'Choose a password that meets every requirement below.' : errors[key]?.message

  function chooseCountry(country: string) {
    setValue('country', country)
    if (COUNTRY_CURRENCIES[country]) setValue('currency', COUNTRY_CURRENCIES[country])
  }

  async function submit(values: BookshopRegistrationValues) {
    setMessage('')
    setPending(true)
    onPendingChange?.(true)
    try {
      const payload = {
        owner_name: values.owner_name.trim(), email: values.email.trim(), phone: values.phone.trim(),
        password: values.password, password_confirmation: values.confirm,
        bookshop_name: values.bookshop_name.trim(), business_phone: values.business_phone.trim(), business_location: values.business_location.trim(),
        country: values.country.trim(), currency: values.currency.trim().toUpperCase(), terms: values.terms,
      }
      if (platformMode) {
        const result = await platformApi.createBookshop(payload)
        if (onCreated) onCreated(result.message)
        else router.replace(`/platform/bookshops/${result.data.id}`)
        return
      }
      const result = await registerBookshop(payload)
      if (result.data.signed_in) router.replace(result.data.next)
      else setDone({ email: result.data.email, message: result.message })
    } catch (e) {
      if (e instanceof ApiError) {
        for (const key of FIELDS) {
          const fieldMessage = e.field(key)
          if (fieldMessage) setError(key, { message: fieldMessage })
        }
        setMessage(e.status === 429 ? 'Too many sign-up attempts from this connection. Wait a minute and try again.' : e.message)
      } else setMessage(errorMessage(e))
    } finally { setPending(false); onPendingChange?.(false) }
  }

  if (done) return <RegistrationShell platformMode={platformMode} embedded={embedded}>
    <span className="mb-5 grid size-12 place-items-center rounded-2xl bg-emerald-50 text-emerald-600"><MailCheck size={24} /></span>
    <AuthHeading title="Check your email">{done.message}</AuthHeading>
    <div className="hk-auth-panel text-sm text-slate-600"><p className="m-0">We sent a verification link to <strong className="text-slate-900">{done.email}</strong>. Your bookshop opens as soon as you confirm it.</p></div>
    <Link to="/login" className={`${primaryButton} mt-6 w-full`}>Go to sign in</Link>
  </RegistrationShell>

  return <RegistrationShell platformMode={platformMode} embedded={embedded}>
    <AuthHeading title={platformMode ? 'New bookshop owner' : 'Register your bookshop'}>{platformMode ? 'Enter the new owner’s details. They will verify their email before using their private workspace.' : <>You&apos;ll be the owner of a new, private workspace. We&apos;ll ask you to confirm your email address.</>}</AuthHeading>
    <form onSubmit={handleSubmit(submit)} noValidate>
      <p className="mb-1 mt-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400">{platformMode ? 'Owner details' : 'About you'}</p>
      <Field label="Full name" error={error('owner_name')}>
        <input className={inputClass} autoComplete="name" value={form.owner_name} onChange={e => setValue('owner_name', e.target.value)} aria-invalid={Boolean(errors.owner_name) || undefined} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email address" error={error('email')}>
          <input className={inputClass} type="email" inputMode="email" autoComplete="email" value={form.email} onChange={e => setValue('email', e.target.value)} aria-invalid={Boolean(errors.email) || undefined} />
        </Field>
        <Field label="Your phone" error={error('phone')}>
          <input className={inputClass} type="tel" autoComplete="tel" placeholder="+254 7XX XXX XXX" value={form.phone} onChange={e => setValue('phone', e.target.value)} aria-invalid={Boolean(errors.phone) || undefined} />
        </Field>
      </div>
      <div>
        <Field label="Password" error={error('password')}>
          <PasswordInput id="bookshop-password" value={form.password} onChange={value => setValue('password', value)} autoComplete="new-password" invalid={Boolean(errors.password)} describedBy="bookshop-password-rules" />
        </Field>
        <PasswordRules id="bookshop-password-rules" value={form.password} />
      </div>
      <Field label="Confirm password" error={error('confirm')}>
        <PasswordInput id="bookshop-confirm" value={form.confirm} onChange={value => setValue('confirm', value)} autoComplete="new-password" invalid={Boolean(errors.confirm)} />
      </Field>

      <p className="mb-1 mt-6 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-400"><Store size={14} /> Your bookshop</p>
      <Field label="Bookshop name" error={error('bookshop_name')}>
        <input className={inputClass} autoComplete="organization" value={form.bookshop_name} onChange={e => setValue('bookshop_name', e.target.value)} aria-invalid={Boolean(errors.bookshop_name) || undefined} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Business phone" error={error('business_phone')}>
          <input className={inputClass} type="tel" value={form.business_phone} onChange={e => setValue('business_phone', e.target.value)} aria-invalid={Boolean(errors.business_phone) || undefined} />
        </Field>
        <Field label="Town or street" error={error('business_location')}>
          <input className={inputClass} autoComplete="address-level2" placeholder="e.g. Moi Avenue, Nairobi" value={form.business_location} onChange={e => setValue('business_location', e.target.value)} aria-invalid={Boolean(errors.business_location) || undefined} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Field label="Country" error={error('country')}>
          <input className={inputClass} list="bookshop-countries" autoComplete="country-name" value={form.country} onChange={e => chooseCountry(e.target.value)} aria-invalid={Boolean(errors.country) || undefined} />
          <datalist id="bookshop-countries">{Object.keys(COUNTRY_CURRENCIES).map(country => <option key={country} value={country} />)}</datalist>
        </Field>
        <Field label="Currency" error={error('currency')}>
          <input className={`${inputClass} uppercase`} maxLength={3} value={form.currency} onChange={e => setValue('currency', e.target.value.toUpperCase())} aria-invalid={Boolean(errors.currency) || undefined} />
        </Field>
      </div>
      <div>
        <label className="hk-check">
          <input type="checkbox" checked={form.terms} onChange={e => setValue('terms', e.target.checked)} aria-invalid={Boolean(errors.terms) || undefined} />
          <span>I accept the <Link to="/terms" className="hk-auth-link" target="_blank">terms of use</Link></span>
        </label>
        {errors.terms && <p className="mt-1.5 text-xs text-rose-600">{errors.terms.message}</p>}
      </div>
      <FormAlert message={message} />
      <button className={`${primaryButton} w-full`} type="submit" disabled={pending}>
        {pending ? 'Creating bookshop…' : platformMode ? 'Create bookshop' : 'Create my bookshop'} {!pending && <ArrowUpRight size={16} />}
      </button>
      {onCancel && <button type="button" className={`${secondaryButton} mt-3 w-full`} disabled={pending} onClick={onCancel}>Cancel</button>}
      {!platformMode && <p className="hk-auth-alt">Shopping or joining a team? <Link to="/register" className="hk-auth-link">Create a personal account</Link></p>}
    </form>
  </RegistrationShell>
}
