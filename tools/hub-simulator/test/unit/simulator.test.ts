import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileBootCounter, MemoryBootCounter } from '../../src/boot-counter.ts';
import { defineConfig } from '../../src/config.ts';
import { HubSimulator } from '../../src/simulator.ts';
import { fakeTransportFactory, type FakeTransport } from './fake-transport.ts';

const LOCKER = 'd46a74ae-39dc-460b-8af0-38fc791b376a';
const STATUS = `aegis/v1/lockers/${LOCKER}/status`;
const EVENTS = `aegis/v1/lockers/${LOCKER}/events`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function setup(overrides: Parameters<typeof defineConfig>[0] = { password: 'test-only' }, bootCounter = new MemoryBootCounter(6)) {
  const { factory, instances } = fakeTransportFactory();
  const sim = new HubSimulator(defineConfig(overrides), { transportFactory: factory, random: () => 0.5, bootCounter });
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
    expect(will).toMatchObject({
      schemaVersion: '2.0',
      type: 'DEVICE_AVAILABILITY',
      status: 'OFFLINE',
      reason: 'CONNECTION_LOST',
      sequence: 0,
      bootCount: 7,
    });
    expect(will.deviceSessionId).toBe(sim.deviceSessionId);
    expect(will.connectionId).toMatch(UUID);
    expect(will.connectionId).toBe(sim.connectionId);
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
    expect(t.published.map((p) => p.payload.schemaVersion)).toEqual(['2.0', '2.0', '2.0']);
    expect(t.published.map((p) => p.payload.bootCount)).toEqual([7, 7, 7]);
    expect(sim.state).toBe('online');
  });

  it("shares the Will's connectionId with ONLINE and the heartbeats, not with DEVICE_RESTARTED", async () => {
    const { sim, transport } = setup();
    sim.start();
    const t = transport();
    const connectionId = JSON.parse(t.will.body).connectionId;
    t.brokerAccept();
    await vi.advanceTimersByTimeAsync(20_000);
    const [online, restarted, ...beats] = t.published.map((p) => p.payload);
    expect(online!.connectionId).toBe(connectionId);
    expect(restarted).not.toHaveProperty('connectionId');
    expect(beats).toHaveLength(3);
    expect(beats.map((b) => b.connectionId)).toEqual([connectionId, connectionId, connectionId]);
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
    expect(secondWill.bootCount).toBe(firstWill.bootCount);
    expect(secondWill.connectionId).toMatch(UUID);
    expect(secondWill.connectionId).not.toBe(firstWill.connectionId);
    expect(sim.state).toBe('reconnecting');

    await vi.advanceTimersByTimeAsync(999);
    expect(t.reconnects).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.reconnects).toBe(1);

    t.brokerAccept();
    expect(t.types()).toEqual(['DEVICE_AVAILABILITY', 'HEARTBEAT']);
    expect(t.published[0]!.payload.status).toBe('ONLINE');
    expect(t.published[0]!.payload.sequence as number).toBeGreaterThan(secondWill.sequence);
    // The previous connection's Will is told apart from the new connection by connectionId.
    expect(t.published.map((p) => p.payload.connectionId)).toEqual([secondWill.connectionId, secondWill.connectionId]);
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
    // No CONNACK was ever received: the prepared Will and connectionId are reused.
    expect(t.will.body).toBe(will);
    t.brokerAccept();
    expect(t.published[0]!.payload.connectionId).toBe(JSON.parse(will).connectionId);
    t.brokerClose();
    expect(delays.at(-1)).toBe(1_000);
    expect(JSON.parse(t.will.body).connectionId).not.toBe(JSON.parse(will).connectionId);
  });

  it('gives every established connection a distinct connectionId and Will messageId', async () => {
    const { sim, transport } = setup();
    const wills: Array<Record<string, unknown>> = [];
    sim.on('willPrepared', (m) => wills.push(m.payload as unknown as Record<string, unknown>));
    sim.start();
    const t = transport();
    for (let i = 0; i < 3; i++) {
      t.brokerAccept();
      t.brokerClose();
      await vi.advanceTimersByTimeAsync(30_000);
    }
    t.brokerAccept();
    expect(wills).toHaveLength(4);
    expect(new Set(wills.map((w) => w.connectionId)).size).toBe(4);
    expect(new Set(wills.map((w) => w.messageId)).size).toBe(4);
    const onlines = t.published.filter((p) => p.payload.status === 'ONLINE').map((p) => p.payload.connectionId);
    expect(onlines).toEqual(wills.map((w) => w.connectionId));
    // Each Will is numbered before its own ONLINE (D6).
    const onlineSequences = t.published.filter((p) => p.payload.status === 'ONLINE').map((p) => p.payload.sequence as number);
    wills.forEach((w, i) => expect(w.sequence as number).toBeLessThan(onlineSequences[i]!));
  });
});

