import { describe, expect, it } from 'vitest';
import { CHANNEL_BY_TYPE, MAX_PAYLOAD_BYTES, SCHEMA_VERSION, formatInstant, topicFor } from '../../src/contract.ts';
import {
  DeviceSession,
  buildDeviceRestarted,
  buildHeartbeat,
  buildOffline,
  buildOnline,
  type CompartmentStatus,
  type MessageContext,
} from '../../src/messages.ts';

const LOCKER = 'd46a74ae-39dc-460b-8af0-38fc791b376a';
const SESSION = 'a36e9e94-b690-4e41-a14c-3cf8032742b0';
const CONNECTION = '7f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b';
const BOOT_COUNT = 42;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const BOOT = Date.parse('2026-09-16T13:00:00.000Z');

// Schema 2.0 field sets (doc 10 §8.1, §13.1, §14, §15; issue #63 D1-D7), copied by hand.
const ENVELOPE_KEYS = ['schemaVersion', 'messageId', 'type', 'lockerId', 'timestamp', 'deviceSessionId', 'bootCount', 'sequence'];
const HEARTBEAT_KEYS = [...ENVELOPE_KEYS, 'connectionId', 'firmwareVersion', 'uptimeSeconds', 'clockSynchronized', 'network', 'compartments'];
const COMPARTMENT_KEYS = ['compartmentId', 'cellAddress', 'connectionStatus', 'readerStatus', 'doorState', 'lockState'];
const AVAILABILITY_KEYS = [...ENVELOPE_KEYS, 'connectionId', 'status', 'reason'];
const RESTARTED_KEYS = [...ENVELOPE_KEYS, 'resetReason', 'firmwareVersion'];

const A1: CompartmentStatus = {
  compartmentId: '1ae77ae3-8490-4f09-9412-a7816b77bff9',
  cellAddress: 1,
  connectionStatus: 'CONNECTED',
  readerStatus: 'HEALTHY',
  doorState: 'CLOSED',
  lockState: 'LOCKED',
};

function context(nowMs: number, session = new DeviceSession(SESSION, BOOT_COUNT, BOOT)): MessageContext {
  return { lockerId: LOCKER, session, nowMs, newMessageId: () => crypto.randomUUID() };
}

function sorted(o: object): string[] {
  return Object.keys(o).sort();
}

function expectEnvelope(payload: Record<string, unknown>, type: string): void {
  expect(payload.schemaVersion).toBe('2.0');
  expect(payload.messageId).toMatch(UUID_V4);
  expect(payload.type).toBe(type);
  expect(payload.lockerId).toBe(LOCKER);
  expect(payload.timestamp).toMatch(INSTANT);
  expect(payload.deviceSessionId).toBe(SESSION);
  expect(payload.bootCount).toBe(BOOT_COUNT);
  expect(Number.isInteger(payload.sequence)).toBe(true);
  expect(payload.sequence as number).toBeGreaterThanOrEqual(0);
  // Doc 10 §20: none of these types carries an operation or a compartment in the envelope.
  expect(payload).not.toHaveProperty('operationId');
  expect(payload).not.toHaveProperty('compartmentId');
}

describe('HEARTBEAT (doc 10 §14)', () => {
  const now = BOOT + 4_821_400;
  const message = buildHeartbeat(context(now), {
    connectionId: CONNECTION,
    firmwareVersion: '0.1.0',
    clockSynchronized: true,
    rssiDbm: -57,
    compartments: [A1],
  });

  it('has exactly the fields of the contract example', () => {
    expect(sorted(message.payload)).toEqual([...HEARTBEAT_KEYS].sort());
    expect(sorted(message.payload.network)).toEqual(['rssiDbm']);
    expect(sorted(message.payload.compartments[0]!)).toEqual([...COMPARTMENT_KEYS].sort());
  });

  it('fills the envelope and typed facts', () => {
    expectEnvelope(message.payload as unknown as Record<string, unknown>, 'HEARTBEAT');
    expect(message.payload.timestamp).toBe('2026-09-16T14:20:21Z');
    expect(message.payload.connectionId).toBe(CONNECTION);
    expect(message.payload.uptimeSeconds).toBe(4821);
    expect(message.payload.clockSynchronized).toBe(true);
    expect(message.payload.network.rssiDbm).toBe(-57);
    expect(message.payload.compartments).toEqual([A1]);
  });

  it('is published on status with QoS 0 and no retain', () => {
    expect(message.topic).toBe(`aegis/v1/lockers/${LOCKER}/status`);
    expect(message.delivery).toEqual({ qos: 0, retain: false });
  });

  it('serializes to the exact body', () => {
    expect(JSON.parse(message.body)).toEqual(message.payload);
  });
});

