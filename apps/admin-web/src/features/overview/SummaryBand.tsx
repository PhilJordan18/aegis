import { useRef } from 'react'
import { Link } from '../../app/Link'
import { useI18n } from '../../i18n/useI18n'
import { Icon } from '../../ui/Icon'
import { StatusChip } from '../../ui/StatusChip'
import { StaleNotice } from '../catalog/StaleNotice'
import { transactionTimes } from '../transactions/transactionPresentation'
import type { AllClear, Tile } from './summaryBand'

interface SummaryBandProps {
  readonly tiles: readonly Tile[]
  readonly allClear: AllClear
  /** Reads again what failed to refresh; the band's one stale notice offers it. */
  readonly onRetryStale: () => void
  readonly retrying: boolean
}

/**
 * Five linked tiles above the modules (contrat-web-manager §2.1 to §2.5). Each tile is one link: its text (overline,
 * value, detail, « Lecture incomplète », read time) is its accessible name, the coloured dot is decoration.
 */
export function SummaryBand({ tiles, allClear, onRetryStale, retrying }: SummaryBandProps) {
  const i18n = useI18n()
  const { m } = i18n
  const t = m.overview
  const times = transactionTimes(i18n)
  const listRef = useRef<HTMLUListElement>(null)
  const stale = tiles.filter((tile) => tile.state === 'ready' && tile.stale)
  const oldestStale = stale.length === 0 ? null : Math.min(...stale.map((tile) => (tile.state === 'ready' ? tile.readAt : Infinity)))
  const loading = tiles.every((tile) => tile.state === 'pending')
  const readTimes = tiles.flatMap((tile) => (tile.state === 'ready' ? [tile.readAt] : []))
  const oldestRead = readTimes.length === 0 ? null : Math.min(...readTimes)

  return (
    <div className="ag-band-wrap">
      <ul className="ag-band" ref={listRef} aria-label={t.band} aria-busy={loading || undefined}>
        {tiles.map((tile) => (
          <li key={tile.key} className="ag-band__item">
            <Link className={`ag-panel ag-tile ag-tile--${tile.state === 'ready' ? tile.role : tile.state === 'failed' ? 'unknown' : 'neutral'}`} to={tile.href}>
              <span className="ag-tile__over">
                <span className="ag-tile__dot" aria-hidden="true" />
                {tile.overline}
                {tile.code !== undefined && (
                  <>
                    {' '}
                    <span className="ag-tile__code">{tile.code}</span>
                  </>
                )}
              </span>
              {tile.state === 'pending' && (
                <span className="ag-tile__skel" aria-hidden="true">
                  <span className="ag-skel__bar ag-skel__bar--name" />
                </span>
              )}
              {tile.state === 'failed' && (
                <>
                  <span className="ag-tile__value" aria-hidden="true">
                    —
                  </span>
                  <span className="ag-tile__detail">
                    <Icon name="status-clock" /> {tile.unavailable}
                  </span>
                </>
              )}
              {tile.state === 'ready' && (
                <>
                  <span className="ag-tile__value">{tile.value}</span>
                  {/* §8.7: a partial read replaces the detail line at every width; the count never reads as complete. */}
                  {tile.partial ? (
                    <span className="ag-tile__detail ag-tile__detail--strong">{t.tilePartial}</span>
                  ) : (
                    tile.detail !== null && (
                      <span className="ag-tile__detail">
                        {tile.detailLead !== undefined && <span className="ag-tile__lead">{tile.detailLead}</span>}
                        {tile.detail}
                      </span>
                    )
                  )}
                  <span className="ag-tile__read">
                    {tile.stale ? (
                      <StatusChip role="unknown" icon="status-clock">
                        {m.pageTools.notRefreshed}
                      </StatusChip>
                    ) : null}
                    <span className="ag-tnum">{m.pageTools.readAt({ time: times.readAt(tile.readAt) })}</span>
                  </span>
                </>
              )}
            </Link>
          </li>
        ))}
      </ul>
      {/* §8.1: below 560 px one line for the band replaces the read time of each tile. */}
      {oldestRead !== null && (
        <p className="ag-band__read">
          <span className="ag-tnum">{t.bandReadAt({ time: times.readAt(oldestRead) })}</span>
          {oldestStale !== null && (
            <StatusChip role="unknown" icon="status-clock">
              {m.pageTools.notRefreshed}
            </StatusChip>
          )}
        </p>
      )}
      {loading && (
        <p className="ag-sr-only" role="status">
          {t.bandLoading}
        </p>
      )}
      {oldestStale !== null && (
        <div className="ag-band__stale">
          <StaleNotice evaluatedAt={times.readAt(oldestStale)} body={(time) => t.staleBody({ time })} retrying={retrying} onRetry={onRetryStale} returnFocus={() => listRef.current?.querySelector('a')?.focus()} />
        </div>
      )}
      {allClear.kind === 'clear' && (
        <p className="ag-band__line">
          <StatusChip role="ready" icon="status-ready">
            {t.allClear({ time: times.readAt(allClear.readAt) })}
          </StatusChip>
        </p>
      )}
      {allClear.kind === 'notConfirmed' && (
        <p className="ag-band__line">
          <StatusChip role="unknown" icon="status-clock">
            {t.notConfirmed}
          </StatusChip>
        </p>
      )}
    </div>
  )
}
