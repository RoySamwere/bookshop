import { Suspense } from 'react'
import { Link, Navigate, Route, Routes } from 'react-router-dom'
import BrandLoader from '../components/brand-loader'
import { SessionManager } from '../components/session-manager'
import { ProtectedRoute } from './protected-route'
import { PageLoadBoundary } from '../components/page-load-boundary'
import { lazyPage } from '../lib/lazy-page'

const Home = lazyPage(() => import('../pages/page'))
const Login = lazyPage(() => import('../pages/login/page'))
const Register = lazyPage(() => import('../pages/register/page'))
const Forgot = lazyPage(() => import('../pages/forgot-password/page'))
const Reset = lazyPage(() => import('../pages/reset-password/page'))
const Verify = lazyPage(() => import('../pages/verify-email/page'))
const Terms = lazyPage(() => import('../pages/terms/page'))
const Account = lazyPage(() => import('../pages/account/page'))
const Dashboard = lazyPage(() => import('../pages/dashboard/page'))
const Catalog = lazyPage(() => import('../pages/dashboard/catalog/page'))
const PublicProducts = lazyPage(() => import('../pages/public-products/page'))
const RegisterBookshop = lazyPage(() => import('../pages/register/bookshop/page'))
const OnboardingVerify = lazyPage(() => import('../pages/onboarding/verify-email/page'))
const OnboardingSetup = lazyPage(() => import('../pages/onboarding/setup/page'))
const OnboardingBookshop = lazyPage(() => import('../pages/onboarding/bookshop/page'))
const AcceptInvitation = lazyPage(() => import('../pages/accept-invitation/page'))
const Platform = lazyPage(() => import('../pages/platform/page'))

export function AppRoutes() {
  return <><SessionManager /><PageLoadBoundary><Suspense fallback={<BrandLoader />}><Routes>
    <Route path="/" element={<Home />} />
    <Route path="/login" element={<Login />} />
    <Route path="/register" element={<Register />} />
    <Route path="/register/bookshop" element={<RegisterBookshop />} />
    <Route path="/products" element={<PublicProducts />} />
    <Route path="/accept-invitation" element={<AcceptInvitation />} />
    {/* Onboarding and the platform console check the account type themselves. */}
    <Route path="/onboarding/verify-email" element={<OnboardingVerify />} />
    <Route path="/onboarding/setup" element={<OnboardingSetup />} />
    <Route path="/onboarding/bookshop" element={<OnboardingBookshop />} />
    <Route path="/onboarding" element={<Navigate replace to="/onboarding/setup" />} />
    <Route element={<ProtectedRoute permission="platform.access" />}><Route path="/platform/*" element={<Platform />} /></Route>
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
  </Routes></Suspense></PageLoadBoundary></>
}
