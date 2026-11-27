import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '../../api/queryKeys'
import { useAnomalyGateway } from '../anomalies/AnomalyGatewayContext'
import { authorizedRequest } from '../auth/authorizedRequest'
import { useSessionStore } from '../auth/session'
import { readOf, summarizeLoans } from './overviewModel'
import { OPEN_ANOMALIES_QUERY, useOpenLoanReads } from './useOverviewQueries'

/** §1.6: read on mounting the shell, then every 60 s while the tab is visible, and on every « Actualiser ». */
export const NAV_BADGE_REFRESH_MS = 60_000

export type NavBadge =
  | { readonly kind: 'none' }
  | { readonly kind: 'count'; readonly n: number; /** « N+ »: a read is missing or a page was cut. */ readonly partial: boolean }
  | { readonly kind: 'unavailable' }

/**
 * The two navigation badges. They share the keys of the Vue d'ensemble (one read for both screens): the open
 * anomalies' `totalItems` and the overdue loans the server flagged among the open loans read. Zero shows nothing; a
 * failed read shows « unavailable », never zero.
 */
export function useNavBadges(): { readonly anomalies: NavBadge; readonly late: NavBadge } {
  const gateway = useAnomalyGateway()
  const session = useSessionStore()
  const anomalies = useQuery({
    queryKey: queryKeys.anomalies.list(OPEN_ANOMALIES_QUERY),
    queryFn: ({ signal }) => authorizedRequest(session, (accessToken) => gateway.listAnomalies(accessToken, OPEN_ANOMALIES_QUERY, signal)),
    refetchInterval: NAV_BADGE_REFRESH_MS,
  })
  const loans = summarizeLoans(useOpenLoanReads(NAV_BADGE_REFRESH_MS).map(readOf))

  const anomalyBadge: NavBadge =
    anomalies.data !== undefined
      ? anomalies.data.totalItems > 0
        ? { kind: 'count', n: anomalies.data.totalItems, partial: false }
        : { kind: 'none' }
      : anomalies.isError
        ? { kind: 'unavailable' }
        : { kind: 'none' }
  const lateBadge: NavBadge =
    loans.kind === 'ready'
      ? loans.value.count.n > 0
        ? { kind: 'count', n: loans.value.count.n, partial: !loans.value.count.complete }
        : // Zero among an incomplete read is not a zero: the badge says the count is unknown instead of hiding the gap.
          loans.value.count.complete
          ? { kind: 'none' }
          : { kind: 'unavailable' }
      : loans.kind === 'failed'
        ? { kind: 'unavailable' }
        : { kind: 'none' }
  return { anomalies: anomalyBadge, late: lateBadge }
}
