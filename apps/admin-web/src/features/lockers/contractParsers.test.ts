import { afterEach, describe, expect, it, vi } from 'vitest'
import { UNRECOGNIZED } from '../catalog/contract'
import { parseLockerStatus } from './contractParsers'
import { lockerStatus, NEVER_SEEN, OFFLINE } from './testFixtures'

/** A response body exactly as 09 §8.6 writes it: plain JSON, no TypeScript type involved. */
const wire = (): Record<string, unknown> => JSON.parse(JSON.stringify(lockerStatus()))

afterEach(() => vi.restoreAllMocks())

describe('parseLockerStatus (09 §8.6, §16.1)', () => {
  it('reads a nominal body into the same value', () => {
    expect(parseLockerStatus(wire())).toEqual(lockerStatus())
  })

  it('reads an offline body and a never-seen body, where lastSeenAt and lastObservedAt are null', () => {
    expect(parseLockerStatus(JSON.parse(JSON.stringify(OFFLINE)))).toEqual(OFFLINE)
    const parsed = parseLockerStatus(JSON.parse(JSON.stringify(NEVER_SEEN)))
    expect(parsed?.connectionStatus).toBe('UNKNOWN')
    expect(parsed?.lastSeenAt).toBeNull()
    expect(parsed?.compartments.every((compartment) => compartment.lastObservedAt === null)).toBe(true)
  })

  it('reads a locker without a schedule: closed, no zone, no instant', () => {
    const body = wire()
    body.currentWindow = { timeZone: null, open: false, closesAt: null, nextOpensAt: null }
    expect(parseLockerStatus(body)?.currentWindow).toEqual({ timeZone: null, open: false, closesAt: null, nextOpensAt: null })
  })

  it('reads a locker with no compartment', () => {
    expect(parseLockerStatus({ ...wire(), compartments: [] })?.compartments).toEqual([])
  })

  it.each([
    ['a missing lockerId', (body: Record<string, unknown>) => delete body.lockerId],
    ['a missing code', (body: Record<string, unknown>) => delete body.code],
    ['a numeric name', (body: Record<string, unknown>) => (body.name = 12)],
    ['a missing connectionStatus', (body: Record<string, unknown>) => delete body.connectionStatus],
    ['a non-string lastSeenAt', (body: Record<string, unknown>) => (body.lastSeenAt = 1730645995)],
    ['a missing lastSeenAt', (body: Record<string, unknown>) => delete body.lastSeenAt],
    ['a missing evaluatedAt', (body: Record<string, unknown>) => delete body.evaluatedAt],
    ['a missing currentWindow', (body: Record<string, unknown>) => delete body.currentWindow],
    ['a currentWindow whose open is a string', (body: Record<string, unknown>) => (body.currentWindow = { timeZone: 'America/Toronto', open: 'true', closesAt: null, nextOpensAt: null })],
    ['a currentWindow without open', (body: Record<string, unknown>) => (body.currentWindow = { timeZone: null, closesAt: null, nextOpensAt: null })],
    ['compartments that is not an array', (body: Record<string, unknown>) => (body.compartments = {})],
    ['a missing topology', (body: Record<string, unknown>) => delete body.topology],
  ])('rejects the whole body for %s', (_label, break_) => {
    const body = wire()
    break_(body)
    expect(parseLockerStatus(body)).toBeNull()
  })

  it.each([
    ['enabled is not a boolean', { enabled: 'yes' }],
    ['id is missing', { id: undefined }],
    ['doorState is missing', { doorState: undefined }],
    ['lockState is a number', { lockState: 3 }],
    ['rfidReaderStatus is empty', { rfidReaderStatus: '' }],
    ['lastObservedAt is a number', { lastObservedAt: 1 }],
  ])('rejects the whole body when a compartment %s', (_label, patch) => {
    const body = wire()
    const [first, ...rest] = body.compartments as Record<string, unknown>[]
    body.compartments = [{ ...first, ...patch }, ...rest]
    expect(parseLockerStatus(body)).toBeNull()
  })

  describe('instants and ids (nothing unparseable reaches a formatter)', () => {
    it('accepts the microseconds the live body sends', () => {
      const body = wire()
      body.lastSeenAt = '2026-11-03T14:59:55.123456Z'
      body.evaluatedAt = '2026-11-03T15:00:00.5Z'
      const [first, ...rest] = body.compartments as Record<string, unknown>[]
      body.compartments = [{ ...first, lastObservedAt: '2026-11-03T14:59:50.000001Z' }, ...rest]
      expect(parseLockerStatus(body)?.lastSeenAt).toBe('2026-11-03T14:59:55.123456Z')
    })

    it.each(['garbage', '', '2026-11-03', '2026-11-03T15:00:00', '2026-11-03T15:00:00+00:00', '2026-11-03 15:00:00Z', '2026-13-03T15:00:00Z', '2026-02-30T15:00:00Z', '2026-11-03T25:00:00Z', 1730646000])(
      'rejects %j as evaluatedAt',
      (value) => {
        expect(parseLockerStatus({ ...wire(), evaluatedAt: value })).toBeNull()
      },
    )

    it.each(['garbage', '2026-13-03T15:00:00Z', '2026-11-03T15:00:00'])('rejects %j as lastSeenAt', (value) => {
      expect(parseLockerStatus({ ...wire(), lastSeenAt: value })).toBeNull()
    })

    it.each(['garbage', '2026-13-03T15:00:00Z', '2026-11-03T15:00:00'])('rejects %j as a compartment lastObservedAt', (value) => {
      const body = wire()
      const [first, ...rest] = body.compartments as Record<string, unknown>[]
      body.compartments = [{ ...first, lastObservedAt: value }, ...rest]
      expect(parseLockerStatus(body)).toBeNull()
    })

    it.each(['garbage', 'not-a-uuid', '12345678-1234-1234-1234-12345678901', '../auth/me'])('rejects %j as lockerId and as a compartment id', (value) => {
      expect(parseLockerStatus({ ...wire(), lockerId: value })).toBeNull()
      const body = wire()
      const [first, ...rest] = body.compartments as Record<string, unknown>[]
      body.compartments = [{ ...first, id: value }, ...rest]
      expect(parseLockerStatus(body)).toBeNull()
    })

    it.each(['closesAt', 'nextOpensAt'])('rejects garbage in the window %s', (field) => {
      const body = wire()
      body.currentWindow = { timeZone: 'America/Toronto', open: true, closesAt: null, nextOpensAt: null, [field]: 'garbage' }
      expect(parseLockerStatus(body)).toBeNull()
    })
  })

  it.each([null, undefined, 'ONLINE', 42, [], [wire()]])('rejects a body that is not an object: %j', (body) => {
    expect(parseLockerStatus(body)).toBeNull()
  })

  describe('an enumeration value this client does not know (09 §3)', () => {
    it('becomes UNRECOGNIZED for the locker connection, never ONLINE, and keeps the rest', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const parsed = parseLockerStatus({ ...wire(), connectionStatus: 'DEGRADED' })
      expect(parsed?.connectionStatus).toBe(UNRECOGNIZED)
      expect(parsed?.code).toBe('AEGIS-DEMO-01')
      expect(warn).toHaveBeenCalledTimes(1)
      // The log names the field, never the server's value.
      expect(String(warn.mock.calls[0]?.[0])).not.toContain('DEGRADED')
    })

    it.each([
      ['connectionStatus', 'REBOOTING'],
      ['rfidReaderStatus', 'DEGRADED'],
      ['doorState', 'AJAR'],
      ['lockState', 'JAMMED'],
    ] as const)('becomes UNRECOGNIZED for a compartment %s', (field, value) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      const body = wire()
      const [first, ...rest] = body.compartments as Record<string, unknown>[]
      body.compartments = [{ ...first, [field]: value }, ...rest]
      const parsed = parseLockerStatus(body)
      expect(parsed?.compartments[0]?.[field]).toBe(UNRECOGNIZED)
      expect(parsed?.compartments[1]?.[field]).not.toBe(UNRECOGNIZED)
    })

    it('does not accept a value in another case as the known one', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(parseLockerStatus({ ...wire(), connectionStatus: 'online' })?.connectionStatus).toBe(UNRECOGNIZED)
    })
  })
})

