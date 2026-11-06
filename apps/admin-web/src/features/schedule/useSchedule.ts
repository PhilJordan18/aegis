import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../api/queryKeys'
import { ApiRequestError } from '../../api/serverState'
import { authorizedRequest } from '../auth/authorizedRequest'
import { useSessionStore } from '../auth/session'
import type { OperatingScheduleRequest, OperatingScheduleView } from './contract'
import { useScheduleGateway } from './ScheduleGatewayContext'

/** The server says the locker exists but has no active schedule (09 §13): not a failure, an empty state. */
function isNotConfigured(error: unknown): boolean {
  return error instanceof ApiRequestError && error.failure.kind === 'httpProblem' && error.failure.status === 404 && error.failure.problem?.code === 'OPERATING_SCHEDULE_NOT_CONFIGURED'
}

/** The active schedule, `null` when none is configured. Read again at each opening of the editor. */
export function useOperatingSchedule(lockerId: string, { enabled = true }: { readonly enabled?: boolean } = {}) {
  const gateway = useScheduleGateway()
  const session = useSessionStore()
  return useQuery({
    queryKey: queryKeys.lockers.schedule(lockerId),
    queryFn: async ({ signal }): Promise<OperatingScheduleView | null> => {
      try {
        return await authorizedRequest(session, (token) => gateway.getSchedule(token, lockerId, signal))
      } catch (error) {
        if (isNotConfigured(error)) return null
        throw error
      }
    },
    enabled,
    // The editor starts from the server's active version, never from a copy cached by an earlier opening.
    refetchOnMount: 'always',
  })
}

/** Saves a version; the answer becomes the cached schedule and the locker status (its window) is read again. */
export function useSaveSchedule(lockerId: string) {
  const gateway = useScheduleGateway()
  const session = useSessionStore()
  const client = useQueryClient()
  return useMutation({
    mutationFn: (request: OperatingScheduleRequest) => authorizedRequest(session, (token) => gateway.putSchedule(token, lockerId, request)),
    onSuccess: (saved) => {
      client.setQueryData(queryKeys.lockers.schedule(lockerId), saved)
      void client.invalidateQueries({ queryKey: queryKeys.lockers.status(lockerId) })
    },
  })
}
