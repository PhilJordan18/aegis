// Runs against the local Mosquitto of infra/docker/compose.yaml, the backend side
// publishing as aegis_api. Credentials come from the environment, e.g.
// `set -a; . ../../infra/docker/.env.example; set +a`.
//
// Every simulator of the fictitious locker shares its commands topic, and an offline
// persistent session keeps the commands published meanwhile. Each test therefore
// discards the broker session of its own clientId before and after it runs, and
// assertions only look at the messageIds and operationIds the test publishes.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mqtt, { type MqttClient } from 'mqtt';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LOCKER_ID, defineConfig } from '../../src/config.ts';
import { clientIdFor } from '../../src/contract.ts';
import { HubSimulator } from '../../src/simulator.ts';
import { A1, A2, OTHER_LOCKER, TOKEN, challenge, command } from '../unit/hub-harness.ts';

const BROKER = process.env.AEGIS_MQTT_URL ?? 'mqtt://127.0.0.1:1883';
const DEVICE_PASSWORD = process.env.AEGIS_MQTT_DEVICE_PASSWORD;
const API_PASSWORD = process.env.AEGIS_MQTT_API_PASSWORD;
const COMMANDS = `aegis/v1/lockers/${DEFAULT_LOCKER_ID}/commands`;
const DISPLAY = `aegis/v1/lockers/${DEFAULT_LOCKER_ID}/display`;
const EVENTS = `aegis/v1/lockers/${DEFAULT_LOCKER_ID}/events`;
/** Short, so that a command left queued in a session has expired by the next run. */
const LIFETIME_MS = 15_000;

interface Received {
  body: string;
  payload: Record<string, unknown>;
  qos: number;
  retain: boolean;
}

