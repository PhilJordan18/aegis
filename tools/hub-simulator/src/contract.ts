// MQTT contract constants, re-implemented from docs/cahier-conception/10-contrats-mqtt.md
// (payload schema 2.0, decisions D1-D7 of issue #63). Deliberately not shared with the Java API so that a divergence between the
// two readings of the contract surfaces in integration instead of being hidden.

/**
 * Doc 10 §3.2. The payload schema is versioned independently of the `v1` topic
 * segment, which versions the topic tree and the ACLs only.
 */
export const SCHEMA_VERSION = '2.0';

/** Doc 10 §8.1: bootCount is an unsigned 32-bit integer from 1, as the firmware stores it in NVS. */
export const BOOT_COUNT_MIN = 1;
export const BOOT_COUNT_MAX = 4_294_967_295;

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

/** Doc 10 §10-§13, §20 and §27.2: every type the simulated hub publishes. */
export const HUB_MESSAGE_TYPES = [
  'HEARTBEAT',
  'DEVICE_AVAILABILITY',
  'DEVICE_RESTARTED',
  'COMMAND_ACKNOWLEDGED',
  'COMMAND_REJECTED',
  'DOOR_OPENED',
  'DOOR_CLOSED',
  'LOCK_UNLOCKED',
  'LOCK_LOCKED',
  'RFID_SCAN_COMPLETED',
  'ACCESS_CHALLENGE_DISPLAYED',
  'DISPLAY_REJECTED',
] as const;
export type HubMessageType = (typeof HUB_MESSAGE_TYPES)[number];

/** Doc 10 §20: the only channel on which each implemented type is allowed. */
export const CHANNEL_BY_TYPE: Readonly<Record<HubMessageType, 'events' | 'status'>> = {
  HEARTBEAT: 'status',
  DEVICE_AVAILABILITY: 'status',
  DEVICE_RESTARTED: 'events',
  COMMAND_ACKNOWLEDGED: 'events',
  COMMAND_REJECTED: 'events',
  DOOR_OPENED: 'events',
  DOOR_CLOSED: 'events',
  LOCK_UNLOCKED: 'events',
  LOCK_LOCKED: 'events',
  RFID_SCAN_COMPLETED: 'events',
  ACCESS_CHALLENGE_DISPLAYED: 'events',
  DISPLAY_REJECTED: 'events',
};

/** Types whose payload carries the connectionId of the connection that sent it (§14, §15). */
export const CONNECTION_SCOPED_TYPES: readonly HubMessageType[] = ['HEARTBEAT', 'DEVICE_AVAILABILITY'];

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
  /** Acknowledgements, rejections, door, lock, RFID and display acknowledgements. */
  event: { qos: 1, retain: false },
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

/** Doc 10 §9 and §27: the types the backend sends to a hub. */
export const COMMAND_TYPE = 'UNLOCK_COMPARTMENT';
export const DISPLAY_TYPES = ['DISPLAY_ACCESS_CHALLENGE', 'DISPLAY_OPERATION_STATUS'] as const;
export type DisplayType = (typeof DISPLAY_TYPES)[number];

/** Doc 10 §3.2: a hub accepts any minor of the major it implements. */
export const SUPPORTED_SCHEMA_MAJOR = 2;

/** Doc 10 §10.2: the controlled COMMAND_REJECTED reasons. */
export const COMMAND_REJECT_REASONS = [
  'INVALID_PAYLOAD',
  'UNSUPPORTED_SCHEMA',
  'WRONG_LOCKER',
  'UNKNOWN_COMPARTMENT',
  'CLOCK_NOT_SYNCHRONIZED',
  'COMMAND_EXPIRED',
  'LOCAL_OPERATION_IN_PROGRESS',
  'CELL_UNREACHABLE',
  'COMPARTMENT_DISABLED',
  'DOOR_STATE_UNSAFE',
  'LOCK_ACTUATION_FAILED',
  'POWER_STATE_UNSAFE',
  'PREVIOUS_EXECUTION_UNCERTAIN',
  'INTERNAL_DEVICE_ERROR',
] as const;
export type CommandRejectReason = (typeof COMMAND_REJECT_REASONS)[number];

/** Doc 10 §10.1. */
export type AckResult = 'ACCEPTED' | 'ALREADY_APPLIED';

/** Doc 10 §10.2: `detail` is bounded and never carries a secret. */
export const DETAIL_MAX_LENGTH = 240;

/** Doc 10 §27.2: the controlled DISPLAY_REJECTED reasons. */
export const DISPLAY_REJECT_REASONS = [
  'SCREEN_UNAVAILABLE',
  'TARGET_SESSION_MISMATCH',
  'DISPLAY_EXPIRED',
  'STALE_DISPLAY_REVISION',
  'INVALID_DISPLAY_PAYLOAD',
] as const;
export type DisplayRejectReason = (typeof DISPLAY_REJECT_REASONS)[number];

/** Doc 10 §27.1 and §27.3: display actions and the longest display windows. */
export const DISPLAY_ACTIONS = ['CHECKOUT', 'RETURN'] as const;
export type DisplayAction = (typeof DISPLAY_ACTIONS)[number];
export const CHALLENGE_MAX_DISPLAY_MS = 60_000;
export const STATUS_MAX_DISPLAY_MS = 30_000;

/** Doc 10 §12.1 bounds of RFID_SCAN_COMPLETED. */
export const RFID_IDENTIFIER_TYPE = 'RFID_UHF';
export const RFID_MAX_IDENTIFIERS = 32;
export const RFID_IDENTIFIER_MAX_LENGTH = 255;
export const RFID_READ_COUNT_MAX = 65_535;
export const RFID_WINDOW_MAX_MS = 10_000;
/** Doc 10 §12.2: the checkout proof covers three seconds after the door closes. */
export const RFID_DEFAULT_WINDOW_MS = 3_000;

/** Doc 10 §16.1 retention of the command journal: at least 24 hours and 64 commands. */
export const JOURNAL_MIN_RETENTION_MS = 24 * 60 * 60 * 1000;
export const JOURNAL_MIN_ENTRIES = 64;

/**
 * Doc 10 §3.3 instant: RFC 3339 UTC with mandatory seconds, an optional 1-3 digit
 * fraction and `Z`. Returns epoch milliseconds, or undefined when invalid.
 */
export function parseInstant(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?Z$/.exec(value);
  if (!match) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return undefined;
  // Date.parse rolls 2026-02-30 over to March; a calendar-invalid instant is refused.
  const [, y, mo, d, h, mi, s] = match;
  const back = new Date(ms);
  if (
    back.getUTCFullYear() !== Number(y) ||
    back.getUTCMonth() + 1 !== Number(mo) ||
    back.getUTCDate() !== Number(d) ||
    back.getUTCHours() !== Number(h) ||
    back.getUTCMinutes() !== Number(mi) ||
    back.getUTCSeconds() !== Number(s)
  ) {
    return undefined;
  }
  return ms;
}

export function isCanonicalUuid(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_UUID.test(value);
}
