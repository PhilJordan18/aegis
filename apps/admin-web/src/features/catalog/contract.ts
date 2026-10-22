import type { AccessLevel } from '../auth/contract'

/**
 * Administrator catalog contract mirrored from docs/cahier-conception/09-contrats-rest.md:
 * §8.1 reasons, §8.2 summaries, §8.9 `AdminAssetView` (no `readiness`), §11.1 page envelope,
 * §12.2 `GET /admin/assets[/{assetId}]`. Read-only: the create, replace and archive routes
 * are not consumed by this slice.
 */

export type OperationalStatus = 'SERVICEABLE' | 'MAINTENANCE' | 'DAMAGED'
export type CalibrationStatus = 'NOT_REQUIRED' | 'VALID' | 'EXPIRED' | 'UNKNOWN'
export type Availability = 'AVAILABLE' | 'RESERVED' | 'BORROWED' | 'UNAVAILABLE'
export type Presence = 'PRESENT' | 'ABSENT' | 'UNKNOWN'

/** §8.1 reasons an administrator can receive; `ACCESS_DENIED` is personal and never appears here (§8.9). */
export const DIAGNOSTIC_REASONS = ['NOT_PRESENT', 'NOT_AVAILABLE', 'MAINTENANCE', 'DAMAGED', 'CALIBRATION_EXPIRED', 'UNKNOWN_PHYSICAL_STATE'] as const
export type DiagnosticReason = (typeof DIAGNOSTIC_REASONS)[number]

export interface AssetModelSummary {
  readonly id: string
  readonly name: string
  readonly manufacturer: string | null
  readonly modelNumber: string | null
}

export interface CalibrationView {
  readonly required: boolean
  /** RFC 3339 UTC instant. A business date: shown in the laboratory zone. */
  readonly dueAt: string | null
  readonly status: CalibrationStatus
}

export interface PlacementSummary {
  readonly lockerId: string
  readonly lockerCode: string
  readonly compartmentId: string
  readonly compartmentCode: string
}

/**
 * Non-personal blockers known at `evaluatedAt` (§8.9). An empty list means only « no non-personal
 * blocker detected »: it is neither a readiness verdict nor a right to borrow.
 */
export interface OperationalDiagnostic {
  /** Technical instant: shown in the device zone. */
  readonly evaluatedAt: string
  readonly reasons: readonly DiagnosticReason[]
}

export interface AdminAssetView {
  readonly id: string
  readonly assetCode: string
  readonly serialNumber: string | null
  readonly model: AssetModelSummary
  readonly requiredAccessLevel: AccessLevel
  readonly operationalStatus: OperationalStatus
  readonly calibration: CalibrationView
  readonly availability: Availability
  readonly presence: Presence
  readonly placement: PlacementSummary | null
  readonly operationalDiagnostic: OperationalDiagnostic
  /** Present once archived (CAT-01 addition): the asset keeps its history and stays listed. */
  readonly archivedAt: string | null
}

/** §11.1 envelope. `page` is zero-based. */
export interface AdminAssetPage {
  readonly items: readonly AdminAssetView[]
  readonly page: number
  readonly size: number
  readonly totalItems: number
  readonly totalPages: number
}

export type AssetSortField = 'assetCode' | 'modelName'

export interface AssetListQuery {
  /** Zero-based, as the API. */
  readonly page: number
  readonly size: number
  readonly sort: `${AssetSortField},${'asc' | 'desc'}`
}

export const DEFAULT_PAGE_SIZE = 20
