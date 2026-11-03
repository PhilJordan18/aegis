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
}
