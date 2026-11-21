import { LOAN_STATUSES, LOCKER_OPERATION_STATUSES, RESERVATION_STATUSES } from './contract'

/** The three lists of the Réservations et prêts page; the address names them in French. */
export type TransactionView = 'reservations' | 'loans' | 'operations'

export const VIEW_PARAM: Readonly<Record<TransactionView, string>> = { reservations: 'reservations', loans: 'prets', operations: 'operations' }
const VIEW_OF_PARAM = new Map<string, TransactionView>(Object.entries(VIEW_PARAM).map(([view, param]) => [param, view as TransactionView]))

export const STATUSES_OF_VIEW: Readonly<Record<TransactionView, readonly string[]>> = {
  reservations: RESERVATION_STATUSES,
  loans: LOAN_STATUSES,
  operations: LOCKER_OPERATION_STATUSES,
}

/** Filters as the address holds them: a status, an equipment id, and two calendar days (`YYYY-MM-DD`, laboratory zone). */
export interface TransactionFilterValues {
  readonly status: string | null
  readonly assetId: string | null
  readonly from: string | null
  readonly to: string | null
}

export const NO_FILTERS: TransactionFilterValues = { status: null, assetId: null, from: null, to: null }

export interface TransactionLocation {
  readonly view: TransactionView
  /** Zero-based, as the API reads it. */
  readonly page: number
  readonly selectedId: string | null
  readonly filters: TransactionFilterValues
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
/** The API reads `page` as a Java int (PageQuery): a larger index is a 400, not a page past the end. */
const MAX_PAGE_INDEX = 2_147_483_647

export const isUuidText = (value: string): boolean => UUID.test(value)

/** A real calendar day, not just a shape: `2026-02-30` is not one. */
export function isCalendarDay(value: string): boolean {
  const match = DAY.exec(value)
  if (match === null) return false
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/**
 * `?vue=prets&statut=ACTIVE&equipement=<uuid>&du=2026-11-01&au=2026-11-10&page=2&dossier=<id>`. The page is one-based in the
 * address. An unusable value is ignored (it filters nothing); it is never sent to the server.
 */
export function readTransactionLocation(search: string): TransactionLocation {
  const params = new URLSearchParams(search)
  const view = VIEW_OF_PARAM.get(params.get('vue') ?? '') ?? 'reservations'
  const page = Number.parseInt(params.get('page') ?? '', 10)
  const status = params.get('statut')
  const assetId = params.get('equipement')
  const from = params.get('du')
  const to = params.get('au')
  const selected = params.get('dossier')
  return {
    view,
    page: Number.isInteger(page) && page >= 1 && page - 1 <= MAX_PAGE_INDEX ? page - 1 : 0,
    selectedId: selected !== null && UUID.test(selected) ? selected.toLowerCase() : null,
    filters: {
      status: status !== null && STATUSES_OF_VIEW[view].includes(status) ? status : null,
      assetId: assetId !== null && UUID.test(assetId) ? assetId.toLowerCase() : null,
      from: from !== null && isCalendarDay(from) ? from : null,
      to: to !== null && isCalendarDay(to) ? to : null,
    },
  }
}

export function transactionHref({ view, page = 0, selectedId = null, filters = NO_FILTERS }: { readonly view: TransactionView; readonly page?: number; readonly selectedId?: string | null; readonly filters?: TransactionFilterValues }): string {
  const params = new URLSearchParams()
  if (view !== 'reservations') params.set('vue', VIEW_PARAM[view])
  if (filters.status !== null) params.set('statut', filters.status)
  if (filters.assetId !== null) params.set('equipement', filters.assetId)
  if (filters.from !== null) params.set('du', filters.from)
  if (filters.to !== null) params.set('au', filters.to)
  if (page > 0) params.set('page', String(page + 1))
  if (selectedId !== null) params.set('dossier', selectedId)
  const query = params.toString()
  return query === '' ? '/reservations-prets' : `/reservations-prets?${query}`
}

export const hasFilters = (filters: TransactionFilterValues): boolean => Object.values(filters).some((value) => value !== null)
