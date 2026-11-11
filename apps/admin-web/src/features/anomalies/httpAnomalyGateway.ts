import { createHttpClient, type HttpClientOptions } from '../../api/http'
import type { AnomalyListQuery } from './contract'
import { parseAnomalyDetail, parseAnomalyPage, parseAnomalyView } from './contractParsers'
import type { AnomalyGateway } from './anomalyGateway'

/** §18.1 query string: only the filters that are set, then the page. */
export function anomalySearch({ status, type, severity, assetId, lockerOperationId, from, to, page, size }: AnomalyListQuery): string {
  const params = new URLSearchParams()
  const filters = { status, type, severity, assetId, lockerOperationId, from, to }
  for (const [name, value] of Object.entries(filters)) if (value !== undefined) params.set(name, value)
  params.set('page', String(page))
  params.set('size', String(size))
  return params.toString()
}

/** Production adapter of 09 §18. */
export function createHttpAnomalyGateway(options?: HttpClientOptions): AnomalyGateway {
  const http = createHttpClient(options)
  const anomaly = (anomalyId: string) => `/admin/anomalies/${encodeURIComponent(anomalyId)}`
  return {
    listAnomalies(accessToken, query, signal) {
      return http.send({ method: 'GET', path: `/admin/anomalies?${anomalySearch(query)}`, accessToken, signal, parse: parseAnomalyPage })
    },
    getAnomaly(accessToken, anomalyId, signal) {
      return http.send({ method: 'GET', path: anomaly(anomalyId), accessToken, signal, parse: parseAnomalyDetail })
    },
    acknowledge(accessToken, anomalyId, request, idempotencyKey) {
      return http.send({ method: 'POST', path: `${anomaly(anomalyId)}/acknowledge`, body: request, accessToken, idempotencyKey, parse: parseAnomalyView })
    },
  }
}