describe('shutdown and restart (doc 10 §13.1, §15.2)', () => {
  it('a clean stop publishes OFFLINE SHUTDOWN on the current connection, then sends DISCONNECT', async () => {
    const { sim, transport } = setup();
    sim.start();
    const t = transport();
    t.brokerAccept();
    const will = JSON.parse(t.will.body);
    const order: string[] = [];
    sim.on('sent', (m) => order.push(`sent:${m.payload.type}`));
    const disconnect = t.disconnect.bind(t);
    t.disconnect = () => {
      order.push('disconnect');
      return disconnect();
    };
    const lastSequence = t.published.at(-1)!.payload.sequence as number;
    await sim.stop();
    expect(order).toEqual(['sent:DEVICE_AVAILABILITY', 'disconnect']);
    const last = t.published.at(-1)!;
    expect(last.topic).toBe(STATUS);
    expect(last.delivery).toEqual({ qos: 1, retain: true });
    expect(last.payload).toMatchObject({
      type: 'DEVICE_AVAILABILITY',
      status: 'OFFLINE',
      reason: 'SHUTDOWN',
      connectionId: will.connectionId,
      bootCount: 7,
      sequence: lastSequence + 1,
    });
    expect(last.payload.messageId).not.toBe(will.messageId);
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

  it('a restart opens a new device session with bootCount + 1 and announces DEVICE_RESTARTED again', async () => {
    const { sim, transport, instances } = setup();
    sim.start();
    transport().brokerAccept();
    const firstSession = sim.deviceSessionId;
    const firstConnection = sim.connectionId;
    expect(sim.bootCount).toBe(7);
    await sim.restart('WATCHDOG');
    expect(instances).toHaveLength(2);
    expect(sim.deviceSessionId).not.toBe(firstSession);
    expect(sim.bootCount).toBe(8);
    expect(sim.connectionId).not.toBe(firstConnection);
    const t = transport();
    expect(JSON.parse(t.will.body)).toMatchObject({ sequence: 0, bootCount: 8 });
    t.brokerAccept();
    expect(t.types()).toEqual(['DEVICE_AVAILABILITY', 'DEVICE_RESTARTED', 'HEARTBEAT']);
    expect(t.published[1]!.payload).toMatchObject({
      resetReason: 'WATCHDOG',
      sequence: 2,
      bootCount: 8,
      deviceSessionId: sim.deviceSessionId,
    });
    expect(t.published.map((p) => p.payload.bootCount)).toEqual([8, 8, 8]);
  });

  it('keeps bootCount constant across reconnections of one boot', async () => {
    const { sim, transport } = setup();
    sim.start();
    const t = transport();
    t.brokerAccept();
    t.brokerClose();
    await vi.advanceTimersByTimeAsync(30_000);
    t.brokerAccept();
    expect(new Set(t.published.map((p) => p.payload.bootCount))).toEqual(new Set([7]));
    expect(JSON.parse(t.will.body).bootCount).toBe(7);
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

describe('bootCount persistence (doc 10 §8.1, NVS equivalent)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aegis-sim-boot-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function fileSim(file: string, firstBootCount?: number, deviceKey = 'unit-bench') {
    const { factory, instances } = fakeTransportFactory();
    const config = defineConfig({
      password: 'test-only',
      deviceKey,
      bootCountFile: file,
      ...(firstBootCount !== undefined ? { firstBootCount } : {}),
    });
    const sim = new HubSimulator(config, { transportFactory: factory, random: () => 0.5 });
    return { sim, instances };
  }

  it('never reuses a count across simulator instances, and restart() increments it', async () => {
    const file = join(dir, 'state', 'boot-counts.json');
    const first = fileSim(file);
    first.sim.start();
    expect(first.sim.bootCount).toBe(1);
    first.instances[0]!.brokerAccept();
    await first.sim.restart();
    expect(first.sim.bootCount).toBe(2);
    await first.sim.crash();

    const second = fileSim(file);
    second.sim.start();
    expect(second.sim.bootCount).toBe(3);
    expect(JSON.parse(second.instances[0]!.will.body).bootCount).toBe(3);
    await second.sim.stop();
    second.sim.start();
    expect(second.sim.bootCount).toBe(4);
    await second.sim.crash();
  });

  it('keeps one count per deviceKey', async () => {
    const file = join(dir, 'boot-counts.json');
    const a = fileSim(file, undefined, 'bench-a');
    a.sim.start();
    await a.sim.restart();
    const b = fileSim(file, undefined, 'bench-b');
    b.sim.start();
    expect([a.sim.bootCount, b.sim.bootCount]).toEqual([2, 1]);
    await a.sim.crash();
    await b.sim.crash();
  });

  it('lets the first boot count be overridden once, then continues from it', async () => {
    const file = join(dir, 'boot-counts.json');
    const sim = fileSim(file, 40).sim;
    sim.start();
    expect(sim.bootCount).toBe(40);
    await sim.restart();
    expect(sim.bootCount).toBe(41);
    await sim.crash();
    const next = fileSim(file).sim;
    next.start();
    expect(next.bootCount).toBe(42);
    await next.crash();
  });

  it('refuses a malformed state file instead of restarting at 1', async () => {
    const { writeFileSync } = await import('node:fs');
    const file = join(dir, 'boot-counts.json');
    writeFileSync(file, '{"version":1,"bootCounts":{"unit-bench":"seven"}}');
    expect(() => fileSim(file).sim.start()).toThrow('invalid count');
    writeFileSync(file, 'not json');
    expect(() => fileSim(file).sim.start()).toThrow('not valid JSON');
  });

  it('rejects an invalid first boot count', () => {
    expect(() => new FileBootCounter(join(dir, 'x.json'), 'k', 0)).toThrow('from 1 to 4294967295');
    expect(() => new FileBootCounter(join(dir, 'x.json'), 'k', 4_294_967_296)).toThrow('from 1 to 4294967295');
    expect(() => defineConfig({ password: 'x', firstBootCount: 0 })).toThrow('bootCount');
    expect(() => defineConfig({ password: 'x', bootCountFile: 'relative.json' })).toThrow('absolute');
  });
});

describe('replay of an emitted message (late or duplicate delivery)', () => {
  it("republishes the previous connection's Will verbatim after a reconnection", async () => {
    const { sim, transport } = setup();
    sim.start();
    const t = transport();
    const oldWill = t.will;
    t.brokerAccept();
    t.brokerClose();
    await vi.advanceTimersByTimeAsync(1_000);
    t.brokerAccept();
    const replayed: string[] = [];
    sim.on('replayed', (m) => replayed.push(m.body));
    await sim.replay({ type: 'DEVICE_AVAILABILITY', reason: 'CONNECTION_LOST', connectionsAgo: 1 });
    const last = t.published.at(-1)!;
    expect(last.body).toBe(oldWill.body);
    expect(last.topic).toBe(oldWill.topic);
    expect(last.delivery).toEqual(oldWill.delivery);
    expect(replayed).toEqual([oldWill.body]);
    expect(last.payload.connectionId).not.toBe(sim.connectionId);
  });

  it("republishes a previous boot's DEVICE_RESTARTED and a closed connection's last heartbeat", async () => {
    const { sim, transport } = setup();
    sim.start();
    transport().brokerAccept();
    await vi.advanceTimersByTimeAsync(10_000);
    const firstBoot = transport().published;
    const oldRestart = firstBoot.find((p) => p.payload.type === 'DEVICE_RESTARTED')!;
    const oldBeat = firstBoot.filter((p) => p.payload.type === 'HEARTBEAT').at(-1)!;
    await sim.restart('SOFTWARE_RESET');
    const t = transport();
    t.brokerAccept();
    await sim.replay({ type: 'DEVICE_RESTARTED', bootsAgo: 1 });
    await sim.replay({ type: 'HEARTBEAT', connectionsAgo: 1 });
    const [restart, beat] = t.published.slice(-2);
    expect(restart!.body).toBe(oldRestart.body);
    expect(restart!.delivery).toEqual({ qos: 1, retain: false });
    expect(beat!.body).toBe(oldBeat.body);
    expect(beat!.payload.bootCount).toBe(7);
    expect(sim.bootCount).toBe(8);
  });

  it('replays the latest heartbeat as a duplicate with the same messageId', async () => {
    const { sim, transport } = setup();
    sim.start();
    const t = transport();
    t.brokerAccept();
    const beat = t.published.at(-1)!;
    await sim.replay({ type: 'HEARTBEAT' });
    expect(t.published.at(-1)!.body).toBe(beat.body);
    expect(t.published.filter((p) => p.payload.messageId === beat.payload.messageId)).toHaveLength(2);
  });

  it('fails when nothing matches or the hub is offline', async () => {
    const { sim, transport } = setup();
    sim.start();
    await expect(sim.replay({ type: 'HEARTBEAT' })).rejects.toThrow('cannot replay from state connecting');
    transport().brokerAccept();
    await expect(sim.replay({ type: 'DEVICE_RESTARTED', bootsAgo: 1 })).rejects.toThrow('no emitted message matches');
    await expect(sim.replay({ type: 'DEVICE_AVAILABILITY', reason: 'SHUTDOWN' })).rejects.toThrow('no emitted message');
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
