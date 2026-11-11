import type { GatewayResult } from '../auth/authGateway'
import type { AuditPage, AuditQuery } from './contract'

/** Boundary of 09 §19. Read only: the audit trail is append-only and has no write route. */
export interface AuditGateway {
  /** `GET /api/v1/admin/audit-events?eventType&subjectType&subjectId&operationId&actorUserId&from&to&limit&cursor`. */
  listAuditEvents(accessToken: string, query: AuditQuery, signal?: AbortSignal): Promise<GatewayResult<AuditPage>>
}

export const unconfiguredAuditGateway: AuditGateway = {
  listAuditEvents: async () => ({ kind: 'network', reason: 'notConfigured' }),
}
