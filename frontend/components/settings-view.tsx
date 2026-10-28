'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Building2, MapPin, Percent, Pencil, Plus, Receipt, Settings, Store, Trash2 } from 'lucide-react'
import { ApiError, errorMessage } from '../lib/api'
import { hasPermission, type BookshopUser } from '../lib/auth'
import { branchesApi, businessApi, type Branch, type BusinessProfile, type TaxRate } from '../lib/workspace-api'
import { Card, EmptyState, ErrorState, Field, FormAlert, LoadingState, Modal, ModalActions, PageHeader, StatusBadge, inputClass, primaryButton, secondaryButton } from './ui-kit'

const TABS = [
  { id: 'business', label: 'Business & receipts', icon: Building2 },
  { id: 'branches', label: 'Branches', icon: Store },
  { id: 'taxes', label: 'Tax rates', icon: Percent },
] as const
type Tab = typeof TABS[number]['id']

export function SettingsView({ currentUser, notify }: { currentUser: BookshopUser; notify: (message: string) => void }) {
  const [tab, setTab] = useState<Tab>('business')
  const canEdit = hasPermission(currentUser, 'settings.manage')

  return <div className="products-page">
    <PageHeader eyebrow="WORKSPACE / SETTINGS" icon={<Settings size={15} />} title="Settings"
      description={canEdit ? 'Your business profile, branches, tax and receipt defaults.' : 'Business details and defaults used across the shop. Only the system owner can change them.'} />
    <div className="mb-5 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm sm:inline-flex" role="tablist" aria-label="Settings sections">
      {TABS.map(({ id, label, icon: Icon }) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
        className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition ${tab === id ? 'bg-[#087df5] text-white shadow-sm' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}>
        <Icon size={16} />{label}
      </button>)}
    </div>
    {tab === 'business' && <BusinessTab canEdit={canEdit} notify={notify} />}
    {tab === 'branches' && <BranchesTab canEdit={hasPermission(currentUser, 'branches.manage')} notify={notify} />}
    {tab === 'taxes' && <TaxesTab canEdit={canEdit} notify={notify} />}
  </div>
}

const TIMEZONES = ['Africa/Nairobi', 'Africa/Kampala', 'Africa/Dar_es_Salaam', 'Africa/Kigali', 'UTC']

