import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  AVAILABILITY_REASONS,
  CELL_CONNECTION_STATUSES,
  COMMAND_TYPE,
  CONNECTION_SCOPED_TYPES,
  DOOR_STATES,
  HUB_MESSAGE_TYPES,
  LOCK_STATES,
  READER_STATUSES,
  RESET_REASONS,
  RFID_WINDOW_MAX_MS,
  SCHEMA_VERSION,
  isCanonicalUuid,
  isResetReason,
  type AvailabilityReason,
  type HubMessageType,
  type ResetReason,
} from './contract.ts';
import { MAX_TRACKED_BOOTS, MAX_TRACKED_CONNECTIONS, type ReplaySelector } from './emission-log.ts';
import { ACTUATION_FAULTS, type ActuationFault, type CompartmentPatch, type HubSimulator } from './simulator.ts';

/**
 * A command built by the scenario and handed to the hub as if the broker had
 * delivered it, for runs without a backend. Times are relative to the step.
 */
export interface ReceiveCommandStep {
  readonly do: 'receiveCommand';
  /** Name under which `redeliverCommand` finds this exact body again. */
  readonly ref: string;
  /** Target cell by scenario code, or `compartmentId` for a raw (possibly unknown) UUID. */
  readonly compartment?: string;
  readonly compartmentId?: string;
  /** Label of the operation; two commands with the same label share one operationId. */
  readonly operation?: string;
  /** Overrides the lockerId of the command (wrong locker). */
  readonly lockerId?: string;
  readonly issuedInMs?: number;
  readonly expiresInMs?: number;
  readonly schemaVersion?: string;
}

/**
 * A scripted run. Each step completes before the next one starts. The hub and the
 * physical world are scripted here; the hub itself decides nothing beyond its
 * technical checks.
 */
export type ScenarioStep =
  | { readonly wait: number }
  | { readonly do: 'waitOnline'; readonly timeoutMs?: number }
  | { readonly do: 'publishHeartbeat' }
  | { readonly do: 'dropConnection' }
  | { readonly do: 'restart'; readonly resetReason?: ResetReason; readonly offlineMs?: number }
  | { readonly do: 'updateCompartment'; readonly code: string; readonly patch: CompartmentPatch }
  | ({ readonly do: 'replay' } & ReplaySelector)
  | { readonly do: 'stop' }
  | { readonly do: 'crash' }
  | { readonly do: 'openDoor'; readonly code: string; readonly forced?: boolean }
  | { readonly do: 'closeDoor'; readonly code: string }
  | { readonly do: 'putTag'; readonly code: string; readonly identifier: string; readonly readCount?: number }
  | { readonly do: 'takeTag'; readonly code: string; readonly identifier: string }
  | { readonly do: 'scanRfid'; readonly code: string; readonly windowMs?: number }
  | { readonly do: 'setClock'; readonly synchronized: boolean }
  | { readonly do: 'setScreen'; readonly available: boolean }
  | { readonly do: 'armFault'; readonly fault: ActuationFault }
  | { readonly do: 'waitUnlocked'; readonly code: string; readonly timeoutMs?: number }
  | ReceiveCommandStep
  | { readonly do: 'redeliverCommand'; readonly ref: string };

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
const LABEL = /^[A-Za-z0-9_-]{1,32}$/;
const RELATIVE_MAX_MS = 3_600_000;

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
      const { resetReason, offlineMs } = raw;
      if (resetReason !== undefined && !isResetReason(resetReason)) {
        return fail(`resetReason must be one of ${RESET_REASONS.join(', ')}`);
      }
      if (offlineMs !== undefined && (typeof offlineMs !== 'number' || !Number.isInteger(offlineMs) || offlineMs < 0 || offlineMs > MAX_WAIT_MS)) {
        return fail(`offlineMs must be an integer in 0..${MAX_WAIT_MS}`);
      }
      return {
        do: 'restart',
        ...(resetReason !== undefined ? { resetReason } : {}),
        ...(offlineMs !== undefined ? { offlineMs } : {}),
      };
    }
    case 'openDoor': {
      const code = requireCode(raw, fail);
      if (raw.forced !== undefined && typeof raw.forced !== 'boolean') return fail('forced must be a boolean');
      return { do: 'openDoor', code, ...(raw.forced !== undefined ? { forced: raw.forced } : {}) };
    }
    case 'closeDoor':
      return { do: 'closeDoor', code: requireCode(raw, fail) };
    case 'putTag':
    case 'takeTag': {
      const code = requireCode(raw, fail);
      if (typeof raw.identifier !== 'string' || raw.identifier.length === 0) return fail('identifier must be a non-empty string');
      if (raw.do === 'takeTag') return { do: 'takeTag', code, identifier: raw.identifier };
      const readCount = optionalInteger(raw, 'readCount', 1, 65_535, fail);
      return { do: 'putTag', code, identifier: raw.identifier, ...(readCount !== undefined ? { readCount } : {}) };
    }
    case 'scanRfid': {
      const code = requireCode(raw, fail);
      const windowMs = optionalInteger(raw, 'windowMs', 1, RFID_WINDOW_MAX_MS, fail);
      return { do: 'scanRfid', code, ...(windowMs !== undefined ? { windowMs } : {}) };
    }
    case 'setClock':
      if (typeof raw.synchronized !== 'boolean') return fail('synchronized must be a boolean');
      return { do: 'setClock', synchronized: raw.synchronized };
    case 'setScreen':
      if (typeof raw.available !== 'boolean') return fail('available must be a boolean');
      return { do: 'setScreen', available: raw.available };
    case 'armFault': {
      const fault = raw.fault;
      if (typeof fault !== 'string' || !(ACTUATION_FAULTS as readonly string[]).includes(fault)) {
        return fail(`fault must be one of ${ACTUATION_FAULTS.join(', ')}`);
      }
      return { do: 'armFault', fault: fault as ActuationFault };
    }
    case 'waitUnlocked': {
      const code = requireCode(raw, fail);
      const timeoutMs = optionalInteger(raw, 'timeoutMs', 1, MAX_WAIT_MS, fail);
      return { do: 'waitUnlocked', code, ...(timeoutMs !== undefined ? { timeoutMs } : {}) };
    }
    case 'receiveCommand':
      return parseReceiveCommand(raw, fail);
    case 'redeliverCommand':
      if (typeof raw.ref !== 'string' || !LABEL.test(raw.ref)) return fail('ref must be 1-32 letters, digits, "_" or "-"');
      return { do: 'redeliverCommand', ref: raw.ref };
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

