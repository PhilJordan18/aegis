import type { GatewayResult } from '../auth/authGateway'
import type { AdminLockerPage, AssetIdentifierView, AssetPlacementView, AssignIdentifierRequest, PlacementRequest } from './contract'

/** Boundary of the identifier, placement and locker-list routes (09 §12.3–12.4, §16.2). */
export interface CustodyGateway {
  /** `GET /api/v1/admin/assets/{assetId}/identifiers`: the whole history, active first. */
  listIdentifiers(accessToken: string, assetId: string, signal?: AbortSignal): Promise<GatewayResult<AssetIdentifierView[]>>
  /** `POST /api/v1/admin/assets/{assetId}/identifiers`, 201. */
  assignIdentifier(accessToken: string, assetId: string, request: AssignIdentifierRequest, idempotencyKey: string): Promise<GatewayResult<AssetIdentifierView>>
  /** `POST /api/v1/admin/assets/{assetId}/identifiers/{identifierId}/revoke`, 200. */
  revokeIdentifier(accessToken: string, assetId: string, identifierId: string, idempotencyKey: string): Promise<GatewayResult<AssetIdentifierView>>
  /** `PUT /api/v1/admin/assets/{assetId}/placement`, 200. */
  setPlacement(accessToken: string, assetId: string, request: PlacementRequest): Promise<GatewayResult<AssetPlacementView>>
  /** `GET /api/v1/admin/lockers?page&size`. */
  listLockers(accessToken: string, query: { readonly page: number; readonly size: number }, signal?: AbortSignal): Promise<GatewayResult<AdminLockerPage>>
}

const notConfigured = async () => ({ kind: 'network', reason: 'notConfigured' }) as const

export const unconfiguredCustodyGateway: CustodyGateway = {
  listIdentifiers: notConfigured,
  assignIdentifier: notConfigured,
  revokeIdentifier: notConfigured,
  setPlacement: notConfigured,
  listLockers: notConfigured,
}
