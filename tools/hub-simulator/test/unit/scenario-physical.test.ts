import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryBootCounter } from '../../src/boot-counter.ts';
import { MemoryCommandJournal } from '../../src/command-journal.ts';
import { defineConfig } from '../../src/config.ts';
import { ScenarioError, parseScenario, runScenario } from '../../src/scenario.ts';
import { HubSimulator } from '../../src/simulator.ts';
import { fakeTransportFactory, type FakeTransport } from './fake-transport.ts';
import { A1, A2, COMMANDS, EVENTS, command } from './hub-harness.ts';

describe('parsing of the SIM-02 steps', () => {
  it('accepts every step with its options', () => {
    const scenario = parseScenario({
      steps: [
        { do: 'openDoor', code: 'A1', forced: true },
        { do: 'closeDoor', code: 'A1' },
        { do: 'putTag', code: 'A1', identifier: 'E2003412', readCount: 1 },
        { do: 'takeTag', code: 'A1', identifier: 'E2003412' },
        { do: 'scanRfid', code: 'A2', windowMs: 1000 },
        { do: 'setClock', synchronized: false },
        { do: 'setScreen', available: false },
        { do: 'armFault', fault: 'LOCK_ACTUATION_FAILED' },
        { do: 'waitUnlocked', code: 'A1', timeoutMs: 1000 },
        { do: 'receiveCommand', ref: 'c1', compartment: 'A1', operation: 'op', expiresInMs: -1, issuedInMs: -2, schemaVersion: '1.0' },
        { do: 'redeliverCommand', ref: 'c1' },
        { do: 'restart', offlineMs: 5000 },
        { do: 'replay', type: 'DOOR_OPENED', bootsAgo: 0 },
      ],
    });
    expect(scenario.steps).toHaveLength(13);
  });

  it.each([
    [{ do: 'openDoor' }, 'code must be'],
    [{ do: 'openDoor', code: 'A1', forced: 'yes' }, 'forced must be a boolean'],
    [{ do: 'putTag', code: 'A1' }, 'identifier must be'],
    [{ do: 'putTag', code: 'A1', identifier: 'x', readCount: 0 }, 'readCount must be'],
    [{ do: 'scanRfid', code: 'A1', windowMs: 10_001 }, 'windowMs must be'],
    [{ do: 'setClock' }, 'synchronized must be'],
    [{ do: 'armFault', fault: 'MELT' }, 'fault must be one of'],
    [{ do: 'receiveCommand', ref: 'c1' }, 'either compartment or compartmentId'],
    [{ do: 'receiveCommand', ref: 'c1', compartment: 'A1', compartmentId: A1 }, 'either compartment or compartmentId'],
    [{ do: 'receiveCommand', ref: 'c 1', compartment: 'A1' }, 'ref must be'],
    [{ do: 'receiveCommand', ref: 'c1', compartment: 'A1', lockerId: 'other' }, 'lockerId must be'],
    [{ do: 'receiveCommand', ref: 'c1', compartment: 'A1', token: 'x' }, 'unknown receiveCommand field'],
    [{ do: 'redeliverCommand' }, 'ref must be'],
    [{ do: 'restart', offlineMs: -1 }, 'offlineMs must be'],
    [{ do: 'replay', type: 'COMMAND_ACKNOWLEDGED', connectionsAgo: 0 }, 'carries no connectionId'],
  ])('rejects %o', (step, message) => {
    expect(() => parseScenario({ steps: [step] })).toThrow(ScenarioError);
    expect(() => parseScenario({ steps: [step] })).toThrow(message);
  });
});