describe('DEVICE_AVAILABILITY (doc 10 §15)', () => {
  it('ONLINE is retained QoS 1 on status with reason CONNECTED and its connectionId', () => {
    const m = buildOnline(context(BOOT), CONNECTION);
    expect(sorted(m.payload)).toEqual([...AVAILABILITY_KEYS].sort());
    expectEnvelope(m.payload as unknown as Record<string, unknown>, 'DEVICE_AVAILABILITY');
    expect(m.payload.status).toBe('ONLINE');
    expect(m.payload.reason).toBe('CONNECTED');
    expect(m.payload.connectionId).toBe(CONNECTION);
    expect(m.topic).toBe(`aegis/v1/lockers/${LOCKER}/status`);
    expect(m.delivery).toEqual({ qos: 1, retain: true });
  });

  it.each(['CONNECTION_LOST', 'SHUTDOWN'] as const)('OFFLINE %s is retained QoS 1 on status with its connectionId', (reason) => {
    const m = buildOffline(context(BOOT), CONNECTION, reason);
    expect(sorted(m.payload)).toEqual([...AVAILABILITY_KEYS].sort());
    expectEnvelope(m.payload as unknown as Record<string, unknown>, 'DEVICE_AVAILABILITY');
    expect(m.payload.status).toBe('OFFLINE');
    expect(m.payload.reason).toBe(reason);
    expect(m.payload.connectionId).toBe(CONNECTION);
    expect(m.topic).toBe(`aegis/v1/lockers/${LOCKER}/status`);
    expect(m.delivery).toEqual({ qos: 1, retain: true });
  });
});

describe('DEVICE_RESTARTED (doc 10 §13.1)', () => {
  it('is a QoS 1, non-retained fact on events, without connectionId', () => {
    const m = buildDeviceRestarted(context(BOOT), { resetReason: 'WATCHDOG', firmwareVersion: '0.1.0' });
    expect(sorted(m.payload)).toEqual([...RESTARTED_KEYS].sort());
    expectEnvelope(m.payload as unknown as Record<string, unknown>, 'DEVICE_RESTARTED');
    expect(m.payload.resetReason).toBe('WATCHDOG');
    expect(m.payload.firmwareVersion).toBe('0.1.0');
    expect(m.payload).not.toHaveProperty('connectionId');
    expect(m.topic).toBe(`aegis/v1/lockers/${LOCKER}/events`);
    expect(m.delivery).toEqual({ qos: 1, retain: false });
  });
});

describe('envelope rules (doc 10 §8.1, §16.3, §20)', () => {
  it('numbers the Will first, so ONLINE gets 1, and renews messageId for each fact; bootCount is constant', () => {
    const session = new DeviceSession(SESSION, BOOT_COUNT, BOOT);
    const messages = [
      buildOffline(context(BOOT, session), CONNECTION, 'CONNECTION_LOST'),
      buildOnline(context(BOOT, session), CONNECTION),
      buildDeviceRestarted(context(BOOT, session), { resetReason: 'POWER_ON', firmwareVersion: '0.1.0' }),
      buildHeartbeat(context(BOOT, session), {
        connectionId: CONNECTION,
        firmwareVersion: '0.1.0',
        clockSynchronized: true,
        rssiDbm: -50,
        compartments: [A1],
      }),
    ];
    expect(messages.map((m) => m.payload.sequence)).toEqual([0, 1, 2, 3]);
    expect(new Set(messages.map((m) => m.payload.messageId)).size).toBe(4);
    expect(new Set(messages.map((m) => m.payload.bootCount))).toEqual(new Set([BOOT_COUNT]));
  });

  it('declares schema 2.0', () => {
    expect(SCHEMA_VERSION).toBe('2.0');
  });

  it.each([0, -1, 1.5, Number.NaN, 4_294_967_296])('refuses bootCount %s', (bootCount) => {
    expect(() => new DeviceSession(SESSION, bootCount, BOOT)).toThrow('bootCount');
  });

  it('accepts the uint32 bounds of bootCount (doc 10 §8.1)', () => {
    expect(new DeviceSession(SESSION, 1, BOOT).bootCount).toBe(1);
    expect(new DeviceSession(SESSION, 4_294_967_295, BOOT).bootCount).toBe(4_294_967_295);
  });

  it('follows the §20 type/topic matrix: only heartbeat and availability on status', () => {
    expect(CHANNEL_BY_TYPE).toEqual({
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
    });
  });

  it('builds wildcard-free topics', () => {
    expect(topicFor(LOCKER, 'status')).not.toMatch(/[+#]/);
  });

  it('formats instants as RFC 3339 UTC whole seconds ending in Z (D4)', () => {
    expect(formatInstant(Date.parse('2026-09-16T14:31:10.987Z'))).toBe('2026-09-16T14:31:10Z');
    expect(formatInstant(Date.parse('2026-09-16T14:31:10.987Z'))).toMatch(INSTANT);
  });

  it('refuses a payload above 16 KiB', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({ ...A1, cellAddress: i + 1 }));
    expect(() =>
      buildHeartbeat(context(BOOT), {
        connectionId: CONNECTION,
        firmwareVersion: '0.1.0',
        clockSynchronized: true,
        rssiDbm: -50,
        compartments: many,
      }),
    ).toThrow(String(MAX_PAYLOAD_BYTES));
  });
});