describe('parseLockerStatus — deviceErrors (#29, 09 §8.6)', () => {
  const group = (overrides: Record<string, unknown> = {}) => ({
    errorCode: 'RFID_READER_FAULT',
    severity: 'CRITICAL',
    compartmentId: '6c0d7d3e-3b6e-4a0e-9f5d-1f6d2f0a1a01',
    firstReceivedAt: '2026-11-03T14:10:00Z',
    lastReceivedAt: '2026-11-03T14:50:00.123456Z',
    occurrences: 3,
    ...overrides,
  })

  it('reads the groups in the server order, a locker-level group with a null compartment included', () => {
    const body = { ...wire(), deviceErrors: [group(), group({ errorCode: 'INBOUND_MESSAGE_INVALID', severity: 'WARNING', compartmentId: null, occurrences: 1 })] }
    expect(parseLockerStatus(body)?.deviceErrors).toEqual([
      group(),
      { errorCode: 'INBOUND_MESSAGE_INVALID', severity: 'WARNING', compartmentId: null, firstReceivedAt: '2026-11-03T14:10:00Z', lastReceivedAt: '2026-11-03T14:50:00.123456Z', occurrences: 1 },
    ])
  })

  it('keeps a code it does not know as sent, and an unknown severity as unrecognized', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const parsed = parseLockerStatus({ ...wire(), deviceErrors: [group({ errorCode: 'FUTURE_FAULT', severity: 'FATAL' })] })
    expect(parsed?.deviceErrors[0]?.errorCode).toBe('FUTURE_FAULT')
    expect(parsed?.deviceErrors[0]?.severity).toBe(UNRECOGNIZED)
  })

  it.each([
    ['missing (an API older than #142)', (body: Record<string, unknown>) => delete body.deviceErrors],
    ['null', (body: Record<string, unknown>) => (body.deviceErrors = null)],
    ['an object', (body: Record<string, unknown>) => (body.deviceErrors = {})],
  ])('rejects the whole response when deviceErrors is %s', (_label, mutate) => {
    const body = wire()
    mutate(body)
    expect(parseLockerStatus(body)).toBeNull()
  })

  it.each([
    ['an empty errorCode', { errorCode: '' }],
    ['a missing severity', { severity: undefined }],
    ['a compartmentId that is not a UUID', { compartmentId: 'A1' }],
    ['a missing compartmentId', { compartmentId: undefined }],
    ['a firstReceivedAt that is not an instant', { firstReceivedAt: '2026-11-03 14:10' }],
    ['a null lastReceivedAt', { lastReceivedAt: null }],
    ['zero occurrences', { occurrences: 0 }],
    ['a fractional occurrence count', { occurrences: 1.5 }],
    ['a textual occurrence count', { occurrences: '3' }],
  ])('rejects the whole response for a group with %s', (_label, overrides) => {
    const item = JSON.parse(JSON.stringify(group(overrides)))
    expect(parseLockerStatus({ ...wire(), deviceErrors: [item] })).toBeNull()
  })
})
