import { vi } from 'vitest'
import type { GatewayResult } from '../auth/authGateway'
import type { CompartmentStatus, LockerStatus } from './contract'
import type { LockerGateway } from './lockerGateway'

export const DEMO_LOCKER_ID = 'd46a74ae-39dc-460b-8af0-38fc791b376a'
export const EVALUATED_AT = '2026-11-03T15:00:00Z'

export function compartment(overrides: Partial<CompartmentStatus> & { id: string; code: string }): CompartmentStatus {
  return {
    enabled: true,
    connectionStatus: 'CONNECTED',
    rfidReaderStatus: 'HEALTHY',
    doorState: 'CLOSED',
    lockState: 'LOCKED',
    lastObservedAt: '2026-11-03T14:59:50Z',
    ...overrides,
  }
}

export const A1 = compartment({ id: '6c0d7d3e-3b6e-4a0e-9f5d-1f6d2f0a1a01', code: 'A1' })
export const A2 = compartment({ id: '6c0d7d3e-3b6e-4a0e-9f5d-1f6d2f0a1a02', code: 'A2' })

/** Nominal: online, open until 17 h (Toronto), two healthy compartments. */
export function lockerStatus(overrides: Partial<LockerStatus> = {}): LockerStatus {
  return {
    lockerId: DEMO_LOCKER_ID,
    code: 'AEGIS-DEMO-01',
    name: 'Casier de démonstration du laboratoire',
    topology: 'HUB_CELL',
    connectionStatus: 'ONLINE',
    lastSeenAt: '2026-11-03T14:59:55Z',
    evaluatedAt: EVALUATED_AT,
    currentWindow: { timeZone: 'America/Toronto', open: true, closesAt: '2026-11-03T22:00:00Z', nextOpensAt: null },
    compartments: [A1, A2],
    ...overrides,
  }
}

/**
 * OFFLINE as the server sends it: compartments are updated only from heartbeats (PHY-01), so they keep the values
 * of the last heartbeat. Every cell still reads CONNECTED, HEALTHY, CLOSED and LOCKED above an « Hors ligne » locker,
 * and its observation is not later than the hub's last signal.
 */
export const OFFLINE = lockerStatus({
  connectionStatus: 'OFFLINE',
  lastSeenAt: '2026-11-03T14:32:00Z',
  compartments: [compartment({ ...A1, lastObservedAt: '2026-11-03T14:31:50Z' }), compartment({ ...A2, lastObservedAt: '2026-11-03T14:31:50Z' })],
})

/** Never seen: no heartbeat since provisioning. */
export const NEVER_SEEN = lockerStatus({
  connectionStatus: 'UNKNOWN',
  lastSeenAt: null,
  compartments: [
    compartment({ ...A1, connectionStatus: 'UNKNOWN', rfidReaderStatus: 'UNKNOWN', doorState: 'UNKNOWN', lockState: 'UNKNOWN', lastObservedAt: null }),
    compartment({ ...A2, connectionStatus: 'UNKNOWN', rfidReaderStatus: 'UNKNOWN', doorState: 'UNKNOWN', lockState: 'UNKNOWN', lastObservedAt: null }),
  ],
})

export const ok = <T>(value: T): GatewayResult<T> => ({ kind: 'ok', value, requestId: 'req-locker' })

type Answer = GatewayResult<LockerStatus> | (() => Promise<GatewayResult<LockerStatus>>)

/**
 * A fake gateway: answers by locker id, in order, repeating the last answer. The only method is a read,
 * so a test can assert that the screen never reached anything else.
 */
export function fakeLockerGateway(answers: Readonly<Record<string, readonly Answer[]>> = {}): LockerGateway & { getStatus: ReturnType<typeof vi.fn> } {
  const calls = new Map<string, number>()
  return {
    getStatus: vi.fn(async (_token: string, lockerId: string) => {
      const list = answers[lockerId]
      const index = calls.get(lockerId) ?? 0
      calls.set(lockerId, index + 1)
      const answer = list?.[Math.min(index, (list?.length ?? 1) - 1)]
      if (answer === undefined) return { kind: 'network', reason: 'offline' } as const
      return typeof answer === 'function' ? answer() : answer
    }),
  }
}
