import type { GatewayResult } from './authGateway'
import type { LoginResponse, ProblemResponse, UserProfile } from './contract'

export const adminProfile: UserProfile = {
  id: '75acc15f-fc23-45d9-857d-b543694e4fc2',
  displayName: 'Administratrice Test',
  email: 'admin@aegis.test',
  role: 'ADMIN',
  maximumAccessLevel: 'RESTRICTED',
}

export const technicianProfile: UserProfile = { ...adminProfile, displayName: 'Technicien Test', role: 'TECHNICIAN', maximumAccessLevel: 'STANDARD' }

export function loginOk(user: UserProfile, accessToken = 'test-token-value'): GatewayResult<LoginResponse> {
  return {
    kind: 'ok',
    requestId: 'req-1',
    value: { accessToken, tokenType: 'Bearer', expiresIn: 3600, expiresAt: '2026-09-30T15:30:00Z', user },
  }
}

export function problemBody(status: number, code: string, extra: Partial<ProblemResponse> = {}): ProblemResponse {
  return {
    type: 'https://aegis.local/problems/test',
    title: 'Test',
    status,
    code,
    detail: 'Test detail',
    instance: '/api/v1/auth/login',
    traceId: '5f4bc22e-66a4-48ef-8bf3-6e7184d71c30',
    timestamp: '2026-09-30T14:30:00Z',
    ...extra,
  }
}

export function httpProblem(
  status: number,
  problem: ProblemResponse | null,
  retryAfter: string | null = null,
  requestId: string | null = 'req-1',
): GatewayResult<LoginResponse> {
  return { kind: 'httpProblem', status, problem, retryAfter, requestId }
}
