import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryBootCounter } from '../../src/boot-counter.ts';
import { FileCommandJournal, MemoryCommandJournal } from '../../src/command-journal.ts';
import { defineConfig } from '../../src/config.ts';
import { HubSimulator } from '../../src/simulator.ts';
import { fakeTransportFactory } from './fake-transport.ts';
import { A1, A2, COMMANDS, DISPLAY, EVENTS, LOCKER, OTHER_LOCKER, command, harness, online } from './hub-harness.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-16T14:31:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('subscriptions (doc 10 §6.1, §18)', () => {
  it("subscribes to its own locker's commands and display on every connection", async () => {
    const h = online();
    expect(h.transport().subscriptions).toEqual([[COMMANDS, DISPLAY]]);
    await h.sim.dropConnection();
    await vi.advanceTimersByTimeAsync(1_000);
    h.accept();
    expect(h.transport().subscriptions).toEqual([
      [COMMANDS, DISPLAY],
      [COMMANDS, DISPLAY],
    ]);
  });
});

describe('UNLOCK_COMPARTMENT accepted (doc 10 §9, §10.1)', () => {
  it('journals EXECUTING before actuating, unlocks only the target cell, then acknowledges', () => {
    const h = online();
    const states: string[] = [];
    h.sim.on('actuated', () => states.push(h.journal.entries().at(-1)!.state));
    const c = command();
    h.transport().deliver(COMMANDS, c.body);

    expect(states).toEqual(['EXECUTING']);
    expect(h.actuations).toEqual([{ compartmentId: A1, operationId: c.operationId }]);
    expect(h.journal.entries()).toEqual([
      expect.objectContaining({ messageId: c.messageId, operationId: c.operationId, state: 'ACKNOWLEDGED', executed: true }),
    ]);
    const [ack, unlocked] = h.events();
    expect(ack).toMatchObject({
      schemaVersion: '2.0',
      type: 'COMMAND_ACKNOWLEDGED',
      commandMessageId: c.messageId,
      operationId: c.operationId,
      lockerId: LOCKER,
      compartmentId: A1,
      deviceSessionId: h.sim.deviceSessionId,
      bootCount: 3,
      timestamp: '2026-09-16T14:31:00Z',
      result: 'ACCEPTED',
    });
    expect(ack!.messageId).toMatch(UUID);
    expect(ack!.messageId).not.toBe(c.messageId);
    expect(unlocked).toMatchObject({ type: 'LOCK_UNLOCKED', operationId: c.operationId, compartmentId: A1, lockState: 'UNLOCKED' });
    expect(h.sim.compartment('A1').lockState).toBe('UNLOCKED');
    expect(h.sim.compartment('A2').lockState).toBe('LOCKED');
  });

  it('publishes acknowledgements on events with QoS 1 and no retain, after ONLINE, DEVICE_RESTARTED and the heartbeat', () => {
    const h = online();
    h.transport().deliver(COMMANDS, command().body);
    const published = h.transport().published;
    expect(published.map((p) => p.payload.type)).toEqual([
      'DEVICE_AVAILABILITY',
      'DEVICE_RESTARTED',
      'HEARTBEAT',
      'COMMAND_ACKNOWLEDGED',
      'LOCK_UNLOCKED',
    ]);
    for (const p of published.slice(3)) {
      expect(p.topic).toBe(EVENTS);
      expect(p.delivery).toEqual({ qos: 1, retain: false });
    }
    expect(published.map((p) => p.payload.sequence)).toEqual([1, 2, 3, 4, 5]);
  });

  it('accepts a newer minor schema and ignores unknown fields (doc 10 §3.2)', () => {
    const h = online();
    h.transport().deliver(COMMANDS, command({ schemaVersion: '2.3', priority: 'high' }).body);
    expect(h.events('COMMAND_ACKNOWLEDGED')).toHaveLength(1);
  });

  it('acknowledges the delivery (PUBACK) once handled', () => {
    const h = online();
    const c = command();
    expect(h.transport().deliver(COMMANDS, c.body)).toBe(true);
    expect(h.transport().acknowledged).toEqual([c.body]);
  });

  it('relocks after the unlock window when nobody opens the door, then accepts the next operation', async () => {
    const h = online({ unlockWindowMs: 15_000 });
    const c = command();
    h.transport().deliver(COMMANDS, c.body);
    await vi.advanceTimersByTimeAsync(14_999);
    expect(h.sim.compartment('A1').lockState).toBe('UNLOCKED');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sim.compartment('A1').lockState).toBe('LOCKED');
    expect(h.events('LOCK_LOCKED')).toEqual([expect.objectContaining({ operationId: c.operationId, lockState: 'LOCKED' })]);
    expect(h.sim.compartment('A1').operationId).toBeUndefined();
    h.transport().deliver(COMMANDS, command().body);
    expect(h.events('COMMAND_ACKNOWLEDGED')).toHaveLength(2);
  });
});

