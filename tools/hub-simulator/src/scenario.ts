import { setTimeout as sleep } from 'node:timers/promises';
import {
  AVAILABILITY_REASONS,
  CELL_CONNECTION_STATUSES,
  DOOR_STATES,
  HUB_MESSAGE_TYPES,
  LOCK_STATES,
  READER_STATUSES,
  RESET_REASONS,
  isResetReason,
  type AvailabilityReason,
  type HubMessageType,
  type ResetReason,
} from './contract.ts';
import { MAX_TRACKED_BOOTS, MAX_TRACKED_CONNECTIONS, type ReplaySelector } from './emission-log.ts';
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
  | { readonly do: 'restart'; readonly resetReason?: ResetReason }
  | { readonly do: 'updateCompartment'; readonly code: string; readonly patch: CompartmentPatch }
  | ({ readonly do: 'replay' } & ReplaySelector)
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
      if (!isResetReason(resetReason)) return fail(`resetReason must be one of ${RESET_REASONS.join(', ')}`);
      return { do: 'restart', resetReason };
    }
    case 'replay':
      return { do: 'replay', ...parseReplaySelector(raw, fail) };
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

function parseAgo(raw: Record<string, unknown>, key: 'bootsAgo' | 'connectionsAgo', max: number, fail: (r: string) => never) {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value >= max) {
    return fail(`${key} must be an integer in 0..${max - 1}`);
  }
  return value;
}

function parseReplaySelector(raw: Record<string, unknown>, fail: (reason: string) => never): ReplaySelector {
  for (const key of Object.keys(raw)) {
    if (!['do', 'type', 'reason', 'bootsAgo', 'connectionsAgo'].includes(key)) fail(`unknown replay field ${key}`);
  }
  const type = raw.type;
  if (typeof type !== 'string' || !(HUB_MESSAGE_TYPES as readonly string[]).includes(type)) {
    return fail(`type must be one of ${HUB_MESSAGE_TYPES.join(', ')}`);
  }
  const reason = raw.reason;
  if (reason !== undefined) {
    if (type !== 'DEVICE_AVAILABILITY') return fail('reason only applies to DEVICE_AVAILABILITY');
    if (typeof reason !== 'string' || !(AVAILABILITY_REASONS as readonly string[]).includes(reason)) {
      return fail(`reason must be one of ${AVAILABILITY_REASONS.join(', ')}`);
    }
  }
  const bootsAgo = parseAgo(raw, 'bootsAgo', MAX_TRACKED_BOOTS, fail);
  const connectionsAgo = parseAgo(raw, 'connectionsAgo', MAX_TRACKED_CONNECTIONS, fail);
  if (bootsAgo !== undefined && connectionsAgo !== undefined) return fail('use bootsAgo or connectionsAgo, not both');
  if (connectionsAgo !== undefined && type === 'DEVICE_RESTARTED') {
    return fail('DEVICE_RESTARTED carries no connectionId; select it with bootsAgo');
  }
  return {
    type: type as HubMessageType,
    ...(reason !== undefined ? { reason: reason as AvailabilityReason } : {}),
    ...(bootsAgo !== undefined ? { bootsAgo } : {}),
    ...(connectionsAgo !== undefined ? { connectionsAgo } : {}),
  };
}

export function parseScenario(raw: unknown): Scenario {
  if (!isRecord(raw) || !Array.isArray(raw.steps)) {
    throw new ScenarioError('a scenario is an object with a "steps" array');
  }
  return { steps: raw.steps.map((step, index) => parseStep(step, index)) };
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
      case 'replay': {
        const { do: _, ...selector } = step;
        await simulator.replay(selector);
        break;
      }
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
