import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../api/queryKeys'
import { authorizedRequest } from '../auth/authorizedRequest'
import { useSessionStore } from '../auth/session'
import { useCatalogGateway } from './CatalogGatewayContext'
import type { AdminAssetView, AssetModelRequest, AssetModelView, AssetRequest } from './contract'

/**
 * Catalog commands (09 §12.1–12.2). The server's answer is the new truth: a unit's answer replaces its
 * cached dossier, then every catalog list is read again (an edit can move a unit between pages or change
 * a model's name shown on units). Mutations are never retried automatically (serverState.ts).
 */
export function useCatalogMutations() {
  const gateway = useCatalogGateway()
  const session = useSessionStore()
  const client = useQueryClient()

  function settledAsset(asset: AdminAssetView) {
    client.setQueryData(queryKeys.catalog.asset(asset.id), asset)
    void client.invalidateQueries({ queryKey: queryKeys.catalog.all, predicate: (query) => query.queryKey[2] !== 'detail' || query.queryKey[3] !== asset.id })
  }
  function settledModel() {
    void client.invalidateQueries({ queryKey: queryKeys.catalog.all })
  }

  const createAsset = useMutation({
    mutationFn: ({ request, idempotencyKey }: { request: AssetRequest; idempotencyKey: string }) =>
      authorizedRequest(session, (token) => gateway.createAsset(token, request, idempotencyKey)),
    onSuccess: settledAsset,
  })
  const updateAsset = useMutation({
    mutationFn: ({ assetId, request }: { assetId: string; request: AssetRequest }) => authorizedRequest(session, (token) => gateway.updateAsset(token, assetId, request)),
    onSuccess: settledAsset,
  })
  const archiveAsset = useMutation({
    mutationFn: ({ assetId, idempotencyKey }: { assetId: string; idempotencyKey: string }) =>
      authorizedRequest(session, (token) => gateway.archiveAsset(token, assetId, idempotencyKey)),
    onSuccess: settledAsset,
  })
  const createModel = useMutation({
    mutationFn: ({ request, idempotencyKey }: { request: AssetModelRequest; idempotencyKey: string }): Promise<AssetModelView> =>
      authorizedRequest(session, (token) => gateway.createModel(token, request, idempotencyKey)),
    onSuccess: settledModel,
  })
  const updateModel = useMutation({
    mutationFn: ({ modelId, request }: { modelId: string; request: AssetModelRequest }) => authorizedRequest(session, (token) => gateway.updateModel(token, modelId, request)),
    onSuccess: settledModel,
  })
  const archiveModel = useMutation({
    mutationFn: ({ modelId, idempotencyKey }: { modelId: string; idempotencyKey: string }) =>
      authorizedRequest(session, (token) => gateway.archiveModel(token, modelId, idempotencyKey)),
    onSuccess: settledModel,
  })

  return { createAsset, updateAsset, archiveAsset, createModel, updateModel, archiveModel }
}