function requireCode(raw: Record<string, unknown>, fail: (reason: string) => never): string {
  if (typeof raw.code !== 'string' || raw.code.length === 0) return fail('code must be a compartment code');
  return raw.code;
}

function optionalInteger(
  raw: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  fail: (reason: string) => never,
): number | undefined {
  const value = raw[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return fail(`${key} must be an integer in ${min}..${max}`);
  }
  return value;
}

function parseReceiveCommand(raw: Record<string, unknown>, fail: (reason: string) => never): ReceiveCommandStep {
  const allowed = ['do', 'ref', 'compartment', 'compartmentId', 'operation', 'lockerId', 'issuedInMs', 'expiresInMs', 'schemaVersion'];
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) fail(`unknown receiveCommand field ${key}`);
  const { ref, compartment, compartmentId, operation, lockerId, schemaVersion } = raw;
  if (typeof ref !== 'string' || !LABEL.test(ref)) return fail('ref must be 1-32 letters, digits, "_" or "-"');
  if ((compartment === undefined) === (compartmentId === undefined)) return fail('give either compartment or compartmentId');
  if (compartment !== undefined && typeof compartment !== 'string') return fail('compartment must be a compartment code');
  if (compartmentId !== undefined && !isCanonicalUuid(compartmentId)) return fail('compartmentId must be a canonical UUID');
  if (operation !== undefined && (typeof operation !== 'string' || !LABEL.test(operation))) {
    return fail('operation must be 1-32 letters, digits, "_" or "-"');
  }
  if (lockerId !== undefined && !isCanonicalUuid(lockerId)) return fail('lockerId must be a canonical UUID');
  if (schemaVersion !== undefined && typeof schemaVersion !== 'string') return fail('schemaVersion must be a string');
  const issuedInMs = optionalInteger(raw, 'issuedInMs', -RELATIVE_MAX_MS, RELATIVE_MAX_MS, fail);
  const expiresInMs = optionalInteger(raw, 'expiresInMs', -RELATIVE_MAX_MS, RELATIVE_MAX_MS, fail);
  return {
    do: 'receiveCommand',
    ref,
    ...(compartment !== undefined ? { compartment } : {}),
    ...(compartmentId !== undefined ? { compartmentId } : {}),
    ...(operation !== undefined ? { operation } : {}),
    ...(lockerId !== undefined ? { lockerId } : {}),
    ...(issuedInMs !== undefined ? { issuedInMs } : {}),
    ...(expiresInMs !== undefined ? { expiresInMs } : {}),
    ...(schemaVersion !== undefined ? { schemaVersion } : {}),
  };
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
  if (connectionsAgo !== undefined && !CONNECTION_SCOPED_TYPES.includes(type as HubMessageType)) {
    return fail(`${type} carries no connectionId; select it with bootsAgo`);
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

/** Default command lifetime of `receiveCommand`, like a backend LockerOperation window. */
export const DEFAULT_COMMAND_LIFETIME_MS = 120_000;

/** Builds the UNLOCK_COMPARTMENT body of a `receiveCommand` step (doc 10 §9). */
export function buildScenarioCommand(
  simulator: HubSimulator,
  step: ReceiveCommandStep,
  operationIdOf: (label: string | undefined) => string,
  nowMs: number,
): string {
  const compartmentId = step.compartmentId ?? simulator.compartment(step.compartment!).compartmentId;
  return JSON.stringify({
    schemaVersion: step.schemaVersion ?? SCHEMA_VERSION,
    messageId: randomUUID(),
    type: COMMAND_TYPE,
    operationId: operationIdOf(step.operation),
    lockerId: step.lockerId ?? simulator.config.lockerId,
    compartmentId,
    issuedAt: new Date(nowMs + (step.issuedInMs ?? 0)).toISOString(),
    expiresAt: new Date(nowMs + (step.expiresInMs ?? DEFAULT_COMMAND_LIFETIME_MS)).toISOString(),
  });
}

export async function runScenario(
  simulator: HubSimulator,
  scenario: Scenario,
  wait: (ms: number) => Promise<unknown> = sleep,
  now: () => number = Date.now,
): Promise<void> {
  const commands = new Map<string, string>();
  const operations = new Map<string, string>();
  const operationIdOf = (label: string | undefined): string => {
    if (label === undefined) return randomUUID();
    let id = operations.get(label);
    if (!id) {
      id = randomUUID();
      operations.set(label, id);
    }
    return id;
  };
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
        await simulator.restart(step.resetReason, step.offlineMs);
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
      case 'openDoor':
        simulator.openDoor(step.code, { forced: step.forced ?? false });
        break;
      case 'closeDoor':
        simulator.closeDoor(step.code);
        break;
      case 'putTag':
        simulator.putTag(step.code, step.identifier, step.readCount);
        break;
      case 'takeTag':
        simulator.takeTag(step.code, step.identifier);
        break;
      case 'scanRfid':
        await simulator.scanRfid(step.code, step.windowMs);
        break;
      case 'setClock':
        simulator.setClockSynchronized(step.synchronized);
        break;
      case 'setScreen':
        simulator.setScreenAvailable(step.available);
        break;
      case 'armFault':
        simulator.armFault(step.fault);
        break;
      case 'waitUnlocked':
        await simulator.waitUntilUnlocked(step.code, step.timeoutMs);
        break;
      case 'receiveCommand': {
        if (commands.has(step.ref)) throw new ScenarioError(`command ref ${step.ref} is already used`);
        const body = buildScenarioCommand(simulator, step, operationIdOf, now());
        commands.set(step.ref, body);
        simulator.deliver('commands', body);
        break;
      }
      case 'redeliverCommand': {
        const body = commands.get(step.ref);
        if (!body) throw new ScenarioError(`no command was received under ref ${step.ref}`);
        // A QoS 1 redelivery: the same bytes, flagged dup by the broker.
        simulator.deliver('commands', body, { dup: true });
        break;
      }
    }
  }
}
