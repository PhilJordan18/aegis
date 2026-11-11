import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { queryKeys } from '../../api/queryKeys'
import { authorizedRequest } from '../auth/authorizedRequest'
import type { SessionStore } from '../auth/session'
import { useSessionStore } from '../auth/session'
import type { AnomalyGateway } from './anomalyGateway'
import { useAnomalyGateway } from './AnomalyGatewayContext'
import type { AnomalyDetail, AnomalyListQuery, AnomalyView } from './contract'

/** Shared by the hook and by the code that must read the dossier again after a refused acknowledgement. */
export function anomalyDetailOptions(gateway: AnomalyGateway, session: SessionStore, anomalyId: string) {
  return queryOptions({
    queryKey: queryKeys.anomalies.detail(anomalyId),
    queryFn: ({ signal }) => authorizedRequest(session, (accessToken) => gateway.getAnomaly(accessToken, anomalyId, signal)),
  })
}

/** One page of anomalies (09 §18.1). The previous page stays on screen while the next one loads. */
export function useAnomalyList(query: AnomalyListQuery) {
  const gateway = useAnomalyGateway()
  const session = useSessionStore()
  return useQuery({
    queryKey: queryKeys.anomalies.list(query),
    queryFn: ({ signal }) => authorizedRequest(session, (accessToken) => gateway.listAnomalies(accessToken, query, signal)),
    placeholderData: keepPreviousData,
  })
}

/**
 * One anomaly, read from `GET /admin/anomalies/{id}` even when it is outside the list's filter (an acknowledged
 * anomaly leaves « Ouvertes » but stays on screen). The list's copy stands in while the request runs, without its
 * evidence: `isPlaceholderData` tells the dossier that the detail itself is not read yet.
 */
export function useAnomaly(anomalyId: string | null, listed: AnomalyView | undefined) {
  const gateway = useAnomalyGateway()
  const session = useSessionStore()
  const standIn = useMemo<AnomalyDetail | undefined>(() => (listed === undefined ? undefined : { ...listed, evidence: null }), [listed])
  return useQuery({
    ...anomalyDetailOptions(gateway, session, anomalyId ?? ''),
    enabled: anomalyId !== null,
    placeholderData: standIn,
  })
}
