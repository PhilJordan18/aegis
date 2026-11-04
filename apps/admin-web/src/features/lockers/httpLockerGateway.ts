import { createHttpClient, type HttpClientOptions } from '../../api/http'
import { parseLockerStatus } from './contractParsers'
import type { LockerGateway } from './lockerGateway'

/** Production adapter: `GET /lockers/{lockerId}/status` (09 §16.1). */
export function createHttpLockerGateway(options?: HttpClientOptions): LockerGateway {
  const http = createHttpClient(options)
  return {
    getStatus(accessToken, lockerId, signal) {
      return http.send({ method: 'GET', path: `/lockers/${encodeURIComponent(lockerId)}/status`, accessToken, signal, parse: parseLockerStatus })
    },
  }
}
