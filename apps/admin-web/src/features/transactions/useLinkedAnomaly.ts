import { useQuery } from '@tanstack/react-query'
import { useSessionStore } from '../auth/session'
import { anomalyDetailOptions } from '../anomalies/useAnomalyQueries'
import { useAnomalyGateway } from '../anomalies/AnomalyGatewayContext'

/** The status of the anomaly an operation names, read once from `GET /admin/anomalies/{id}`; a failed read is not retried. */
export function useLinkedAnomaly(anomalyId: string | null) {
  const gateway = useAnomalyGateway()
  const session = useSessionStore()
  return useQuery({ ...anomalyDetailOptions(gateway, session, anomalyId ?? ''), enabled: anomalyId !== null, retry: false })
}
