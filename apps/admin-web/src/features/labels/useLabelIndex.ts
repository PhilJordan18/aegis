import { useQueries, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { queryKeys } from '../../api/queryKeys'
import { authorizedRequest } from '../auth/authorizedRequest'
import { useSessionStore } from '../auth/session'
import { useCatalogGateway } from '../catalog/CatalogGatewayContext'
import { useCustodyGateway } from '../custody/CustodyGatewayContext'
import { LOCKER_PAGE } from '../custody/useCustody'
import { ASSET_INDEX_PAGE_SIZE, assetPagesToRead, buildLabelIndex, type LabelIndex } from './labelIndex'

/** Placement changes invalidate the key; « Actualiser » reads it again. */
const LOCKER_INDEX_STALE_MS = 30_000

const assetPageQuery = (page: number) => ({ page, size: ASSET_INDEX_PAGE_SIZE, sort: 'assetCode,asc' as const })

/**
 * The shared label index (§1.1). Every page calls it; TanStack Query shares the reads, so the requests are bounded and
 * independent of the rows shown: one locker page (the key of the placement editor and the Vue d'ensemble) and at most
 * five unit pages, read once per session. The unit pages live under `catalog`, so a catalogue or placement change reads
 * them again; « Actualiser » reads them again through `refreshLabelIndex`.
 */
export function useLabelIndex(): LabelIndex & { readonly retry: () => void } {
  const catalog = useCatalogGateway()
  const custody = useCustodyGateway()
  const session = useSessionStore()
  const client = useQueryClient()
  const lockers = useQuery({
    queryKey: queryKeys.custody.lockers(LOCKER_PAGE),
    queryFn: ({ signal }) => authorizedRequest(session, (token) => custody.listLockers(token, LOCKER_PAGE, signal)),
    // Each component of a page that names a cell mounts this read: it is fresh for the page, not one read per component.
    staleTime: LOCKER_INDEX_STALE_MS,
  })
  const pageQuery = (page: number) => ({
    queryKey: queryKeys.catalog.labelIndex(page),
    queryFn: ({ signal }: { signal: AbortSignal }) => authorizedRequest(session, (token) => catalog.listAssets(token, assetPageQuery(page), signal)),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const first = useQuery(pageQuery(0))
  const rest = useQueries({ queries: Array.from({ length: assetPagesToRead(first.data) - 1 }, (_, index) => pageQuery(index + 1)) })
  const index = buildLabelIndex({
    lockers: { data: lockers.data, failed: lockers.isError && lockers.data === undefined },
    assets: [first, ...rest].map((query) => ({ data: query.data, failed: query.isError && query.data === undefined })),
  })
  const retry = useCallback(() => void refreshLabelIndex(client), [client])
  return { ...index, retry }
}

/**
 * The cells' current units only (« Équipement attendu », §1.2), from the one locker page of the index: a page that names
 * no unit by identifier (Casiers) reads no unit page.
 */
export function useCellPlacements(): LabelIndex['placement'] {
  const custody = useCustodyGateway()
  const session = useSessionStore()
  const lockers = useQuery({
    queryKey: queryKeys.custody.lockers(LOCKER_PAGE),
    queryFn: ({ signal }) => authorizedRequest(session, (token) => custody.listLockers(token, LOCKER_PAGE, signal)),
    // Each component of a page that names a cell mounts this read: it is fresh for the page, not one read per component.
    staleTime: LOCKER_INDEX_STALE_MS,
  })
  return buildLabelIndex({ lockers: { data: lockers.data, failed: lockers.isError && lockers.data === undefined }, assets: [] }).placement
}

/** « Actualiser » of any page: the unit pages and the locker page of the index are read again. */
export function refreshLabelIndex(client: QueryClient): Promise<unknown> {
  return Promise.allSettled([
    client.refetchQueries({ queryKey: queryKeys.catalog.labelIndexAll }),
    client.refetchQueries({ queryKey: queryKeys.custody.lockers(LOCKER_PAGE) }),
  ])
}
