import { setTimeout as sleep } from 'node:timers/promises';
import { CELL_CONNECTION_STATUSES, DOOR_STATES, LOCK_STATES, READER_STATUSES } from './contract.ts';
import type { CompartmentPatch, HubSimulator } from './simulator.ts';

/**
 * A scripted run for automated tests. Each step completes before the next one starts.
 * Steps that would need commands, the display or physical observations belong to
 * SIM-02 (#39) and are intentionally absent.
 */
export type ScenarioStep =
  | { readonly wait: number }
  | { readonly do: 'waitOnline'; readonly timeoutMs?: number }
  | { readonly do: 'publishHeartbeat' }
  | { readonly do: 'dropConnection' }
  | { readonly do: 'restart'; readonly resetReason?: string }
  | { readonly do: 'updateCompartment'; readonly code: string; readonly patch: CompartmentPatch }
  | { readonly do: 'stop' }
  | { readonly do: 'crash' };

export interface Scenario {
  readonly steps: readonly ScenarioStep[];
}

export class ScenarioError extends Error {
  override name = 'ScenarioError';
}

const PATCH_VALUES: Record<keyof CompartmentPatch, readonly string[]> = {
  connectionStatus: CELL_CONNECTION_STATUSES,
  readerStatus: READER_STATUSES,
  doorState: DOOR_STATES,
  lockState: LOCK_STATES,
};

const MAX_WAIT_MS = 3_600_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStep(raw: unknown, index: number): ScenarioStep {
  const fail = (reason: string): never => {
    throw new ScenarioError(`step ${index}: ${reason}`);
  };
  if (!isRecord(raw)) return fail('must be an object');
  if ('wait' in raw) {
    const wait = raw.wait;
    if (typeof wait !== 'number' || !Number.isInteger(wait) || wait < 0 || wait > MAX_WAIT_MS) {
      return fail(`wait must be an integer number of milliseconds in 0..${MAX_WAIT_MS}`);
    }
    return { wait };
  }
  switch (raw.do) {
    case 'waitOnline': {
      const timeoutMs = raw.timeoutMs;
      if (timeoutMs === undefined) return { do: 'waitOnline' };
      if (typeof timeoutMs !== 'number' || !Number.isInteger(timeoutMs) || timeoutMs <= 0) {
        return fail('timeoutMs must be a positive integer');
      }
      return { do: 'waitOnline', timeoutMs };
    }
    case 'publishHeartbeat':
    case 'dropConnection':
    case 'stop':
    case 'crash':
      return { do: raw.do };
    case 'restart': {
      const resetReason = raw.resetReason;
      if (resetReason === undefined) return { do: 'restart' };
      if (typeof resetReason !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(resetReason)) {
        return fail('resetReason must be an UPPER_SNAKE_CASE string');
      }
      return { do: 'restart', resetReason };
    }
    case 'updateCompartment': {
      const { code, patch } = raw;
      if (typeof code !== 'string') return fail('code must be a string');
      if (!isRecord(patch)) return fail('patch must be an object');
      const parsed: Record<string, string> = {};
      for (const [key, value] of Object.entries(patch)) {
        const allowed = PATCH_VALUES[key as keyof CompartmentPatch];
        if (!allowed) return fail(`unknown patch field ${key}`);
        if (typeof value !== 'string' || !allowed.includes(value)) {
          return fail(`${key} must be one of ${allowed.join(', ')}`);
        }
        parsed[key] = value;
      }
      return { do: 'updateCompartment', code, patch: parsed as CompartmentPatch };
    }
    default:
      return fail(`unknown action ${JSON.stringify(raw.do)}`);
  }
}

export function parseScenario(raw: unknown): Scenario {
  if (!isRecord(raw) || !Array.isArray(raw.steps)) {
    throw new ScenarioError('a scenario is an object with a "steps" array');
  }
  return { steps: raw.steps.map(parseStep) };
}

export async function runScenario(
  simulator: HubSimulator,
  scenario: Scenario,
  wait: (ms: number) => Promise<unknown> = sleep,
): Promise<void> {
  for (const step of scenario.steps) {
    if ('wait' in step) {
      await wait(step.wait);
      continue;
    }
    switch (step.do) {
      case 'waitOnline':
        await simulator.waitUntilOnline(step.timeoutMs);
        break;
      case 'publishHeartbeat':
        simulator.publishHeartbeat();
        break;
      case 'dropConnection':
        await simulator.dropConnection();
        break;
      case 'restart':
        await simulator.restart(step.resetReason);
        break;
      case 'updateCompartment':
        simulator.updateCompartment(step.code, step.patch);
        break;
      case 'stop':
        await simulator.stop();
        break;
      case 'crash':
        await simulator.crash();
        break;
    }
  }
}
