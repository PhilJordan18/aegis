import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { queryKeys } from '../../api/queryKeys'
import { authorizedRequest } from '../auth/authorizedRequest'
import { useSessionStore } from '../auth/session'
import { toAuditQuery, type AuditFilters } from './auditFilters'
import { useAuditGateway } from './AuditGatewayContext'
import type { AuditPage } from './contract'

/** A page and the instant the server answered, kept so the screen can say when the first page was read. */
export interface TimelinePage extends AuditPage {
  readonly readAt: number
}

type Walk = InfiniteData<TimelinePage, string | undefined>

/**
 * One walk of the audit history (09 §19.1, §22.2): the first page, then « Charger plus » with the opaque cursor passed
 * back unchanged. Nothing refetches by itself: a refetch of an infinite query would re-read every loaded page, and a
 * walk is only restarted on purpose (`restart`), from the first page. The cache is dropped when the screen is left
 * (`gcTime: 0`), so coming back starts a fresh walk.
 */
export function useAuditTimeline(filters: AuditFilters) {
  const gateway = useAuditGateway()
  const session = useSessionStore()
  const client = useQueryClient()
  const base = toAuditQuery(filters)
  const queryKey = queryKeys.audit.timeline(base)
  const query = useInfiniteQuery<TimelinePage, Error, Walk, readonly unknown[], string | undefined>({
    queryKey,
    queryFn: async ({ pageParam, signal }) => {
      const page = await authorizedRequest(session, (accessToken) => gateway.listAuditEvents(accessToken, { ...base, cursor: pageParam }, signal))
      return { ...page, readAt: Date.now() }
    },
    initialPageParam: undefined,
    getNextPageParam: (last) => (last.hasMore ? (last.nextCursor ?? undefined) : undefined),
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })

  /**
   * Back to the first page. The loaded pages are cut to the first before it is read again, because a refetch would
   * walk them all: the screen then shows what the server says now from the start, or says that it could not.
   */
  function restart() {
    client.setQueryData<Walk>(queryKey, (walk) => walk && { pages: walk.pages.slice(0, 1), pageParams: walk.pageParams.slice(0, 1) })
    return query.refetch()
  }

  return { query, restart }
}
