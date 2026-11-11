import { useId, type MouseEvent } from 'react'
import { Link } from '../../app/Link'
import { useI18n, type I18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { StatusChip } from '../../ui/StatusChip'
import { LAB_TIME_ZONE } from '../catalog/assetPresentation'
import { StaleNotice } from '../catalog/StaleNotice'
import { TransactionAlert } from './TransactionAlert'
import type { TransactionFailure } from './transactionFailure'
import { isShownOverdue, lateChip, loanChip, operationChip, operationTypeLabel, reservationChip, shortId, transactionTimes, type TransactionTimes } from './transactionPresentation'
import { transactionHref, type TransactionFilterValues, type TransactionView } from './transactionHref'
import type { TransactionRecord, TransactionRecordPage } from './useTransactionQueries'

interface TransactionListProps {
  readonly view: TransactionView
  readonly page: TransactionRecordPage | undefined
  readonly selectedId: string | null
  readonly filters: TransactionFilterValues
  readonly filtered: boolean
  readonly loading: boolean
  /** The shown page is the previous one, kept while the requested page loads. */
  readonly refreshing: boolean
  readonly failure: TransactionFailure | null
  /** A refresh failed but a page is still shown. */
  readonly stale: boolean
  /** A refresh is running. */
  readonly retrying: boolean
  /** When the page on screen was read. */
  readonly readAt: number
  readonly onRetry: () => void
  readonly onSelect: (record: TransactionRecord, event: MouseEvent<HTMLAnchorElement>) => void
  readonly onPage: (page: number) => void
  readonly onClearFilters: () => void
}

export function TransactionList({ view, page, selectedId, filters, filtered, loading, refreshing, failure, stale, retrying, readAt, onRetry, onSelect, onPage, onClearFilters }: TransactionListProps) {
  const i18n = useI18n()
  const { m } = i18n
  const t = m.reservations
  const titleId = useId()
  const times = transactionTimes(i18n)
  const items = page?.items ?? []
  const read = times.readAt(readAt)
  const title = page === undefined ? { reservations: t.tabReservations, loans: t.tabLoans, operations: t.tabOperations }[view] : { reservations: t.titleReservations, loans: t.titleLoans, operations: t.titleOperations }[view]({ count: page.totalItems })

  return (
    <section className="ag-panel ag-list" aria-labelledby={titleId} aria-busy={loading || refreshing || undefined}>
      <div className="ag-list__head">
        {/* Focus target when a successful refresh removes the stale notice that had focus. */}
        <h2 className="ag-list__title" id={titleId} tabIndex={-1}>
          {title}
        </h2>
        <span className="ag-list__meta">{t.listMeta}</span>
      </div>

      {failure !== null && page === undefined && (
        <div className="ag-list__alerts">
          <TransactionAlert failure={failure} onRetry={onRetry} />
        </div>
      )}
      {stale && page !== undefined && (
        <div className="ag-list__alerts">
          <StaleNotice evaluatedAt={read} retrying={retrying} onRetry={onRetry} returnFocus={() => document.getElementById(titleId)?.focus()} />
        </div>
      )}

      {loading && <LoadingRows />}

      {page !== undefined && items.length === 0 && (
        <div className="ag-list__empty">
          <p className="ag-list__empty-title">{filtered ? t.filteredEmptyTitle[view] : t.emptyTitle[view]}</p>
          <p className="ag-list__empty-body">{filtered ? t.filteredEmptyBody : t.emptyBody[view]}</p>
          {filtered && (
            <div>
              <Button variant="secondary" size="sm" onClick={onClearFilters}>
                {t.filterClear}
              </Button>
            </div>
          )}
        </div>
      )}

      {items.length > 0 && (
        <ul className="ag-list__items">
          {items.map((record) => (
            <li key={record.item.id}>
              <Row record={record} selected={record.item.id === selectedId} page={page?.page ?? 0} filters={filters} times={times} i18n={i18n} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}

      {page !== undefined && page.totalPages > 1 && <Pager page={page} onPage={onPage} />}
      {page !== undefined && items.length > 0 && (
        <p className="ag-list__foot">
          {t.listFoot({ time: read })}
          <span className="ag-list__zone">{t.zoneNote({ zone: LAB_TIME_ZONE })}</span>
        </p>
      )}
    </section>
  )
}

interface RowProps {
  readonly record: TransactionRecord
  readonly selected: boolean
  readonly page: number
  readonly filters: TransactionFilterValues
  readonly times: TransactionTimes
  readonly i18n: I18n
  readonly onSelect: TransactionListProps['onSelect']
}

function Row({ record, selected, page, filters, times, i18n, onSelect }: RowProps) {
  const t = i18n.m.reservations
  const chips: { role: Parameters<typeof StatusChip>[0]['role']; icon: Parameters<typeof StatusChip>[0]['icon']; label: string }[] = []
  let title: string
  let code: string | null = null
  let facts: string | null = null
  let holder: string
  switch (record.kind) {
    case 'reservations': {
      const { item } = record
      chips.push(reservationChip(item.status, i18n))
      title = item.asset.model.name
      code = item.asset.assetCode
      facts = t.fromTo({ from: times.short(item.reservedFrom), to: times.clock(item.reservedUntil) })
      holder = t.holderLine
      break
    }
    case 'loans': {
      const { item } = record
      chips.push(loanChip(item.status, i18n))
      const overdue = isShownOverdue(item)
      if (overdue) chips.push(lateChip(i18n))
      title = item.asset.model.name
      code = item.asset.assetCode
      facts = `${overdue ? t.lateSince({ time: times.short(item.dueAt) }) : t.dueAt({ time: times.short(item.dueAt) })} · ${t.checkout({ time: times.short(item.checkedOutAt) })}`
      holder = t.holderLine
      break
    }
    case 'operations': {
      const { item } = record
      chips.push(operationChip(item.status, i18n))
      title = operationTypeLabel(item.type, i18n)
      holder = t.userLine
      break
    }
  }
  const holderId = record.kind === 'loans' ? record.item.holderUserId : record.item.userId
  const person = record.kind === 'loans' ? record.item.holder : record.kind === 'reservations' ? record.item.user : null
  const late = record.kind === 'loans' && isShownOverdue(record.item)
  return (
    <Link
      className="ag-item"
      to={transactionHref({ view: record.kind, page, selectedId: record.item.id, filters })}
      aria-current={selected ? 'true' : undefined}
      onClick={(event) => onSelect(record, event)}
    >
      <span className="ag-item__chips">
        {chips.map((chip) => (
          <StatusChip key={chip.label} role={chip.role} icon={chip.icon}>
            {chip.label}
          </StatusChip>
        ))}
      </span>
      <span className="ag-item__title">
        {title}
        {code !== null && <span className="ag-item__code">{code}</span>}
      </span>
      {record.kind === 'operations' ? (
        <span className="ag-item__facts">
          {times.short(record.item.createdAt)} · {t.assetIdOnly} <code className="ag-id">{shortId(record.item.assetId)}</code>
        </span>
      ) : (
        <span className={late ? 'ag-item__facts ag-item__facts--late' : 'ag-item__facts'}>{facts}</span>
      )}
      <span className="ag-item__facts">
        {person === null ? holder : `${t.holderLabel} ${person.displayName}`} <code className="ag-id">{shortId(holderId)}</code>
      </span>
    </Link>
  )
}

function Pager({ page, onPage }: { readonly page: TransactionRecordPage; readonly onPage: (page: number) => void }) {
  const { m } = useI18n()
  const first = page.page <= 0
  const last = page.page >= page.totalPages - 1
  return (
    <nav className="ag-pager" aria-label={m.reservations.paginationLabel}>
      <Button variant="secondary" size="sm" inert={first} onClick={() => !first && onPage(page.page - 1)}>
        {m.reservations.previousPage}
      </Button>
      <span className="ag-pager__page">{m.reservations.pageOf({ page: page.page + 1, pages: page.totalPages })}</span>
      <Button variant="secondary" size="sm" inert={last} onClick={() => !last && onPage(page.page + 1)}>
        {m.reservations.nextPage}
      </Button>
    </nav>
  )
}

function LoadingRows() {
  return (
    <div className="ag-list__items" aria-hidden="true">
      {[0, 1, 2].map((row) => (
        <div className="ag-skel" key={row}>
          <span className="ag-skel__bar ag-skel__bar--chip" />
          <span className="ag-skel__bar ag-skel__bar--name" />
          <span className="ag-skel__bar ag-skel__bar--facts" />
        </div>
      ))}
    </div>
  )
}
