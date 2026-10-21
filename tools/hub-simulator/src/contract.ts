// MQTT contract constants, re-implemented from docs/cahier-conception/10-contrats-mqtt.md
// (payload schema 2.0, decisions D1-D7 of issue #63). Deliberately not shared with the Java API so that a divergence between the
// two readings of the contract surfaces in integration instead of being hidden.

/**
 * Doc 10 §3.2. The payload schema is versioned independently of the `v1` topic
 * segment, which versions the topic tree and the ACLs only.
 */
export const SCHEMA_VERSION = '2.0';

/** Doc 10 §3.1: MQTT 3.1.1 is protocol level 4. */
export const MQTT_PROTOCOL_VERSION = 4;

/** Doc 10 §7.1. */
export const KEEPALIVE_SECONDS = 30;
export const CLEAN_SESSION = false;

/** Doc 10 §14 and §23.5: nominal heartbeat period. */
export const HEARTBEAT_INTERVAL_MS = 10_000;

/** Doc 10 §3.3. */
export const MAX_PAYLOAD_BYTES = 16 * 1024;

/** Doc 10 §18: 1 s, 2 s, 4 s, 8 s, 16 s, then at most 30 s. */
export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;

export type Channel = 'commands' | 'events' | 'status' | 'display';

/** Doc 10 §5. */
export function topicFor(lockerId: string, channel: Channel): string {
  return `aegis/v1/lockers/${lockerId}/${channel}`;
}

/** Doc 10 §4.1 recommended client identifier format. */
export function clientIdFor(deviceKey: string): string {
  return `aegis-locker-${deviceKey}`;
}

export const HUB_MESSAGE_TYPES = ['HEARTBEAT', 'DEVICE_AVAILABILITY', 'DEVICE_RESTARTED'] as const;
export type HubMessageType = (typeof HUB_MESSAGE_TYPES)[number];

/** Doc 10 §20: the only channel on which each implemented type is allowed. */
export const CHANNEL_BY_TYPE: Readonly<Record<HubMessageType, 'events' | 'status'>> = {
  HEARTBEAT: 'status',
  DEVICE_AVAILABILITY: 'status',
  DEVICE_RESTARTED: 'events',
};

export type QoS = 0 | 1;

export interface Delivery {
  readonly qos: QoS;
  readonly retain: boolean;
}

/** Doc 10 §7 table (DEVICE_RESTARTED: decision D3). */
export const DELIVERY = {
  heartbeat: { qos: 0, retain: false },
  availabilityOnline: { qos: 1, retain: true },
  availabilityOffline: { qos: 1, retain: true },
  deviceRestarted: { qos: 1, retain: false },
} as const satisfies Record<string, Delivery>;

/** Doc 03 §4.7 and §5.8-5.9, doc 08 `compartments` checks. */
export const CELL_CONNECTION_STATUSES = ['CONNECTED', 'DISCONNECTED', 'UNKNOWN'] as const;
export const READER_STATUSES = ['HEALTHY', 'FAULTED', 'UNKNOWN'] as const;
export const DOOR_STATES = ['OPEN', 'CLOSED', 'UNKNOWN'] as const;
export const LOCK_STATES = ['LOCKED', 'UNLOCKED', 'UNKNOWN'] as const;

export type CellConnectionStatus = (typeof CELL_CONNECTION_STATUSES)[number];
export type ReaderStatus = (typeof READER_STATUSES)[number];
export type DoorState = (typeof DOOR_STATES)[number];
export type LockState = (typeof LOCK_STATES)[number];

export type AvailabilityStatus = 'ONLINE' | 'OFFLINE';

/**
 * Doc 10 §15 (decision D2): CONNECTED for ONLINE, CONNECTION_LOST for the Last Will
 * the broker publishes, SHUTDOWN for the OFFLINE the hub publishes before a clean
 * DISCONNECT.
 */
export const AVAILABILITY_REASONS = ['CONNECTED', 'CONNECTION_LOST', 'SHUTDOWN'] as const;
export type AvailabilityReason = (typeof AVAILABILITY_REASONS)[number];

/** Doc 10 §13.1 (decision D1): the controlled DEVICE_RESTARTED reset causes. */
export const RESET_REASONS = [
  'POWER_ON',
  'EXTERNAL_RESET',
  'SOFTWARE_RESET',
  'WATCHDOG',
  'PANIC',
  'BROWNOUT',
  'UNKNOWN',
] as const;
export type ResetReason = (typeof RESET_REASONS)[number];

export function isResetReason(value: unknown): value is ResetReason {
  return typeof value === 'string' && (RESET_REASONS as readonly string[]).includes(value);
}

/** Doc 08 `ck_compartments_local_address`. */
export const CELL_ADDRESS_MIN = 1;
export const CELL_ADDRESS_MAX = 247;

/** Canonical lowercase UUID, doc 10 §5 rule 1. */
export const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Doc 10 §3.3 (decision D4): RFC 3339 UTC ending in `Z`. A 1-3 digit fraction is
 * allowed; the simulator emits whole seconds (for example `2026-09-16T14:31:10Z`).
 */
export function formatInstant(epochMs: number): string {
  return new Date(Math.floor(epochMs / 1000) * 1000).toISOString().replace('.000Z', 'Z');
}
