import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { queryKeys } from '../../api/queryKeys'
import { OPEN_ANOMALIES_QUERY } from '../overview/useOverviewQueries'
import { useI18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { Icon } from '../../ui/Icon'
import { StatusChip } from '../../ui/StatusChip'
import { transactionTimes } from '../transactions/transactionPresentation'
import './page-tools.css'

interface RefreshControlProps {
  /** Reads the page again; resolves to whether every read succeeded. */
  readonly onRefresh: () => Promise<boolean>
  /** Epoch ms of the oldest successful read the page shows; null before any. */
  readonly readAt: number | null
  /** A read of the page already failed outside « Actualiser » (a background read): its data are the previous ones. */
  readonly stale?: boolean
  /** A read the page started itself (first load, a filter): the button is busy too. */
  readonly busy?: boolean
  /** False when the page already announces its own outcome of a successful read (Audit: the count of events). */
  readonly announceSuccess?: boolean
}

/**
 * « Actualiser », the same on every page (contract §1.5). The instant beside it is always the one of the last
 * successful read: a failed refresh never moves it, adds « Non actualisé » and says so in the live region. One read
 * at a time: a second activation while busy does nothing.
 */
export function RefreshControl({ onRefresh, readAt, stale = false, busy = false, announceSuccess = true }: RefreshControlProps) {
  const i18n = useI18n()
  const t = i18n.m.pageTools
  const times = transactionTimes(i18n)
  const client = useQueryClient()
  const [refreshing, setRefreshing] = useState(false)
  const [failed, setFailed] = useState(false)
  const [announcement, setAnnouncement] = useState('')

  const refresh = () => {
    if (refreshing || busy) return
    setRefreshing(true)
    setAnnouncement('')
    const read = onRefresh()
    // The navigation badges are read again with every page (§1.6). The page's reads have started: a badge read the page
    // already runs (the Vue d'ensemble, Anomalies) is joined, not started twice.
    void client.refetchQueries({ queryKey: queryKeys.anomalies.list(OPEN_ANOMALIES_QUERY), type: 'active' }, { cancelRefetch: false })
    void client.refetchQueries({ queryKey: queryKeys.overview.all, type: 'active' }, { cancelRefetch: false })
    void read
      .catch(() => false)
      .then((ok) => {
        setRefreshing(false)
        setFailed(!ok)
        // The instant announced on success is the moment the read ended; on failure, the one of the data kept.
        if (ok) setAnnouncement(!announceSuccess ? '' : t.refreshed({ time: times.readAt(Date.now()) }))
        else setAnnouncement(readAt === null ? t.refreshFailedNoData : t.refreshFailed({ time: times.readAt(readAt) }))
      })
  }

  const notRefreshed = (failed || stale) && readAt !== null
  return (
    <div className="ag-refresh">
      {readAt !== null && <span className="ag-refresh__time ag-tnum">{t.readAt({ time: times.readAt(readAt) })}</span>}
      {notRefreshed && (
        <StatusChip role="unknown" icon="status-clock">
          {t.notRefreshed}
        </StatusChip>
      )}
      <Button variant="secondary" busy={refreshing || busy} onClick={refresh}>
        <Icon name="refresh" />
        {refreshing ? t.refreshing : t.refresh}
      </Button>
      <p className="ag-sr-only" role="status">
        {announcement}
      </p>
    </div>
  )
}
