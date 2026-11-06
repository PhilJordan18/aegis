import { createHttpClient, type HttpClientOptions } from '../../api/http'
import type { CatalogGateway } from './catalogGateway'
import { parseAdminAssetPage, parseAdminAssetView, parseAssetModelPage, parseAssetModelView } from './contractParsers'

/** Production adapter of the administrator catalog routes (09 §12.1–12.2). */
export function createHttpCatalogGateway(options?: HttpClientOptions): CatalogGateway {
  const http = createHttpClient(options)
  const asset = (assetId: string) => `/admin/assets/${encodeURIComponent(assetId)}`
  const model = (modelId: string) => `/admin/asset-models/${encodeURIComponent(modelId)}`
  return {
    listAssets(accessToken, { page, size, sort }, signal) {
      const params = new URLSearchParams({ page: String(page), size: String(size), sort })
      return http.send({ method: 'GET', path: `/admin/assets?${params.toString()}`, accessToken, signal, parse: parseAdminAssetPage })
    },
    getAsset(accessToken, assetId, signal) {
      return http.send({ method: 'GET', path: asset(assetId), accessToken, signal, parse: parseAdminAssetView })
    },
    createAsset(accessToken, request, idempotencyKey) {
      return http.send({ method: 'POST', path: '/admin/assets', body: request, accessToken, idempotencyKey, parse: parseAdminAssetView })
    },
    updateAsset(accessToken, assetId, request) {
      return http.send({ method: 'PUT', path: asset(assetId), body: request, accessToken, parse: parseAdminAssetView })
    },
    archiveAsset(accessToken, assetId, idempotencyKey) {
      return http.send({ method: 'POST', path: `${asset(assetId)}/archive`, accessToken, idempotencyKey, parse: parseAdminAssetView })
    },
    listModels(accessToken, { page, size }, signal) {
      const params = new URLSearchParams({ page: String(page), size: String(size) })
      return http.send({ method: 'GET', path: `/admin/asset-models?${params.toString()}`, accessToken, signal, parse: parseAssetModelPage })
    },
    createModel(accessToken, request, idempotencyKey) {
      return http.send({ method: 'POST', path: '/admin/asset-models', body: request, accessToken, idempotencyKey, parse: parseAssetModelView })
    },
    updateModel(accessToken, modelId, request) {
      return http.send({ method: 'PUT', path: model(modelId), body: request, accessToken, parse: parseAssetModelView })
    },
    archiveModel(accessToken, modelId, idempotencyKey) {
      return http.send({ method: 'POST', path: `${model(modelId)}/archive`, accessToken, idempotencyKey, parse: parseAssetModelView })
    },
  }
}
