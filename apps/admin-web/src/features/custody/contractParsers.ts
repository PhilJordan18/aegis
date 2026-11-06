import type { AdminCompartmentView, AdminLockerPage, AdminLockerView, AssetIdentifierView, AssetPlacementView } from './contract'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === 'string' && value.length > 0
const isTextOrNull = (value: unknown): value is string | null => value === null || isText(value)
const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0

/** 09 §12.3 `AssetIdentifierView`. Any structural break rejects the whole response. */
export function parseAssetIdentifierView(body: unknown): AssetIdentifierView | null {
  if (!isRecord(body)) return null
  const { id, assetId, type, value, active, assignedAt, revokedAt } = body
  if (!isText(id) || !isText(assetId) || !isText(type) || !isText(value) || typeof active !== 'boolean' || !isText(assignedAt) || !isTextOrNull(revokedAt)) return null
  return { id, assetId, type, value, active, assignedAt, revokedAt }
}

/** 09 §12.3 history: a plain array, active first (the server's order is kept). */
export function parseAssetIdentifierList(body: unknown): AssetIdentifierView[] | null {
  if (!Array.isArray(body)) return null
  const parsed: AssetIdentifierView[] = []
  for (const item of body) {
    const identifier = parseAssetIdentifierView(item)
    if (identifier === null) return null
    parsed.push(identifier)
  }
  return parsed
}

/** 09 §12.4 `AssetPlacementView`. */
export function parseAssetPlacementView(body: unknown): AssetPlacementView | null {
  if (!isRecord(body)) return null
  const { id, assetId, lockerId, lockerCode, compartmentId, compartmentCode, assignedAt, reason } = body
  if (!isText(id) || !isText(assetId) || !isText(lockerId) || !isText(lockerCode) || !isText(compartmentId) || !isText(compartmentCode) || !isText(assignedAt) || !isText(reason)) return null
  return { id, assetId, lockerId, lockerCode, compartmentId, compartmentCode, assignedAt, reason }
}

function parseCompartment(body: unknown): AdminCompartmentView | null {
  if (!isRecord(body)) return null
  const { id, code, enabled, currentAsset } = body
  if (!isText(id) || !isText(code) || typeof enabled !== 'boolean') return null
  if (currentAsset === null) return { id, code, enabled, currentAsset: null }
  if (!isRecord(currentAsset) || !isText(currentAsset.id) || !isText(currentAsset.assetCode)) return null
  return { id, code, enabled, currentAsset: { id: currentAsset.id, assetCode: currentAsset.assetCode } }
}

function parseLocker(body: unknown): AdminLockerView | null {
  if (!isRecord(body)) return null
  const { id, code, name, topology, compartments } = body
  if (!isText(id) || !isText(code) || typeof name !== 'string' || !isText(topology) || !Array.isArray(compartments)) return null
  const parsed: AdminCompartmentView[] = []
  for (const item of compartments) {
    const compartment = parseCompartment(item)
    if (compartment === null) return null
    parsed.push(compartment)
  }
  return { id, code, name, topology, compartments: parsed }
}

/** 09 §16.2, in the §11.1 envelope. */
export function parseAdminLockerPage(body: unknown): AdminLockerPage | null {
  if (!isRecord(body)) return null
  const { items, page, size, totalItems, totalPages } = body
  if (!Array.isArray(items) || !isCount(page) || !isCount(size) || !isCount(totalItems) || !isCount(totalPages)) return null
  const parsed: AdminLockerView[] = []
  for (const item of items) {
    const locker = parseLocker(item)
    if (locker === null) return null
    parsed.push(locker)
  }
  return { items: parsed, page, size, totalItems, totalPages }
}
