import { isInstant, isUuid } from '../lockers/contractParsers'
import type { AuditActor, AuditDetails, AuditEventView, AuditPage } from './contract'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value !== ''
const isTextOrNull = (value: unknown): value is string | null => value === null || isText(value)

function parseActor(value: unknown): AuditActor {
  if (value === null) return null
  if (isRecord(value) && isUuid(value.id) && isText(value.displayName)) return { id: value.id, displayName: value.displayName }
  return { kind: 'unreadable' }
}

const NO_DETAILS: AuditDetails = { entries: [], omitted: 0 }

/** D9: scalar fields only. An object or a list is dropped and counted, never read or rendered. */
export function parseAuditDetails(details: unknown): AuditDetails {
  if (!isRecord(details)) return NO_DETAILS
  const entries: [string, string | number | boolean | null][] = []
  let omitted = 0
  for (const [key, value] of Object.entries(details)) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) entries.push([key, value])
    else omitted += 1
  }
  return { entries, omitted }
}

/** §19.1. The fields §19.1 does type are strict; an `actor` shape the contract does not send is kept visible as unreadable, not dropped. */
export function parseAuditEventView(body: unknown): AuditEventView | null {
  if (!isRecord(body)) return null
  const { id, eventType, subjectType, subjectId, operationId, fromState, toState, result, reason, occurredAt, details } = body
  if (!isUuid(id) || !isText(eventType) || !isText(subjectType) || !isUuid(subjectId) || !isInstant(occurredAt)) return null
  if (!(operationId === null || isUuid(operationId)) || !isTextOrNull(result) || !isTextOrNull(reason)) return null
  if (!isTextOrNull(fromState) || !isTextOrNull(toState) || (fromState === null) !== (toState === null)) return null
  if (!(details === undefined || details === null || isRecord(details))) return null
  return {
    id,
    eventType,
    actor: parseActor(body.actor),
    subjectType,
    subjectId,
    operationId,
    fromState,
    toState,
    result,
    reason,
    occurredAt,
    details: parseAuditDetails(details),
  }
}

export function parseAuditPage(body: unknown): AuditPage | null {
  if (!isRecord(body) || !Array.isArray(body.items) || typeof body.hasMore !== 'boolean') return null
  const { nextCursor, hasMore } = body
  // A further page announced without a cursor cannot be reached: the response is incoherent, not empty.
  if (!isTextOrNull(nextCursor) || (hasMore && nextCursor === null)) return null
  const items: AuditEventView[] = []
  for (const item of body.items) {
    const event = parseAuditEventView(item)
    if (event === null) return null
    items.push(event)
  }
  return { items, nextCursor, hasMore }
}
