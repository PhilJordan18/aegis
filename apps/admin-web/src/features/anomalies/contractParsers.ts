import { lenientEnum } from '../catalog/contractParsers'
import { isInstant, isUuid } from '../lockers/contractParsers'
import {
  ANOMALY_SEVERITIES,
  ANOMALY_STATUSES,
  ANOMALY_TYPES,
  type AnomalyDetail,
  type AnomalyEvidence,
  type AnomalyEvidenceItem,
  type AnomalyPage,
  type AnomalyView,
  type UserSummary,
} from './contract'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value !== ''
const isTextOrNull = (value: unknown): value is string | null => value === null || isText(value)
const isInstantOrNull = (value: unknown): value is string | null => value === null || isInstant(value)
const isUuidOrNull = (value: unknown): value is string | null => value === null || isUuid(value)
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

function parseUserSummary(value: unknown): UserSummary | null | undefined {
  if (value === null) return null
  if (!isRecord(value) || !isUuid(value.id) || !isText(value.displayName)) return undefined
  return { id: value.id, displayName: value.displayName }
}

/**
 * §8.7. A structural break rejects the response; an unknown type, severity or status becomes UNRECOGNIZED (09 §3).
 * The lifecycle fields are taken as sent: the client never infers a status from them, nor the reverse.
 */
export function parseAnomalyView(body: unknown): AnomalyView | null {
  if (!isRecord(body)) return null
  const { id, lockerOperationId, assetId, compartmentId, detectedAt, acknowledgedAt, acknowledgementNote, resolvedAt, resolutionEvidenceObservationId, resolutionNote, summary } = body
  if (!isUuid(id) || !isUuidOrNull(lockerOperationId) || !isUuidOrNull(assetId) || !isUuidOrNull(compartmentId)) return null
  if (!isInstant(detectedAt) || !isInstantOrNull(acknowledgedAt) || !isInstantOrNull(resolvedAt) || !isUuidOrNull(resolutionEvidenceObservationId)) return null
  if (!isTextOrNull(acknowledgementNote) || !isTextOrNull(resolutionNote) || !isText(summary)) return null
  const acknowledgedBy = parseUserSummary(body.acknowledgedBy)
  const type = lenientEnum(body.type, ANOMALY_TYPES, 'anomaly.type')
  const severity = lenientEnum(body.severity, ANOMALY_SEVERITIES, 'anomaly.severity')
  const status = lenientEnum(body.status, ANOMALY_STATUSES, 'anomaly.status')
  if (acknowledgedBy === undefined || type === undefined || severity === undefined || status === undefined) return null
  return {
    id,
    type,
    typeCode: body.type as string,
    severity,
    status,
    lockerOperationId,
    assetId,
    compartmentId,
    detectedAt,
    acknowledgedAt,
    acknowledgedBy,
    acknowledgementNote,
    resolvedAt,
    resolutionEvidenceObservationId,
    resolutionNote,
    summary,
  }
}

/** §18.1 list, in the §11.1 envelope. */
export function parseAnomalyPage(body: unknown): AnomalyPage | null {
  if (!isRecord(body)) return null
  const { items, page, size, totalItems, totalPages } = body
  if (!Array.isArray(items) || !isCount(page) || !isCount(size) || !isCount(totalItems) || !isCount(totalPages)) return null
  const parsed: AnomalyView[] = []
  for (const item of items) {
    const anomaly = parseAnomalyView(item)
    if (anomaly === null) return null
    parsed.push(anomaly)
  }
  return { items: parsed, page, size, totalItems, totalPages }
}

function parseEvidenceItem(value: unknown): AnomalyEvidenceItem | null {
  if (!isRecord(value)) return null
  const { observationId, type, compartmentId, operationId, observedAt, receivedAt } = value
  if (!isUuid(observationId) || !isText(type) || !isInstant(observedAt)) return null
  // Optional members of the evidence entry: an absent or malformed one is shown as not provided, never repaired.
  return {
    observationId,
    type,
    compartmentId: isUuid(compartmentId) ? compartmentId : null,
    operationId: isUuid(operationId) ? operationId : null,
    observedAt,
    receivedAt: isInstant(receivedAt) ? receivedAt : null,
  }
}

/** Lenient on purpose: the section's shape is not in the contract. Anything but an array is "no readable section". */
function parseEvidence(value: unknown): AnomalyEvidence | null {
  if (!Array.isArray(value)) return null
  const items: AnomalyEvidenceItem[] = []
  let unreadable = 0
  for (const entry of value) {
    const item = parseEvidenceItem(entry)
    if (item === null) unreadable += 1
    else items.push(item)
  }
  return { items, unreadable }
}

/** §18.1 detail: the §8.7 view, strictly, plus the evidence section, leniently (a broken section never hides the anomaly). */
export function parseAnomalyDetail(body: unknown): AnomalyDetail | null {
  const view = parseAnomalyView(body)
  if (view === null || !isRecord(body)) return null
  return { ...view, evidence: parseEvidence(body.evidence) }
}