/** The backend identity: publishes commands and display, reads events. */
async function backend(): Promise<{ client: MqttClient; events: Received[]; publish(topic: string, body: string): Promise<void> }> {
  const client = await mqtt.connectAsync(BROKER, {
    protocolVersion: 4,
    clientId: `aegis-sim-it-api-${process.pid}-${Math.random().toString(16).slice(2, 8)}`,
    username: 'aegis_api',
    password: API_PASSWORD!,
    clean: true,
    reconnectPeriod: 0,
  });
  const events: Received[] = [];
  client.on('message', (_topic, body, packet) => {
    events.push({ body: body.toString('utf8'), payload: JSON.parse(body.toString('utf8')), qos: packet.qos, retain: packet.retain });
  });
  await client.subscribeAsync(EVENTS, { qos: 1 });
  return {
    client,
    events,
    publish: async (topic, body) => {
      await client.publishAsync(topic, body, { qos: 1, retain: false });
    },
  };
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

function shortCommand(overrides: Parameters<typeof command>[0] = {}) {
  return command({ expiresAt: new Date(Date.now() + LIFETIME_MS).toISOString(), ...overrides });
}

const clients: MqttClient[] = [];
const sims: HubSimulator[] = [];
const stateDir = mkdtempSync(join(tmpdir(), 'aegis-sim-it-commands-'));

afterAll(() => {
  rmSync(stateDir, { recursive: true, force: true });
});

const usedKeys = new Set<string>();

/** A clean-session CONNECT with the same clientId drops the persistent session and its queue. */
async function discardSession(deviceKey: string): Promise<void> {
  const client = await mqtt.connectAsync(BROKER, {
    protocolVersion: 4,
    clientId: clientIdFor(deviceKey),
    username: DEFAULT_LOCKER_ID,
    password: DEVICE_PASSWORD!,
    clean: true,
    reconnectPeriod: 0,
  });
  await client.endAsync();
}

afterEach(async () => {
  await Promise.all(sims.splice(0).map((s) => s.stop()));
  await Promise.all(clients.splice(0).map((c) => c.endAsync()));
  for (const key of usedKeys) await discardSession(key);
  usedKeys.clear();
});

/** A simulator with its own clientId and state files, online and subscribed. */
async function hub(deviceKey: string) {
  await discardSession(deviceKey);
  usedKeys.add(deviceKey);
  const sim = new HubSimulator(
    defineConfig({
      brokerUrl: BROKER,
      password: DEVICE_PASSWORD!,
      deviceKey,
      bootCountFile: join(stateDir, `${deviceKey}-boot.json`),
      commandJournalFile: join(stateDir, `${deviceKey}-journal.json`),
    }),
  );
  sims.push(sim);
  const actuated: string[] = [];
  sim.on('actuated', (_, operationId) => actuated.push(operationId));
  const subscribed = new Promise<void>((resolve) => sim.once('subscribed', () => resolve()));
  const refused: Error[] = [];
  sim.on('transportError', (e) => refused.push(e));
  sim.start();
  await sim.waitUntilOnline(5_000);
  await subscribed;
  expect(refused).toEqual([]);
  return { sim, actuated };
}

describe.skipIf(!DEVICE_PASSWORD || !API_PASSWORD)('commands and display through the local broker', () => {
  it('acknowledges a backend command once, answers its redelivery ALREADY_APPLIED, rejects the bad ones', { timeout: 30_000 }, async () => {
    const { sim, actuated } = await hub('sim-it-commands');
    const api = await backend();
    clients.push(api.client);
    const answerTo = (messageId: string, n = 1) =>
      until(
        () => {
          const found = api.events.filter((e) => e.payload.commandMessageId === messageId);
          return found.length >= n ? found : undefined;
        },
        5_000,
        `answer ${n} to ${messageId}`,
      );

    const valid = shortCommand();
    await api.publish(COMMANDS, valid.body);
    const [ack] = await answerTo(valid.messageId);
    expect(ack).toMatchObject({
      qos: 1,
      retain: false,
      payload: {
        schemaVersion: '2.0',
        type: 'COMMAND_ACKNOWLEDGED',
        result: 'ACCEPTED',
        operationId: valid.operationId,
        compartmentId: A1,
        lockerId: DEFAULT_LOCKER_ID,
        deviceSessionId: sim.deviceSessionId,
        bootCount: 1,
      },
    });
    await until(
      () => api.events.find((e) => e.payload.type === 'LOCK_UNLOCKED' && e.payload.operationId === valid.operationId),
      3_000,
      'LOCK_UNLOCKED',
    );

    // A QoS 1 redelivery of the same command: known outcome, no second actuation.
    await api.publish(COMMANDS, valid.body);
    const answers = await answerTo(valid.messageId, 2);
    expect(answers[1]!.payload).toMatchObject({ type: 'COMMAND_ACKNOWLEDGED', result: 'ALREADY_APPLIED' });
    expect(answers[1]!.payload.messageId).not.toBe(answers[0]!.payload.messageId);

    const now = Date.now();
    const bad = [
      [shortCommand({ compartmentId: '7d4bd7a0-6a0e-4b8e-8e57-1f2c3d4e5f60' }), 'UNKNOWN_COMPARTMENT'],
      [shortCommand({ lockerId: OTHER_LOCKER }), 'WRONG_LOCKER'],
      [
        shortCommand({ issuedAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now - 1_000).toISOString() }),
        'COMMAND_EXPIRED',
      ],
      [shortCommand({ compartmentId: A2 }), 'LOCAL_OPERATION_IN_PROGRESS'],
    ] as const;
    for (const [c, reason] of bad) {
      await api.publish(COMMANDS, c.body);
      const [rejected] = await answerTo(c.messageId);
      expect(rejected!.payload).toMatchObject({ type: 'COMMAND_REJECTED', reason, operationId: c.operationId });
    }

    await new Promise((r) => setTimeout(r, 300));
    expect(actuated.filter((op) => op === valid.operationId)).toHaveLength(1);
    expect(api.events.filter((e) => e.payload.type === 'LOCK_UNLOCKED' && e.payload.operationId === valid.operationId)).toHaveLength(1);
    for (const [c] of bad) expect(actuated).not.toContain(c.operationId);
  });

  it('shows a backend challenge, acknowledges it without the token, and refuses another boot', { timeout: 30_000 }, async () => {
    const { sim } = await hub('sim-it-display');
    const api = await backend();
    clients.push(api.client);
    const d = challenge(sim, { displayRevision: 1 });
    await api.publish(DISPLAY, d.body);
    const ack = await until(() => api.events.find((e) => e.payload.displayMessageId === d.messageId), 5_000, 'display acknowledgement');
    expect(ack).toMatchObject({
      qos: 1,
      retain: false,
      payload: { type: 'ACCESS_CHALLENGE_DISPLAYED', challengeId: d.challengeId, displayRevision: 1, operationId: d.operationId },
    });
    expect(ack.body).not.toContain(TOKEN);
    expect(sim.screen).toMatchObject({ kind: 'ACCESS_CHALLENGE', challengeId: d.challengeId });
    expect(sim.screen.kind === 'ACCESS_CHALLENGE' && sim.screen.qrUri).toContain(`token=${TOKEN}`);

    const stale = challenge(sim, { displayRevision: 2, targetDeviceSessionId: '1b24299c-028f-4c9f-a942-1c1ce36be899' });
    await api.publish(DISPLAY, stale.body);
    const rejected = await until(() => api.events.find((e) => e.payload.displayMessageId === stale.messageId), 5_000, 'display rejection');
    expect(rejected.payload).toMatchObject({ type: 'DISPLAY_REJECTED', reason: 'TARGET_SESSION_MISMATCH' });
    expect(sim.screen).toMatchObject({ challengeId: d.challengeId });
  });

  it('a crash during actuation is never acknowledged; after reboot the broker redelivers and the hub reports uncertainty', { timeout: 30_000 }, async () => {
    const { sim, actuated } = await hub('sim-it-crash');
    const api = await backend();
    clients.push(api.client);
    sim.armFault('CRASH_DURING_ACTUATION');
    const stopped = new Promise<void>((resolve) => sim.on('state', (s) => s === 'stopped' && resolve()));
    const c = shortCommand();
    await api.publish(COMMANDS, c.body);
    await stopped;
    expect(actuated).toEqual([c.operationId]);

    const redelivered = new Promise<void>((resolve) =>
      sim.on('inbound', (r) => r.messageId === c.messageId && r.reason === 'PREVIOUS_EXECUTION_UNCERTAIN' && resolve()),
    );
    sim.start();
    await sim.waitUntilOnline(5_000);
    // One proactive report after boot, one answer to the redelivered, never-PUBACKed command.
    await redelivered;
    const answers = await until(
      () => {
        const found = api.events.filter((e) => e.payload.commandMessageId === c.messageId);
        return found.length >= 2 ? found : undefined;
      },
      5_000,
      'two uncertainty reports',
    );
    for (const a of answers) {
      expect(a.payload).toMatchObject({ type: 'COMMAND_REJECTED', reason: 'PREVIOUS_EXECUTION_UNCERTAIN', bootCount: 2 });
    }
    expect(actuated).toEqual([c.operationId]);
    expect(api.events.filter((e) => e.payload.operationId === c.operationId && e.payload.type === 'LOCK_UNLOCKED')).toEqual([]);
  });

  it('the device account never receives the commands of another locker (§6.1)', { timeout: 15_000 }, async () => {
    const foreign = `aegis/v1/lockers/${OTHER_LOCKER}/commands`;
    const device = await mqtt.connectAsync(BROKER, {
      protocolVersion: 4,
      clientId: `aegis-sim-it-acl-${process.pid}`,
      username: DEFAULT_LOCKER_ID,
      password: DEVICE_PASSWORD!,
      clean: true,
      reconnectPeriod: 0,
    });
    clients.push(device);
    const received: string[] = [];
    device.on('message', (topic) => received.push(topic));
    // Mosquitto 2 grants the SUBACK and enforces the read ACL on delivery.
    await device.subscribeAsync([foreign, COMMANDS], { qos: 1 });
    const api = await backend();
    clients.push(api.client);
    const own = shortCommand({ expiresAt: new Date(Date.now() - 1_000).toISOString(), issuedAt: new Date(Date.now() - 5_000).toISOString() });
    await api.publish(foreign, shortCommand({ lockerId: OTHER_LOCKER }).body);
    await api.publish(COMMANDS, own.body);
    await until(() => (received.includes(COMMANDS) ? true : undefined), 3_000, 'own command');
    await new Promise((r) => setTimeout(r, 300));
    expect(received).not.toContain(foreign);
  });
});
