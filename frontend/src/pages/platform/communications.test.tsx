import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CommunicationsView from './communications'
import { communicationApi, type CommunicationLog } from '../../lib/communication-api'
import { platformApi } from '../../lib/tenancy-api'

vi.mock('../../lib/communication-api', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/communication-api')>(),
  communicationApi: { summary: vi.fn(), logs: vi.fn(), retry: vi.fn(), retryFailed: vi.fn(), templates: vi.fn(), saveTemplate: vi.fn(), resetTemplate: vi.fn(), announcements: vi.fn(), audience: vi.fn(), announce: vi.fn() } }))
vi.mock('../../lib/tenancy-api', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/tenancy-api')>(), platformApi: { bookshops: vi.fn() } }))

const page = <T,>(data: T[]) => ({ data, current_page: 1, last_page: 1, total: data.length })
const failed: CommunicationLog = { id: 7, event: 'announcement', bookshop_id: 3, bookshop_name: 'Kisumu Readers', announcement_id: 1, recipient_name: 'Achieng', recipient_email: 'owner@example.test',
  subject: 'Maintenance on Sunday', body: 'Hello Achieng,\n\nWe will be offline.', status: 'failed', attempts: 3, last_error: 'TransportException: Connection refused', sent_at: null, failed_at: '2026-11-14T08:00:00Z', created_at: '2026-11-14T07:00:00Z' }

function mount(path = '/platform/communications') {
  return render(<MemoryRouter initialEntries={[path]}><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <Routes><Route path="/platform/communications/*" element={<CommunicationsView />} /></Routes></QueryClientProvider></MemoryRouter>)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(communicationApi.summary).mockResolvedValue({ sent: 12, queued: 1, failed: 1, last_30_days: 14, announcements: 2 })
  vi.mocked(communicationApi.logs).mockResolvedValue(page([failed]))
  vi.mocked(communicationApi.announcements).mockResolvedValue(page([]))
  vi.mocked(platformApi.bookshops).mockResolvedValue({ data: [{ id: 3, name: 'Kisumu Readers', status: 'active' }, { id: 4, name: 'Mombasa Page Turners', status: 'active' }] as never, meta: { current_page: 1, last_page: 1, per_page: 25, total: 2, from: 1, to: 2 } })
})

describe('Communication', () => {
  it('summarises delivery and retries a failed email', async () => {
    vi.mocked(communicationApi.retry).mockResolvedValue({ message: 'Queued', data: { ...failed, status: 'queued' } })
    const user = userEvent.setup(); mount()
    const summary = await screen.findByRole('region', { name: 'Delivery summary' })
    expect(within(summary).getByText('12')).toBeInTheDocument()
    const row = (await screen.findByText('Maintenance on Sunday')).closest('tr')!
    expect(within(row).getByText('Failed')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry email to owner@example.test' }))
    expect(communicationApi.retry).toHaveBeenCalledWith(7)
    await user.click(screen.getByRole('button', { name: 'View email to owner@example.test' }))
    expect(within(await screen.findByRole('dialog')).getByText(/Connection refused/)).toBeInTheDocument()
  })

  it('sends an announcement to selected bookshops only after confirming who receives it', async () => {
    vi.mocked(communicationApi.audience).mockResolvedValue({ bookshops: 1, recipients: 3 })
    vi.mocked(communicationApi.announce).mockResolvedValue({ message: 'Announcement queued for 3 user(s) in 1 bookshop(s).', duplicate: false, data: { id: 1, recipient_count: 3 } })
    const user = userEvent.setup(); mount('/platform/communications/announcements')
    const send = await screen.findByRole('button', { name: /Review and send/ })
    expect(send).toBeDisabled()

    await user.selectOptions(screen.getByLabelText('Send to'), 'staff')
    await user.click(screen.getByRole('radio', { name: /Selected bookshops/ }))
    await user.click(await screen.findByRole('checkbox', { name: /Kisumu Readers/ }))
    await user.type(screen.getByLabelText('Subject'), 'New stock taking feature')
    await user.type(screen.getByLabelText(/^Message/), 'Stock taking is now available.')
    await user.click(send)
    expect(communicationApi.audience).toHaveBeenCalledWith({ audience: 'selected', bookshop_ids: [3], recipients: 'staff' })

    const dialog = await screen.findByRole('dialog', { name: 'Send this announcement?' })
    expect(within(dialog).getByText('3')).toBeInTheDocument()
    expect(communicationApi.announce).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Send to 3 people' }))
    expect(communicationApi.announce).toHaveBeenCalledWith(expect.objectContaining({ audience: 'selected', bookshop_ids: [3], recipients: 'staff', subject: 'New stock taking feature', category: 'update', idempotency_key: expect.stringMatching(/^[A-Za-z0-9-]{8,64}$/) }))
    expect(await screen.findByText('Announcement queued for 3 user(s) in 1 bookshop(s).')).toBeInTheDocument()
  })

  it('edits a template and can turn it off', async () => {
    vi.mocked(communicationApi.templates).mockResolvedValue([{ key: 'welcome', label: 'Bookshop activated', description: 'Sent on activation.', placeholders: ['name', 'bookshop'], subject: 'Welcome {bookshop}', body: 'Hello {name},', is_enabled: true, customized: false, default_subject: 'Welcome {bookshop}', default_body: 'Hello {name},' }])
    vi.mocked(communicationApi.saveTemplate).mockResolvedValue({ message: 'Template saved. New messages use it from now on.' })
    const user = userEvent.setup(); mount('/platform/communications/templates')
    await user.click(await screen.findByRole('button', { name: /Bookshop activated/ }))
    const subject = screen.getByLabelText('Subject')
    await user.clear(subject); await user.type(subject, 'Karibu {{bookshop}')
    await user.click(screen.getByRole('checkbox', { name: /Send this email automatically/ }))
    await user.click(screen.getByRole('button', { name: 'Save template' }))
    expect(communicationApi.saveTemplate).toHaveBeenCalledWith('welcome', { subject: 'Karibu {bookshop}', body: 'Hello {name},', is_enabled: false })
  })
})
