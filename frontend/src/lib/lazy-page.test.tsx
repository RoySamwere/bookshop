import { Suspense } from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PageLoadBoundary } from '../components/page-load-boundary'
import { isChunkLoadError, lazyPage, reloadOnceForFreshAssets } from './lazy-page'

const chunkError = () => new TypeError('Failed to fetch dynamically imported module: https://hekimabookshop.co.ke/assets/page-BIYpPcnh.js')

describe('lazyPage', () => {
  const reload = vi.fn()
  beforeEach(() => {
    sessionStorage.clear()
    reload.mockReset()
    Object.defineProperty(window, 'location', { configurable: true, value: { ...window.location, reload } })
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
  })
  afterEach(() => vi.restoreAllMocks())

  it('recognises chunk load failures from Chrome, Safari and Firefox', () => {
    expect(isChunkLoadError(chunkError())).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
  })

  it('reloads only once within the guard window', () => {
    expect(reloadOnceForFreshAssets()).toBe(true)
    expect(reloadOnceForFreshAssets()).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reloads the page once when a page chunk fails, keeping the loader on screen', async () => {
    const Page = lazyPage(() => Promise.reject(chunkError()))
    render(<PageLoadBoundary><Suspense fallback={<p>Loading</p>}><Page /></Suspense></PageLoadBoundary>)
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1))
    expect(screen.getByText('Loading')).toBeTruthy()
  })

  it('shows a reload screen instead of a blank page when it already reloaded', async () => {
    sessionStorage.setItem('hekima:chunk-reload-at', String(Date.now()))
    const Page = lazyPage(() => Promise.reject(chunkError()))
    render(<PageLoadBoundary><Suspense fallback={<p>Loading</p>}><Page /></Suspense></PageLoadBoundary>)
    expect(await screen.findByRole('heading', { name: 'This page didn’t finish loading' })).toBeTruthy()
    screen.getByRole('button', { name: 'Reload page' }).click()
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('loads normally when the chunk is fine', async () => {
    const Page = lazyPage(() => Promise.resolve({ default: () => <h1>Dashboard</h1> }))
    render(<PageLoadBoundary><Suspense fallback={<p>Loading</p>}><Page /></Suspense></PageLoadBoundary>)
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeTruthy()
    expect(reload).not.toHaveBeenCalled()
  })
})
