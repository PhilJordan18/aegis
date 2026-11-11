/**
 * Contract of `GET /api/v1/admin/audit-events` (09 §19.1, §22.2), under the approved decisions D1, D2, D8, D9 and D10
 * of #67. History is append-only: the client reads it and offers no write. The list is newest first, ties broken by
 * id; `actor` is `{id, displayName}` for a human and null otherwise; `details` is an allowlisted object per event type
 * (an unknown type sends `{}`); the cursor is opaque and bound to the filters. The event vocabulary stays an opaque
 * code here: the client never derives a physical fact from it.
 */
/** §8.8 identity summary. */
export interface UserSummary {
  readonly id: string
  readonly displayName: string
}

/** `actor` as sent: a §8.8 UserSummary, null when no human is involved (nothing is attributed), or, defensively, a shape the contract does not send. */
export type AuditActor = UserSummary | null | { readonly kind: 'unreadable' }

export interface AuditEventView {
  readonly id: string
  /** Opaque code, shown with a label when the catalog knows it; never read to derive a physical fact. */
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
  /** The scalar entries of the filtered `details`, in the order sent; never a non-scalar value. */
  readonly details: AuditDetails
}

/** A value the client renders: D9 sends scalar fields only. */
export type AuditDetailValue = string | number | boolean | null

export interface AuditDetails {
  /** An array and not a map: a key such as `__proto__` stays an ordinary entry. */
  readonly entries: readonly (readonly [key: string, value: AuditDetailValue])[]
  /** How many entries were dropped because their value is an object or a list. They are counted, never displayed. */
  readonly omitted: number
}

export interface AuditPage {
  readonly items: readonly AuditEventView[]
  /** Opaque and bound to the filters (D10); passed back unchanged and never decoded. */
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
