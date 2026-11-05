import { createHttpClient, type HttpClientOptions } from '../../api/http'
import type { CatalogGateway } from './catalogGateway'
import { parseAdminAssetPage, parseAdminAssetView } from './contractParsers'

/** Production adapter: `GET /admin/assets` and `GET /admin/assets/{assetId}` (09 §12.2). */
export function createHttpCatalogGateway(options?: HttpClientOptions): CatalogGateway {
  const http = createHttpClient(options)
  return {
    listAssets(accessToken, { page, size, sort }, signal) {
      const params = new URLSearchParams({ page: String(page), size: String(size), sort })
      return http.send({ method: 'GET', path: `/admin/assets?${params.toString()}`, accessToken, signal, parse: parseAdminAssetPage })
    },
    getAsset(accessToken, assetId, signal) {
      return http.send({ method: 'GET', path: `/admin/assets/${encodeURIComponent(assetId)}`, accessToken, signal, parse: parseAdminAssetView })
    },
  }
}