/** Runs a committed scenario on fake timers against a broker that accepts every CONNECT. */
async function runFile(name: string) {
  const { factory, instances } = fakeTransportFactory();
  const autoAccept: typeof factory = (options) => {
    const t = factory(options) as FakeTransport;
    t.reconnect = () => setTimeout(() => t.brokerAccept(), 0);
    setTimeout(() => t.brokerAccept(), 0);
    return t;
  };
  const journal = new MemoryCommandJournal();
  const sim = new HubSimulator(defineConfig({ password: 'test-only' }), {
    transportFactory: autoAccept,
    random: () => 0.5,
    bootCounter: new MemoryBootCounter(),
    commandJournal: journal,
  });
  const actuations: string[] = [];
  sim.on('actuated', (compartmentId) => actuations.push(compartmentId));
  const raw = JSON.parse(readFileSync(new URL(`../../scenarios/${name}`, import.meta.url), 'utf8'));
  sim.start();
  let done = false;
  let failure: unknown;
  runScenario(sim, parseScenario(raw), (ms) => new Promise((r) => setTimeout(r, ms))).then(
    () => (done = true),
    (error: unknown) => ((failure = error), (done = true)),
  );
  for (let i = 0; i < 600 && !done; i++) await vi.advanceTimersByTimeAsync(100);
  expect(failure).toBeUndefined();
  expect(done).toBe(true);
  const events = instances
    .flatMap((t) => t.published)
    .filter((p) => p.topic === EVENTS && p.payload.type !== 'DEVICE_RESTARTED')
    .map((p) => p.payload);
  return { sim, events, actuations, journal, instances };
}

