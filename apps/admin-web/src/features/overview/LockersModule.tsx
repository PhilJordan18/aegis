import type { UseQueryResult } from '@tanstack/react-query'
import { useRef } from 'react'
import { Link } from '../../app/Link'
import { pathOf } from '../../app/routes'
import { useI18n } from '../../i18n/useI18n'
import { Alert } from '../../ui/Alert'
import { StatusChip } from '../../ui/StatusChip'
import { UNRECOGNIZED } from '../catalog/contract'
import { StaleNotice } from '../catalog/StaleNotice'
import type { AdminLockerPage, AdminLockerView } from '../custody/contract'
import type { LockerStatus } from '../lockers/contract'
import { connectionChip, doorState, lockState, windowView } from '../lockers/lockerPresentation'
import { transactionTimes } from '../transactions/transactionPresentation'
import { ModuleAlert, OverviewModule } from './OverviewModule'
import { readOf, type BlockRead } from './overviewModel'

interface LockersBlockProps {
  readonly read: BlockRead<AdminLockerPage>
  readonly statuses: ReadonlyMap<string, UseQueryResult<LockerStatus, Error>>
  readonly retrying: boolean
  readonly onRetry: () => void
}

/**
 * Locker block: the connection and the cells exactly as the server evaluated them (09 §8.6, §16.1), beside the
 * equipment the locker list places in each cell. Nothing is derived: no cell is « free » or « occupied » from a missing
 * signal, and a reading authorizes no opening.
 */
export function LockersBlock({ read, statuses, retrying, onRetry }: LockersBlockProps) {
  const { m } = useI18n()
  const t = m.overview
  const page = read.kind === 'ready' ? read.value : null
  return (
    <OverviewModule
      title={t.locker}
      className="ag-ov__mod--locker"
      read={read}
      retrying={retrying}
      onRetry={onRetry}
      foot={
        page === null ? undefined : (
          <Link className="ag-link" to={pathOf('lockers')}>
            {t.viewLocker}
          </Link>
        )
      }
    >
      {page !== null && page.items.length === 0 && <p className="ag-ov__empty">{t.noLockers}</p>}
      {page?.items.map((locker) => <LockerSummary key={locker.id} locker={locker} status={statuses.get(locker.id)} />)}
    </OverviewModule>
  )
}

