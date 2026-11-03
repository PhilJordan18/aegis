import { UNRECOGNIZED, type Unrecognized } from '../catalog/contract'
import type {
  CompartmentConnectionStatus,
  CompartmentStatus,
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

function parseWindow(value: unknown): OperatingWindow | null {
  if (!isRecord(value)) return null
  const { timeZone, open, closesAt, nextOpensAt } = value
  if (!isTextOrNull(timeZone) || typeof open !== 'boolean' || !isTextOrNull(closesAt) || !isTextOrNull(nextOpensAt)) return null
  return { timeZone, open, closesAt, nextOpensAt }
}

function parseCompartment(value: unknown): CompartmentStatus | null {
  if (!isRecord(value)) return null
  const { id, code, enabled, connectionStatus, rfidReaderStatus, doorState, lockState, lastObservedAt } = value
  if (!isText(id) || !isText(code) || typeof enabled !== 'boolean' || !isTextOrNull(lastObservedAt)) return null
  const connection = lenientEnum(connectionStatus, COMPARTMENT_CONNECTIONS, 'compartments.connectionStatus')
  const reader = lenientEnum(rfidReaderStatus, READER_STATUSES, 'compartments.rfidReaderStatus')
  const door = lenientEnum(doorState, DOOR_STATES, 'compartments.doorState')
  const lock = lenientEnum(lockState, LOCK_STATES, 'compartments.lockState')
  if (connection === undefined || reader === undefined || door === undefined || lock === undefined) return null
  return { id, code, enabled, connectionStatus: connection, rfidReaderStatus: reader, doorState: door, lockState: lock, lastObservedAt }
}

/**
 * 09 §8.6. A structural break (a missing field, a wrong type, a boolean that is not a boolean) rejects
 * the whole response, so the screen reports a service error instead of guessing a state. An unknown
 * enumeration value does not (09 §3): see `lenientEnum`.
 */
export function parseLockerStatus(body: unknown): LockerStatus | null {
  if (!isRecord(body)) return null
  const { lockerId, code, name, topology, connectionStatus, lastSeenAt, evaluatedAt, currentWindow, compartments } = body
  if (!isText(lockerId) || !isText(code) || typeof name !== 'string' || !isTextOrNull(lastSeenAt) || !isText(evaluatedAt)) return null
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
  }
}