describe('committed local scenarios (no backend)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-16T14:31:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('checkout-return-local.json: an empty scan after checkout, the tag seen three times after return', async () => {
    const { events, actuations, sim } = await runFile('checkout-return-local.json');
    expect(events.map((e) => e.type)).toEqual([
      'COMMAND_ACKNOWLEDGED',
      'LOCK_UNLOCKED',
      'DOOR_OPENED',
      'DOOR_CLOSED',
      'LOCK_LOCKED',
      'RFID_SCAN_COMPLETED',
      'COMMAND_ACKNOWLEDGED',
      'LOCK_UNLOCKED',
      'DOOR_OPENED',
      'DOOR_CLOSED',
      'LOCK_LOCKED',
      'RFID_SCAN_COMPLETED',
    ]);
    const [checkoutScan, returnScan] = events.filter((e) => e.type === 'RFID_SCAN_COMPLETED');
    expect(checkoutScan).toMatchObject({ readerStatus: 'HEALTHY', observedIdentifiers: [] });
    expect(returnScan).toMatchObject({
      readerStatus: 'HEALTHY',
      observedIdentifiers: [{ identifierType: 'RFID_UHF', identifierValue: 'E20034120123456789000001', readCount: 3 }],
    });
    expect(checkoutScan!.operationId).not.toBe(returnScan!.operationId);
    expect(actuations).toEqual([A1, A1]);
    expect(sim.state).toBe('stopped');
  });

  it('negative-commands-local.json: wrong compartment, wrong locker, expired, then a replayed command never re-actuates', async () => {
    const { events, actuations, instances } = await runFile('negative-commands-local.json');
    const answers = events.filter((e) => e.type === 'COMMAND_ACKNOWLEDGED' || e.type === 'COMMAND_REJECTED');
    expect(answers.map((e) => e.reason ?? e.result)).toEqual([
      'UNKNOWN_COMPARTMENT',
      'WRONG_LOCKER',
      'COMMAND_EXPIRED',
      'ACCEPTED',
      'ALREADY_APPLIED',
      'ALREADY_APPLIED',
      // The replay step: the previous acknowledgement delivered twice.
      'ALREADY_APPLIED',
    ]);
    expect(actuations).toEqual([A1]);
    // The replay step republished the last acknowledgement byte for byte.
    const bodies = instances[0]!.published.filter((p) => p.payload.type === 'COMMAND_ACKNOWLEDGED').map((p) => p.body);
    expect(bodies).toHaveLength(4);
    expect(bodies[3]).toBe(bodies[2]);
    expect(events.filter((e) => e.type === 'LOCK_LOCKED')).toHaveLength(1);
  });

  it('missing-tag-reader-fault-local.json: a healthy empty return scan, then a faulted scan replayed', async () => {
    const { events } = await runFile('missing-tag-reader-fault-local.json');
    const scans = events.filter((e) => e.type === 'RFID_SCAN_COMPLETED');
    expect(scans).toEqual([
      expect.objectContaining({ compartmentId: A1, readerStatus: 'HEALTHY', observedIdentifiers: [] }),
      expect.objectContaining({ compartmentId: A2, readerStatus: 'FAULTED', observedIdentifiers: [] }),
      expect.objectContaining({ compartmentId: A2, readerStatus: 'FAULTED' }),
    ]);
    expect(scans[2]!.messageId).toBe(scans[1]!.messageId);
    expect(scans[0]!.operationId).toBeDefined();
    expect(scans[1]).not.toHaveProperty('operationId');
  });

  it('restart-mid-operation-local.json: uncertainty instead of a second actuation, and a lost operation after reboot', async () => {
    const { events, actuations, sim } = await runFile('restart-mid-operation-local.json');
    expect(actuations).toEqual([A1, A2]);
    expect(events.map((e) => `${e.type}${e.reason ? `:${e.reason}` : ''}`)).toEqual([
      'COMMAND_REJECTED:PREVIOUS_EXECUTION_UNCERTAIN',
      'COMMAND_REJECTED:PREVIOUS_EXECUTION_UNCERTAIN',
      'COMMAND_ACKNOWLEDGED',
      'LOCK_UNLOCKED',
      'DOOR_OPENED',
      'DOOR_CLOSED',
    ]);
    expect(events.at(-1)).not.toHaveProperty('operationId');
    expect(events[0]!.bootCount).toBe(2);
    expect(sim.state).toBe('stopped');
  });

  it('checkout-with-backend.json follows the unlock decided by a backend', async () => {
    const { factory, instances } = fakeTransportFactory();
    const sim = new HubSimulator(defineConfig({ password: 'test-only' }), {
      transportFactory: factory,
      random: () => 0.5,
      bootCounter: new MemoryBootCounter(),
      commandJournal: new MemoryCommandJournal(),
    });
    sim.start();
    instances[0]!.brokerAccept();
    const raw = JSON.parse(readFileSync(new URL('../../scenarios/checkout-with-backend.json', import.meta.url), 'utf8'));
    let done = false;
    runScenario(sim, parseScenario(raw), (ms) => new Promise((r) => setTimeout(r, ms))).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(done).toBe(false);
    expect(instances[0]!.types()).toEqual(['DEVICE_AVAILABILITY', 'DEVICE_RESTARTED', 'HEARTBEAT', 'HEARTBEAT', 'HEARTBEAT', 'HEARTBEAT']);
    // The backend's command arrives through the broker.
    const c = command();
    instances[0]!.deliver(COMMANDS, c.body);
    for (let i = 0; i < 100 && !done; i++) await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(true);
    const events = instances[0]!.published.filter((p) => p.topic === EVENTS).map((p) => p.payload);
    expect(events.filter((e) => e.type !== 'DEVICE_RESTARTED').map((e) => e.type)).toEqual([
      'COMMAND_ACKNOWLEDGED',
      'LOCK_UNLOCKED',
      'DOOR_OPENED',
      'DOOR_CLOSED',
      'LOCK_LOCKED',
      'RFID_SCAN_COMPLETED',
    ]);
    expect(events.at(-1)).toMatchObject({ operationId: c.operationId, observedIdentifiers: [] });
    await sim.crash();
  });
});

describe('local command delivery', () => {
  it('refuses a redelivery of an unknown ref and a delivery while offline', async () => {
    const { factory } = fakeTransportFactory();
    const sim = new HubSimulator(defineConfig({ password: 'test-only' }), {
      transportFactory: factory,
      bootCounter: new MemoryBootCounter(),
      commandJournal: new MemoryCommandJournal(),
    });
    sim.start();
    await expect(runScenario(sim, parseScenario({ steps: [{ do: 'redeliverCommand', ref: 'nope' }] }))).rejects.toThrow(
      'no command was received under ref nope',
    );
    await expect(
      runScenario(sim, parseScenario({ steps: [{ do: 'receiveCommand', ref: 'c1', compartment: 'A1' }] })),
    ).rejects.toThrow('cannot receive a message from state connecting');
    await sim.crash();
  });
});
