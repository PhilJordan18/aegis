import { describe, expect, it } from 'vitest'
import { ApiRequestError, SessionEndedError } from '../../api/serverState'
import { problemBody } from '../auth/testFixtures'
import { classifyMutationFailure } from './mutationFailure'

const problem = (status: number, code: string, extra = {}) =>
  new ApiRequestError({ kind: 'httpProblem', status, problem: problemBody(status, code, { traceId: 'trace-1', ...extra }), retryAfter: null, requestId: 'req-1' })

describe('classifyMutationFailure', () => {
  it('maps transport failures to an unknown outcome', () => {
    expect(classifyMutationFailure(new ApiRequestError({ kind: 'network', reason: 'offline' }))).toEqual({ kind: 'unreachable' })
    expect(
      classifyMutationFailure(new ApiRequestError({ kind: 'httpProblem', status: 502, problem: null, retryAfter: null, requestId: null })),
    ).toEqual({ kind: 'unreachable' })
  })

  it('keeps business refusals by code and validation violations by field', () => {
    expect(classifyMutationFailure(problem(409, 'ASSET_MODEL_IN_USE'))).toEqual({ kind: 'refused', code: 'ASSET_MODEL_IN_USE', traceId: 'trace-1' })
    expect(classifyMutationFailure(problem(409, 'IDEMPOTENCY_REQUEST_IN_PROGRESS'))).toEqual({ kind: 'inProgress' })
    expect(
      classifyMutationFailure(problem(400, 'VALIDATION_ERROR', { violations: [{ field: 'assetCode', code: 'TOO_LONG', message: 'ignored' }] })),
    ).toEqual({ kind: 'validation', violations: [{ field: 'assetCode', code: 'TOO_LONG' }], traceId: 'trace-1' })
  })

  it('maps access and session outcomes', () => {
    expect(classifyMutationFailure(new SessionEndedError())).toEqual({ kind: 'ended' })
    expect(classifyMutationFailure(problem(401, 'AUTHENTICATION_REQUIRED'))).toEqual({ kind: 'ended' })
    expect(classifyMutationFailure(problem(403, 'ACCESS_DENIED'))).toEqual({ kind: 'forbidden' })
    expect(classifyMutationFailure(problem(404, 'RESOURCE_NOT_FOUND'))).toEqual({ kind: 'notFound' })
    expect(classifyMutationFailure(problem(500, 'INTERNAL_ERROR'))).toEqual({ kind: 'serviceError', traceId: 'trace-1' })
    expect(classifyMutationFailure(new Error('bug'))).toEqual({ kind: 'serviceError', traceId: null })
  })
})
