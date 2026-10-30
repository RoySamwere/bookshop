import { lazy, type ComponentType } from 'react'

/**
 * Pages are separate files (chunks) that load when first opened. A chunk can fail to load when:
 *  - the site was redeployed while this tab was open, so the old chunk names no longer exist, or
 *  - the connection dropped mid-download (ERR_CONNECTION_RESET).
 * One full reload fixes both: it fetches the current index.html and its current chunk names.
 * The reload happens at most once per 30 seconds per tab, so a real outage cannot cause a reload loop.
 */
const RELOAD_KEY = 'hekima:chunk-reload-at'
const RELOAD_WINDOW_MS = 30_000

export function isChunkLoadError(error: unknown) {
  if (!(error instanceof Error)) return false
  return /dynamically imported module|importing a module script failed|error loading dynamically imported module|unable to preload css|chunkloaderror|loading chunk .* failed/i
    .test(`${error.name} ${error.message}`)
}

/** Reloads the page unless it already did so very recently. Returns true when a reload was started. */
export function reloadOnceForFreshAssets(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
    if (Date.now() - last < RELOAD_WINDOW_MS) return false
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  } catch {
    return false // No storage means no loop guard; let the error screen offer a manual reload instead.
  }
  window.location.reload()
  return true
}

/** `React.lazy` that recovers from a failed chunk download by reloading once. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await load()
    } catch (error) {
      // While the reload is starting, keep showing the loader instead of an error.
      if (isChunkLoadError(error) && reloadOnceForFreshAssets()) return new Promise<never>(() => undefined)
      throw error
    }
  })
}
