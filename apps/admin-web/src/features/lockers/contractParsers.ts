import { UNRECOGNIZED, type Unrecognized } from '../catalog/contract'
import type {
  CompartmentConnectionStatus,
  CompartmentStatus,
  DeviceError,
  DeviceErrorSeverity,
  DoorState,
  LockerConnectionStatus,
  LockerStatus,
  LockerTopology,
  LockState,
  OperatingWindow,
  RfidReaderStatus,
} from './contract'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value !== ''
}

function isTextOrNull(value: unknown): value is string | null {
  return value === null || isText(value)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// RFC 3339 in UTC, as the API writes it (09 §3): fractional seconds of any length, such as `.123456Z`.
const INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?Z$/

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

/**
 * A real UTC instant. `Date` rolls an impossible date over (30 February becomes 2 March), so the calendar fields are
 * read back and compared: month 13, day 30 of February or hour 25 are rejected here, and no later formatting can throw.
 */
function isInstant(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = INSTANT.exec(value)
  if (match === null) return false
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number) as [number, number, number, number, number, number]
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  return (
    !Number.isNaN(new Date(value).getTime()) &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second
  )
}

function isInstantOrNull(value: unknown): value is string | null {
  return value === null || isInstant(value)
}

/**
 * An enumeration the client does not know (09 §3) becomes UNRECOGNIZED, which the screen shows as an
 * unavailable state: never as a known value, and never as a healthy one. The log names the field only.
 * Anything that is not a non-empty string is a structural break: undefined.
 */
function lenientEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T | Unrecognized | undefined {
  if (!isText(value)) return undefined
  if ((allowed as readonly string[]).includes(value)) return value as T
  console.warn(`Unrecognized value for ${field}: shown as an unavailable state until the client is updated`)
  return UNRECOGNIZED
}

const TOPOLOGIES: readonly LockerTopology[] = ['MONOLITHIC', 'HUB_CELL']
const LOCKER_CONNECTIONS: readonly LockerConnectionStatus[] = ['ONLINE', 'OFFLINE', 'UNKNOWN']
const COMPARTMENT_CONNECTIONS: readonly CompartmentConnectionStatus[] = ['CONNECTED', 'DISCONNECTED', 'UNKNOWN']
const READER_STATUSES: readonly RfidReaderStatus[] = ['HEALTHY', 'FAULTED', 'UNKNOWN']
const DOOR_STATES: readonly DoorState[] = ['OPEN', 'CLOSED', 'UNKNOWN']
const LOCK_STATES: readonly LockState[] = ['LOCKED', 'UNLOCKED', 'UNKNOWN']
const SEVERITIES: readonly DeviceErrorSeverity[] = ['WARNING', 'CRITICAL']

function parseWindow(value: unknown): OperatingWindow | null {
  if (!isRecord(value)) return null
  const { timeZone, open, closesAt, nextOpensAt } = value
  if (!isTextOrNull(timeZone) || typeof open !== 'boolean' || !isInstantOrNull(closesAt) || !isInstantOrNull(nextOpensAt)) return null
  return { timeZone, open, closesAt, nextOpensAt }
}

function parseCompartment(value: unknown): CompartmentStatus | null {
  if (!isRecord(value)) return null
  const { id, code, enabled, connectionStatus, rfidReaderStatus, doorState, lockState, lastObservedAt } = value
  if (!isUuid(id) || !isText(code) || typeof enabled !== 'boolean' || !isInstantOrNull(lastObservedAt)) return null
  const connection = lenientEnum(connectionStatus, COMPARTMENT_CONNECTIONS, 'compartments.connectionStatus')
  const reader = lenientEnum(rfidReaderStatus, READER_STATUSES, 'compartments.rfidReaderStatus')
  const door = lenientEnum(doorState, DOOR_STATES, 'compartments.doorState')
  const lock = lenientEnum(lockState, LOCK_STATES, 'compartments.lockState')
  if (connection === undefined || reader === undefined || door === undefined || lock === undefined) return null
  return { id, code, enabled, connectionStatus: connection, rfidReaderStatus: reader, doorState: door, lockState: lock, lastObservedAt }
}

function parseDeviceError(value: unknown): DeviceError | null {
  if (!isRecord(value)) return null
  const { errorCode, severity, compartmentId, firstReceivedAt, lastReceivedAt, occurrences } = value
  if (!isText(errorCode) || !(compartmentId === null || isUuid(compartmentId)) || !isInstant(firstReceivedAt) || !isInstant(lastReceivedAt)) return null
  if (typeof occurrences !== 'number' || !Number.isSafeInteger(occurrences) || occurrences < 1) return null
  const parsedSeverity = lenientEnum(severity, SEVERITIES, 'deviceErrors.severity')
  if (parsedSeverity === undefined) return null
  return { errorCode, severity: parsedSeverity, compartmentId, firstReceivedAt, lastReceivedAt, occurrences }
}

/**
 * 09 §8.6. A structural break (a missing field, a wrong type, a boolean that is not a boolean, an id that is not a
 * UUID, an instant that is not a UTC RFC 3339 date) rejects
 * the whole response, so the screen reports a service error instead of guessing a state. An unknown
 * enumeration value does not (09 §3): see `lenientEnum`.
 */
export function parseLockerStatus(body: unknown): LockerStatus | null {
  if (!isRecord(body)) return null
  const { lockerId, code, name, topology, connectionStatus, lastSeenAt, evaluatedAt, currentWindow, compartments, deviceErrors } = body
  if (!isUuid(lockerId) || !isText(code) || typeof name !== 'string' || !isInstantOrNull(lastSeenAt) || !isInstant(evaluatedAt)) return null
  const parsedTopology = lenientEnum(topology, TOPOLOGIES, 'topology')
  const parsedConnection = lenientEnum(connectionStatus, LOCKER_CONNECTIONS, 'connectionStatus')
  const window = parseWindow(currentWindow)
  if (parsedTopology === undefined || parsedConnection === undefined || window === null || !Array.isArray(compartments)) return null
  const parsedCompartments: CompartmentStatus[] = []
  for (const item of compartments) {
    const compartment = parseCompartment(item)
    if (compartment === null) return null
    parsedCompartments.push(compartment)
  }
  // Required since #142: an API without it is older than this client, and the list is not guessed empty.
  if (!Array.isArray(deviceErrors)) return null
  const parsedErrors: DeviceError[] = []
  for (const item of deviceErrors) {
    const error = parseDeviceError(item)
    if (error === null) return null
    parsedErrors.push(error)
  }
  return {
    lockerId,
    code,
    name,
    topology: parsedTopology,
    connectionStatus: parsedConnection,
    lastSeenAt,
    evaluatedAt,
    currentWindow: window,
    compartments: parsedCompartments,
    deviceErrors: parsedErrors,
  }
}
