import type { GatewayResult } from '../auth/authGateway'
import type { AdminAssetPage, AdminAssetView, AssetListQuery } from './contract'

/**
 * Boundary between the Manager UI and the administrator catalog routes (09 §12.2).
 * Same rules as `AuthGateway`: send `Authorization: Bearer`, an `X-Request-Id`, apply a timeout
 * and honour `signal`, parse `application/problem+json` into `problem` (null when malformed),
 * never log or echo the token. The production adapter is `httpCatalogGateway.ts`.
 */
export interface CatalogGateway {
  /** `GET /api/v1/admin/assets?page&size&sort` (09 §12.2, §11.1 envelope). */
  listAssets(accessToken: string, query: AssetListQuery, signal?: AbortSignal): Promise<GatewayResult<AdminAssetPage>>
  /** `GET /api/v1/admin/assets/{assetId}`; 404 `RESOURCE_NOT_FOUND` when absent. */
  getAsset(accessToken: string, assetId: string, signal?: AbortSignal): Promise<GatewayResult<AdminAssetView>>
}

/** Context default when no adapter is provided: every call honestly fails as unreachable. */
export const unconfiguredCatalogGateway: CatalogGateway = {
  listAssets: async () => ({ kind: 'network', reason: 'notConfigured' }),
  getAsset: async () => ({ kind: 'network', reason: 'notConfigured' }),
}
