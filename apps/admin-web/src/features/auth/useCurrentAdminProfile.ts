import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../../api/queryKeys'
import { useAuthGateway } from './AuthGatewayContext'
import { fetchCurrentAdminProfile } from './authorizedRequest'
import { useSessionStore } from './session'

/** Server-confirmed profile of the signed-in administrator. Refetched when stale and the window regains focus. */
export function useCurrentAdminProfile() {
  const gateway = useAuthGateway()
  const session = useSessionStore()
  return useQuery({
    queryKey: queryKeys.auth.currentProfile(),
    queryFn: ({ signal }) => fetchCurrentAdminProfile(gateway, session, signal),
    staleTime: 5 * 60_000,
  })
}
