import type { Unrecognized } from '../catalog/contract'

/**
 * Anomaly administration (ANO-01 #52), mirrored from docs/cahier-conception/09-contrats-rest.md §8.7, §8.8 and §18,
 * with the P0 types of 03 §5.11. Acknowledging is not resolving: there is no resolve route, and only coherent physical
 * evidence ingested by the server moves an anomaly to RESOLVED.
 */

export const ANOMALY_TYPES = [
  'EXPECTED_ASSET_NOT_OBSERVED',
  'UNEXPECTED_ASSET_OBSERVED',
  'ASSET_PRESENT_WITH_ACTIVE_LOAN',
  'DOOR_NOT_CLOSED_BEFORE_EXPIRY',
  'COMMAND_REJECTED',
  'DEVICE_OFFLINE_DURING_OPERATION',
  'INCONSISTENT_PHYSICAL_STATE',
] as const
export type AnomalyType = (typeof ANOMALY_TYPES)[number]

export const ANOMALY_SEVERITIES = ['LOW', 'MEDIUM', 'HIGH'] as const
export type AnomalySeverity = (typeof ANOMALY_SEVERITIES)[number]

export const ANOMALY_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const
export type AnomalyStatus = (typeof ANOMALY_STATUSES)[number]

/** §8.8 `UserSummary`: it grants no further read. */
export interface UserSummary {
  readonly id: string
  readonly displayName: string
}

/**
 * §8.7. The detail route adds an `evidence` section whose shape §18.1 does not define yet; it is not read, so the
 * client neither guesses observations nor shows raw payloads.
 */
export interface AnomalyView {
  readonly id: string
  readonly type: AnomalyType | Unrecognized
  readonly severity: AnomalySeverity | Unrecognized
  readonly status: AnomalyStatus | Unrecognized
  readonly lockerOperationId: string | null
  readonly assetId: string | null
  readonly compartmentId: string | null
  readonly detectedAt: string
  readonly acknowledgedAt: string | null
  readonly acknowledgedBy: UserSummary | null
  readonly acknowledgementNote: string | null
  readonly resolvedAt: string | null
  readonly resolutionEvidenceObservationId: string | null
  readonly resolutionNote: string | null
  /** Server text, shown as written. */
  readonly summary: string
}

export interface AnomalyPage {
  readonly items: readonly AnomalyView[]
  readonly page: number
  readonly size: number
  readonly totalItems: number
  readonly totalPages: number
}

/** §18.1 filters; `from` inclusive, `to` exclusive. */
export interface AnomalyListQuery {
  readonly status?: AnomalyStatus
  readonly type?: AnomalyType
  readonly severity?: AnomalySeverity
  readonly assetId?: string
  readonly lockerOperationId?: string
  readonly from?: string
  readonly to?: string
  readonly page: number
  readonly size: number
}

/**
 * `POST /admin/anomalies/{anomalyId}/acknowledge` body; Idempotency-Key required. §18.2 bounds the note to 1–500
 * characters without fixing the counting unit, trimming or line breaks: the server judges it, and the client does
 * not pre-validate until that is decided.
 */
export interface AcknowledgeRequest {
  readonly note: string
}
