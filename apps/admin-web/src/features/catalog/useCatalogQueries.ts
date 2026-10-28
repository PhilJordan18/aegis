import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { queryKeys } from '../../api/queryKeys'
import { authorizedRequest } from '../auth/authorizedRequest'
import { useSessionStore } from '../auth/session'
import { useCatalogGateway } from './CatalogGatewayContext'
import type { AdminAssetView, AssetListQuery } from './contract'

/** One page of units. The previous page stays on screen while the next one loads. */
export function useAssetList(query: AssetListQuery) {
  const gateway = useCatalogGateway()
  const session = useSessionStore()
  return useQuery({
    queryKey: queryKeys.catalog.assetList(query),
    queryFn: ({ signal }) => authorizedRequest(session, (accessToken) => gateway.listAssets(accessToken, query, signal)),
    placeholderData: keepPreviousData,
  })
}

/**
 * One unit, read from `GET /admin/assets/{assetId}`. The list's copy of the same unit stands in
 * while the request runs, so selecting a row does not flash an empty dossier; an error still wins.
 */
export function useAsset(assetId: string | null, listed: AdminAssetView | undefined) {
  const gateway = useCatalogGateway()
  const session = useSessionStore()
  return useQuery({
    queryKey: queryKeys.catalog.asset(assetId ?? ''),
    queryFn: ({ signal }) => authorizedRequest(session, (accessToken) => gateway.getAsset(accessToken, assetId ?? '', signal)),
    enabled: assetId !== null,
    placeholderData: listed,
  })
}
