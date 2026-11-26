import { useId, type MouseEvent, type ReactNode } from 'react'
import { Link } from '../../app/Link'
import { useI18n, type I18n } from '../../i18n/useI18n'
import { Button } from '../../ui/Button'
import { StatusChip } from '../../ui/StatusChip'
import { LAB_TIME_ZONE } from '../catalog/assetPresentation'
import { StaleNotice } from '../catalog/StaleNotice'
import '../pageTools/data-table.css'
import { CellName } from '../labels/Labels'
import { useLabelIndex } from '../labels/useLabelIndex'
import { TransactionAlert } from './TransactionAlert'
import type { TransactionFailure } from './transactionFailure'
import { isShownOverdue, lateChip, loanChip, operationChip, operationTypeLabel, reservationChip, transactionTimes, type TransactionTimes } from './transactionPresentation'
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
  const title = page === undefined ? { reservations: t.tabReservations, loans: t.tabLoans, operations: t.tabOperations }[view] : collectionTitle(view, page, i18n)
  // §3.3: overdue loans lead the page on screen, and the foot says so; the collection keeps the server's order.
  const late = (record: TransactionRecord) => record.kind === 'loans' && isShownOverdue(record.item)
  const ordered = view === 'loans' && !refreshing ? [...items.filter(late), ...items.filter((record) => !late(record))] : items
  const reordered = ordered.some((record, index) => record !== items[index])
  const shown = ordered

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

      {items.length > 0 && <Table view={view} records={shown} selectedId={selectedId} page={page?.page ?? 0} filters={filters} times={times} i18n={i18n} onSelect={onSelect} />}

      {page !== undefined && page.totalPages > 1 && <Pager page={page} onPage={onPage} />}
      {page !== undefined && items.length > 0 && (
        <p className="ag-list__foot">
          {t.listFoot({ time: read })}
          {reordered && <span className="ag-list__zone">{t.overdueFirst}</span>}
          <span className="ag-list__zone">{t.zoneNote({ zone: LAB_TIME_ZONE })}</span>
        </p>
      )}
    </section>
  )
}

function collectionTitle(view: TransactionView, page: TransactionRecordPage, i18n: I18n): string {
  const t = i18n.m.reservations
  // « 3 réservations » when the page holds the collection; « 20 sur 143 réservations · page 2 de 8 » otherwise.
  if (page.totalPages <= 1 && page.items.length >= page.totalItems) return { reservations: t.titleReservations, loans: t.titleLoans, operations: t.titleOperations }[view]({ count: page.totalItems })
  return t.titlePartial[view]({ shown: page.items.length, total: page.totalItems, page: page.page + 1, pages: Math.max(page.totalPages, 1) })
}

interface TableProps {
  readonly view: TransactionView
  readonly records: readonly TransactionRecord[]
  readonly selectedId: string | null
  readonly page: number
  readonly filters: TransactionFilterValues
  readonly times: TransactionTimes
  readonly i18n: I18n
  readonly onSelect: TransactionListProps['onSelect']
}

type Column = { readonly key: string; readonly label: string; readonly secondary?: boolean }

/**
 * Réservations, Prêts and Opérations as one table each (contrat-web-manager §3.3), fixed columns and no column sort:
 * the server orders the rows. The equipment cell holds the row's link; the rest of the row follows it on click. Under
 * 1024 px the CSS turns each row into a labelled block (`data-label`).
 */
