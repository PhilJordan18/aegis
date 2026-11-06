import type { AccessLevel } from '../auth/contract'

/**
 * Administrator catalog contract mirrored from docs/cahier-conception/09-contrats-rest.md:
 * §8.1 reasons, §8.2 summaries, §8.9 `AdminAssetView` (no `readiness`), §11.1 page envelope,
 * §12.1 `AssetModelView` and the model routes, §12.2 `GET /admin/assets[/{assetId}]` and the
 * asset create, replace and archive routes. Identifier and placement routes (§12.3–12.4) are not here.
 */

/**
 * An enumeration value this client does not know (09 §3): it is logged and shown as an unavailable
 * state until the client is updated. It never stands for a known value, and never for « ready ».
 */
export const UNRECOGNIZED = 'UNRECOGNIZED' as const
export type Unrecognized = typeof UNRECOGNIZED

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
  readonly status: CalibrationStatus | Unrecognized
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
  readonly reasons: readonly (DiagnosticReason | Unrecognized)[]
}

export interface AdminAssetView {
  readonly id: string
  readonly assetCode: string
  readonly serialNumber: string | null
  readonly model: AssetModelSummary
  readonly requiredAccessLevel: AccessLevel | Unrecognized
  readonly operationalStatus: OperationalStatus | Unrecognized
  readonly calibration: CalibrationView
  readonly availability: Availability | Unrecognized
  readonly presence: Presence | Unrecognized
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
  /** Search on code and model name (§22.3), already trimmed and valid (`readSearchText`); absent means no filter. */
  readonly q?: string
}

export const DEFAULT_PAGE_SIZE = 20

/**
 * The first-page query of the units list. Équipements and Casiers both send it, so they share one cached request: keep one
 * definition, or the two screens would silently stop sharing (and Casiers would read another page).
 */
export const LIST_QUERY_BASE = { size: DEFAULT_PAGE_SIZE, sort: 'assetCode,asc' } as const

/** §12.1 `AssetModelView`: the response of every model route. Archived models stay listed. */
export interface AssetModelView {
  readonly id: string
  readonly name: string
  readonly manufacturer: string | null
  readonly modelNumber: string | null
  readonly description: string | null
  readonly defaultCalibrationRequired: boolean
  readonly archivedAt: string | null
}

/** §11.1 envelope around `AssetModelView` items, sorted by name without case, then id (§12.1). */
export interface AssetModelPage {
  readonly items: readonly AssetModelView[]
  readonly page: number
  readonly size: number
  readonly totalItems: number
  readonly totalPages: number
}

export interface ModelListQuery {
  readonly page: number
  readonly size: number
}

/** The API's largest page (PageQuery.MAX_SIZE): the model choice of the unit form reads one page of this size. */
export const MAX_PAGE_SIZE = 100

/**
 * §12.1 `CreateAssetModelRequest` and `UpdateAssetModelRequest`. Every key is sent, `null` included: an
 * omitted nullable field is a `REQUIRED` violation, an explicit `null` clears it.
 */
export interface AssetModelRequest {
  readonly name: string
  readonly manufacturer: string | null
  readonly modelNumber: string | null
  readonly description: string | null
  readonly defaultCalibrationRequired: boolean
}

/** §12.2 `CreateAssetRequest` and `UpdateAssetRequest`; same rule for `null`. Readiness is never sent. */
export interface AssetRequest {
  readonly assetModelId: string
  readonly assetCode: string
  readonly serialNumber: string | null
  readonly requiredAccessLevel: AccessLevel
  readonly operationalStatus: OperationalStatus
  readonly calibrationRequired: boolean
  /** RFC 3339 instant, or null when calibration is not required. */
  readonly calibrationDueAt: string | null
}
