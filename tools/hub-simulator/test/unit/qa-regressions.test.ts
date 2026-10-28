// Regression tests from the independent review of SIM-02 (PR #95), built on its probes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JOURNAL_MAX_ENTRIES, MemoryCommandJournal, type JournalEntry } from '../../src/command-journal.ts';
import { A1, A2, COMMANDS, DISPLAY, OTHER_LOCKER, TOKEN, challenge, command, online } from './hub-harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-16T14:31:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

/** A journal whose next durable writes fail as listed (true = fail), then succeed. */
class FlakyJournal extends MemoryCommandJournal {
  failures: boolean[] = [];
  protected override save(entries: readonly JournalEntry[]): void {
    if (this.failures.shift() === true) throw new Error('flash write failed');
    super.save(entries);
  }
}

describe('journal bound (review finding 1)', () => {
  it('a burst of refusals never evicts an executed, still valid command: its redelivery does not actuate again', () => {
    const h = online({ unlockWindowMs: 1_000 });
    const c = command({ expiresAt: new Date(Date.now() + 3_600_000).toISOString() });
    h.transport().deliver(COMMANDS, c.body);
    vi.advanceTimersByTime(1_500);
    for (let i = 0; i < JOURNAL_MAX_ENTRIES; i++) h.transport().deliver(COMMANDS, command({ lockerId: OTHER_LOCKER }).body);
    expect(h.journal.entries().length).toBeLessThanOrEqual(JOURNAL_MAX_ENTRIES);
    expect(h.journal.findByMessageId(c.messageId)).toMatchObject({ state: 'ACKNOWLEDGED', expiresAt: Date.parse(c.expiresAt) });
    h.transport().deliver(COMMANDS, c.body, { dup: true });
    expect(h.actuations).toHaveLength(1);
    expect(h.events().at(-1)).toMatchObject({ type: 'COMMAND_ACKNOWLEDGED', commandMessageId: c.messageId, result: 'ALREADY_APPLIED' });
  });

  it('refuses a new command with INTERNAL_DEVICE_ERROR when every entry must be kept', () => {
    const h = online();
    h.sim.updateCompartment('A1', { connectionStatus: 'DISCONNECTED' });
    // Refusals that a redelivery could turn into an actuation once the cell answers.
    for (let i = 0; i < JOURNAL_MAX_ENTRIES; i++) h.transport().deliver(COMMANDS, command().body);
    expect(h.journal.entries()).toHaveLength(JOURNAL_MAX_ENTRIES);
    h.sim.updateCompartment('A1', { connectionStatus: 'CONNECTED' });
    const c = command();
    h.transport().deliver(COMMANDS, c.body);
    expect(h.actuations).toEqual([]);
    expect(h.events().at(-1)).toMatchObject({
      type: 'COMMAND_REJECTED',
      commandMessageId: c.messageId,
      reason: 'INTERNAL_DEVICE_ERROR',
      detail: expect.stringContaining('full'),
    });
  });
});

describe('second command of an executed operation (review finding 2)', () => {
  it('naming another cell is rejected INVALID_PAYLOAD, and that cell stays locked', () => {
    const h = online();
    const first = command();
    h.transport().deliver(COMMANDS, first.body);
    const second = command({ operationId: first.operationId, compartmentId: A2 });
    h.transport().deliver(COMMANDS, second.body);
    expect(h.events().at(-1)).toMatchObject({
      type: 'COMMAND_REJECTED',
      reason: 'INVALID_PAYLOAD',
      commandMessageId: second.messageId,
      compartmentId: A2,
    });
    expect(h.sim.compartment('A2').lockState).toBe('LOCKED');
    expect(h.actuations).toEqual([{ compartmentId: A1, operationId: first.operationId }]);
    h.transport().deliver(COMMANDS, second.body, { dup: true });
    expect(h.events().at(-1)).toMatchObject({ reason: 'INVALID_PAYLOAD' });
  });
});

