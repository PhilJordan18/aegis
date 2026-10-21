import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { BOOT_COUNT_MAX, BOOT_COUNT_MIN } from './contract.ts';

/**
 * Source of the `bootCount` of each boot (doc 10 §8.1, schema 2.0). The firmware
 * keeps it in NVS; the simulator keeps it in a state file outside the repository,
 * so that a restarted process never reuses a count a backend has already seen.
 */
export interface BootCounter {
  /** Reserves and durably records the count of a new boot. */
  next(): number;
}

export class BootCounterError extends Error {
  override name = 'BootCounterError';
}

/**
 * Default state file of one hub identity:
 * `$XDG_STATE_HOME/aegis/hub-simulator/boot-count-<deviceKey>.json`. One file per
 * deviceKey, so that simulators of different hubs never rewrite the same file and
 * cannot lose each other's update (there is no file lock).
 */
export function defaultBootCountFile(deviceKey: string, env: NodeJS.ProcessEnv = process.env): string {
  const stateHome = env.XDG_STATE_HOME && env.XDG_STATE_HOME.length > 0 ? env.XDG_STATE_HOME : join(homedir(), '.local', 'state');
  return join(stateHome, 'aegis', 'hub-simulator', `boot-count-${deviceKey}.json`);
}

export function isValidBootCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= BOOT_COUNT_MIN && value <= BOOT_COUNT_MAX;
}

interface BootCountFile {
  version: 1;
  bootCounts: Record<string, number>;
}

/**
 * Persists the last bootCount per deviceKey in one JSON file. `firstBootCount`
 * replaces the stored value for the first boot only: tests use it, and a deliberate
 * reset after re-provisioning sets it to 1.
 *
 * A missing file starts at 1. An unreadable or malformed file is an error, never a
 * silent restart at 1, which a backend would rank as an older session.
 */
export class FileBootCounter implements BootCounter {
  readonly path: string;
  readonly deviceKey: string;
  #pendingFirst: number | undefined;

  constructor(path: string, deviceKey: string, firstBootCount?: number) {
    if (firstBootCount !== undefined && !isValidBootCount(firstBootCount)) {
      throw new BootCounterError(`first bootCount must be an integer from ${BOOT_COUNT_MIN} to ${BOOT_COUNT_MAX}, got ${firstBootCount}`);
    }
    this.path = path;
    this.deviceKey = deviceKey;
    this.#pendingFirst = firstBootCount;
  }

  next(): number {
    const state = this.#read();
    const last = state.bootCounts[this.deviceKey];
    const value = this.#pendingFirst ?? (last === undefined ? 1 : last + 1);
    if (!isValidBootCount(value)) {
      throw new BootCounterError(`bootCount for ${this.deviceKey} cannot advance past ${last}`);
    }
    state.bootCounts[this.deviceKey] = value;
    this.#write(state);
    this.#pendingFirst = undefined;
    return value;
  }

  #read(): BootCountFile {
    let raw: string;
    try {
      raw = readFileSync(this.path, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, bootCounts: {} };
      throw new BootCounterError(`cannot read boot count file ${this.path}: ${(error as Error).message}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BootCounterError(`boot count file ${this.path} is not valid JSON`);
    }
    const counts = (parsed as Partial<BootCountFile> | null)?.bootCounts;
    if ((parsed as Partial<BootCountFile> | null)?.version !== 1 || typeof counts !== 'object' || counts === null || Array.isArray(counts)) {
      throw new BootCounterError(`boot count file ${this.path} has an unexpected shape`);
    }
    for (const [key, value] of Object.entries(counts)) {
      if (!isValidBootCount(value)) throw new BootCounterError(`boot count file ${this.path}: invalid count for ${key}`);
    }
    return { version: 1, bootCounts: { ...counts } };
  }

  #write(state: BootCountFile): void {
    // Write then rename, so a crash mid-write never leaves a truncated file.
    const temporary = `${this.path}.${process.pid}.tmp`;
    try {
      mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
      writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      renameSync(temporary, this.path);
    } catch (error) {
      throw new BootCounterError(`cannot write boot count file ${this.path}: ${(error as Error).message}`);
    }
  }
}

/** Volatile counter for tests: `last` is the count of the boot before the first one. */
export class MemoryBootCounter implements BootCounter {
  #last: number;

  constructor(last = 0) {
    this.#last = last;
  }

  next(): number {
    this.#last += 1;
    return this.#last;
  }
}
