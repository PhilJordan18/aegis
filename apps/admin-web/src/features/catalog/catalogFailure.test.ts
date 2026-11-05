import { describe, expect, it } from 'vitest'
import { ApiRequestError, SessionEndedError } from '../../api/serverState'
import type { GatewayFailure } from '../auth/authGateway'
import { problemBody } from '../auth/testFixtures'
import { classifyCatalogFailure } from './catalogFailure'

const fail = (failure: GatewayFailure) => classifyCatalogFailure(new ApiRequestError(failure))
const http = (status: number, code: string | null, requestId: string | null = 'req-1'): GatewayFailure => ({
  kind: 'httpProblem',
  status,
  problem: code === null ? null : problemBody(status, code, { traceId: 'trace-from-body' }),
  retryAfter: null,
  requestId,
})

describe('classifyCatalogFailure', () => {
  it('treats an ended session as nothing to show: the sign-in redirect is under way', () => {
    expect(classifyCatalogFailure(new SessionEndedError())).toEqual({ kind: 'ended' })
    expect(fail(http(401, 'AUTH_TOKEN_EXPIRED'))).toEqual({ kind: 'ended' })
    expect(fail(http(401, 'AUTH_TOKEN_INVALID'))).toEqual({ kind: 'ended' })
  })

  it.each<[string, GatewayFailure]>([
    ['offline', { kind: 'network', reason: 'offline' }],
    ['timeout', { kind: 'network', reason: 'timeout' }],
    ['not configured', { kind: 'network', reason: 'notConfigured' }],
    ['a 502 without a problem body (proxy or gateway)', http(502, null)],
  ])('says unreachable for %s', (_label, failure) => {
    expect(fail(failure)).toEqual({ kind: 'unreachable' })
  })

  it('maps 403 to forbidden and 404 to not found, by status', () => {
    expect(fail(http(403, 'FORBIDDEN'))).toEqual({ kind: 'forbidden' })
    expect(fail(http(404, 'RESOURCE_NOT_FOUND'))).toEqual({ kind: 'notFound' })
  })

  it('keeps the trace id of a 5xx problem body, and falls back to the request id', () => {
    expect(fail(http(500, 'INTERNAL_ERROR'))).toEqual({ kind: 'serviceError', traceId: 'trace-from-body' })
    expect(fail({ kind: 'invalidResponse', status: 200, requestId: 'req-9' })).toEqual({ kind: 'serviceError', traceId: 'req-9' })
  })

  it('reports an unexpected error as a service error without a trace', () => {
    expect(classifyCatalogFailure(new Error('boom'))).toEqual({ kind: 'serviceError', traceId: null })
  })
})