function LockerSummary({ locker, status }: { readonly locker: AdminLockerView; readonly status: UseQueryResult<LockerStatus, Error> | undefined }) {
  const i18n = useI18n()
  const { m } = i18n
  const t = m.overview
  const read = status === undefined ? ({ kind: 'pending' } as const) : readOf(status)
  const codeRef = useRef<HTMLSpanElement>(null)

  if (read.kind === 'pending') {
    return (
      <div className="ag-ov__lk" aria-hidden="true">
        <div className="ag-skel">
          <span className="ag-skel__bar ag-skel__bar--chip" />
          <span className="ag-skel__bar ag-skel__bar--name" />
          <span className="ag-skel__bar ag-skel__bar--facts" />
        </div>
      </div>
    )
  }
  if (read.kind === 'failed') {
    return (
      <div className="ag-ov__alert">
        <p className="ag-ov__lkcode">{locker.code}</p>
        <ModuleAlert failure={read.failure} onRetry={() => void status?.refetch()} retrying={status?.isFetching ?? false} />
      </div>
    )
  }
  const live = read.value
  const chip = connectionChip(live.connectionStatus, i18n)
  const times = transactionTimes(i18n)
  const window = windowView(live.currentWindow, i18n)
  const online = live.connectionStatus === 'ONLINE'
  const windowText =
    window.kind === 'open'
      ? t.windowOpen({ time: window.closesAt ?? '' })
      : window.kind === 'closed'
        ? window.nextOpensAt === null
          ? t.windowClosedNoNext
          : t.windowClosed({ time: window.nextOpensAt })
        : m.lockers.noSchedule
  const placed = new Map(locker.compartments.map((compartment) => [compartment.id, compartment.currentAsset?.assetCode ?? null]))

  return (
    <div className="ag-ov__lk ag-ov__lk--wide">
      <div className="ag-ov__lkstatus">
        <div className="ag-ov__lkline">
          <span className="ag-ov__lkcode" tabIndex={-1} ref={codeRef}>
            {locker.code}
          </span>
          <StatusChip role={chip.role} icon={chip.icon}>
            {chip.label}
          </StatusChip>
        </div>
        <p className="ag-ov__sub ag-tnum">{live.lastSeenAt === null ? m.lockers.neverSignal : m.lockers.lastSignal({ time: times.zoned(live.lastSeenAt) })}</p>
        <p className="ag-ov__sub">{windowText}</p>
        {!online && <p className="ag-ov__sub">{t.lastKnown}</p>}
      </div>
      <div className="ag-ov__lkcells">
        <table className="ag-ov__cells">
          <caption className="ag-sr-only">{m.lockers.compartmentsCaption({ code: locker.code })}</caption>
          <thead>
            <tr>
              <th scope="col">{t.cell}</th>
              <th scope="col">{t.door}</th>
              <th scope="col">{t.lock}</th>
              <th scope="col">{t.expectedAsset}</th>
            </tr>
          </thead>
          <tbody>
            {live.compartments.map((cell) => {
              const expected = placed.get(cell.id)
              return (
                <tr key={cell.id}>
                  <th scope="row">{cell.code}</th>
                  <td data-label={t.door}>{doorState(cell.doorState, i18n).label}</td>
                  <td data-label={t.lock}>{lockState(cell.lockState, i18n).label}</td>
                  <td data-label={t.expectedAsset}>{expected === undefined ? t.placementUnknown : (expected ?? t.noAsset)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <p className="ag-ov__sub">{m.lockers.evaluatedNote({ time: times.zoned(live.evaluatedAt) })}</p>
      </div>
      {read.stale && (
        <div className="ag-ov__lkstale">
          <StaleNotice
            evaluatedAt={times.readAt(read.readAt)}
            body={(time) => t.staleBody({ time })}
            retrying={status?.isFetching ?? false}
            onRetry={() => void status?.refetch()}
            returnFocus={() => codeRef.current?.focus()}
          />
        </div>
      )}
    </div>
  )
}

/** Persistent notice above the blocks while a locker is not online (sections.md §5.1): its values are a memory. */
export function LockerConnectionBanners({ lockers, statuses }: { readonly lockers: AdminLockerPage | undefined; readonly statuses: ReadonlyMap<string, UseQueryResult<LockerStatus, Error>> }) {
  const i18n = useI18n()
  const { m } = i18n
  const times = transactionTimes(i18n)
  const banners = (lockers?.items ?? []).flatMap((locker) => {
    const live = statuses.get(locker.id)?.data
    // An unrecognized value is neither online nor offline: it is not announced as either.
    if (live === undefined || live.connectionStatus === UNRECOGNIZED || live.connectionStatus === 'ONLINE') return []
    return [{ id: locker.id, code: locker.code, status: live }]
  })
  if (banners.length === 0) return null
  return (
    <div className="ag-ov__banners">
      {banners.map(({ id, code, status }) =>
        status.connectionStatus === 'OFFLINE' ? (
          <Alert key={id} kind="warning" icon="status-offline" title={m.overview.lockerOfflineTitle({ code })}>
            <p>{status.lastSeenAt === null ? m.lockers.neverSignal : m.overview.lockerOfflineBody({ time: times.zoned(status.lastSeenAt) })}</p>
          </Alert>
        ) : (
          <Alert key={id} kind="warning" icon="status-offline" title={m.overview.lockerUnknownTitle({ code })}>
            <p>{m.overview.lockerUnknownBody}</p>
          </Alert>
        ),
      )}
    </div>
  )
}
