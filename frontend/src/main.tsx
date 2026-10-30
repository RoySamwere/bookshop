import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './app/query-client'
import { AuthProvider } from './features/auth/auth-provider'
import { AppRoutes } from './routes/app-routes'
import './pages/globals.css'
import './pages/workspace.css'
import './pages/public.css'
import './pages/pos.css'
import './pages/shop-theme.css'
import './pages/pos-theme.css'
import { clearLegacyCredentials } from './lib/api'
import { reloadOnceForFreshAssets } from './lib/lazy-page'

clearLegacyCredentials()

// Tells the loading guard in index.html that the app's files arrived and the app is starting.
;(window as Window & { __hekimaStarted?: boolean }).__hekimaStarted = true

// Vite fires this when a page's supporting files (shared JS or CSS) fail to load, usually after a redeploy.
window.addEventListener('vite:preloadError', event => {
  if (reloadOnceForFreshAssets()) event.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <BrowserRouter><QueryClientProvider client={queryClient}><AuthProvider><AppRoutes /></AuthProvider></QueryClientProvider></BrowserRouter>,
)
