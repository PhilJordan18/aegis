import { vi, type Mocked } from 'vitest'
import type { AdminLockerView, AssetIdentifierView } from './contract'
import type { CustodyGateway } from './custodyGateway'

export const LOCKER_ID = 'd46a74ae-39dc-460b-8af0-38fc791b376a'
export const A1_ID = '1ae77ae3-8490-4f09-9412-a7816b77bff9'
export const A2_ID = '5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10'
export const A3_ID = '6d2e1c8f-3a5b-4e4c-8b72-1f9c8d3e5a21'

export function identifier(overrides: Partial<AssetIdentifierView> = {}): AssetIdentifierView {
  return {
    id: '2b3c4d5e-6f70-4a81-9b92-a3b4c5d6e7f8',
    assetId: 'unset',
    type: 'RFID_UHF',
    value: 'E20034120123456789000001',
    active: true,
    assignedAt: '2026-11-01T14:00:00Z',
    revokedAt: null,
    ...overrides,
  }
}

export function demoLocker(occupant: { id: string; assetCode: string } | null = null): AdminLockerView {
  return {
    id: LOCKER_ID,
    code: 'AEGIS-DEMO-01',
    name: 'Casier de démonstration',
    topology: 'HUB_CELL',
    compartments: [
      { id: A1_ID, code: 'A1', enabled: true, currentAsset: occupant },
      { id: A2_ID, code: 'A2', enabled: true, currentAsset: { id: 'other-unit', assetCode: 'MM-099' } },
      { id: A3_ID, code: 'A3', enabled: false, currentAsset: null },
    ],
  }
}

export const okResult = <T,>(value: T) => ({ kind: 'ok', value, requestId: 'req-c' }) as const

export function fakeCustodyGateway(overrides: Partial<CustodyGateway> = {}): Mocked<CustodyGateway> {
  return {
    listIdentifiers: vi.fn(overrides.listIdentifiers ?? (async () => okResult([] as AssetIdentifierView[]))),
    assignIdentifier: vi.fn(overrides.assignIdentifier ?? (async () => ({ kind: 'network', reason: 'offline' }) as const)),
    revokeIdentifier: vi.fn(overrides.revokeIdentifier ?? (async () => ({ kind: 'network', reason: 'offline' }) as const)),
    setPlacement: vi.fn(overrides.setPlacement ?? (async () => ({ kind: 'network', reason: 'offline' }) as const)),
    listLockers: vi.fn(overrides.listLockers ?? (async () => okResult({ items: [demoLocker()], page: 0, size: 100, totalItems: 1, totalPages: 1 }))),
  }
}
