import {
  BOOT_COUNT_MAX,
  BOOT_COUNT_MIN,
  CHANNEL_BY_TYPE,
  DELIVERY,
  MAX_PAYLOAD_BYTES,
  SCHEMA_VERSION,
  formatInstant,
  topicFor,
  DETAIL_MAX_LENGTH,
  RFID_IDENTIFIER_TYPE,
  type AckResult,
  type AvailabilityReason,
  type AvailabilityStatus,
  type CellConnectionStatus,
  type CommandRejectReason,
  type DisplayRejectReason,
  type Delivery,
  type DeviceErrorCode,
  type DeviceErrorSeverity,
  type DoorState,
  type HubMessageType,
  type LockState,
  type ReaderStatus,
  type ResetReason,
} from './contract.ts';
import { isValidBootCount } from './boot-counter.ts';

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

/** Doc 10 §13.2; operationId and compartmentId are optional (§20). */
export interface DeviceErrorPayload extends HubEnvelope {
  type: 'DEVICE_ERROR';
  operationId?: string;
  compartmentId?: string;
  errorCode: DeviceErrorCode;
  severity: DeviceErrorSeverity;
  detail: string;
}

/** Doc 10 §10.1. */
export interface CommandAcknowledgedPayload extends HubEnvelope {
  type: 'COMMAND_ACKNOWLEDGED';
  commandMessageId: string;
  operationId: string;
  compartmentId: string;
  result: AckResult;
}

/** Doc 10 §10.2. */
export interface CommandRejectedPayload extends HubEnvelope {
  type: 'COMMAND_REJECTED';
  commandMessageId: string;
  operationId: string;
  compartmentId: string;
  reason: CommandRejectReason;
  detail: string;
}

/** Doc 10 §11.1; operationId is absent outside an operation (§20). */
export interface DoorEventPayload extends HubEnvelope {
  type: 'DOOR_OPENED' | 'DOOR_CLOSED';
  operationId?: string;
  compartmentId: string;
  doorState: 'OPEN' | 'CLOSED';
}

/** Doc 10 §11.2. */
export interface LockEventPayload extends HubEnvelope {
  type: 'LOCK_UNLOCKED' | 'LOCK_LOCKED';
  operationId?: string;
  compartmentId: string;
  lockState: 'UNLOCKED' | 'LOCKED';
}

export interface ObservedIdentifier {
  identifierType: typeof RFID_IDENTIFIER_TYPE;
  identifierValue: string;
  readCount: number;
}

/** Doc 10 §12.1. */
export interface RfidScanPayload extends HubEnvelope {
  type: 'RFID_SCAN_COMPLETED';
  operationId?: string;
  compartmentId: string;
  windowStartedAt: string;
  windowEndedAt: string;
  readerStatus: ReaderStatus;
  observedIdentifiers: ObservedIdentifier[];
}

/** Doc 10 §27.2; never carries the token nor a commandMessageId. */
export interface ChallengeDisplayedPayload extends HubEnvelope {
  type: 'ACCESS_CHALLENGE_DISPLAYED';
  operationId: string;
  compartmentId: string;
  displayMessageId: string;
  challengeId: string;
  displayRevision: number;
}

/** Doc 10 §27.2: same correlation as the display acknowledgement. */
export interface DisplayRejectedPayload extends HubEnvelope {
  type: 'DISPLAY_REJECTED';
  operationId: string;
  compartmentId: string;
  displayMessageId: string;
  challengeId?: string;
  displayRevision?: number;
  reason: DisplayRejectReason;
}

