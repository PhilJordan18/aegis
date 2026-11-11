import { isInstant, isUuid } from '../lockers/contractParsers'
import type { AuditActor, AuditEventView, AuditPage } from './contract'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value !== ''
const isTextOrNull = (value: unknown): value is string | null => value === null || isText(value)

function parseActor(value: unknown): AuditActor {
  if (value === null) return null
  if (isRecord(value) && isUuid(value.id) && isText(value.displayName)) return { id: value.id, displayName: value.displayName }
  return { kind: 'unreadable' }
}

/** §19.1. The fields §19.1 does type are strict; an undefined `actor` shape is kept visible as unreadable, not dropped. */
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
    hasDetails: isRecord(details) && Object.keys(details).length > 0,
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
