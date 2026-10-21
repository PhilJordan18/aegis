import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineConfig } from '../../src/config.ts';
import { HubSimulator } from '../../src/simulator.ts';
import { fakeTransportFactory, type FakeTransport } from './fake-transport.ts';

const LOCKER = 'd46a74ae-39dc-460b-8af0-38fc791b376a';
const STATUS = `aegis/v1/lockers/${LOCKER}/status`;
const EVENTS = `aegis/v1/lockers/${LOCKER}/events`;

function setup(overrides: Parameters<typeof defineConfig>[0] = { password: 'test-only' }) {
  const { factory, instances } = fakeTransportFactory();
  const sim = new HubSimulator(defineConfig(overrides), { transportFactory: factory, random: () => 0.5 });
  const transport = (): FakeTransport => {
    const t = instances.at(-1);
    if (!t) throw new Error('no transport created');
    return t;
  };
  return { sim, transport, instances };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-16T14:30:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('connection setup (doc 10 §4, §7.1, §15.2)', () => {
  it('registers an OFFLINE Last Will before connecting, with the device identity', () => {
    const { sim, transport } = setup();
    sim.start();
    const t = transport();
    expect(t.options.clientId).toBe(`aegis-locker-sim-${LOCKER}`);
    expect(t.options.username).toBe(LOCKER);
    expect(t.options.password).toBe('test-only');
    expect(t.will.topic).toBe(STATUS);
    expect(t.will.delivery).toEqual({ qos: 1, retain: true });
    const will = JSON.parse(t.will.body);
    expect(will).toMatchObject({ type: 'DEVICE_AVAILABILITY', status: 'OFFLINE', reason: 'CONNECTION_LOST', sequence: 0 });
    expect(will.deviceSessionId).toBe(sim.deviceSessionId);
    expect(t.published).toHaveLength(0);
  });
});

describe('on connect (doc 10 §15.1, §13.1, §18)', () => {
  it('publishes ONLINE, DEVICE_RESTARTED, then an immediate heartbeat', async () => {
    const { sim, transport } = setup();
    sim.start();
    transport().brokerAccept();
    await vi.advanceTimersByTimeAsync(0);
    const t = transport();
    expect(t.types()).toEqual(['DEVICE_AVAILABILITY', 'DEVICE_RESTARTED', 'HEARTBEAT']);
    expect(t.published.map((p) => p.topic)).toEqual([STATUS, EVENTS, STATUS]);
    expect(t.published.map((p) => p.delivery)).toEqual([
      { qos: 1, retain: true },
      { qos: 1, retain: false },
      { qos: 0, retain: false },
    ]);
    expect(t.published[0]!.payload).toMatchObject({ status: 'ONLINE', reason: 'CONNECTED' });
    expect(t.published[1]!.payload).toMatchObject({ resetReason: 'POWER_ON', firmwareVersion: '0.1.0-sim' });
    expect(t.published.map((p) => p.payload.sequence)).toEqual([1, 2, 3]);
    expect(new Set(t.published.map((p) => p.payload.deviceSessionId))).toEqual(new Set([sim.deviceSessionId]));
    expect(sim.state).toBe('online');
  });

  it('reports both default cells A1 and A2 in the heartbeat', async () => {
    const { sim, transport } = setup();
    sim.start();
    transport().brokerAccept();
    const hb = transport().published.find((p) => p.payload.type === 'HEARTBEAT')!;
    expect(hb.payload.compartments).toEqual([
      { compartmentId: '1ae77ae3-8490-4f09-9412-a7816b77bff9', cellAddress: 1, connectionStatus: 'CONNECTED', readerStatus: 'HEALTHY', doorState: 'CLOSED', lockState: 'LOCKED' },
      { compartmentId: '5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10', cellAddress: 2, connectionStatus: 'CONNECTED', readerStatus: 'HEALTHY', doorState: 'CLOSED', lockState: 'LOCKED' },
    ]);
    expect(hb.payload.uptimeSeconds).toBe(0);
  });
});

describe('heartbeat schedule (doc 10 §14, §23.5)', () => {
  it('publishes every 10 seconds with advancing timestamp, uptime and sequence', async () => {
    const { sim, transport } = setup();
    sim.start();
    transport().brokerAccept();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(transport().types().filter((t) => t === 'HEARTBEAT')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(10_000);
    const beats = transport().published.filter((p) => p.payload.type === 'HEARTBEAT').map((p) => p.payload);
    expect(beats.map((b) => b.timestamp)).toEqual(['2026-09-16T14:30:00Z', '2026-09-16T14:30:10Z', '2026-09-16T14:30:20Z']);
    expect(beats.map((b) => b.uptimeSeconds)).toEqual([0, 10, 20]);
    expect(beats.map((b) => b.sequence)).toEqual([3, 4, 5]);
    expect(new Set(beats.map((b) => b.messageId)).size).toBe(3);
  });

  it('stops heartbeats while disconnected and never replays them', async () => {
    const { sim, transport } = setup();
    sim.start();
    transport().brokerAccept();
    transport().brokerClose();
    const before = transport().published.length;
    await vi.advanceTimersByTimeAsync(30_000);
    // Only reconnect attempts happen; nothing is published while offline.
    expect(transport().published.length).toBe(before);
  });

  it('reflects a compartment update in the next heartbeat', async () => {
    const { sim, transport } = setup();
    sim.start();
    transport().brokerAccept();
    sim.updateCompartment('A2', { connectionStatus: 'DISCONNECTED', readerStatus: 'UNKNOWN' });
    await vi.advanceTimersByTimeAsync(10_000);
    const last = transport().published.at(-1)!.payload as { compartments: Array<Record<string, unknown>> };
    expect(last.compartments[1]).toMatchObject({ cellAddress: 2, connectionStatus: 'DISCONNECTED', readerStatus: 'UNKNOWN' });
    expect(() => sim.updateCompartment('B9', { doorState: 'OPEN' })).toThrow('unknown compartment');
  });
});

describe('reconnection without reboot (doc 10 §18)', () => {
  it('re-arms a new Will, backs off, then republishes ONLINE and a heartbeat but not DEVICE_RESTARTED', async () => {
    const { sim, transport } = setup();
    sim.start();
    const t = transport();
    t.brokerAccept();
    const firstWill = JSON.parse(t.will.body);
    t.published.length = 0;

    t.brokerClose();
    const secondWill = JSON.parse(t.will.body);
    expect(secondWill.messageId).not.toBe(firstWill.messageId);
    expect(secondWill.sequence).toBeGreaterThan(firstWill.sequence);
    expect(secondWill.deviceSessionId).toBe(firstWill.deviceSessionId);
    expect(sim.state).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(999);
    expect(t.reconnects).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.reconnects).toBe(1);

    t.brokerAccept();
    expect(t.types()).toEqual(['DEVICE_AVAILABILITY', 'HEARTBEAT']);
    expect(t.published[0]!.payload.status).toBe('ONLINE');
    expect(t.published[0]!.payload.sequence as number).toBeGreaterThan(secondWill.sequence);
  });

  it('doubles the delay on consecutive failures up to 30 s and keeps the unused Will', async () => {
    const { sim, transport } = setup();
    const delays: number[] = [];
    sim.on('reconnectScheduled', (delay) => delays.push(delay));
    sim.start();
    const t = transport();
    const will = t.will.body;
    for (let i = 0; i < 7; i++) {
      t.brokerClose();
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    expect(t.will.body).toBe(will);
    t.brokerAccept();
    t.brokerClose();
    expect(delays.at(-1)).toBe(1_000);
  });
});

describe('shutdown and restart (doc 10 §13.1, §15.2)', () => {
  it('a clean stop publishes OFFLINE then sends DISCONNECT', async () => {
    const { sim, transport } = setup();
    sim.start();
    const t = transport();
    t.brokerAccept();
    await sim.stop();
    const last = t.published.at(-1)!;
    expect(last.topic).toBe(STATUS);
    expect(last.delivery).toEqual({ qos: 1, retain: true });
    expect(last.payload).toMatchObject({ type: 'DEVICE_AVAILABILITY', status: 'OFFLINE' });
    expect(t.disconnects).toBe(1);
    expect(t.destroys).toBe(0);
    const count = t.published.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.published.length).toBe(count);
    expect(sim.state).toBe('stopped');
  });

  it('a crash closes the socket without DISCONNECT and publishes nothing itself', async () => {
    const { sim, transport } = setup();
    sim.start();
    const t = transport();
    t.brokerAccept();
    const count = t.published.length;
    await sim.crash();
    expect(t.destroys).toBe(1);
    expect(t.disconnects).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.published.length).toBe(count);
    expect(t.reconnects).toBe(0);
  });

  it('a restart opens a new device session and announces DEVICE_RESTARTED again', async () => {
    const { sim, transport, instances } = setup();
    sim.start();
    transport().brokerAccept();
    const firstSession = sim.deviceSessionId;
    await sim.restart('WATCHDOG');
    expect(instances).toHaveLength(2);
    expect(sim.deviceSessionId).not.toBe(firstSession);
    const t = transport();
    expect(JSON.parse(t.will.body).sequence).toBe(0);
    t.brokerAccept();
    expect(t.types()).toEqual(['DEVICE_AVAILABILITY', 'DEVICE_RESTARTED', 'HEARTBEAT']);
    expect(t.published[1]!.payload).toMatchObject({ resetReason: 'WATCHDOG', sequence: 2, deviceSessionId: sim.deviceSessionId });
  });

  it('announces DEVICE_RESTARTED only once per boot even after several reconnections', async () => {
    const { sim, transport } = setup();
    sim.start();
    const t = transport();
    t.brokerAccept();
    for (let i = 0; i < 3; i++) {
      t.brokerClose();
      await vi.advanceTimersByTimeAsync(30_000);
      t.brokerAccept();
    }
    expect(t.types().filter((type) => type === 'DEVICE_RESTARTED')).toHaveLength(1);
    expect(t.types().filter((type) => type === 'DEVICE_AVAILABILITY')).toHaveLength(4);
  });

  it('stopping before the first connection only closes the transport', async () => {
    const { sim, transport } = setup();
    sim.start();
    await sim.stop();
    expect(transport().destroys).toBe(1);
    expect(transport().published).toHaveLength(0);
  });
});

describe('configurable identity', () => {
  it('uses another locker, device key and compartments', () => {
    const lockerId = '0b9f3c1e-6a2d-4e8f-9c7b-1d2e3f4a5b6c';
    const { sim, transport } = setup({
      password: 'test-only',
      lockerId,
      username: lockerId,
      deviceKey: 'bench-02',
      compartments: [{ code: 'B1', compartmentId: 'f3a1c2d4-5b6e-4f70-8a91-b2c3d4e5f607', cellAddress: 7 }],
    });
    sim.start();
    const t = transport();
    t.brokerAccept();
    expect(t.options.clientId).toBe('aegis-locker-bench-02');
    expect(new Set(t.published.map((p) => p.topic))).toEqual(
      new Set([`aegis/v1/lockers/${lockerId}/status`, `aegis/v1/lockers/${lockerId}/events`]),
    );
    const hb = t.published.find((p) => p.payload.type === 'HEARTBEAT')!;
    expect(hb.payload.lockerId).toBe(lockerId);
    expect(hb.payload.compartments).toEqual([expect.objectContaining({ cellAddress: 7 })]);
  });
});
