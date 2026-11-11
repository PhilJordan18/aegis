import type { GatewayResult } from '../auth/authGateway'
import type { AcknowledgeRequest, AnomalyDetail, AnomalyListQuery, AnomalyPage, AnomalyView } from './contract'

/** Boundary of the anomaly routes of 09 §18. There is deliberately no resolve call. */
export interface AnomalyGateway {
  /** `GET /api/v1/admin/anomalies?status&type&severity&assetId&lockerOperationId&from&to&page&size`. */
  listAnomalies(accessToken: string, query: AnomalyListQuery, signal?: AbortSignal): Promise<GatewayResult<AnomalyPage>>
  /** `GET /api/v1/admin/anomalies/{anomalyId}`, with the `evidence` section (at most 50 observations) read leniently. */
  getAnomaly(accessToken: string, anomalyId: string, signal?: AbortSignal): Promise<GatewayResult<AnomalyDetail>>
  /** `POST /api/v1/admin/anomalies/{anomalyId}/acknowledge`, 200 with the ACKNOWLEDGED view. */
  acknowledge(accessToken: string, anomalyId: string, request: AcknowledgeRequest, idempotencyKey: string): Promise<GatewayResult<AnomalyView>>
}

const notConfigured = async () => ({ kind: 'network', reason: 'notConfigured' }) as const

export const unconfiguredAnomalyGateway: AnomalyGateway = {
  listAnomalies: notConfigured,
  getAnomaly: notConfigured,
  acknowledge: notConfigured,
}
