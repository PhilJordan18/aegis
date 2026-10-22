import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { simulatorStateDirectory } from './boot-counter.ts';
import {
  COMMAND_REJECT_REASONS,
  JOURNAL_MIN_ENTRIES,
  JOURNAL_MIN_RETENTION_MS,
  isCanonicalUuid,
  type CommandRejectReason,
} from './contract.ts';

/** Doc 10 §16.1 local states of a consumed command. */
export type JournalState = 'EXECUTING' | 'ACKNOWLEDGED' | 'REJECTED';

export interface JournalEntry {
  readonly messageId: string;
  readonly operationId: string;
  readonly compartmentId: string;
  readonly state: JournalState;
  /** The command reached EXECUTING: an actuation was attempted and its operation is consumed. */
  readonly executed: boolean;
  readonly reason?: CommandRejectReason;
  readonly detail?: string;
  /** Epoch milliseconds of the last transition. */
  readonly recordedAt: number;
  /** A PREVIOUS_EXECUTION_UNCERTAIN rejection the broker has not acknowledged yet. */
  readonly pendingReport?: boolean;
}

export class CommandJournalError extends Error {
  override name = 'CommandJournalError';
}

/**
 * Hard cap above the §16.1 minimums (24 hours and 64 commands), so that a burst of
 * commands cannot grow the journal without bound. Reached only above about 1000
 * commands a day, far beyond a P0 locker.
 */
export const JOURNAL_MAX_ENTRIES = 1_024;

export const UNCERTAIN_DETAIL = 'The hub restarted while this command was executing; the lock was not actuated again.';

/**
 * Doc 10 §16.1 bounded journal of consumed commands, the deduplication memory of the
 * hub. The firmware keeps it in a flash ring; the simulator persists it like the boot
 * counter, so that a restarted process keeps deduplicating. Every mutation is
 * persisted before it returns: EXECUTING is durable before the actuation starts.
 */
export abstract class CommandJournal {
  #entries: JournalEntry[] = [];

  /** Reads the durable copy, as a boot reads NVS. */
  protected abstract load(): JournalEntry[];
  /** Writes the durable copy; throws CommandJournalError when it cannot. */
  protected abstract save(entries: readonly JournalEntry[]): void;

  /**
   * Boot recovery: reloads the journal, then turns every entry left EXECUTING into
   * a PREVIOUS_EXECUTION_UNCERTAIN rejection to report (§9.1). Returns the
   * rejections not yet acknowledged by the broker, oldest first.
   */
  recover(nowMs: number): JournalEntry[] {
    this.#entries = this.load();
    let changed = false;
    this.#entries = this.#entries.map((entry) => {
      if (entry.state !== 'EXECUTING') return entry;
      changed = true;
      return {
        ...entry,
        state: 'REJECTED',
        reason: 'PREVIOUS_EXECUTION_UNCERTAIN',
        detail: UNCERTAIN_DETAIL,
        recordedAt: nowMs,
        pendingReport: true,
      };
    });
    if (changed) this.save(this.#entries);
    return this.#entries.filter((e) => e.pendingReport === true);
  }

  findByMessageId(messageId: string): JournalEntry | undefined {
    return this.#entries.find((e) => e.messageId === messageId);
  }

  /** The command of this operation that already reached EXECUTING, if any. */
  findExecutedByOperation(operationId: string): JournalEntry | undefined {
    return this.#entries.find((e) => e.operationId === operationId && e.executed);
  }

  /**
   * Inserts or replaces the entry of `entry.messageId`, prunes, then persists. The
   * in-memory copy changes only once the durable write succeeded.
   */
  record(entry: JournalEntry, nowMs: number = entry.recordedAt): void {
    const exists = this.#entries.some((e) => e.messageId === entry.messageId);
    const next = exists
      ? this.#entries.map((e) => (e.messageId === entry.messageId ? entry : e))
      : [...this.#entries, entry];
    const pruned = prune(next, nowMs);
    this.save(pruned);
    this.#entries = pruned;
  }

  /** The broker acknowledged the PREVIOUS_EXECUTION_UNCERTAIN report of this command. */
  markReported(messageId: string, nowMs: number): void {
    const entry = this.findByMessageId(messageId);
    if (!entry || entry.pendingReport !== true) return;
    const { pendingReport: _, ...reported } = entry;
    this.record(reported, nowMs);
  }

  entries(): readonly JournalEntry[] {
    return this.#entries;
  }
}

