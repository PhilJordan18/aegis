import { lenientEnum, parsePlacement } from '../catalog/contractParsers'
import { isInstant, isUuid } from '../lockers/contractParsers'
import { LOAN_STATUSES, RESERVATION_STATUSES, type AssetSummary, type LoanView, type ReservationView, type TransactionPage } from './contract'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value !== ''
const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string'
const isInstantOrNull = (value: unknown): value is string | null => value === null || isInstant(value)
const isUuidOrNull = (value: unknown): value is string | null => value === null || isUuid(value)
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

/** §8.10: unknown values are tolerated and kept as text; the console never turns them into actions. */
function parseActions(value: unknown): readonly string[] | null {
  if (!Array.isArray(value) || !value.every(isText)) return null
  return value as string[]
}

/** §8.8 `AssetSummary`. */
export function parseAssetSummary(body: unknown): AssetSummary | null {
  if (!isRecord(body)) return null
  const { id, assetCode, model, placement } = body
  if (!isUuid(id) || !isText(assetCode)) return null
  if (!isRecord(model) || !isText(model.id) || !isText(model.name) || !isTextOrNull(model.manufacturer) || !isTextOrNull(model.modelNumber)) return null
  const parsedPlacement = parsePlacement(placement)
  if (parsedPlacement === undefined) return null
  return { id, assetCode, model: { id: model.id, name: model.name, manufacturer: model.manufacturer, modelNumber: model.modelNumber }, placement: parsedPlacement }
}

/**
 * §8.3. A structural break rejects the whole response, so the screen reports a service error instead of guessing;
 * an unknown status is tolerated per value (09 §3) and becomes UNRECOGNIZED.
 */
export function parseReservationView(body: unknown): ReservationView | null {
  if (!isRecord(body)) return null
  const { id, userId, reservedFrom, reservedUntil, createdAt, cancelledAt, fulfilledAt, expiredAt, currentOperationId } = body
  if (!isUuid(id) || !isUuid(userId) || !isInstant(reservedFrom) || !isInstant(reservedUntil) || !isInstant(createdAt)) return null
  if (!isInstantOrNull(cancelledAt) || !isInstantOrNull(fulfilledAt) || !isInstantOrNull(expiredAt) || !isUuidOrNull(currentOperationId)) return null
  const asset = parseAssetSummary(body.asset)
  const status = lenientEnum(body.status, RESERVATION_STATUSES, 'reservation.status')
  const availableActions = parseActions(body.availableActions)
  if (asset === null || status === undefined || availableActions === null) return null
  return { id, asset, userId, status, reservedFrom, reservedUntil, createdAt, cancelledAt, fulfilledAt, expiredAt, currentOperationId, availableActions }
}

/** §8.4. `overdue` is read as sent: it is never recomputed from `dueAt`. */
export function parseLoanView(body: unknown): LoanView | null {
  if (!isRecord(body)) return null
  const { id, holderUserId, checkedOutAt, dueAt, overdue, returnRequestedAt, returnedAt, checkoutOperationId, returnOperationId, currentOperationId } = body
  if (!isUuid(id) || !isUuid(holderUserId) || !isInstant(checkedOutAt) || !isInstant(dueAt) || typeof overdue !== 'boolean') return null
  if (!isInstantOrNull(returnRequestedAt) || !isInstantOrNull(returnedAt)) return null
  if (!isUuid(checkoutOperationId) || !isUuidOrNull(returnOperationId) || !isUuidOrNull(currentOperationId)) return null
  const asset = parseAssetSummary(body.asset)
  const status = lenientEnum(body.status, LOAN_STATUSES, 'loan.status')
  const availableActions = parseActions(body.availableActions)
  if (asset === null || status === undefined || availableActions === null) return null
  return {
    id,
    asset,
    holderUserId,
    status,
    checkedOutAt,
    dueAt,
    overdue,
    returnRequestedAt,
    returnedAt,
    checkoutOperationId,
    returnOperationId,
    currentOperationId,
    availableActions,
  }
}

function pageOf<T>(parseItem: (item: unknown) => T | null) {
  return (body: unknown): TransactionPage<T> | null => {
    if (!isRecord(body)) return null
    const { items, page, size, totalItems, totalPages } = body
    if (!Array.isArray(items) || !isCount(page) || !isCount(size) || !isCount(totalItems) || !isCount(totalPages)) return null
    const parsed: T[] = []
    for (const item of items) {
      const value = parseItem(item)
      if (value === null) return null
      parsed.push(value)
    }
    return { items: parsed, page, size, totalItems, totalPages }
  }
}

/** §17 list, in the §11.1 envelope. */
export const parseReservationPage = pageOf(parseReservationView)
export const parseLoanPage = pageOf(parseLoanView)
