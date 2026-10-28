import { randomBytes, randomUUID } from 'node:crypto';
import { MemoryBootCounter } from '../../src/boot-counter.ts';
import { MemoryCommandJournal } from '../../src/command-journal.ts';
import { defineConfig, type SimulatorConfig } from '../../src/config.ts';
import { HubSimulator, type InboundReport, type RedactedScreenView } from '../../src/simulator.ts';
import { fakeTransportFactory, type FakeTransport, type PublishedRecord } from './fake-transport.ts';

export const LOCKER = 'd46a74ae-39dc-460b-8af0-38fc791b376a';
export const OTHER_LOCKER = '0b6f1c84-5f43-4c2a-9a7e-3d1e2c4b5a69';
export const A1 = '1ae77ae3-8490-4f09-9412-a7816b77bff9';
export const A2 = '5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10';
export const COMMANDS = `aegis/v1/lockers/${LOCKER}/commands`;
export const DISPLAY = `aegis/v1/lockers/${LOCKER}/display`;
export const EVENTS = `aegis/v1/lockers/${LOCKER}/events`;
export const STATUS = `aegis/v1/lockers/${LOCKER}/status`;
/** A fresh display token for each test run: the tests check it never leaks, so no fixed value lives in the repository. */
export const TOKEN = randomBytes(32).toString('base64url');

export interface Harness {
  readonly sim: HubSimulator;
  readonly journal: MemoryCommandJournal;
  readonly instances: FakeTransport[];
  /** The transport of the current boot. */
  transport(): FakeTransport;
  readonly actuations: Array<{ compartmentId: string; operationId: string }>;
  readonly inbound: InboundReport[];
  readonly screens: RedactedScreenView[];
  /** Operational events (DEVICE_RESTARTED aside unless asked) across all boots, oldest first. */
  events(type?: string): Array<Record<string, unknown>>;
  /** The broker accepts the pending CONNECT of the current transport. */
  accept(): void;
}

export function harness(overrides: Partial<SimulatorConfig> = {}, journal = new MemoryCommandJournal()): Harness {
  const { factory, instances } = fakeTransportFactory();
  const sim = new HubSimulator(defineConfig({ password: 'test-only', ...overrides }), {
    transportFactory: factory,
    random: () => 0.5,
    bootCounter: new MemoryBootCounter(2),
    commandJournal: journal,
  });
  const actuations: Harness['actuations'] = [];
  const inbound: InboundReport[] = [];
  const screens: RedactedScreenView[] = [];
  sim.on('actuated', (compartmentId, operationId) => actuations.push({ compartmentId, operationId }));
  sim.on('inbound', (r) => inbound.push(r));
  sim.on('screen', (v) => screens.push(v));
  const transport = () => {
    const t = instances.at(-1);
    if (!t) throw new Error('no transport');
    return t;
  };
  return {
    sim,
    journal,
    instances,
    transport,
    actuations,
    inbound,
    screens,
    events: (type) =>
      instances
        .flatMap((t) => t.published)
        .filter(
          (p: PublishedRecord) =>
            p.topic === EVENTS && (type === undefined ? p.payload.type !== 'DEVICE_RESTARTED' : p.payload.type === type),
        )
        .map((p) => p.payload),
    accept: () => transport().brokerAccept(),
  };
}

/** A harness whose hub is booted and online. */
export function online(overrides: Partial<SimulatorConfig> = {}, journal?: MemoryCommandJournal): Harness {
  const h = harness(overrides, journal);
  h.sim.start();
  h.accept();
  return h;
}

export interface CommandFields {
  messageId: string;
  operationId: string;
  lockerId: string;
  compartmentId: string;
  issuedAt: string;
  expiresAt: string;
  schemaVersion: string;
  type: string;
}

/** An UNLOCK_COMPARTMENT valid for two minutes from the fake clock (doc 10 §9). */
export function command(overrides: Partial<CommandFields> & Record<string, unknown> = {}): CommandFields & { body: string } {
  const now = Date.now();
  const fields = {
    schemaVersion: '2.0',
    messageId: randomUUID(),
    type: 'UNLOCK_COMPARTMENT',
    operationId: randomUUID(),
    lockerId: LOCKER,
    compartmentId: A1,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 120_000).toISOString(),
    ...overrides,
  };
  return { ...fields, body: JSON.stringify(fields) };
}

export interface ChallengeFields {
  messageId: string;
  operationId: string;
  compartmentId: string;
  targetDeviceSessionId: string;
  displayRevision: number;
  challengeId: string;
  issuedAt: string;
  expiresAt: string;
}

/** A DISPLAY_ACCESS_CHALLENGE for the hub's current boot, 60 s long (doc 10 §27.1). */
export function challenge(
  sim: HubSimulator,
  overrides: Partial<ChallengeFields> & { payload?: Record<string, unknown>; lockerId?: string; schemaVersion?: string } = {},
): { body: string; messageId: string; operationId: string; challengeId: string; displayRevision: number } {
  const now = Date.now();
  const challengeId = overrides.challengeId ?? randomUUID();
  const fields = {
    schemaVersion: overrides.schemaVersion ?? '2.0',
    messageId: overrides.messageId ?? randomUUID(),
    type: 'DISPLAY_ACCESS_CHALLENGE',
    lockerId: overrides.lockerId ?? LOCKER,
    compartmentId: overrides.compartmentId ?? A1,
    operationId: overrides.operationId ?? randomUUID(),
    targetDeviceSessionId: overrides.targetDeviceSessionId ?? sim.deviceSessionId!,
    displayRevision: overrides.displayRevision ?? 41,
    issuedAt: overrides.issuedAt ?? new Date(now).toISOString(),
    expiresAt: overrides.expiresAt ?? new Date(now + 60_000).toISOString(),
    payload: { challengeId, action: 'CHECKOUT', compartmentCode: 'A1', token: TOKEN, ...overrides.payload },
  };
  return { body: JSON.stringify(fields), messageId: fields.messageId, operationId: fields.operationId, challengeId, displayRevision: fields.displayRevision };
}

/** A DISPLAY_OPERATION_STATUS for the hub's current boot, 30 s long (doc 10 §27.3). */
export function operationStatus(
  sim: HubSimulator,
  overrides: { operationId?: string; displayRevision?: number; status?: string; messageId?: string } = {},
): { body: string; messageId: string } {
  const now = Date.now();
  const fields = {
    schemaVersion: '2.0',
    messageId: overrides.messageId ?? randomUUID(),
    type: 'DISPLAY_OPERATION_STATUS',
    lockerId: LOCKER,
    compartmentId: A1,
    operationId: overrides.operationId ?? randomUUID(),
    targetDeviceSessionId: sim.deviceSessionId!,
    displayRevision: overrides.displayRevision ?? 42,
    issuedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 30_000).toISOString(),
    payload: { action: 'CHECKOUT', compartmentCode: 'A1', status: overrides.status ?? 'CONFIRMED', reasonCode: null },
  };
  return { body: JSON.stringify(fields), messageId: fields.messageId };
}
