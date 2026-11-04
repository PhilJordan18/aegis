import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../../api/queryKeys'
import { authorizedRequest } from '../auth/authorizedRequest'
import { useSessionStore } from '../auth/session'
import { useLockerGateway } from './LockerGatewayContext'

/**
 * The hub sends a heartbeat every 10 s and the server calls it ONLINE up to 30 s after the last one
 * (09 §16.1, 10 §15.3). 15 s keeps the screen within one missed beat without hammering the API. The
 * server alone decides ONLINE, OFFLINE or UNKNOWN: this interval only asks again. TanStack Query
 * pauses it while the tab is hidden (`refetchIntervalInBackground` stays false).
 */
export const LOCKER_STATUS_REFRESH_MS = 15_000

/** One locker's status, refreshed on an interval. A failed refresh keeps the last good data (`isRefetchError`). */
export function useLockerStatus(lockerId: string) {
  const gateway = useLockerGateway()
  const session = useSessionStore()
  return useQuery({
    queryKey: queryKeys.lockers.status(lockerId),
    queryFn: ({ signal }) => authorizedRequest(session, (accessToken) => gateway.getStatus(accessToken, lockerId, signal)),
    refetchInterval: LOCKER_STATUS_REFRESH_MS,
    staleTime: LOCKER_STATUS_REFRESH_MS / 2,
  })
}
