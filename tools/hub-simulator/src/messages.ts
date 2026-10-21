import {
  CHANNEL_BY_TYPE,
  DELIVERY,
  MAX_PAYLOAD_BYTES,
  SCHEMA_VERSION,
  formatInstant,
  topicFor,
  type AvailabilityReason,
  type AvailabilityStatus,
  type CellConnectionStatus,
  type Delivery,
  type DoorState,
  type HubMessageType,
  type LockState,
  type ReaderStatus,
  type ResetReason,
} from './contract.ts';

/** Doc 10 §8.1 common envelope of every hub message (schema 2.0). */
export interface HubEnvelope {
  schemaVersion: string;
  messageId: string;
  type: HubMessageType;
  lockerId: string;
  timestamp: string;
  deviceSessionId: string;
  bootCount: number;
  sequence: number;
}

export interface CompartmentStatus {
  compartmentId: string;
  cellAddress: number;
  connectionStatus: CellConnectionStatus;
  readerStatus: ReaderStatus;
  doorState: DoorState;
  lockState: LockState;
}

/** Doc 10 §14. */
export interface HeartbeatPayload extends HubEnvelope {
  type: 'HEARTBEAT';
  connectionId: string;
  firmwareVersion: string;
  uptimeSeconds: number;
  clockSynchronized: boolean;
  network: { rssiDbm: number };
  compartments: CompartmentStatus[];
}

/** Doc 10 §15. */
export interface AvailabilityPayload extends HubEnvelope {
  type: 'DEVICE_AVAILABILITY';
  connectionId: string;
  status: AvailabilityStatus;
  reason: AvailabilityReason;
}

/** Doc 10 §13.1. */
export interface DeviceRestartedPayload extends HubEnvelope {
  type: 'DEVICE_RESTARTED';
  resetReason: ResetReason;
  firmwareVersion: string;
}

export type HubPayload = HeartbeatPayload | AvailabilityPayload | DeviceRestartedPayload;

export interface OutboundMessage<P extends HubPayload = HubPayload> {
  readonly topic: string;
  readonly delivery: Delivery;
  readonly payload: P;
  readonly body: string;
}

/**
 * One boot of the hub (doc 10 §8.1): a fresh deviceSessionId, the persisted
 * bootCount of this boot, and a sequence that increases for every message prepared
 * in the session, the Last Will included.
 */
export class DeviceSession {
  readonly deviceSessionId: string;
  readonly bootCount: number;
  readonly bootEpochMs: number;
  #nextSequence = 0;

  constructor(deviceSessionId: string, bootCount: number, bootEpochMs: number) {
    if (!Number.isSafeInteger(bootCount) || bootCount < 1) {
      throw new RangeError(`bootCount must be an integer >= 1, got ${bootCount}`);
    }
    this.deviceSessionId = deviceSessionId;
    this.bootCount = bootCount;
    this.bootEpochMs = bootEpochMs;
  }

  takeSequence(): number {
    return this.#nextSequence++;
  }
}

export interface MessageContext {
  readonly lockerId: string;
  readonly session: DeviceSession;
  readonly nowMs: number;
  readonly newMessageId: () => string;
}

function envelope<T extends HubMessageType>(ctx: MessageContext, type: T): HubEnvelope & { type: T } {
  return {
    schemaVersion: SCHEMA_VERSION,
    messageId: ctx.newMessageId(),
    type,
    lockerId: ctx.lockerId,
    timestamp: formatInstant(ctx.nowMs),
    deviceSessionId: ctx.session.deviceSessionId,
    bootCount: ctx.session.bootCount,
    sequence: ctx.session.takeSequence(),
  };
}

function seal<P extends HubPayload>(lockerId: string, delivery: Delivery, payload: P): OutboundMessage<P> {
  const body = JSON.stringify(payload);
  const size = Buffer.byteLength(body, 'utf8');
  if (size > MAX_PAYLOAD_BYTES) {
    throw new Error(`${payload.type} payload is ${size} bytes, above the ${MAX_PAYLOAD_BYTES}-byte contract limit`);
  }
  return { topic: topicFor(lockerId, CHANNEL_BY_TYPE[payload.type]), delivery, payload, body };
}

export interface HeartbeatFacts {
  /** The MQTT connection the heartbeat is sent on (decision D7, option A). */
  readonly connectionId: string;
  readonly firmwareVersion: string;
  readonly clockSynchronized: boolean;
  readonly rssiDbm: number;
  readonly compartments: readonly CompartmentStatus[];
}

export function buildHeartbeat(ctx: MessageContext, facts: HeartbeatFacts): OutboundMessage<HeartbeatPayload> {
  return seal(ctx.lockerId, DELIVERY.heartbeat, {
    ...envelope(ctx, 'HEARTBEAT'),
    connectionId: facts.connectionId,
    firmwareVersion: facts.firmwareVersion,
    uptimeSeconds: Math.max(0, Math.floor((ctx.nowMs - ctx.session.bootEpochMs) / 1000)),
    clockSynchronized: facts.clockSynchronized,
    network: { rssiDbm: facts.rssiDbm },
    compartments: facts.compartments.map((c) => ({ ...c })),
  });
}

export function buildOnline(ctx: MessageContext, connectionId: string): OutboundMessage<AvailabilityPayload> {
  return seal(ctx.lockerId, DELIVERY.availabilityOnline, {
    ...envelope(ctx, 'DEVICE_AVAILABILITY'),
    connectionId,
    status: 'ONLINE',
    reason: 'CONNECTED',
  });
}

/**
 * OFFLINE availability, either the Last Will registered before connecting
 * (`CONNECTION_LOST`; its timestamp and sequence are those of the preparation, doc
 * 10 §15.2) or the message the hub publishes itself before a clean DISCONNECT
 * (`SHUTDOWN`). Both carry the connectionId of the connection they close.
 */
export function buildOffline(
  ctx: MessageContext,
  connectionId: string,
  reason: Exclude<AvailabilityReason, 'CONNECTED'>,
): OutboundMessage<AvailabilityPayload> {
  return seal(ctx.lockerId, DELIVERY.availabilityOffline, {
    ...envelope(ctx, 'DEVICE_AVAILABILITY'),
    connectionId,
    status: 'OFFLINE',
    reason,
  });
}

export function buildDeviceRestarted(
  ctx: MessageContext,
  facts: { readonly resetReason: ResetReason; readonly firmwareVersion: string },
): OutboundMessage<DeviceRestartedPayload> {
  return seal(ctx.lockerId, DELIVERY.deviceRestarted, {
    ...envelope(ctx, 'DEVICE_RESTARTED'),
    resetReason: facts.resetReason,
    firmwareVersion: facts.firmwareVersion,
  });
}