export type HubPayload =
  | HeartbeatPayload
  | AvailabilityPayload
  | DeviceRestartedPayload
  | DeviceErrorPayload
  | CommandAcknowledgedPayload
  | CommandRejectedPayload
  | DoorEventPayload
  | LockEventPayload
  | RfidScanPayload
  | ChallengeDisplayedPayload
  | DisplayRejectedPayload;

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
    if (!isValidBootCount(bootCount)) {
      throw new RangeError(`bootCount must be an integer from ${BOOT_COUNT_MIN} to ${BOOT_COUNT_MAX}, got ${bootCount}`);
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

export interface DeviceErrorFacts {
  readonly errorCode: DeviceErrorCode;
  readonly severity: DeviceErrorSeverity;
  readonly operationId?: string | undefined;
  readonly compartmentId?: string | undefined;
  readonly detail: string;
}

/** Doc 10 §13.2: a controlled error code, its severity and a bounded detail without secret. */
export function buildDeviceError(ctx: MessageContext, facts: DeviceErrorFacts): OutboundMessage<DeviceErrorPayload> {
  return seal(ctx.lockerId, DELIVERY.event, {
    ...envelope(ctx, 'DEVICE_ERROR'),
    ...(facts.operationId !== undefined ? { operationId: facts.operationId } : {}),
    ...(facts.compartmentId !== undefined ? { compartmentId: facts.compartmentId } : {}),
    errorCode: facts.errorCode,
    severity: facts.severity,
    detail: facts.detail.slice(0, DETAIL_MAX_LENGTH),
  });
}

/** Correlation of an acknowledgement or rejection with the command it answers (§10). */
export interface CommandCorrelation {
  readonly commandMessageId: string;
  readonly operationId: string;
  readonly compartmentId: string;
}

export function buildCommandAcknowledged(
  ctx: MessageContext,
  correlation: CommandCorrelation,
  result: AckResult,
): OutboundMessage<CommandAcknowledgedPayload> {
  return seal(ctx.lockerId, DELIVERY.event, {
    ...envelope(ctx, 'COMMAND_ACKNOWLEDGED'),
    commandMessageId: correlation.commandMessageId,
    operationId: correlation.operationId,
    compartmentId: correlation.compartmentId,
    result,
  });
}

export function buildCommandRejected(
  ctx: MessageContext,
  correlation: CommandCorrelation,
  reason: CommandRejectReason,
  detail: string,
): OutboundMessage<CommandRejectedPayload> {
  return seal(ctx.lockerId, DELIVERY.event, {
    ...envelope(ctx, 'COMMAND_REJECTED'),
    commandMessageId: correlation.commandMessageId,
    operationId: correlation.operationId,
    compartmentId: correlation.compartmentId,
    reason,
    detail: detail.slice(0, DETAIL_MAX_LENGTH),
  });
}

/** Where a physical observation happened, and the operation it belongs to, if any. */
export interface ObservationScope {
  readonly compartmentId: string;
  readonly operationId?: string | undefined;
}

function scopeFields(scope: ObservationScope): { operationId?: string; compartmentId: string } {
  return {
    ...(scope.operationId !== undefined ? { operationId: scope.operationId } : {}),
    compartmentId: scope.compartmentId,
  };
}

export function buildDoorEvent(
  ctx: MessageContext,
  scope: ObservationScope,
  doorState: 'OPEN' | 'CLOSED',
): OutboundMessage<DoorEventPayload> {
  return seal(ctx.lockerId, DELIVERY.event, {
    ...envelope(ctx, doorState === 'OPEN' ? 'DOOR_OPENED' : 'DOOR_CLOSED'),
    ...scopeFields(scope),
    doorState,
  });
}

export function buildLockEvent(
  ctx: MessageContext,
  scope: ObservationScope,
  lockState: 'UNLOCKED' | 'LOCKED',
): OutboundMessage<LockEventPayload> {
  return seal(ctx.lockerId, DELIVERY.event, {
    ...envelope(ctx, lockState === 'UNLOCKED' ? 'LOCK_UNLOCKED' : 'LOCK_LOCKED'),
    ...scopeFields(scope),
    lockState,
  });
}

export interface RfidScanFacts {
  readonly windowStartedMs: number;
  readonly windowEndedMs: number;
  readonly readerStatus: ReaderStatus;
  readonly observed: ReadonlyArray<{ readonly identifierValue: string; readonly readCount: number }>;
}

export function buildRfidScan(ctx: MessageContext, scope: ObservationScope, facts: RfidScanFacts): OutboundMessage<RfidScanPayload> {
  return seal(ctx.lockerId, DELIVERY.event, {
    ...envelope(ctx, 'RFID_SCAN_COMPLETED'),
    ...scopeFields(scope),
    windowStartedAt: formatInstant(facts.windowStartedMs),
    windowEndedAt: formatInstant(facts.windowEndedMs),
    readerStatus: facts.readerStatus,
    observedIdentifiers: facts.observed.map((o) => ({
      identifierType: RFID_IDENTIFIER_TYPE,
      identifierValue: o.identifierValue,
      readCount: o.readCount,
    })),
  });
}

/** Correlation of a display acknowledgement or rejection (§27.2). */
export interface DisplayCorrelation {
  readonly displayMessageId: string;
  readonly operationId: string;
  readonly compartmentId: string;
  readonly challengeId?: string | undefined;
  readonly displayRevision?: number | undefined;
}

export function buildChallengeDisplayed(
  ctx: MessageContext,
  correlation: DisplayCorrelation & { readonly challengeId: string; readonly displayRevision: number },
): OutboundMessage<ChallengeDisplayedPayload> {
  return seal(ctx.lockerId, DELIVERY.event, {
    ...envelope(ctx, 'ACCESS_CHALLENGE_DISPLAYED'),
    operationId: correlation.operationId,
    compartmentId: correlation.compartmentId,
    displayMessageId: correlation.displayMessageId,
    challengeId: correlation.challengeId,
    displayRevision: correlation.displayRevision,
  });
}

export function buildDisplayRejected(
  ctx: MessageContext,
  correlation: DisplayCorrelation,
  reason: DisplayRejectReason,
): OutboundMessage<DisplayRejectedPayload> {
  return seal(ctx.lockerId, DELIVERY.event, {
    ...envelope(ctx, 'DISPLAY_REJECTED'),
    operationId: correlation.operationId,
    compartmentId: correlation.compartmentId,
    displayMessageId: correlation.displayMessageId,
    ...(correlation.challengeId !== undefined ? { challengeId: correlation.challengeId } : {}),
    ...(correlation.displayRevision !== undefined ? { displayRevision: correlation.displayRevision } : {}),
    reason,
  });
}