describe('COMMAND_REJECTED (doc 10 §9.1, §10.2, §23.2)', () => {
  const at = (offsetMs: number) => new Date(Date.parse('2026-09-16T14:31:00.000Z') + offsetMs).toISOString();

  it.each([
    ['WRONG_LOCKER', () => command({ lockerId: OTHER_LOCKER })],
    ['UNKNOWN_COMPARTMENT', () => command({ compartmentId: '7d4bd7a0-6a0e-4b8e-8e57-1f2c3d4e5f60' })],
    ['COMMAND_EXPIRED', () => command({ issuedAt: at(-120_000), expiresAt: at(0) })],
    ['COMMAND_EXPIRED', () => command({ issuedAt: at(-120_000), expiresAt: at(-1) })],
    ['UNSUPPORTED_SCHEMA', () => command({ schemaVersion: '1.0' })],
    ['UNSUPPORTED_SCHEMA', () => command({ schemaVersion: '3.0' })],
    ['INVALID_PAYLOAD', () => command({ schemaVersion: 'two' })],
    ['INVALID_PAYLOAD', () => command({ type: 'OPEN_ALL' })],
    ['INVALID_PAYLOAD', () => command({ expiresAt: '2026-09-16 14:33:00' })],
    ['INVALID_PAYLOAD', () => command({ expiresAt: '2026-02-30T14:33:00Z' })],
    ['INVALID_PAYLOAD', () => command({ issuedAt: at(0), expiresAt: at(0) })],
    ['INVALID_PAYLOAD', () => command({ lockerId: 'D46A74AE-39DC-460B-8AF0-38FC791B376A' })],
  ])('rejects with %s, without actuation', (reason, build) => {
    const h = online();
    const c = build();
    h.transport().deliver(COMMANDS, c.body);
    expect(h.actuations).toEqual([]);
    expect(h.events()).toEqual([
      expect.objectContaining({
        type: 'COMMAND_REJECTED',
        reason,
        commandMessageId: c.messageId,
        operationId: c.operationId,
        compartmentId: c.compartmentId,
        lockerId: LOCKER,
      }),
    ]);
    const rejected = h.events()[0]!;
    expect(typeof rejected.detail).toBe('string');
    expect((rejected.detail as string).length).toBeLessThanOrEqual(240);
    expect(h.sim.compartment('A1').lockState).toBe('LOCKED');
  });

  it('rejects CLOCK_NOT_SYNCHRONIZED and reports the clock in the heartbeat (§17.1)', () => {
    const h = online();
    h.sim.setClockSynchronized(false);
    h.transport().deliver(COMMANDS, command().body);
    expect(h.events()[0]).toMatchObject({ type: 'COMMAND_REJECTED', reason: 'CLOCK_NOT_SYNCHRONIZED' });
    h.sim.publishHeartbeat();
    expect(h.transport().published.at(-1)!.payload.clockSynchronized).toBe(false);
  });

  it('rejects CELL_UNREACHABLE for a disconnected cell (§23.2 point 7)', () => {
    const h = online();
    h.sim.updateCompartment('A1', { connectionStatus: 'DISCONNECTED' });
    h.transport().deliver(COMMANDS, command().body);
    expect(h.events()[0]).toMatchObject({ reason: 'CELL_UNREACHABLE' });
    expect(h.actuations).toEqual([]);
  });

  it('rejects DOOR_STATE_UNSAFE when the target door is not closed', () => {
    const h = online();
    h.sim.updateCompartment('A1', { doorState: 'UNKNOWN' });
    h.transport().deliver(COMMANDS, command().body);
    expect(h.events()[0]).toMatchObject({ reason: 'DOOR_STATE_UNSAFE' });
  });

  it('rejects LOCAL_OPERATION_IN_PROGRESS while another cell is unlocked', () => {
    const h = online();
    h.transport().deliver(COMMANDS, command().body);
    h.transport().deliver(COMMANDS, command({ compartmentId: A2 }).body);
    expect(h.events('COMMAND_REJECTED')).toEqual([expect.objectContaining({ reason: 'LOCAL_OPERATION_IN_PROGRESS', compartmentId: A2 })]);
    expect(h.actuations).toHaveLength(1);
  });

  it('rejects LOCK_ACTUATION_FAILED, leaves the lock locked and consumes the operation', () => {
    const h = online();
    h.sim.armFault('LOCK_ACTUATION_FAILED');
    const c = command();
    h.transport().deliver(COMMANDS, c.body);
    expect(h.events()).toEqual([expect.objectContaining({ type: 'COMMAND_REJECTED', reason: 'LOCK_ACTUATION_FAILED' })]);
    expect(h.actuations).toEqual([]);
    expect(h.sim.compartment('A1').lockState).toBe('LOCKED');
    // The fault is one-shot, but this operation is consumed: a second command for it is not executed.
    h.transport().deliver(COMMANDS, command({ operationId: c.operationId }).body);
    expect(h.events().at(-1)).toMatchObject({ type: 'COMMAND_REJECTED', reason: 'LOCK_ACTUATION_FAILED' });
    expect(h.actuations).toEqual([]);
  });

  it('refuses to actuate with INTERNAL_DEVICE_ERROR when EXECUTING cannot be journaled', () => {
    const journal = new MemoryCommandJournal();
    const h = online({}, journal);
    journal.failWrites = true;
    const errors: Error[] = [];
    h.sim.on('journalError', (e) => errors.push(e));
    h.transport().deliver(COMMANDS, command().body);
    expect(h.actuations).toEqual([]);
    expect(h.events()).toEqual([expect.objectContaining({ type: 'COMMAND_REJECTED', reason: 'INTERNAL_DEVICE_ERROR' })]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('ignores an uncorrelatable message: nothing is published nor actuated', () => {
    const h = online();
    const tooLarge = command({ padding: 'x'.repeat(16 * 1024) }).body;
    const noOperation = JSON.stringify({ ...JSON.parse(command().body), operationId: undefined });
    for (const body of ['{not json', '[]', tooLarge, noOperation]) h.transport().deliver(COMMANDS, body);
    expect(h.events()).toEqual([]);
    expect(h.actuations).toEqual([]);
    expect(h.inbound.map((r) => r.outcome)).toEqual(['IGNORED', 'IGNORED', 'IGNORED', 'IGNORED']);
  });

  it('never executes a retained command (§7.2)', () => {
    const h = online();
    h.transport().deliver(COMMANDS, command().body, { retain: true });
    expect(h.events()).toEqual([]);
    expect(h.actuations).toEqual([]);
    expect(h.inbound).toEqual([{ channel: 'commands', outcome: 'IGNORED', why: 'retained command' }]);
  });
});

describe('deduplication (doc 10 §10.1, §16.1, §23.2 points 5-6)', () => {
  it('answers a redelivered command with ALREADY_APPLIED and never actuates again', () => {
    const h = online();
    const c = command();
    h.transport().deliver(COMMANDS, c.body);
    h.transport().deliver(COMMANDS, c.body, { dup: true });
    h.transport().deliver(COMMANDS, c.body, { dup: true });
    expect(h.actuations).toHaveLength(1);
    expect(h.events('LOCK_UNLOCKED')).toHaveLength(1);
    const acks = h.events('COMMAND_ACKNOWLEDGED');
    expect(acks.map((a) => a.result)).toEqual(['ACCEPTED', 'ALREADY_APPLIED', 'ALREADY_APPLIED']);
    expect(new Set(acks.map((a) => a.commandMessageId))).toEqual(new Set([c.messageId]));
    expect(new Set(acks.map((a) => a.messageId)).size).toBe(3);
    expect(h.journal.entries()).toHaveLength(1);
  });

  it('keeps the known outcome after the command expired', async () => {
    const h = online();
    const c = command();
    h.transport().deliver(COMMANDS, c.body);
    await vi.advanceTimersByTimeAsync(300_000);
    h.transport().deliver(COMMANDS, c.body, { dup: true });
    expect(h.events('COMMAND_ACKNOWLEDGED').at(-1)).toMatchObject({ result: 'ALREADY_APPLIED' });
    expect(h.actuations).toHaveLength(1);
  });

  it('repeats a rejection identically even after the cause disappeared', () => {
    const h = online();
    h.sim.updateCompartment('A1', { connectionStatus: 'DISCONNECTED' });
    const c = command();
    h.transport().deliver(COMMANDS, c.body);
    h.sim.updateCompartment('A1', { connectionStatus: 'CONNECTED' });
    h.transport().deliver(COMMANDS, c.body, { dup: true });
    expect(h.events().map((e) => e.reason)).toEqual(['CELL_UNREACHABLE', 'CELL_UNREACHABLE']);
    expect(h.actuations).toEqual([]);
  });

  it('answers a different command of an executed operation with ALREADY_APPLIED, without actuation', () => {
    const h = online();
    const first = command();
    h.transport().deliver(COMMANDS, first.body);
    const second = command({ operationId: first.operationId });
    h.transport().deliver(COMMANDS, second.body);
    expect(h.actuations).toHaveLength(1);
    expect(h.events('COMMAND_ACKNOWLEDGED').at(-1)).toMatchObject({
      commandMessageId: second.messageId,
      operationId: first.operationId,
      result: 'ALREADY_APPLIED',
    });
    expect(h.journal.findByMessageId(second.messageId)).toMatchObject({ state: 'ACKNOWLEDGED', executed: false });
  });

  it('keeps deduplicating across a reboot of the hub', async () => {
    const h = online();
    const c = command();
    h.transport().deliver(COMMANDS, c.body);
    await h.sim.restart('SOFTWARE_RESET');
    h.accept();
    h.transport().deliver(COMMANDS, c.body, { dup: true });
    expect(h.actuations).toHaveLength(1);
    expect(h.events('COMMAND_ACKNOWLEDGED').at(-1)).toMatchObject({ result: 'ALREADY_APPLIED', bootCount: 4 });
  });

  describe('a messageId reused with another content (§10.1, §23.2 point 10)', () => {
    function reuse(c: { messageId: string }) {
      return command({ messageId: c.messageId, operationId: randomUUID(), compartmentId: A2 });
    }

    function expectNoTrace(h: ReturnType<typeof online>, other: { operationId: string }) {
      expect(h.events().filter((e) => e.operationId === other.operationId)).toEqual([]);
      expect(h.events().filter((e) => e.compartmentId === A2)).toEqual([]);
      expect(h.sim.compartment('A2').lockState).toBe('LOCKED');
      expect(h.actuations.filter((a) => a.compartmentId === A2)).toEqual([]);
    }

    it('answers with the journaled operation and cell after an execution, and actuates nothing', () => {
      const h = online();
      const c = command();
      h.transport().deliver(COMMANDS, c.body);
      const other = reuse(c);
      h.transport().deliver(COMMANDS, other.body);

      expect(h.actuations).toEqual([{ compartmentId: A1, operationId: c.operationId }]);
      expect(h.events('COMMAND_ACKNOWLEDGED').at(-1)).toMatchObject({
        commandMessageId: c.messageId,
        operationId: c.operationId,
        compartmentId: A1,
        result: 'ALREADY_APPLIED',
      });
      expectNoTrace(h, other);
      expect(h.journal.entries()).toEqual([expect.objectContaining({ messageId: c.messageId, operationId: c.operationId, compartmentId: A1 })]);
    });

    it('repeats the journaled rejection with its own operation and cell, even when the new cell could open', () => {
      const h = online();
      h.sim.updateCompartment('A1', { connectionStatus: 'DISCONNECTED' });
      const c = command();
      h.transport().deliver(COMMANDS, c.body);
      const other = reuse(c);
      h.transport().deliver(COMMANDS, other.body);

      expect(h.actuations).toEqual([]);
      expect(h.events('COMMAND_REJECTED')).toEqual([
        expect.objectContaining({ commandMessageId: c.messageId, operationId: c.operationId, compartmentId: A1, reason: 'CELL_UNREACHABLE' }),
        expect.objectContaining({ commandMessageId: c.messageId, operationId: c.operationId, compartmentId: A1, reason: 'CELL_UNREACHABLE' }),
      ]);
      expectNoTrace(h, other);
    });

    it('keeps the journaled correlation across a reboot and after an uncertain execution', async () => {
      const h = online();
      const done = command();
      h.transport().deliver(COMMANDS, done.body);
      await vi.advanceTimersByTimeAsync(15_000);
      h.sim.armFault('CRASH_DURING_ACTUATION');
      const uncertain = command();
      h.transport().deliver(COMMANDS, uncertain.body);
      await vi.advanceTimersByTimeAsync(0);
      h.sim.start();
      h.accept();
      await vi.advanceTimersByTimeAsync(0);

      const reusedDone = reuse(done);
      const reusedUncertain = reuse(uncertain);
      h.transport().deliver(COMMANDS, reusedDone.body);
      h.transport().deliver(COMMANDS, reusedUncertain.body);

      expect(h.actuations).toHaveLength(2);
      expect(h.events('COMMAND_ACKNOWLEDGED').at(-1)).toMatchObject({
        commandMessageId: done.messageId,
        operationId: done.operationId,
        compartmentId: A1,
        result: 'ALREADY_APPLIED',
      });
      expect(h.events('COMMAND_REJECTED').at(-1)).toMatchObject({
        commandMessageId: uncertain.messageId,
        operationId: uncertain.operationId,
        compartmentId: A1,
        reason: 'PREVIOUS_EXECUTION_UNCERTAIN',
      });
      expectNoTrace(h, reusedDone);
      expectNoTrace(h, reusedUncertain);
    });
  });

  describe('with the journal file, across simulator processes', () => {
    let dir: string;
    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), 'aegis-journal-'));
    });
    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    function process(file: string) {
      const { factory, instances } = fakeTransportFactory();
      const config = defineConfig({ password: 'test-only', deviceKey: 'unit-bench', commandJournalFile: file });
      const sim = new HubSimulator(config, {
        transportFactory: factory,
        random: () => 0.5,
        bootCounter: new MemoryBootCounter(),
        commandJournal: new FileCommandJournal(file, 'unit-bench'),
      });
      const actuations: string[] = [];
      sim.on('actuated', (_, operationId) => actuations.push(operationId));
      sim.start();
      instances[0]!.brokerAccept();
      return { sim, transport: instances[0]!, actuations };
    }

    it('a new process answers ALREADY_APPLIED for a command consumed by the previous one', async () => {
      const file = join(dir, 'journal.json');
      const c = command();
      const first = process(file);
      first.transport.deliver(COMMANDS, c.body);
      await first.sim.crash();
      const second = process(file);
      second.transport.deliver(COMMANDS, c.body, { dup: true });
      expect(first.actuations).toHaveLength(1);
      expect(second.actuations).toEqual([]);
      expect(second.transport.published.at(-1)!.payload).toMatchObject({ type: 'COMMAND_ACKNOWLEDGED', result: 'ALREADY_APPLIED' });
    });
  });
});