function BusinessTab({ canEdit, notify }: { canEdit: boolean; notify: (message: string) => void }) {
  const [profile, setProfile] = useState<BusinessProfile | null>(null)
  const [form, setForm] = useState<BusinessProfile | null>(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [message, setMessage] = useState('')

  const load = useCallback(() => {
    setLoadError('')
    businessApi.get().then(data => { setProfile(data); setForm(data) }).catch(e => setLoadError(errorMessage(e)))
  }, [])
  useEffect(load, [load])

  if (loadError) return <Card title="Business profile"><ErrorState message={loadError} onRetry={load} /></Card>
  if (!form || !profile) return <Card title="Business profile"><LoadingState label="Loading business settings" /></Card>

  const set = <K extends keyof BusinessProfile>(key: K, value: BusinessProfile[K]) => setForm(previous => previous && ({ ...previous, [key]: value }))
  const text = (key: keyof BusinessProfile) => ({ value: (form[key] as string | null) ?? '', disabled: !canEdit, onChange: (e: { target: { value: string } }) => set(key, (e.target.value || null) as never) })
  const dirty = JSON.stringify(form) !== JSON.stringify(profile)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null); setMessage('')
    const { default_tax: _ignored, ...payload } = form!
    try {
      const saved = await businessApi.update(payload)
      setProfile(saved.data); setForm(saved.data); notify(saved.message)
    } catch (e) {
      if (e instanceof ApiError) { setError(e); setMessage(e.message) } else setMessage(errorMessage(e))
    } finally { setBusy(false) }
  }

  return <form onSubmit={submit} className="grid gap-5 xl:grid-cols-[1fr_340px]" noValidate>
    <div className="grid gap-5">
      <Card title="Business profile" description="Shown on receipts, invoices and the online store.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Trading name" error={error?.field('name')}><input className={inputClass} {...text('name')} required /></Field>
          <Field label="Registered (legal) name" error={error?.field('legal_name')}><input className={inputClass} {...text('legal_name')} placeholder="e.g. Nifunze Lessons Ltd" /></Field>
          <Field label="KRA PIN" error={error?.field('kra_pin')} hint="Format A123456789Z"><input className={inputClass} {...text('kra_pin')} placeholder="P051234567X" /></Field>
          <Field label="Email" error={error?.field('email')}><input className={inputClass} type="email" {...text('email')} placeholder="hello@nifunze.co.ke" /></Field>
          <Field label="Phone" error={error?.field('phone')}><input className={inputClass} type="tel" {...text('phone')} placeholder="+254 7XX XXX XXX" /></Field>
          <Field label="Website" error={error?.field('website')}><input className={inputClass} type="url" {...text('website')} placeholder="https://" /></Field>
          <Field label="Street address" error={error?.field('address')}><input className={inputClass} {...text('address')} /></Field>
          <Field label="Town / city" error={error?.field('city')}><input className={inputClass} {...text('city')} /></Field>
        </div>
      </Card>
      <Card title="Store defaults" description="Currency, time and stock alert defaults for every branch.">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Currency" error={error?.field('currency')}><select className={inputClass} value={form.currency} disabled={!canEdit} onChange={e => set('currency', e.target.value)}><option value="KES">KES · Kenyan shilling</option><option value="UGX">UGX · Ugandan shilling</option><option value="TZS">TZS · Tanzanian shilling</option><option value="USD">USD · US dollar</option></select></Field>
          <Field label="Time zone" error={error?.field('timezone')}><select className={inputClass} value={form.timezone} disabled={!canEdit} onChange={e => set('timezone', e.target.value)}>{[...new Set([form.timezone, ...TIMEZONES])].map(zone => <option key={zone}>{zone}</option>)}</select></Field>
          <Field label="Low stock alert at" error={error?.field('low_stock_threshold')} hint="Units remaining"><input className={inputClass} type="number" min={0} value={form.low_stock_threshold} disabled={!canEdit} onChange={e => set('low_stock_threshold', Number(e.target.value))} /></Field>
          <Field label="Shelf prices" hint={profile.default_tax ? `Default tax: ${profile.default_tax.name}` : 'No default tax set'}><select className={inputClass} value={form.prices_include_tax ? 'yes' : 'no'} disabled={!canEdit} onChange={e => set('prices_include_tax', e.target.value === 'yes')}><option value="yes">Include tax</option><option value="no">Exclude tax</option></select></Field>
        </div>
      </Card>
      <Card title="Receipts" description="Header, numbering and closing message printed on every receipt.">
        <div className="grid gap-4 sm:grid-cols-[160px_1fr]">
          <Field label="Receipt prefix" error={error?.field('receipt_prefix')} hint={`e.g. #${form.receipt_prefix || 'NS'}-10001`}><input className={inputClass} {...text('receipt_prefix')} maxLength={10} /></Field>
          <Field label="Header line" error={error?.field('receipt_header')}><input className={inputClass} {...text('receipt_header')} placeholder="e.g. Books for every learner" /></Field>
          <Field label="Footer message" error={error?.field('receipt_footer')} className="sm:col-span-2"><textarea className={`${inputClass} h-24 py-3`} {...text('receipt_footer')} placeholder="Thank you for shopping with us." /></Field>
        </div>
      </Card>
      {canEdit && <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-end">
        <FormAlert message={message} />
        <button type="button" className={secondaryButton} disabled={!dirty || busy} onClick={() => { setForm(profile); setError(null); setMessage('') }}>Discard changes</button>
        <button type="submit" className={primaryButton} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save settings'}</button>
      </div>}
    </div>
    <ReceiptPreview profile={form} />
  </form>
}

