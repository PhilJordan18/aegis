import { createHttpClient, type HttpClientOptions } from '../../api/http'
import { AUDIT_LIMIT_MAX, AUDIT_LIMIT_MIN, type AuditQuery } from './contract'
import { parseAuditPage } from './contractParsers'
import type { AuditGateway } from './auditGateway'

/** §19.1 query string: the filters that are set, the limit clamped to 1–100, then the opaque cursor unchanged. */
export function auditSearch({ eventType, subjectType, subjectId, operationId, actorUserId, from, to, limit, cursor }: AuditQuery): string {
  const params = new URLSearchParams()
  const filters = { eventType, subjectType, subjectId, operationId, actorUserId, from, to }
  for (const [name, value] of Object.entries(filters)) if (value !== undefined) params.set(name, value)
  params.set('limit', String(Math.min(AUDIT_LIMIT_MAX, Math.max(AUDIT_LIMIT_MIN, Math.trunc(limit)))))
  if (cursor !== undefined) params.set('cursor', cursor)
  return params.toString()
}

/** Production adapter of 09 §19. */
export function createHttpAuditGateway(options?: HttpClientOptions): AuditGateway {
  const http = createHttpClient(options)
  return {
    listAuditEvents(accessToken, query, signal) {
      return http.send({ method: 'GET', path: `/admin/audit-events?${auditSearch(query)}`, accessToken, signal, parse: parseAuditPage })
    },
  }
}
