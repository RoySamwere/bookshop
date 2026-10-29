import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getCurrentUser, type BookshopUser } from '../../lib/auth'
import { UNAUTHORIZED_EVENT } from '../../lib/api'

type AuthState = { user: BookshopUser | null; loading: boolean; error: Error | null; retry: () => void }
const AuthContext = createContext<AuthState | null>(null)
export function AuthProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient()
  const session = useQuery({ queryKey: ['auth', 'me'], queryFn: getCurrentUser, retry: false })
  useEffect(() => {
    const expired = () => {
      client.clear()
      client.setQueryData(['auth', 'me'], null)
    }
    window.addEventListener(UNAUTHORIZED_EVENT, expired)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, expired)
  }, [client])
  return <AuthContext.Provider value={{ user: session.data ?? null, loading: session.isPending, error: session.error, retry: () => { void session.refetch() } }}>{children}</AuthContext.Provider>
}
export function useAuth() {
  const state = useContext(AuthContext)
  if (!state) throw new Error('useAuth requires AuthProvider')
  return state
}