function ReceiptPreview({ profile }: { profile: BusinessProfile }) {
  const tax = profile.default_tax ? Number(profile.default_tax.rate) : 0
  const total = 1650
  const taxAmount = profile.prices_include_tax ? total - total / (1 + tax / 100) : total * tax / 100
  const money = (value: number) => `${profile.currency} ${value.toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return <aside className="self-start xl:sticky xl:top-24">
    <p className="mb-2 flex items-center gap-2 text-[11px] font-bold tracking-[0.16em] text-slate-500"><Receipt size={14} /> RECEIPT PREVIEW</p>
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-6 font-mono text-[12px] leading-relaxed text-slate-700 shadow-sm">
      <div className="text-center">
        <img src="/favicon.png" alt="" className="mx-auto mb-2 size-10 object-contain" />
        <p className="font-sans text-sm font-bold text-slate-900">{profile.name || 'Business name'}</p>
        {profile.receipt_header && <p>{profile.receipt_header}</p>}
        {(profile.address || profile.city) && <p>{[profile.address, profile.city].filter(Boolean).join(', ')}</p>}
        {profile.phone && <p>Tel {profile.phone}</p>}
        {profile.kra_pin && <p>PIN {profile.kra_pin}</p>}
      </div>
      <div className="my-3 border-t border-dashed border-slate-300" />
      <p>Receipt #{profile.receipt_prefix || 'NS'}-10001</p>
      <div className="my-3 border-t border-dashed border-slate-300" />
      <p className="flex justify-between"><span>Sample item × 1</span><span>{money(total)}</span></p>
      <p className="flex justify-between text-slate-500"><span>{profile.default_tax?.name || 'Tax'}{profile.prices_include_tax ? ' (incl.)' : ''}</span><span>{money(taxAmount)}</span></p>
      <p className="mt-1 flex justify-between font-bold text-slate-900"><span>TOTAL</span><span>{money(profile.prices_include_tax ? total : total + taxAmount)}</span></p>
      {profile.receipt_footer && <><div className="my-3 border-t border-dashed border-slate-300" /><p className="whitespace-pre-line text-center">{profile.receipt_footer}</p></>}
    </div>
  </aside>
}

function BranchesTab({ canEdit, notify }: { canEdit: boolean; notify: (message: string) => void }) {
  const [branches, setBranches] = useState<Branch[] | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Branch | 'new' | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(() => {
    setError('')
    branchesApi.list().then(setBranches).catch(e => setError(errorMessage(e)))
  }, [])
  useEffect(load, [load])

  async function toggle(branch: Branch) {
    if (!confirm(`${branch.is_active ? 'Deactivate' : 'Reactivate'} ${branch.name}?`)) return
    setBusyId(branch.id)
    try { notify((await branchesApi.update(branch.id, { is_active: !branch.is_active })).message); load() }
    catch (e) { notify(errorMessage(e)) } finally { setBusyId(null) }
  }

  return <Card title="Branches and stores" description="Each branch keeps its own staff today, and its own stock and sales in later phases." flush
    actions={canEdit && <button className={primaryButton} onClick={() => setEditing('new')}><Plus size={17} /> Add branch</button>}>
    {error ? <ErrorState message={error} onRetry={load} /> : !branches ? <LoadingState label="Loading branches" /> : branches.length === 0
      ? <EmptyState icon={<Store size={22} />} title="No branches" body="Add your first shop to start assigning staff." />
      : <div className="divide-y divide-slate-100">
        {branches.map(branch => <div key={branch.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-blue-50 text-[#087df5]"><Store size={19} /></span>
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-800">{branch.name}<span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] font-bold text-slate-500">{branch.code}</span>{branch.is_main && <span className="rounded-md bg-pink-50 px-1.5 py-0.5 text-[11px] font-bold text-[#d9539f]">MAIN</span>}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
              {(branch.address || branch.city) && <span className="inline-flex items-center gap-1"><MapPin size={12} />{[branch.address, branch.city].filter(Boolean).join(', ')}</span>}
              {branch.phone && <span>{branch.phone}</span>}<span>{branch.users_count ?? 0} staff</span>
            </p>
          </div>
          <StatusBadge active={branch.is_active} />
          {canEdit && <div className="flex gap-2">
            <button className={`${secondaryButton} h-9`} onClick={() => setEditing(branch)}><Pencil size={14} /> Edit</button>
            {!branch.is_main && <button className={`${secondaryButton} h-9`} disabled={busyId === branch.id} onClick={() => void toggle(branch)}>{branch.is_active ? 'Deactivate' : 'Reactivate'}</button>}
          </div>}
        </div>)}
      </div>}
    {editing && <BranchDialog branch={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={message => { setEditing(null); notify(message); load() }} />}
  </Card>
}

function BranchDialog({ branch, onClose, onSaved }: { branch?: Branch; onClose: () => void; onSaved: (message: string) => void }) {
  const [form, setForm] = useState({ name: branch?.name || '', code: branch?.code || '', phone: branch?.phone || '', email: branch?.email || '', address: branch?.address || '', city: branch?.city || '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [message, setMessage] = useState('')
  const input = (key: keyof typeof form) => ({ value: form[key], onChange: (e: { target: { value: string } }) => setForm(previous => ({ ...previous, [key]: e.target.value })) })

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null); setMessage('')
    const payload = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value.trim() || null]))
    try { onSaved((branch ? await branchesApi.update(branch.id, payload) : await branchesApi.create(payload)).message) }
    catch (e) { if (e instanceof ApiError) { setError(e); setMessage(e.message) } else setMessage(errorMessage(e)) }
    finally { setBusy(false) }
  }

  return <Modal title={branch ? `Edit ${branch.name}` : 'Add a branch'} description="Branch details appear on receipts printed at that branch." icon={<Store size={19} />} onClose={onClose} busy={busy}>
    <form onSubmit={submit} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Branch name" error={error?.field('name')}><input className={inputClass} {...input('name')} placeholder="e.g. Westlands Shop" required /></Field>
        <Field label="Branch code" error={error?.field('code')} hint="Short unique code, e.g. WEST"><input className={`${inputClass} uppercase`} {...input('code')} maxLength={20} required /></Field>
        <Field label="Phone" error={error?.field('phone')}><input className={inputClass} type="tel" {...input('phone')} /></Field>
        <Field label="Email" error={error?.field('email')}><input className={inputClass} type="email" {...input('email')} /></Field>
        <Field label="Street address" error={error?.field('address')}><input className={inputClass} {...input('address')} /></Field>
        <Field label="Town / city" error={error?.field('city')}><input className={inputClass} {...input('city')} /></Field>
      </div>
      <FormAlert message={message} />
      <ModalActions busy={busy} submitLabel={branch ? 'Save branch' : 'Create branch'} busyLabel="Saving…" onCancel={onClose} />
    </form>
  </Modal>
}

function TaxesTab({ canEdit, notify }: { canEdit: boolean; notify: (message: string) => void }) {
  const [rates, setRates] = useState<TaxRate[] | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<TaxRate | 'new' | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(() => {
    setError('')
    businessApi.taxRates().then(setRates).catch(e => setError(errorMessage(e)))
  }, [])
  useEffect(load, [load])

  async function run(rate: TaxRate, action: () => Promise<{ message: string }>) {
    setBusyId(rate.id)
    try { notify((await action()).message); load() } catch (e) { notify(errorMessage(e)) } finally { setBusyId(null) }
  }

  return <Card title="Tax rates" description="The default rate applies to new products and POS sales. Kenyan VAT is 16%." flush
    actions={canEdit && <button className={primaryButton} onClick={() => setEditing('new')}><Plus size={17} /> Add tax rate</button>}>
    {error ? <ErrorState message={error} onRetry={load} /> : !rates ? <LoadingState label="Loading tax rates" /> : rates.length === 0
      ? <EmptyState icon={<Percent size={22} />} title="No tax rates" body="Add VAT 16% to start charging tax." />
      : <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left">
        <thead className="bg-slate-50/80"><tr className="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400"><th className="px-6 py-3.5">Name</th><th className="px-5 py-3.5">Code</th><th className="px-5 py-3.5">Rate</th><th className="px-5 py-3.5">Status</th><th className="px-5 py-3.5 text-right">{canEdit ? 'Manage' : ''}</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{rates.map(rate => <tr key={rate.id}>
          <td className="px-6 py-4 text-sm font-semibold text-slate-800">{rate.name}{rate.is_default && <span className="ml-2 rounded-md bg-blue-50 px-1.5 py-0.5 text-[11px] font-bold text-[#087df5]">DEFAULT</span>}</td>
          <td className="px-5 py-4 text-sm text-slate-500">{rate.code}</td>
          <td className="px-5 py-4 text-sm font-semibold text-slate-800">{Number(rate.rate)}%</td>
          <td className="px-5 py-4"><StatusBadge active={rate.is_active} /></td>
          <td className="px-5 py-4">{canEdit && <div className="flex justify-end gap-2">
            {!rate.is_default && rate.is_active && <button className={`${secondaryButton} h-9`} disabled={busyId === rate.id} onClick={() => void run(rate, () => businessApi.updateTaxRate(rate.id, { is_default: true }))}>Make default</button>}
            <button className={`${secondaryButton} h-9`} onClick={() => setEditing(rate)} aria-label={`Edit ${rate.name}`}><Pencil size={14} /></button>
            {!rate.is_default && <button className={`${secondaryButton} h-9 text-rose-600`} disabled={busyId === rate.id} aria-label={`Delete ${rate.name}`}
              onClick={() => { if (confirm(`Delete ${rate.name}?`)) void run(rate, () => businessApi.deleteTaxRate(rate.id)) }}><Trash2 size={14} /></button>}
          </div>}</td>
        </tr>)}</tbody>
      </table></div>}
    {editing && <TaxDialog rate={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={message => { setEditing(null); notify(message); load() }} />}
  </Card>
}

function TaxDialog({ rate, onClose, onSaved }: { rate?: TaxRate; onClose: () => void; onSaved: (message: string) => void }) {
  const [form, setForm] = useState({ name: rate?.name || '', code: rate?.code || '', rate: rate ? String(Number(rate.rate)) : '', is_active: rate?.is_active ?? true })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ApiError | null>(null)
  const [message, setMessage] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(null); setMessage('')
    const payload = { name: form.name, code: form.code, rate: form.rate as unknown as string, ...(rate?.is_default ? {} : { is_active: form.is_active }) }
    try { onSaved((rate ? await businessApi.updateTaxRate(rate.id, payload) : await businessApi.createTaxRate(payload)).message) }
    catch (e) { if (e instanceof ApiError) { setError(e); setMessage(e.message) } else setMessage(errorMessage(e)) }
    finally { setBusy(false) }
  }

  return <Modal title={rate ? `Edit ${rate.name}` : 'Add a tax rate'} icon={<Percent size={19} />} onClose={onClose} busy={busy}>
    <form onSubmit={submit} noValidate>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Name" error={error?.field('name')} className="sm:col-span-3"><input className={inputClass} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. VAT 16%" required /></Field>
        <Field label="Code" error={error?.field('code')}><input className={`${inputClass} uppercase`} value={form.code} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="VAT16" required /></Field>
        <Field label="Rate (%)" error={error?.field('rate')}><input className={inputClass} type="number" min={0} max={100} step="0.01" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })} required /></Field>
        {!rate?.is_default && <Field label="Status"><select className={inputClass} value={form.is_active ? '1' : '0'} onChange={e => setForm({ ...form, is_active: e.target.value === '1' })}><option value="1">Active</option><option value="0">Inactive</option></select></Field>}
      </div>
      <FormAlert message={message} />
      <ModalActions busy={busy} submitLabel={rate ? 'Save tax rate' : 'Add tax rate'} busyLabel="Saving…" onCancel={onClose} />
    </form>
  </Modal>
}
