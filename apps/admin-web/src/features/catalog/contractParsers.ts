import type { AccessLevel } from '../auth/contract'
import {
  DIAGNOSTIC_REASONS,
  UNRECOGNIZED,
  type Unrecognized,
  type AdminAssetPage,
  type AdminAssetView,
  type Availability,
  type CalibrationStatus,
  type DiagnosticReason,
  type OperationalStatus,
  type PlacementSummary,
  type Presence,
} from './contract'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function isTextOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

/**
 * An enumeration the client does not know is tolerated per value (09 §3): it is logged by field name
 * only, never with server text, and becomes UNRECOGNIZED so the rest of the page still renders.
 * Anything that is not a non-empty string is a structural break: undefined.
 */
function lenientEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T | Unrecognized | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  if ((allowed as readonly string[]).includes(value)) return value as T
  console.warn(`Unrecognized value for ${field}: shown as an unavailable state until the client is updated`)
  return UNRECOGNIZED
}

const ACCESS_LEVELS: readonly AccessLevel[] = ['STANDARD', 'RESTRICTED']
const OPERATIONAL_STATUSES: readonly OperationalStatus[] = ['SERVICEABLE', 'MAINTENANCE', 'DAMAGED']
const CALIBRATION_STATUSES: readonly CalibrationStatus[] = ['NOT_REQUIRED', 'VALID', 'EXPIRED', 'UNKNOWN']
const AVAILABILITIES: readonly Availability[] = ['AVAILABLE', 'RESERVED', 'BORROWED', 'UNAVAILABLE']
const PRESENCES: readonly Presence[] = ['PRESENT', 'ABSENT', 'UNKNOWN']

function parsePlacement(value: unknown): PlacementSummary | null | undefined {
  if (value === null) return null
  if (!isRecord(value)) return undefined
  const { lockerId, lockerCode, compartmentId, compartmentCode } = value
  if (!isText(lockerId) || !isText(lockerCode) || !isText(compartmentId) || !isText(compartmentCode)) return undefined
  return { lockerId, lockerCode, compartmentId, compartmentCode }
}

function parseReasons(value: unknown): readonly (DiagnosticReason | Unrecognized)[] | null {
  if (!Array.isArray(value)) return null
  const reasons: (DiagnosticReason | Unrecognized)[] = []
  for (const reason of value) {
    const parsed = lenientEnum(reason, DIAGNOSTIC_REASONS, 'operationalDiagnostic.reasons')
    if (parsed === undefined) return null
    reasons.push(parsed)
  }
  return reasons
}

/**
 * 09 §8.9. A structural break (a missing field, a wrong type) rejects the whole response, so the screen
 * reports a service error instead of guessing. An unknown enumeration value does not (09 §3): see
 * `lenientEnum`. There is no `readiness` to read, and none is invented.
 */
export function parseAdminAssetView(body: unknown): AdminAssetView | null {
  if (!isRecord(body)) return null
  const { id, assetCode, serialNumber, model, requiredAccessLevel, operationalStatus, calibration, availability, presence, placement, operationalDiagnostic, archivedAt } = body
  if (!isText(id) || !isText(assetCode) || !isTextOrNull(serialNumber) || !isTextOrNull(archivedAt)) return null
  const accessLevel = lenientEnum(requiredAccessLevel, ACCESS_LEVELS, 'requiredAccessLevel')
  const status = lenientEnum(operationalStatus, OPERATIONAL_STATUSES, 'operationalStatus')
  const availabilityValue = lenientEnum(availability, AVAILABILITIES, 'availability')
  const presenceValue = lenientEnum(presence, PRESENCES, 'presence')
  if (accessLevel === undefined || status === undefined || availabilityValue === undefined || presenceValue === undefined) return null

  if (!isRecord(model) || !isText(model.id) || !isText(model.name) || !isTextOrNull(model.manufacturer) || !isTextOrNull(model.modelNumber)) return null
  if (!isRecord(calibration) || typeof calibration.required !== 'boolean' || !isTextOrNull(calibration.dueAt)) return null
  const calibrationStatus = lenientEnum(calibration.status, CALIBRATION_STATUSES, 'calibration.status')
  if (calibrationStatus === undefined) return null
  if (!isRecord(operationalDiagnostic) || !isText(operationalDiagnostic.evaluatedAt)) return null
  const reasons = parseReasons(operationalDiagnostic.reasons)
  const parsedPlacement = parsePlacement(placement)
  if (reasons === null || parsedPlacement === undefined) return null

  return {
    id,
    assetCode,
    serialNumber,
    model: { id: model.id, name: model.name, manufacturer: model.manufacturer, modelNumber: model.modelNumber },
    requiredAccessLevel: accessLevel,
    operationalStatus: status,
    calibration: { required: calibration.required, dueAt: calibration.dueAt, status: calibrationStatus },
    availability: availabilityValue,
    presence: presenceValue,
    placement: parsedPlacement,
    operationalDiagnostic: { evaluatedAt: operationalDiagnostic.evaluatedAt, reasons },
    archivedAt,
  }
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

/** 09 §11.1 envelope around `AdminAssetView` items. */
export function parseAdminAssetPage(body: unknown): AdminAssetPage | null {
  if (!isRecord(body)) return null
  const { items, page, size, totalItems, totalPages } = body
  if (!Array.isArray(items) || !isCount(page) || !isCount(size) || !isCount(totalItems) || !isCount(totalPages)) return null
  const parsed: AdminAssetView[] = []
  for (const item of items) {
    const asset = parseAdminAssetView(item)
    if (asset === null) return null
    parsed.push(asset)
  }
  return { items: parsed, page, size, totalItems, totalPages }
}
