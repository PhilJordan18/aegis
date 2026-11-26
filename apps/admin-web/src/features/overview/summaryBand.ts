import type { UseQueryResult } from '@tanstack/react-query'
import { FORMAT_LOCALE } from '../../i18n/locale'
import type { I18n } from '../../i18n/useI18n'
import type { StatusRole } from '../../ui/StatusChip'
import type { AdminLockerPage } from '../custody/contract'
import type { LockerStatus } from '../lockers/contract'
import { connectionChip, windowView } from '../lockers/lockerPresentation'
import type { ReservationView, TransactionPage } from '../transactions/contract'
import { NO_FILTERS, transactionHref } from '../transactions/transactionHref'
import { transactionTimes } from '../transactions/transactionPresentation'
import { anomaliesHref, NO_FILTERS as NO_ANOMALY_FILTERS } from '../anomalies/anomalyLocation'
import { pathOf } from '../../app/routes'
import { isComplete, readOf, type AnomalySummary, type BlockRead, type LoanSummary, type OperationSummary } from './overviewModel'
import type { AnomalyView } from '../anomalies/contract'

/**
 * The summary band of the Vue d'ensemble (contrat-web-manager §2.1): one tile per question, each a link to the page
 * that answers it, each with its own read instant. A tile never shows a zero it did not read: a failed read is « — »,
 * a partial one « N+ ». The value stays in the text colour; only the dot and the overline carry the role.
 */
export type Tile =
  | { readonly key: string; readonly overline: string; readonly href: string; readonly state: 'pending' }
  | { readonly key: string; readonly overline: string; readonly href: string; readonly state: 'failed'; readonly unavailable: string }
  | {
      readonly key: string
      readonly overline: string
      readonly href: string
      readonly state: 'ready'
      readonly value: string
      /** `neutral` at zero: nothing to do, nothing coloured. */
      readonly role: StatusRole
      readonly detail: string | null
      /** « Lecture incomplète »: the value is a count among the rows read. */
      readonly partial: boolean
      readonly readAt: number
      readonly stale: boolean
    }

export interface BandInputs {
  readonly anomalies: BlockRead<AnomalySummary>
  /** The open-anomaly page itself: its rows give the severities when it holds the whole population. */
  readonly anomalyPage: TransactionPage<AnomalyView> | undefined
  readonly loans: BlockRead<LoanSummary>
  readonly lockers: BlockRead<AdminLockerPage>
  readonly statuses: ReadonlyMap<string, UseQueryResult<LockerStatus, Error>>
  readonly operations: BlockRead<OperationSummary>
  readonly reservations: BlockRead<TransactionPage<ReservationView>>
}

type Base = { readonly key: string; readonly overline: string; readonly href: string }

function fromRead<T>(base: Base, read: BlockRead<T>, unavailable: string, ready: (value: T) => Omit<Extract<Tile, { state: 'ready' }>, keyof Base | 'state' | 'readAt' | 'stale'>): Tile {
  if (read.kind === 'pending') return { ...base, state: 'pending' }
  if (read.kind === 'failed') return { ...base, state: 'failed', unavailable }
  return { ...base, state: 'ready', ...ready(read.value), readAt: read.readAt, stale: read.stale }
}

export function bandTiles(inputs: BandInputs, i18n: I18n): readonly Tile[] {
  const { m } = i18n
  const t = m.overview
  const times = transactionTimes(i18n)
  const number = new Intl.NumberFormat(FORMAT_LOCALE[i18n.locale])

  const anomalies = fromRead({ key: 'anomalies', overline: t.anomalies, href: anomaliesHref({ filters: { ...NO_ANOMALY_FILTERS, status: 'OPEN' }, page: 0, anomalyId: null }) }, inputs.anomalies, t.tileUnavailable, ({ total }) => {
    const page = inputs.anomalyPage
    // Severities are counted only over the whole population: a part would call its own mix « the » mix.
    const detail =
      total > 0 && page !== undefined && isComplete(page)
        ? t.tileSeverity({
            high: page.items.filter((item) => item.severity === 'HIGH').length,
            medium: page.items.filter((item) => item.severity === 'MEDIUM').length,
            low: page.items.filter((item) => item.severity === 'LOW').length,
          }) || null
        : null
    return { value: total > 0 ? number.format(total) : t.tileNone, role: total > 0 ? 'anomaly' : 'neutral', detail, partial: false }
  })

  const loans = fromRead({ key: 'loans', overline: t.loans, href: transactionHref({ view: 'loans', filters: { ...NO_FILTERS, status: 'ACTIVE' } }) }, inputs.loans, t.tileUnavailable, ({ overdue, count: { n, complete } }) => {
    const oldest = overdue[0]
    return {
      value: !complete ? t.tileAtLeast({ count: n }) : n > 0 ? number.format(n) : t.tileNone,
      role: n > 0 ? 'unknown' : 'neutral',
      detail: oldest === undefined ? null : t.tileLateSince({ day: times.day(oldest.dueAt) }),
      partial: !complete,
    }
  })

  const operations = fromRead({ key: 'operations', overline: t.operations, href: transactionHref({ view: 'operations' }) }, inputs.operations, t.tileUnavailable, ({ count: { n, complete } }) => ({
    value: !complete ? t.tileAtLeast({ count: n }) : n > 0 ? number.format(n) : t.tileNone,
    role: n > 0 ? 'progress' : 'neutral',
    detail: null,
    partial: !complete,
  }))

  const reservations = fromRead(
    { key: 'reservations', overline: t.reservations, href: transactionHref({ view: 'reservations', filters: { ...NO_FILTERS, status: 'ACTIVE' } }) },
    inputs.reservations,
    t.tileUnavailable,
    ({ totalItems }) => ({ value: totalItems > 0 ? number.format(totalItems) : t.tileNone, role: totalItems > 0 ? 'info' : 'neutral', detail: null, partial: false }),
  )

  return [anomalies, loans, lockerTile(inputs, i18n), operations, reservations]
}

