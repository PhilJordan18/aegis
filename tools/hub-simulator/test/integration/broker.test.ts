// Runs against the local Mosquitto of infra/docker/compose.yaml. Credentials come from
// the environment, e.g. `set -a; . ../../infra/docker/.env.example; set +a`.
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import mqtt, { type MqttClient } from 'mqtt';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LOCKER_ID, defineConfig } from '../../src/config.ts';
import { HubSimulator } from '../../src/simulator.ts';

const BROKER = process.env.AEGIS_MQTT_URL ?? 'mqtt://127.0.0.1:1883';
const DEVICE_PASSWORD = process.env.AEGIS_MQTT_DEVICE_PASSWORD;
const API_PASSWORD = process.env.AEGIS_MQTT_API_PASSWORD;
const STATUS = `aegis/v1/lockers/${DEFAULT_LOCKER_ID}/status`;
const EVENTS = `aegis/v1/lockers/${DEFAULT_LOCKER_ID}/events`;
const STATUS_FACTS = new Set(['DEVICE_AVAILABILITY', 'DEVICE_RESTARTED', 'HEARTBEAT']);
const CLI = fileURLToPath(new URL('../../src/cli.ts', import.meta.url));

interface Received {
  topic: string;
  body: string;
  payload: Record<string, unknown>;
  qos: number;
  retain: boolean;
  atMs: number;
}

/** Subscribes as the backend identity (aegis_api), which may only read events and status. */
async function observe(): Promise<{ client: MqttClient; live: Received[]; retained: Received[] }> {
  const client = await mqtt.connectAsync(BROKER, {
    protocolVersion: 4,
    clientId: `aegis-sim-it-${process.pid}-${Math.random().toString(16).slice(2, 8)}`,
    username: 'aegis_api',
    password: API_PASSWORD!,
    clean: true,
    reconnectPeriod: 0,
  });
  const live: Received[] = [];
  const retained: Received[] = [];
  client.on('message', (topic, body, packet) => {
    const record = {
      topic,
      body: body.toString('utf8'),
      payload: JSON.parse(body.toString('utf8')) as Record<string, unknown>,
      qos: packet.qos,
      retain: packet.retain,
      atMs: Date.now(),
    };
    (packet.retain ? retained : live).push(record);
  });
  await client.subscribeAsync([STATUS, EVENTS], { qos: 1 });
  return { client, live, retained };
}