function Table({ view, records, selectedId, page, filters, times, i18n, onSelect }: TableProps) {
  const t = i18n.m.reservations
  const labels = useLabelIndex()
  const columns: readonly Column[] = {
    reservations: [
      { key: 'status', label: t.colStatus },
      { key: 'asset', label: t.colAsset },
      { key: 'person', label: t.colHolder },
      { key: 'period', label: t.colPeriod },
      { key: 'attempt', label: t.colAttempt, secondary: true },
    ],
    loans: [
      { key: 'status', label: t.colStatus },
      { key: 'asset', label: t.colAsset },
      { key: 'person', label: t.colHolder },
      { key: 'checkout', label: t.colCheckout },
      { key: 'due', label: t.colDue },
    ],
    operations: [
      { key: 'status', label: t.colStatus },
      { key: 'type', label: t.colType },
      { key: 'asset', label: t.colAsset },
      { key: 'person', label: t.colUser },
      { key: 'cell', label: t.colCell },
      { key: 'created', label: t.colCreated, secondary: true },
    ],
  }[view]
  const caption = { reservations: t.tabReservations, loans: t.tabLoans, operations: t.tabOperations }[view]

  return (
    <table className="ag-list__items ag-tbl">
      <caption className="ag-sr-only">{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column.key} scope="col" className={column.secondary ? 'ag-tbl__secondary' : undefined}>
              {column.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {records.map((record) => {
          const selected = record.item.id === selectedId
          const href = transactionHref({ view: record.kind, page, selectedId: record.item.id, filters })
          const cells = cellsOf(record, { href, selected, times, i18n, onSelect, cell: (id) => <CellName compartmentId={id} label={labels.compartment(id)} /> })
          return (
            <tr
              key={record.item.id}
              className="ag-tbl__row"
              aria-current={selected ? 'true' : undefined}
              onClick={(event) => {
                // The link answers its own clicks; elsewhere the row follows it, a modified click opening a new tab.
                if ((event.target as HTMLElement).closest('a') !== null) return
                const link = event.currentTarget.querySelector<HTMLAnchorElement>('a.ag-tbl__link')
                if (link === null) return
                if (event.metaKey || event.ctrlKey || event.shiftKey) window.open(link.href, '_blank', 'noopener')
                else {
                  link.focus()
                  link.click()
                }
              }}
            >
              {columns.map((column) => (
                <td key={column.key} data-label={column.label} className={column.secondary ? 'ag-tbl__secondary' : undefined}>
                  {cells[column.key]}
                </td>
              ))}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

interface CellContext {
  readonly href: string
  readonly selected: boolean
  readonly times: TransactionTimes
  readonly i18n: I18n
  readonly onSelect: TransactionListProps['onSelect']
  readonly cell: (compartmentId: string) => ReactNode
}

function chipList(chips: readonly { role: Parameters<typeof StatusChip>[0]['role']; icon: Parameters<typeof StatusChip>[0]['icon']; label: string }[]) {
  return (
    <span className="ag-item__chips">
      {chips.map((chip) => (
        <StatusChip key={chip.label} role={chip.role} icon={chip.icon}>
          {chip.label}
        </StatusChip>
      ))}
    </span>
  )
}

function cellsOf(record: TransactionRecord, { href, selected, times, i18n, onSelect, cell }: CellContext): Record<string, ReactNode> {
  const t = i18n.m.reservations
  const asset = record.item.asset
  const link = (
    <Link className="ag-tbl__link" to={href} aria-current={selected ? 'true' : undefined} onClick={(event) => onSelect(record, event)}>
      <span className="ag-tbl__code">{asset.assetCode}</span>
      <span className="ag-tbl__sub">{asset.model.name}</span>
    </Link>
  )
  const person = record.kind === 'loans' ? record.item.holder : record.item.user
  const personText = person === null ? t.holderUnnamed : person.displayName
  switch (record.kind) {
    case 'reservations': {
      const { item } = record
      return {
        status: chipList([reservationChip(item.status, i18n)]),
        asset: link,
        person: personText,
        period: t.fromTo({ from: times.short(item.reservedFrom), to: times.clock(item.reservedUntil) }),
        attempt: item.currentOperationId === null ? t.attemptNone : t.attemptCurrent,
      }
    }
    case 'loans': {
      const { item } = record
      const overdue = isShownOverdue(item)
      return {
        status: chipList(overdue ? [loanChip(item.status, i18n), lateChip(i18n)] : [loanChip(item.status, i18n)]),
        asset: link,
        person: personText,
        checkout: times.short(item.checkedOutAt),
        due: <span className={overdue ? 'ag-item__facts--late' : undefined}>{item.returnedAt !== null ? t.returnedOn({ time: times.short(item.returnedAt) }) : overdue ? t.lateSince({ time: times.short(item.dueAt) }) : t.dueAt({ time: times.short(item.dueAt) })}</span>,
      }
    }
    case 'operations': {
      const { item } = record
      return {
        status: chipList([operationChip(item.status, i18n)]),
        type: operationTypeLabel(item.type, i18n),
        asset: link,
        person: personText,
        cell: cell(item.compartmentId),
        created: times.short(item.createdAt),
      }
    }
  }
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
