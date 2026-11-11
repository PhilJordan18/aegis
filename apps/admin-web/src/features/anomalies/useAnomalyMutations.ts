import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../api/queryKeys'
import { authorizedRequest } from '../auth/authorizedRequest'
import { useSessionStore } from '../auth/session'
import { useAnomalyGateway } from './AnomalyGatewayContext'
import { anomalyDetailOptions } from './useAnomalyQueries'
import type { AnomalyDetail, AnomalyView } from './contract'

/**
 * The one anomaly command (09 §18.2). Never retried automatically (serverState.ts): a retry is the administrator's,
 * with the same `Idempotency-Key`. The server's answer is shown at once, keeping the evidence already read (an
 * acknowledgement changes none), then everything is read again; the status is never set by the client.
 */
export function useAcknowledgeAnomaly() {
  const gateway = useAnomalyGateway()
  const session = useSessionStore()
  const client = useQueryClient()

  const acknowledge = useMutation({
    mutationFn: ({ anomalyId, note, idempotencyKey }: { anomalyId: string; note: string; idempotencyKey: string }) =>
      authorizedRequest(session, (token) => gateway.acknowledge(token, anomalyId, { note }, idempotencyKey)),
    onSuccess: (view: AnomalyView) => {
      client.setQueryData<AnomalyDetail>(queryKeys.anomalies.detail(view.id), (previous) => ({ ...view, evidence: previous?.evidence ?? null }))
      void client.invalidateQueries({ queryKey: queryKeys.anomalies.all })
    },
  })

  /**
   * After a refused acknowledgement (409): the list is read again in the background and the dossier is read again
   * now, so the dialog can say what the server holds. Resolves with it, or rejects when that read fails.
   */
  async function rereadAfterRefusal(anomalyId: string): Promise<AnomalyDetail> {
    void client.invalidateQueries({ queryKey: queryKeys.anomalies.all, predicate: (query) => !(query.queryKey[1] === 'detail' && query.queryKey[2] === anomalyId) })
    return client.fetchQuery({ ...anomalyDetailOptions(gateway, session, anomalyId), staleTime: 0 })
  }

  return { acknowledge, rereadAfterRefusal }
}