describe('restart in the middle of an execution (doc 10 §9.1, §16.1, §23.6 point 2)', () => {
  it('never re-actuates: the EXECUTING entry becomes PREVIOUS_EXECUTION_UNCERTAIN, reported after boot', async () => {
    const h = online();
    h.sim.armFault('CRASH_DURING_ACTUATION');
    const c = command();
    const acknowledged = h.transport().deliver(COMMANDS, c.body);
    await vi.advanceTimersByTimeAsync(0);

    // Power lost after the actuation: no acknowledgement, no PUBACK, entry still EXECUTING.
    expect(acknowledged).toBe(false);
    expect(h.sim.state).toBe('stopped');
    expect(h.actuations).toHaveLength(1);
    expect(h.events()).toEqual([]);
    expect(h.journal.entries()).toEqual([expect.objectContaining({ state: 'EXECUTING', executed: true })]);

    h.sim.start();
    expect(h.sim.compartment('A1').lockState).toBe('LOCKED');
    expect(h.journal.entries()).toEqual([
      expect.objectContaining({ state: 'REJECTED', reason: 'PREVIOUS_EXECUTION_UNCERTAIN', pendingReport: true }),
    ]);
    h.accept();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.transport().types()).toEqual(['DEVICE_AVAILABILITY', 'DEVICE_RESTARTED', 'HEARTBEAT', 'COMMAND_REJECTED']);
    expect(h.events('COMMAND_REJECTED')).toEqual([
      expect.objectContaining({
        reason: 'PREVIOUS_EXECUTION_UNCERTAIN',
        commandMessageId: c.messageId,
        operationId: c.operationId,
        compartmentId: A1,
        bootCount: 4,
      }),
    ]);
    // Delivered: the report is not repeated at the next boot.
    expect(h.journal.entries()[0]!.pendingReport).toBeUndefined();

    // The broker redelivers the never-acknowledged command.
    h.transport().deliver(COMMANDS, c.body, { dup: true });
    expect(h.actuations).toHaveLength(1);
    expect(h.events('COMMAND_REJECTED').map((e) => e.reason)).toEqual(['PREVIOUS_EXECUTION_UNCERTAIN', 'PREVIOUS_EXECUTION_UNCERTAIN']);
    // A new command for the same operation is not executed either.
    h.transport().deliver(COMMANDS, command({ operationId: c.operationId }).body);
    expect(h.actuations).toHaveLength(1);
    expect(h.events().at(-1)).toMatchObject({ type: 'COMMAND_REJECTED', reason: 'PREVIOUS_EXECUTION_UNCERTAIN' });
  });

  it('reports the uncertainty again at the next boot when the broker never acknowledged it', async () => {
    const h = online();
    h.sim.armFault('CRASH_DURING_ACTUATION');
    h.transport().deliver(COMMANDS, command().body);
    await vi.advanceTimersByTimeAsync(0);
    h.sim.start();
    h.transport().acknowledge = false;
    h.accept();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.events('COMMAND_REJECTED')).toHaveLength(1);
    await h.sim.restart();
    h.accept();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.events('COMMAND_REJECTED').map((e) => e.bootCount)).toEqual([4, 5]);
    expect(h.actuations).toHaveLength(1);
  });

  it('reports nothing on a reboot after a completed command', async () => {
    const h = harness();
    h.sim.start();
    h.accept();
    h.transport().deliver(COMMANDS, command().body);
    await h.sim.restart();
    h.accept();
    expect(h.transport().types()).toEqual(['DEVICE_AVAILABILITY', 'DEVICE_RESTARTED', 'HEARTBEAT']);
  });
});
