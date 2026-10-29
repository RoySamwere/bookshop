import { lazy, Suspense } from 'react'
import { Link, Route, Routes } from 'react-router-dom'
import BrandLoader from '../components/brand-loader'
import { SessionManager } from '../components/session-manager'
import { ProtectedRoute } from './protected-route'

const Home = lazy(() => import('../pages/page'))
const Login = lazy(() => import('../pages/login/page'))
const Register = lazy(() => import('../pages/register/page'))
const Forgot = lazy(() => import('../pages/forgot-password/page'))
const Reset = lazy(() => import('../pages/reset-password/page'))
const Verify = lazy(() => import('../pages/verify-email/page'))
const Terms = lazy(() => import('../pages/terms/page'))
const Account = lazy(() => import('../pages/account/page'))
const Dashboard = lazy(() => import('../pages/dashboard/page'))
const Catalog = lazy(() => import('../pages/dashboard/catalog/page'))

export function AppRoutes() {
  return <><SessionManager /><Suspense fallback={<BrandLoader />}><Routes>
    <Route path="/" element={<Home />} />
    <Route path="/login" element={<Login />} />
    <Route path="/register" element={<Register />} />
    <Route path="/forgot-password" element={<Forgot />} />
    <Route path="/reset-password" element={<Reset />} />
    <Route path="/verify-email" element={<Verify />} />
    <Route path="/terms" element={<Terms />} />
    <Route element={<ProtectedRoute />}><Route path="/account" element={<Account />} /></Route>
    <Route element={<ProtectedRoute permission="workspace.access" />}>
      <Route path="/dashboard" element={<Dashboard />} />
    </Route>
    <Route element={<ProtectedRoute permission="catalog.view" />}><Route path="/dashboard/catalog" element={<Catalog />} /></Route>
    <Route path="*" element={<main className="p-8"><h1>Page not found</h1><Link to="/">Return home</Link></main>} />
  </Routes></Suspense></>
}
