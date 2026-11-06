import type { Unrecognized } from '../catalog/contract'

/**
 * Locker status contract mirrored from docs/cahier-conception/09-contrats-rest.md:
 * §8.6 `LockerStatusView` and `OperatingWindowView`, §16.1 `GET /lockers/{lockerId}/status`.
 * Read-only: the schedule and every command route are not consumed by this slice. The server
 * evaluates ONLINE, OFFLINE and UNKNOWN at read time (§16.1, 10 §15.3); the client never derives
 * a connection state from a timestamp.
 */

export type LockerTopology = 'MONOLITHIC' | 'HUB_CELL'
export type LockerConnectionStatus = 'ONLINE' | 'OFFLINE' | 'UNKNOWN'
export type CompartmentConnectionStatus = 'CONNECTED' | 'DISCONNECTED' | 'UNKNOWN'
export type RfidReaderStatus = 'HEALTHY' | 'FAULTED' | 'UNKNOWN'
export type DoorState = 'OPEN' | 'CLOSED' | 'UNKNOWN'
export type LockState = 'LOCKED' | 'UNLOCKED' | 'UNKNOWN'

/** §8.6 `OperatingWindowView`, computed by the server at `LockerStatusView.evaluatedAt`. */
export interface OperatingWindow {
  /** IANA identifier; null when the locker has no usable schedule. */
  readonly timeZone: string | null
  readonly open: boolean
  /** RFC 3339 UTC instant; set only while the window is open. */
  readonly closesAt: string | null
  /** RFC 3339 UTC instant; set only while the window is closed and a schedule exists. */
  readonly nextOpensAt: string | null
}

export interface CompartmentStatus {
  readonly id: string
  readonly code: string
  readonly enabled: boolean
  readonly connectionStatus: CompartmentConnectionStatus | Unrecognized
  readonly rfidReaderStatus: RfidReaderStatus | Unrecognized
  readonly doorState: DoorState | Unrecognized
  readonly lockState: LockState | Unrecognized
  readonly lastObservedAt: string | null
}

/** §8.6 `DeviceErrorView`: one group of `DEVICE_ERROR` reports (10 §13.2) of the hub's current session, per (`errorCode`, `compartmentId`). */
export type DeviceErrorSeverity = 'WARNING' | 'CRITICAL'

export interface DeviceError {
  /** A code of 10 §13.2; a code this client does not know is still shown, as sent. */
  readonly errorCode: string
  readonly severity: DeviceErrorSeverity | Unrecognized
  /** A compartment of this locker, or null for the locker itself. */
  readonly compartmentId: string | null
  /** Backend reception instants, never the hub's clock. */
  readonly firstReceivedAt: string
  readonly lastReceivedAt: string
  readonly occurrences: number
}

/** The server sends at most this many groups (§8.6), the least urgent omitted. */
export const DEVICE_ERRORS_LIMIT = 20

export interface LockerStatus {
  readonly lockerId: string
  readonly code: string
  readonly name: string
  readonly topology: LockerTopology | Unrecognized
  readonly connectionStatus: LockerConnectionStatus | Unrecognized
  /** Technical instant of the last valid heartbeat; null when none was ever received. */
  readonly lastSeenAt: string | null
  /** Technical instant at which the server evaluated this view. */
  readonly evaluatedAt: string
  readonly currentWindow: OperatingWindow
  readonly compartments: readonly CompartmentStatus[]
  /**
   * Errors the hub reported in its current session, in the server's order (#29, §8.6). A reported error is not proof of
   * an active fault: it changes no connection state, compartment state, readiness or action.
   */
  readonly deviceErrors: readonly DeviceError[]
}
