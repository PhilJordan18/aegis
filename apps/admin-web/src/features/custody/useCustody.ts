import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '../../api/queryKeys'
import { authorizedRequest } from '../auth/authorizedRequest'
import { useSessionStore } from '../auth/session'
import type { AssignIdentifierRequest, PlacementRequest } from './contract'
import { useCustodyGateway } from './CustodyGatewayContext'

/** The lab has a handful of lockers: one page of the maximum size covers them (09 §11.1). */
export const LOCKER_PAGE = { page: 0, size: 100 } as const

export function useIdentifiers(assetId: string) {
  const gateway = useCustodyGateway()
  const session = useSessionStore()
  return useQuery({
    queryKey: queryKeys.custody.identifiers(assetId),
    queryFn: ({ signal }) => authorizedRequest(session, (token) => gateway.listIdentifiers(token, assetId, signal)),
  })
}

/** Read again at each opening of the placement editor: occupancy changes under other administrators. */
export function useAdminLockers({ enabled = true }: { readonly enabled?: boolean } = {}) {
  const gateway = useCustodyGateway()
  const session = useSessionStore()
  return useQuery({
    queryKey: queryKeys.custody.lockers(LOCKER_PAGE),
    queryFn: ({ signal }) => authorizedRequest(session, (token) => gateway.listLockers(token, LOCKER_PAGE, signal)),
    enabled,
    refetchOnMount: 'always',
  })
}

/**
 * Identifier and placement commands. The server's answer is the truth: the identifier history, the unit's dossier
 * and lists (placement, archived state) and the locker list are read again; nothing is patched locally.
 */
export function useCustodyMutations(assetId: string) {
  const gateway = useCustodyGateway()
  const session = useSessionStore()
  const client = useQueryClient()
  const settledIdentifiers = () => void client.invalidateQueries({ queryKey: queryKeys.custody.identifiers(assetId) })
  const settledPlacement = () => {
    void client.invalidateQueries({ queryKey: queryKeys.catalog.all })
    void client.invalidateQueries({ queryKey: queryKeys.custody.all })
    void client.invalidateQueries({ queryKey: queryKeys.lockers.all })
  }

  const assign = useMutation({
    mutationFn: ({ request, idempotencyKey }: { request: AssignIdentifierRequest; idempotencyKey: string }) =>
      authorizedRequest(session, (token) => gateway.assignIdentifier(token, assetId, request, idempotencyKey)),
    onSettled: settledIdentifiers,
  })
  const revoke = useMutation({
    mutationFn: ({ identifierId, idempotencyKey }: { identifierId: string; idempotencyKey: string }) =>
      authorizedRequest(session, (token) => gateway.revokeIdentifier(token, assetId, identifierId, idempotencyKey)),
    onSettled: settledIdentifiers,
  })
  const place = useMutation({
    mutationFn: (request: PlacementRequest) => authorizedRequest(session, (token) => gateway.setPlacement(token, assetId, request)),
    onSuccess: settledPlacement,
  })
  return { assign, revoke, place }
}
