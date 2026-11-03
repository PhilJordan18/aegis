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