/** Keeps the last 64 entries and every entry younger than 24 hours, within the hard cap. */
function prune(entries: JournalEntry[], nowMs: number): JournalEntry[] {
  const keep = entries.filter(
    (e, i) =>
      e.state === 'EXECUTING' ||
      e.pendingReport === true ||
      i >= entries.length - JOURNAL_MIN_ENTRIES ||
      nowMs - e.recordedAt < JOURNAL_MIN_RETENTION_MS,
  );
  while (keep.length > JOURNAL_MAX_ENTRIES) {
    const oldest = keep.findIndex((e) => e.state !== 'EXECUTING' && e.pendingReport !== true);
    if (oldest < 0) break;
    keep.splice(oldest, 1);
  }
  return keep;
}

/** Volatile journal for tests; its copy survives `recover()`, like NVS survives a reboot. */
export class MemoryCommandJournal extends CommandJournal {
  #durable: JournalEntry[] = [];
  /** true: every write fails, as a worn-out flash would. */
  failWrites = false;

  protected load(): JournalEntry[] {
    return this.#durable.map((e) => ({ ...e }));
  }

  protected save(entries: readonly JournalEntry[]): void {
    if (this.failWrites) throw new CommandJournalError('simulated journal write failure');
    this.#durable = entries.map((e) => ({ ...e }));
  }
}

/** `$XDG_STATE_HOME/aegis/hub-simulator/command-journal-<deviceKey>.json`, outside the repository. */
export function defaultCommandJournalFile(deviceKey: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(simulatorStateDirectory(env), `command-journal-${deviceKey}.json`);
}

interface JournalFile {
  version: 1;
  deviceKey: string;
  entries: Array<Omit<JournalEntry, 'recordedAt'> & { recordedAt: string }>;
}

const STATES: readonly string[] = ['EXECUTING', 'ACKNOWLEDGED', 'REJECTED'];

/**
 * One JSON file per deviceKey, written then renamed so that a crash mid-write never
 * leaves a truncated journal. A malformed file stops the boot instead of silently
 * forgetting which commands were consumed.
 */
export class FileCommandJournal extends CommandJournal {
  readonly path: string;
  readonly deviceKey: string;

  constructor(path: string, deviceKey: string) {
    super();
    this.path = path;
    this.deviceKey = deviceKey;
  }

  protected load(): JournalEntry[] {
    let raw: string;
    try {
      raw = readFileSync(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw new CommandJournalError(`cannot read command journal ${this.path}: ${(error as Error).message}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new CommandJournalError(`command journal ${this.path} is not valid JSON`);
    }
    const file = parsed as Partial<JournalFile> | null;
    if (file?.version !== 1 || file.deviceKey !== this.deviceKey || !Array.isArray(file.entries)) {
      throw new CommandJournalError(`command journal ${this.path} has an unexpected shape or another deviceKey`);
    }
    return file.entries.map((e, i) => {
      const recordedAt = Date.parse(String(e?.recordedAt));
      const valid =
        isCanonicalUuid(e?.messageId) &&
        isCanonicalUuid(e.operationId) &&
        isCanonicalUuid(e.compartmentId) &&
        STATES.includes(e.state) &&
        typeof e.executed === 'boolean' &&
        (e.reason === undefined || (COMMAND_REJECT_REASONS as readonly string[]).includes(e.reason)) &&
        (e.detail === undefined || typeof e.detail === 'string') &&
        (e.pendingReport === undefined || typeof e.pendingReport === 'boolean') &&
        !Number.isNaN(recordedAt);
      if (!valid) throw new CommandJournalError(`command journal ${this.path}: invalid entry ${i}`);
      return { ...e, recordedAt };
    });
  }

  protected save(entries: readonly JournalEntry[]): void {
    const file: JournalFile = {
      version: 1,
      deviceKey: this.deviceKey,
      entries: entries.map((e) => ({ ...e, recordedAt: new Date(e.recordedAt).toISOString() })),
    };
    const temporary = `${this.path}.${process.pid}.tmp`;
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 });
      renameSync(temporary, this.path);
    } catch (error) {
      throw new CommandJournalError(`cannot write command journal ${this.path}: ${(error as Error).message}`);
    }
  }
}
