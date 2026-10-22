import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CommandJournalError,
  FileCommandJournal,
  JOURNAL_MAX_ENTRIES,
  MemoryCommandJournal,
  defaultCommandJournalFile,
  type JournalEntry,
} from '../../src/command-journal.ts';

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-09-16T14:31:00Z');

function entry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    messageId: randomUUID(),
    operationId: randomUUID(),
    compartmentId: '1ae77ae3-8490-4f09-9412-a7816b77bff9',
    state: 'ACKNOWLEDGED',
    executed: true,
    recordedAt: T0,
    ...overrides,
  };
}

describe('retention (doc 10 §16.1)', () => {
  it('keeps every entry younger than 24 hours, even beyond 64', () => {
    const journal = new MemoryCommandJournal();
    for (let i = 0; i < 100; i++) journal.record(entry({ recordedAt: T0 + i }));
    expect(journal.entries()).toHaveLength(100);
  });

  it('keeps at least the last 64 entries, even older than 24 hours', () => {
    const journal = new MemoryCommandJournal();
    for (let i = 0; i < 70; i++) journal.record(entry({ recordedAt: T0 + i }));
    journal.record(entry({ recordedAt: T0 + 2 * DAY }));
    expect(journal.entries()).toHaveLength(64);
    expect(journal.entries()[0]!.recordedAt).toBe(T0 + 7);
  });

  it(`never grows beyond ${JOURNAL_MAX_ENTRIES} entries`, () => {
    const journal = new MemoryCommandJournal();
    for (let i = 0; i < JOURNAL_MAX_ENTRIES + 10; i++) journal.record(entry({ recordedAt: T0 + i }));
    expect(journal.entries()).toHaveLength(JOURNAL_MAX_ENTRIES);
    expect(journal.entries()[0]!.recordedAt).toBe(T0 + 10);
  });

  it('replaces an entry in place when its command changes state', () => {
    const journal = new MemoryCommandJournal();
    const e = entry({ state: 'EXECUTING' });
    journal.record(e);
    journal.record(entry());
    journal.record({ ...e, state: 'ACKNOWLEDGED' });
    expect(journal.entries().map((x) => x.state)).toEqual(['ACKNOWLEDGED', 'ACKNOWLEDGED']);
    expect(journal.entries()[0]!.messageId).toBe(e.messageId);
  });

  it('keeps its previous content when a write fails', () => {
    const journal = new MemoryCommandJournal();
    journal.record(entry());
    journal.failWrites = true;
    expect(() => journal.record(entry())).toThrow(CommandJournalError);
    expect(journal.entries()).toHaveLength(1);
  });
});

describe('boot recovery (doc 10 §9.1)', () => {
  it('turns EXECUTING into a PREVIOUS_EXECUTION_UNCERTAIN rejection to report, until reported', () => {
    const journal = new MemoryCommandJournal();
    const executing = entry({ state: 'EXECUTING' });
    journal.record(entry());
    journal.record(executing);
    const pending = journal.recover(T0 + 1_000);
    expect(pending).toEqual([
      expect.objectContaining({
        messageId: executing.messageId,
        state: 'REJECTED',
        reason: 'PREVIOUS_EXECUTION_UNCERTAIN',
        executed: true,
        pendingReport: true,
      }),
    ]);
    expect(journal.recover(T0 + 2_000)).toHaveLength(1);
    journal.markReported(executing.messageId, T0 + 3_000);
    expect(journal.recover(T0 + 4_000)).toEqual([]);
    expect(journal.findByMessageId(executing.messageId)).toMatchObject({ state: 'REJECTED', reason: 'PREVIOUS_EXECUTION_UNCERTAIN' });
  });

  it('finds an executed operation, not one only rejected before actuation', () => {
    const journal = new MemoryCommandJournal();
    const rejected = entry({ state: 'REJECTED', executed: false, reason: 'CELL_UNREACHABLE' });
    journal.record(rejected);
    expect(journal.findExecutedByOperation(rejected.operationId)).toBeUndefined();
    const done = entry();
    journal.record(done);
    expect(journal.findExecutedByOperation(done.operationId)?.messageId).toBe(done.messageId);
  });
});

describe('FileCommandJournal', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aegis-journal-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('persists every write and reads it back in a new instance', () => {
    const file = join(dir, 'nested', 'journal.json');
    const first = new FileCommandJournal(file, 'hub-1');
    first.recover(T0);
    const e = entry({ state: 'REJECTED', executed: false, reason: 'COMMAND_EXPIRED', detail: 'expired' });
    first.record(e);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const second = new FileCommandJournal(file, 'hub-1');
    second.recover(T0);
    expect(second.findByMessageId(e.messageId)).toEqual(e);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ version: 1, deviceKey: 'hub-1' });
  });

  it('starts empty without a file', () => {
    const journal = new FileCommandJournal(join(dir, 'absent.json'), 'hub-1');
    expect(journal.recover(T0)).toEqual([]);
    expect(journal.entries()).toEqual([]);
  });

  it.each([
    ['not json', /not valid JSON/],
    [JSON.stringify({ version: 2, deviceKey: 'hub-1', entries: [] }), /unexpected shape/],
    [JSON.stringify({ version: 1, deviceKey: 'hub-2', entries: [] }), /another deviceKey/],
    [JSON.stringify({ version: 1, deviceKey: 'hub-1', entries: [{ messageId: 'x' }] }), /invalid entry 0/],
  ])('refuses a malformed file instead of forgetting consumed commands (%s)', (content, message) => {
    const file = join(dir, 'journal.json');
    writeFileSync(file, content);
    expect(() => new FileCommandJournal(file, 'hub-1').recover(T0)).toThrow(message);
  });

  it('lives outside the repository by default, one file per deviceKey', () => {
    expect(defaultCommandJournalFile('hub-1', { XDG_STATE_HOME: '/state' })).toBe('/state/aegis/hub-simulator/command-journal-hub-1.json');
  });
});
