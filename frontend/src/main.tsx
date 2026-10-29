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
import { clearLegacyCredentials } from './lib/api'

clearLegacyCredentials()

createRoot(document.getElementById('root')!).render(
  <BrowserRouter><QueryClientProvider client={queryClient}><AuthProvider><AppRoutes /></AuthProvider></QueryClientProvider></BrowserRouter>,
)