/** P0 has one locker: its tile, and « +N » toward Casiers when the list holds more. */
function lockerTile({ lockers, statuses }: BandInputs, i18n: I18n): Tile {
  const { m } = i18n
  const t = m.overview
  const times = transactionTimes(i18n)
  const href = pathOf('lockers')
  if (lockers.kind !== 'ready') return fromRead({ key: 'locker', overline: t.locker, href }, lockers, t.tileLockerUnavailable, () => ({ value: '', role: 'neutral', detail: null, partial: false }))
  const first = lockers.value.items[0]
  if (first === undefined) return { key: 'locker', overline: t.locker, href, state: 'ready', value: t.tileNoLocker, role: 'neutral', detail: null, partial: false, readAt: lockers.readAt, stale: lockers.stale }
  const base = { key: 'locker', overline: t.tileLocker({ code: first.code }), href }
  const query = statuses.get(first.id)
  const read: BlockRead<LockerStatus> = query === undefined ? { kind: 'pending' } : readOf(query)
  const more = lockers.value.items.length - 1
  return fromRead(base, read, t.tileLockerUnavailable, (live) => {
    const chip = connectionChip(live.connectionStatus, i18n)
    const window = windowView(live.currentWindow, i18n)
    const state =
      live.connectionStatus === 'OFFLINE'
        ? live.lastSeenAt === null
          ? m.lockers.neverSignal
          : t.tileOfflineSince({ time: times.clock(live.lastSeenAt) })
        : window.kind === 'open'
          ? t.windowOpen({ time: window.closesAt ?? '' })
          : window.kind === 'closed'
            ? window.nextOpensAt === null
              ? t.windowClosedNoNext
              : t.windowClosed({ time: window.nextOpensAt })
            : m.lockers.noSchedule
    const detail = more > 0 ? `${state} · ${t.tileMoreLockers({ count: more })}` : state
    return { value: chip.label, role: chip.role, detail, partial: false }
  })
}

/**
 * §2.2 and §2.6 criterion 3: the line under the band. `clear` only when there are no open anomalies and no overdue
 * loans, and every tile was read in full and is fresh: one failed, partial or stale read and the absence is not
 * confirmed. An offline locker shows no line (its tile says it).
 */
export type AllClear = { readonly kind: 'none' } | { readonly kind: 'clear'; readonly readAt: number } | { readonly kind: 'notConfirmed' }

export function allClearOf(anomalies: BlockRead<AnomalySummary>, loans: BlockRead<LoanSummary>, tiles: readonly Tile[], lockerOffline: boolean): AllClear {
  if (anomalies.kind === 'pending' || loans.kind === 'pending') return { kind: 'none' }
  // Something to do is shown by the band itself.
  if ((anomalies.kind === 'ready' && anomalies.value.total > 0) || (loans.kind === 'ready' && loans.value.count.n > 0)) return { kind: 'none' }
  if (tiles.some((tile) => tile.state === 'pending')) return { kind: 'none' }
  if (lockerOffline) return { kind: 'none' }
  const complete = tiles.every((tile) => tile.state === 'ready' && !tile.stale && !tile.partial)
  if (!complete || anomalies.kind !== 'ready' || loans.kind !== 'ready') return { kind: 'notConfirmed' }
  return { kind: 'clear', readAt: Math.min(...tiles.map((tile) => (tile.state === 'ready' ? tile.readAt : Infinity))) }
}
