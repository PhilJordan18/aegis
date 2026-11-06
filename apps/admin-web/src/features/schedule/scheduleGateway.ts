import type { GatewayResult } from '../auth/authGateway'
import type { OperatingScheduleRequest, OperatingScheduleView } from './contract'

/** Boundary of the operating schedule routes (09 §13), with the same rules as the other gateways. */
export interface ScheduleGateway {
  /** `GET /api/v1/admin/lockers/{lockerId}/operating-schedule`; 404 `OPERATING_SCHEDULE_NOT_CONFIGURED` when none is active. */
  getSchedule(accessToken: string, lockerId: string, signal?: AbortSignal): Promise<GatewayResult<OperatingScheduleView>>
  /** `PUT` of the same path: a new active version, or the active one when nothing changed. */
  putSchedule(accessToken: string, lockerId: string, request: OperatingScheduleRequest): Promise<GatewayResult<OperatingScheduleView>>
}

const notConfigured = async () => ({ kind: 'network', reason: 'notConfigured' }) as const

export const unconfiguredScheduleGateway: ScheduleGateway = { getSchedule: notConfigured, putSchedule: notConfigured }
