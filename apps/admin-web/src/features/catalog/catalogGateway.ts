import type { GatewayResult } from '../auth/authGateway'
import type { AdminAssetPage, AdminAssetView, AssetListQuery, AssetModelPage, AssetModelRequest, AssetModelView, AssetRequest, ModelListQuery } from './contract'

/**
 * Boundary between the Manager UI and the administrator catalog routes (09 §12.1–12.2).
 * Same rules as `AuthGateway`: send `Authorization: Bearer`, an `X-Request-Id`, apply a timeout
 * and honour `signal`, parse `application/problem+json` into `problem` (null when malformed),
 * never log or echo the token. The production adapter is `httpCatalogGateway.ts`.
 *
 * Mutations that 09 §20.1 lists take the caller's `idempotencyKey`: one key per intent, reused
 * unchanged when the same intent is repeated. The PUT routes take none (§20.2: PUT is idempotent).
 */
export interface CatalogGateway {
  /** `GET /api/v1/admin/assets?page&size&sort` (09 §12.2, §11.1 envelope). */
  listAssets(accessToken: string, query: AssetListQuery, signal?: AbortSignal): Promise<GatewayResult<AdminAssetPage>>
  /** `GET /api/v1/admin/assets/{assetId}`; 404 `RESOURCE_NOT_FOUND` when absent. */
  getAsset(accessToken: string, assetId: string, signal?: AbortSignal): Promise<GatewayResult<AdminAssetView>>
  /** `POST /api/v1/admin/assets`, 201. */
  createAsset(accessToken: string, request: AssetRequest, idempotencyKey: string): Promise<GatewayResult<AdminAssetView>>
  /** `PUT /api/v1/admin/assets/{assetId}`, 200. */
  updateAsset(accessToken: string, assetId: string, request: AssetRequest): Promise<GatewayResult<AdminAssetView>>
  /** `POST /api/v1/admin/assets/{assetId}/archive`, 200. */
  archiveAsset(accessToken: string, assetId: string, idempotencyKey: string): Promise<GatewayResult<AdminAssetView>>
  /** `GET /api/v1/admin/asset-models?page&size` (09 §12.1). */
  listModels(accessToken: string, query: ModelListQuery, signal?: AbortSignal): Promise<GatewayResult<AssetModelPage>>
  /** `POST /api/v1/admin/asset-models`, 201. */
  createModel(accessToken: string, request: AssetModelRequest, idempotencyKey: string): Promise<GatewayResult<AssetModelView>>
  /** `PUT /api/v1/admin/asset-models/{modelId}`, 200. */
  updateModel(accessToken: string, modelId: string, request: AssetModelRequest): Promise<GatewayResult<AssetModelView>>
  /** `POST /api/v1/admin/asset-models/{modelId}/archive`, 200. */
  archiveModel(accessToken: string, modelId: string, idempotencyKey: string): Promise<GatewayResult<AssetModelView>>
}

const notConfigured = async () => ({ kind: 'network', reason: 'notConfigured' }) as const

/** Context default when no adapter is provided: every call honestly fails as unreachable. */
export const unconfiguredCatalogGateway: CatalogGateway = {
  listAssets: notConfigured,
  getAsset: notConfigured,
  createAsset: notConfigured,
  updateAsset: notConfigured,
  archiveAsset: notConfigured,
  listModels: notConfigured,
  createModel: notConfigured,
  updateModel: notConfigured,
  archiveModel: notConfigured,
}