describe('journal write failing after the decision (review finding 3)', () => {
  it('redeliveries of the boot get ALREADY_APPLIED, and after a reboot the command is reported uncertain', async () => {
    const journal = new FlakyJournal();
    const h = online({}, journal);
    // EXECUTING is written, ACKNOWLEDGED is not.
    journal.failures = [false, true];
    const c = command();
    h.transport().deliver(COMMANDS, c.body);
    h.transport().deliver(COMMANDS, c.body, { dup: true });
    const answers = h.events().filter((e) => e.commandMessageId === c.messageId);
    expect(answers.map((e) => e.result ?? e.reason)).toEqual(['ACCEPTED', 'ALREADY_APPLIED']);
    expect(h.actuations).toHaveLength(1);

    await h.sim.restart();
    h.accept();
    h.transport().deliver(COMMANDS, c.body, { dup: true });
    const afterReboot = h.events().filter((e) => e.commandMessageId === c.messageId).slice(2);
    expect(afterReboot.map((e) => e.reason)).toEqual(['PREVIOUS_EXECUTION_UNCERTAIN', 'PREVIOUS_EXECUTION_UNCERTAIN']);
    expect(h.actuations).toHaveLength(1);
  });

  it('a rejection whose write fails is answered identically to its redelivery', () => {
    const journal = new FlakyJournal();
    const h = online({}, journal);
    h.sim.updateCompartment('A1', { connectionStatus: 'DISCONNECTED' });
    journal.failures = [true];
    const c = command();
    h.transport().deliver(COMMANDS, c.body);
    h.sim.updateCompartment('A1', { connectionStatus: 'CONNECTED' });
    h.transport().deliver(COMMANDS, c.body, { dup: true });
    expect(h.events().map((e) => e.reason)).toEqual(['CELL_UNREACHABLE', 'CELL_UNREACHABLE']);
    expect(h.actuations).toEqual([]);
  });
});

describe('commands arriving during stop() (review finding 4)', () => {
  it('are neither handled nor acknowledged, so the broker redelivers them', async () => {
    const h = online();
    // SHUTDOWN waits for its PUBACK, keeping the hub in `stopping`.
    h.transport().acknowledge = false;
    const stopping = h.sim.stop();
    expect(h.sim.state).toBe('stopping');
    const c = command();
    expect(h.transport().deliver(COMMANDS, c.body)).toBe(false);
    expect(h.actuations).toEqual([]);
    expect(h.journal.findByMessageId(c.messageId)).toBeUndefined();
    await vi.advanceTimersByTimeAsync(5_000);
    await stopping;
    expect(h.sim.state).toBe('stopped');
  });
});

describe('display deadline (review finding 5)', () => {
  it('an issuedAt in the future cannot keep the QR beyond 60 s from now', async () => {
    const h = online();
    const now = Date.now();
    const d = challenge(h.sim, { issuedAt: new Date(now + 600_000).toISOString(), expiresAt: new Date(now + 660_000).toISOString() });
    h.transport().deliver(DISPLAY, d.body);
    expect(h.sim.screen).toMatchObject({ kind: 'ACCESS_CHALLENGE', until: '2026-09-16T14:32:00.000Z' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.sim.screen).toEqual({ kind: 'IDLE' });
  });

  it('never leaks the token, including for an invalid instruction and a duplicate', () => {
    const h = online();
    h.transport().deliver(DISPLAY, challenge(h.sim, { payload: { action: 'NOPE' } }).body);
    const good = challenge(h.sim, { displayRevision: 50 });
    h.transport().deliver(DISPLAY, good.body);
    h.transport().deliver(DISPLAY, good.body, { dup: true });
    const all = h.instances.flatMap((t) => t.published).map((p) => p.body).join('\n') + JSON.stringify([h.inbound, h.screens]);
    expect(all).not.toContain(TOKEN);
  });

  it('an uncorrelatable display instruction publishes nothing (no DEVICE_ERROR errorCode fits)', () => {
    const h = online();
    h.transport().deliver(DISPLAY, JSON.stringify({ type: 'DISPLAY_ACCESS_CHALLENGE', payload: { token: TOKEN } }));
    expect(h.events()).toEqual([]);
    expect(h.inbound.map((r) => r.outcome)).toEqual(['IGNORED']);
  });
});
