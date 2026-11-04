import type { GatewayResult } from '../auth/authGateway'
import type { LockerStatus } from './contract'

/**
 * Boundary between the Manager UI and the locker status route (09 §16.1). Same rules as the other
 * gateways: bearer token, `X-Request-Id`, timeout, `signal`, problem+json parsed into `problem`,
 * never log or echo the token. Reading only: no command or write route exists here.
 */
export interface LockerGateway {
  /** `GET /api/v1/lockers/{lockerId}/status`; 404 `RESOURCE_NOT_FOUND` for an unknown locker. */
  getStatus(accessToken: string, lockerId: string, signal?: AbortSignal): Promise<GatewayResult<LockerStatus>>
}

/** Context default when no adapter is provided: every call honestly fails as unreachable. */
export const unconfiguredLockerGateway: LockerGateway = {
  getStatus: async () => ({ kind: 'network', reason: 'notConfigured' }),
}
