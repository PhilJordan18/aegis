/**
 * Identifiers and placement of a unit (CAT-02 #26, 09 §12.3–12.4) and the locker list that lets the Manager
 * choose a compartment without a written id (09 §16.2, approved 6 November 2026). The server decides every
 * conflict: a displayed occupancy never promises that a placement will be accepted.
 */
export const IDENTIFIER_TYPES = ['RFID_UHF', 'NFC', 'QR'] as const
export type IdentifierType = (typeof IDENTIFIER_TYPES)[number]

export interface AssetIdentifierView {
  readonly id: string
  readonly assetId: string
  /** Kept as sent: a type unknown to this client is shown as such, never dropped. */
  readonly type: string
  readonly value: string
  readonly active: boolean
  readonly assignedAt: string
  readonly revokedAt: string | null
}

/** `POST /admin/assets/{assetId}/identifiers` body; Idempotency-Key required. */
export interface AssignIdentifierRequest {
  readonly type: IdentifierType
  readonly value: string
}

export interface AssetPlacementView {
  readonly id: string
  readonly assetId: string
  readonly lockerId: string
  readonly lockerCode: string
  readonly compartmentId: string
  readonly compartmentCode: string
  readonly assignedAt: string
  readonly reason: string
}

/** `PUT /admin/assets/{assetId}/placement` body; no key, a PUT to the current compartment is a no-op. */
export interface PlacementRequest {
  readonly compartmentId: string
  readonly reason: string
}

export interface AdminCompartmentView {
  readonly id: string
  readonly code: string
  readonly enabled: boolean
  readonly currentAsset: { readonly id: string; readonly assetCode: string } | null
}

export interface AdminLockerView {
  readonly id: string
  readonly code: string
  readonly name: string
  readonly topology: string
  readonly compartments: readonly AdminCompartmentView[]
}

export interface AdminLockerPage {
  readonly items: readonly AdminLockerView[]
  readonly page: number
  readonly size: number
  readonly totalItems: number
  readonly totalPages: number
}