async function until<T>(probe: () => T | undefined, timeoutMs: number, what: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

const clients: MqttClient[] = [];
const children: ChildProcess[] = [];
// Boot counts of these runs live in a throwaway directory, never in the user's state.
const stateDir = mkdtempSync(join(tmpdir(), 'aegis-sim-it-'));

afterAll(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

afterEach(async () => {
  for (const child of children.splice(0)) if (child.exitCode === null) child.kill('SIGKILL');
  await Promise.all(clients.splice(0).map((c) => c.endAsync()));
});

describe.skipIf(!DEVICE_PASSWORD || !API_PASSWORD)('against the local broker', () => {
  it('CLI: ONLINE, DEVICE_RESTARTED, heartbeats every 10 s, then OFFLINE Last Will on SIGKILL', { timeout: 60_000 }, async () => {
    const observer = await observe();
    clients.push(observer.client);

    const child = spawn(process.execPath, [CLI], {
      env: {
        PATH: process.env.PATH,
        AEGIS_MQTT_URL: BROKER,
        AEGIS_MQTT_DEVICE_PASSWORD: DEVICE_PASSWORD,
        AEGIS_SIM_BOOT_COUNT_FILE: join(stateDir, 'cli-boot-counts.json'),
        AEGIS_SIM_COMMAND_JOURNAL_FILE: join(stateDir, 'cli-journal.json'),
      },
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    children.push(child);
    const logs: Array<Record<string, unknown>> = [];
    createInterface({ input: child.stdout! }).on('line', (line) => logs.push(JSON.parse(line)));

    const will = await until(() => logs.find((l) => l.event === 'will_prepared'), 5_000, 'Will preparation');
    const session = will.deviceSessionId as string;
    const mine = () => observer.live.filter((m) => m.payload.deviceSessionId === session);

    await until(() => (mine().filter((m) => m.payload.type === 'HEARTBEAT').length >= 3 ? true : undefined), 30_000, 'three heartbeats');

    const sequence = mine();
    const online = sequence.find((m) => m.payload.type === 'DEVICE_AVAILABILITY')!;
    const restarted = sequence.find((m) => m.payload.type === 'DEVICE_RESTARTED')!;
    const beats = sequence.filter((m) => m.payload.type === 'HEARTBEAT');

    expect(online).toMatchObject({ topic: STATUS, qos: 1, payload: { status: 'ONLINE', reason: 'CONNECTED', schemaVersion: '2.0' } });
    expect(sequence.every((m) => m.payload.schemaVersion === '2.0' && m.payload.bootCount === 1)).toBe(true);
    expect(will.bootCount).toBe(1);
    const connectionId = will.connectionId as string;
    expect(online.payload.connectionId).toBe(connectionId);
    expect(beats.every((b) => b.payload.connectionId === connectionId)).toBe(true);
    expect(restarted).toMatchObject({ topic: EVENTS, qos: 1, payload: { resetReason: 'POWER_ON', firmwareVersion: '0.1.0-sim' } });
    expect(beats.every((b) => b.topic === STATUS && b.qos === 0)).toBe(true);
    expect(sequence.slice(0, 3).map((m) => m.payload.type)).toEqual(['DEVICE_AVAILABILITY', 'DEVICE_RESTARTED', 'HEARTBEAT']);
    expect(sequence.map((m) => m.payload.sequence)).toEqual(sequence.map((_, i) => i + 1));
    for (let i = 1; i < beats.length; i++) {
      const gap = beats[i]!.atMs - beats[i - 1]!.atMs;
      expect(gap).toBeGreaterThan(9_500);
      expect(gap).toBeLessThan(10_500);
    }

    // A new subscriber sees the retained ONLINE of this session.
    const lateComer = await observe();
    clients.push(lateComer.client);
    const retainedOnline = await until(() => lateComer.retained.find((m) => m.topic === STATUS), 3_000, 'retained ONLINE');
    expect(retainedOnline).toMatchObject({ retain: true, payload: { status: 'ONLINE', deviceSessionId: session } });

    child.kill('SIGKILL');
    await once(child, 'exit');

    const offline = await until(
      () => observer.live.find((m) => m.payload.status === 'OFFLINE' && m.payload.deviceSessionId === session),
      5_000,
      'Last Will OFFLINE',
    );
    expect(offline).toMatchObject({
      topic: STATUS,
      qos: 1,
      payload: {
        type: 'DEVICE_AVAILABILITY',
        reason: 'CONNECTION_LOST',
        messageId: will.messageId,
        sequence: 0,
        bootCount: 1,
        connectionId,
      },
    });

    const afterDeath = await observe();
    clients.push(afterDeath.client);
    const retainedOffline = await until(() => afterDeath.retained.find((m) => m.topic === STATUS), 3_000, 'retained OFFLINE');
    expect(retainedOffline).toMatchObject({ retain: true, payload: { status: 'OFFLINE', messageId: will.messageId } });
  });

  it('API: a network loss fires the Will, then the same session reconnects without DEVICE_RESTARTED', { timeout: 30_000 }, async () => {
    const observer = await observe();
    clients.push(observer.client);
    const sim = new HubSimulator(
      defineConfig({
        brokerUrl: BROKER,
        password: DEVICE_PASSWORD!,
        bootCountFile: join(stateDir, 'api-loss.json'),
        commandJournalFile: join(stateDir, 'api-loss-journal.json'),
      }),
    );
    const wills: string[] = [];
    const willConnections: string[] = [];
    sim.on('willPrepared', (m) => {
      wills.push(m.payload.messageId);
      if (m.payload.type === 'DEVICE_AVAILABILITY') willConnections.push(m.payload.connectionId);
    });
    try {
      sim.start();
      await sim.waitUntilOnline(5_000);
      const session = sim.deviceSessionId;
      // Status facts only: a persistent session may hand this hub commands queued by
      // other runs, whose answers are not the subject here.
      const mine = () =>
        observer.live.filter((m) => m.payload.deviceSessionId === session && STATUS_FACTS.has(String(m.payload.type)));
      await until(() => (mine().some((m) => m.payload.type === 'HEARTBEAT') ? true : undefined), 5_000, 'first heartbeat');

      await sim.dropConnection();
      await sim.waitUntilOnline(5_000);
      await until(() => (mine().filter((m) => m.payload.type === 'HEARTBEAT').length >= 2 ? true : undefined), 5_000, 'heartbeat after reconnect');

      const types = mine().map((m) => `${m.payload.type}${m.payload.status ? `:${m.payload.status}` : ''}`);
      expect(types).toEqual([
        'DEVICE_AVAILABILITY:ONLINE',
        'DEVICE_RESTARTED',
        'HEARTBEAT',
        'DEVICE_AVAILABILITY:OFFLINE',
        'DEVICE_AVAILABILITY:ONLINE',
        'HEARTBEAT',
      ]);
      const offline = mine().find((m) => m.payload.status === 'OFFLINE')!;
      expect(offline.payload.messageId).toBe(wills[0]);
      expect(wills).toHaveLength(2);
      expect(wills[1]).not.toBe(wills[0]);
      expect(new Set(mine().map((m) => m.payload.bootCount))).toEqual(new Set([1]));

      // The broker published the old connection's Will with its own connectionId, which
      // tells it apart from the new connection's ONLINE and heartbeats.
      const [oldConnection, newConnection] = willConnections as [string, string];
      expect(oldConnection).not.toBe(newConnection);
      expect(offline.payload).toMatchObject({ reason: 'CONNECTION_LOST', connectionId: oldConnection });
      const all = mine();
      const offlineAt = all.indexOf(offline);
      expect(all.slice(0, offlineAt).every((m) => m.payload.type === 'DEVICE_RESTARTED' || m.payload.connectionId === oldConnection)).toBe(true);
      const after = all.slice(offlineAt + 1);
      expect(after.map((m) => m.payload.connectionId)).toEqual([newConnection, newConnection]);

      await sim.stop();
      const graceful = await until(
        () => mine().filter((m) => m.payload.status === 'OFFLINE')[1],
        3_000,
        'graceful OFFLINE',
      );
      // A clean DISCONNECT discards the armed Will: the OFFLINE seen is the explicit SHUTDOWN.
      expect(graceful).toMatchObject({
        topic: STATUS,
        qos: 1,
        payload: { status: 'OFFLINE', reason: 'SHUTDOWN', connectionId: newConnection, bootCount: 1 },
      });
      expect(graceful.payload.messageId).not.toBe(wills[1]);
      expect(graceful.payload.sequence as number).toBeGreaterThan(after.at(-1)!.payload.sequence as number);
      await new Promise((r) => setTimeout(r, 500));
      expect(mine().filter((m) => m.payload.messageId === wills[1])).toHaveLength(0);
      expect(mine().filter((m) => m.payload.reason === 'CONNECTION_LOST')).toHaveLength(1);
      // Nothing follows SHUTDOWN on that connection.
      expect(mine().at(-1)!.payload.messageId).toBe(graceful.payload.messageId);

      const afterStop = await observe();
      clients.push(afterStop.client);
      const retained = await until(() => afterStop.retained.find((m) => m.topic === STATUS), 3_000, 'retained SHUTDOWN');
      expect(retained.payload).toMatchObject({ reason: 'SHUTDOWN', messageId: graceful.payload.messageId });
    } finally {
      await sim.crash();
    }
  });

  it('API: restart increments bootCount on the wire, and replay republishes old messages verbatim', { timeout: 30_000 }, async () => {
    const observer = await observe();
    clients.push(observer.client);
    const sim = new HubSimulator(
      defineConfig({
        brokerUrl: BROKER,
        password: DEVICE_PASSWORD!,
        bootCountFile: join(stateDir, 'api-restart.json'),
        commandJournalFile: join(stateDir, 'api-restart-journal.json'),
        firstBootCount: 9,
      }),
    );
    try {
      sim.start();
      await sim.waitUntilOnline(5_000);
      const firstSession = sim.deviceSessionId!;
      const firstConnection = sim.connectionId!;
      const ofSession = (session: string) => observer.live.filter((m) => m.payload.deviceSessionId === session);
      await until(() => ofSession(firstSession).find((m) => m.payload.type === 'HEARTBEAT'), 5_000, 'first heartbeat');

      await sim.restart('SOFTWARE_RESET');
      await sim.waitUntilOnline(5_000);
      const secondSession = sim.deviceSessionId!;
      await until(() => ofSession(secondSession).find((m) => m.payload.type === 'HEARTBEAT'), 5_000, 'heartbeat after restart');

      // The abrupt end of the first boot made the broker publish that boot's Will.
      const oldWill = await until(
        () => ofSession(firstSession).find((m) => m.payload.reason === 'CONNECTION_LOST'),
        5_000,
        'Will of the first boot',
      );
      expect(oldWill.payload).toMatchObject({ bootCount: 9, connectionId: firstConnection });
      expect(new Set(ofSession(firstSession).map((m) => m.payload.bootCount))).toEqual(new Set([9]));
      expect(new Set(ofSession(secondSession).map((m) => m.payload.bootCount))).toEqual(new Set([10]));
      const restarted = ofSession(secondSession).find((m) => m.payload.type === 'DEVICE_RESTARTED')!;
      expect(restarted.payload).toMatchObject({ resetReason: 'SOFTWARE_RESET', bootCount: 10 });

      const oldRestart = ofSession(firstSession).find((m) => m.payload.type === 'DEVICE_RESTARTED')!;
      const oldBeat = ofSession(firstSession).filter((m) => m.payload.type === 'HEARTBEAT').at(-1)!;
      await sim.replay({ type: 'DEVICE_AVAILABILITY', reason: 'CONNECTION_LOST', connectionsAgo: 1 });
      await sim.replay({ type: 'DEVICE_RESTARTED', bootsAgo: 1 });
      await sim.replay({ type: 'HEARTBEAT', bootsAgo: 1 });

      const copies = (body: string) => observer.live.filter((m) => m.body === body);
      await until(() => (copies(oldWill.body).length >= 2 ? true : undefined), 3_000, 'replayed Will');
      await until(() => (copies(oldRestart.body).length >= 2 ? true : undefined), 3_000, 'replayed DEVICE_RESTARTED');
      await until(() => (copies(oldBeat.body).length >= 2 ? true : undefined), 3_000, 'replayed heartbeat');
      const replayedWill = copies(oldWill.body)[1]!;
      expect(replayedWill).toMatchObject({ topic: STATUS, qos: 1, payload: { messageId: oldWill.payload.messageId } });
      expect(copies(oldRestart.body)[1]).toMatchObject({ topic: EVENTS, qos: 1 });
    } finally {
      await sim.crash();
    }
  });

  it('refuses a wrong device secret', { timeout: 15_000 }, async () => {
    const sim = new HubSimulator(
      defineConfig({
        brokerUrl: BROKER,
        password: 'definitely-wrong',
        bootCountFile: join(stateDir, 'wrong-secret.json'),
        commandJournalFile: join(stateDir, 'wrong-secret-journal.json'),
      }),
    );
    const errors: string[] = [];
    sim.on('transportError', (e) => errors.push(e.message));
    try {
      sim.start();
      await until(() => (errors.length > 0 ? true : undefined), 5_000, 'authentication error');
      expect(errors[0]).toMatch(/not authorized|bad user name or password/i);
      expect(sim.state).not.toBe('online');
    } finally {
      await sim.crash();
    }
  });
});
