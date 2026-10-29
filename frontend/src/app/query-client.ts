import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '../lib/api'

export const queryClient = new QueryClient({ defaultOptions: {
  queries: { staleTime: 30_000, refetchOnWindowFocus: true,
    retry: (count, error) => count < 1 && (!(error instanceof ApiError) || error.status >= 500),
  },
  mutations: { retry: false },
} })
