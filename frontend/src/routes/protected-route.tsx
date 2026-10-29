import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../features/auth/auth-provider'
import { ApiError } from '../lib/api'
import { hasPermission, type Permission } from '../lib/auth'
import BrandLoader from '../components/brand-loader'

export function ProtectedRoute({ permission }: { permission?: Permission }) {
  const { user, loading, error, retry } = useAuth()
  const location = useLocation()
  if (loading) return <BrandLoader />
  if (error && (!(error instanceof ApiError) || ![401, 403, 419].includes(error.status))) {
    return <main className="p-8" role="alert"><p>{error.message}</p><button onClick={retry}>Retry connection</button></main>
  }
  if (!user) return <Navigate replace to={`/login?next=${encodeURIComponent(location.pathname + location.search + location.hash)}`} />
  if (permission && !hasPermission(user, permission)) return <main className="p-8"><h1>Access restricted</h1><p>Your account does not have permission to open this page.</p></main>
  return <Outlet />
}
