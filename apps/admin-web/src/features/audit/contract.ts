/**
 * Contract of `GET /api/v1/admin/audit-events` (09 §19.1, §22.2). History is append-only: the client reads it and
 * offers no write. §19.1 types neither the event vocabulary nor `actor` nor `details`, so they stay opaque here until
 * the contract fixes them; see the Manager console decision list.
 */
/** §8.8 identity summary. */
export interface UserSummary {
  readonly id: string
  readonly displayName: string
}

/** `actor` as sent: a §8.8 UserSummary, null for a system event, or a shape §19.1 has not defined yet. */
export type AuditActor = UserSummary | null | { readonly kind: 'unreadable' }

export interface AuditEventView {
  readonly id: string
  /** Opaque code; §19.1 fixes no vocabulary and the client never derives a physical fact from it. */
  readonly eventType: string
  readonly actor: AuditActor
  readonly subjectType: string
  readonly subjectId: string
  readonly operationId: string | null
  /** Both null or both set (V002_2 `ck_audit_events_state_pair`); a lone value breaks the view. */
  readonly fromState: string | null
  readonly toState: string | null
  readonly result: string | null
  readonly reason: string | null
  readonly occurredAt: string
  /** Whether the server sent a non-empty filtered `details` object; its content is not read until typed. */
  readonly hasDetails: boolean
}

export interface AuditPage {
  readonly items: readonly AuditEventView[]
  /** Opaque; passed back unchanged and never decoded (§19.1). */
  readonly nextCursor: string | null
  readonly hasMore: boolean
}

export const AUDIT_LIMIT_MIN = 1
export const AUDIT_LIMIT_MAX = 100

export interface AuditQuery {
  readonly eventType?: string
  readonly subjectType?: string
  readonly subjectId?: string
  readonly operationId?: string
  readonly actorUserId?: string
  /** Inclusive. */
  readonly from?: string
  /** Exclusive. */
  readonly to?: string
  readonly limit: number
  readonly cursor?: string
}
