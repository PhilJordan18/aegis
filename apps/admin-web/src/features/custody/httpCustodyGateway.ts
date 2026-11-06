import { createHttpClient, type HttpClientOptions } from '../../api/http'
import { parseAdminLockerPage, parseAssetIdentifierList, parseAssetIdentifierView, parseAssetPlacementView } from './contractParsers'
import type { CustodyGateway } from './custodyGateway'

/** Production adapter of 09 §12.3–12.4 and §16.2. */
export function createHttpCustodyGateway(options?: HttpClientOptions): CustodyGateway {
  const http = createHttpClient(options)
  const asset = (assetId: string) => `/admin/assets/${encodeURIComponent(assetId)}`
  return {
    listIdentifiers(accessToken, assetId, signal) {
      return http.send({ method: 'GET', path: `${asset(assetId)}/identifiers`, accessToken, signal, parse: parseAssetIdentifierList })
    },
    assignIdentifier(accessToken, assetId, request, idempotencyKey) {
      return http.send({ method: 'POST', path: `${asset(assetId)}/identifiers`, body: request, accessToken, idempotencyKey, parse: parseAssetIdentifierView })
    },
    revokeIdentifier(accessToken, assetId, identifierId, idempotencyKey) {
      return http.send({ method: 'POST', path: `${asset(assetId)}/identifiers/${encodeURIComponent(identifierId)}/revoke`, accessToken, idempotencyKey, parse: parseAssetIdentifierView })
    },
    setPlacement(accessToken, assetId, request) {
      return http.send({ method: 'PUT', path: `${asset(assetId)}/placement`, body: request, accessToken, parse: parseAssetPlacementView })
    },
    listLockers(accessToken, { page, size }, signal) {
      const params = new URLSearchParams({ page: String(page), size: String(size) })
      return http.send({ method: 'GET', path: `/admin/lockers?${params.toString()}`, accessToken, signal, parse: parseAdminLockerPage })
    },
  }
}
