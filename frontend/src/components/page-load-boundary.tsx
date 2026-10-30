import { Component, type ReactNode } from 'react'
import { isChunkLoadError } from '../lib/lazy-page'

type State = { error: Error | null }

/** Shows a way out instead of a blank screen when a page fails to load or crashes. */
export class PageLoadBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error('Page failed to load', error)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const chunk = isChunkLoadError(error)
    return <main role="alert" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: '#F5F7FC', fontFamily: 'Figtree, system-ui, sans-serif', color: '#14213D' }}>
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <h1 style={{ margin: '0 0 8px', fontSize: 22 }}>{chunk ? 'This page didn’t finish loading' : 'Something went wrong on this page'}</h1>
        <p style={{ margin: '0 0 20px', fontSize: 15, lineHeight: 1.55, color: '#4A5670' }}>
          {chunk
            ? 'The connection dropped or the site was just updated. Reloading gets the latest version. Anything in your sale is kept.'
            : 'Reload the page to try again. If it keeps happening, tell your administrator what you were doing.'}
        </p>
        <button type="button" onClick={() => window.location.reload()}
          style={{ height: 46, padding: '0 22px', border: 0, borderRadius: 12, background: '#0A63E0', color: '#fff', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
          Reload page
        </button>
      </div>
    </main>
  }
}
