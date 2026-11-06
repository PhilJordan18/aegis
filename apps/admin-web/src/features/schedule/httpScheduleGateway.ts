import { createHttpClient, type HttpClientOptions } from '../../api/http'
import { parseOperatingScheduleView } from './contractParsers'
import type { ScheduleGateway } from './scheduleGateway'

/** Production adapter of `GET`/`PUT /admin/lockers/{lockerId}/operating-schedule` (09 §13). */
export function createHttpScheduleGateway(options?: HttpClientOptions): ScheduleGateway {
  const http = createHttpClient(options)
  const path = (lockerId: string) => `/admin/lockers/${encodeURIComponent(lockerId)}/operating-schedule`
  return {
    getSchedule(accessToken, lockerId, signal) {
      return http.send({ method: 'GET', path: path(lockerId), accessToken, signal, parse: parseOperatingScheduleView })
    },
    putSchedule(accessToken, lockerId, request) {
      return http.send({ method: 'PUT', path: path(lockerId), body: request, accessToken, parse: parseOperatingScheduleView })
    },
  }
}
