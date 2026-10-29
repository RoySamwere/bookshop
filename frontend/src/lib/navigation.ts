import { useMemo } from 'react'
import { useLocation, useNavigate, useSearchParams as useRouterSearchParams } from 'react-router-dom'

/** Stable navigation facade while the preserved screens migrate to route-specific hooks. */
export function useRouter() {
  const navigate = useNavigate()
  return useMemo(() => ({
    push: (path: string) => navigate(path),
    replace: (path: string) => navigate(path, { replace: true }),
    back: () => navigate(-1),
  }), [navigate])
}
export const usePathname = () => useLocation().pathname
export const useSearchParams = () => useRouterSearchParams()[0]
