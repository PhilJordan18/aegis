// Technical parsing of what the backend sends to the hub (doc 10 §8.2, §9, §27). It
// checks shape only; the simulator then checks identity, time, deduplication and the
// physical state. Nothing here decides whether an operation is authorised.
import {
  COMMAND_TYPE,
  DISPLAY_ACTIONS,
  DISPLAY_TYPES,
  MAX_PAYLOAD_BYTES,
  SUPPORTED_SCHEMA_MAJOR,
  isCanonicalUuid,
  parseInstant,
  type DisplayAction,
  type DisplayType,
} from './contract.ts';
import type { CommandCorrelation, DisplayCorrelation } from './messages.ts';

export interface UnlockCommand {
  readonly messageId: string;
  readonly operationId: string;
  readonly lockerId: string;
  readonly compartmentId: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}

/**
 * `uncorrelatable`: no COMMAND_REJECTED can be built, because messageId, operationId
 * or compartmentId is missing (§20 makes them required in the rejection).
 * `invalid`: a correlatable command whose content is refused before any other check.
 */
export type CommandParse =
  | { readonly kind: 'uncorrelatable'; readonly why: string }
  | {
      readonly kind: 'invalid';
      readonly correlation: CommandCorrelation;
      readonly reason: 'INVALID_PAYLOAD' | 'UNSUPPORTED_SCHEMA';
      readonly detail: string;
      /** expiresAt when it could be read, so that the journal keeps the refusal until then. */
      readonly expiresAtMs?: number;
    }
  | { readonly kind: 'command'; readonly correlation: CommandCorrelation; readonly command: UnlockCommand };

export interface ChallengeContent {
  readonly kind: 'challenge';
  readonly challengeId: string;
  readonly action: DisplayAction;
  readonly compartmentCode: string;
  /** Ephemeral secret (§4.3): shown in the QR only, never logged nor echoed. */
  readonly token: string;
}

export interface StatusContent {
  readonly kind: 'status';
  readonly action: DisplayAction;
  readonly compartmentCode: string;
  readonly status: string;
  readonly reasonCode: string | null;
}

export interface DisplayInstruction {
  readonly type: DisplayType;
  readonly messageId: string;
  readonly lockerId: string;
  readonly operationId: string;
  readonly compartmentId: string;
  readonly targetDeviceSessionId: string;
  readonly displayRevision: number;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly content: ChallengeContent | StatusContent;
}

export type DisplayParse =
  | { readonly kind: 'uncorrelatable'; readonly why: string }
  | { readonly kind: 'invalid'; readonly correlation: DisplayCorrelation; readonly why: string }
  | { readonly kind: 'instruction'; readonly correlation: DisplayCorrelation; readonly instruction: DisplayInstruction };

/** 32 random bytes in unpadded base64url (§27.1). */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const COMPARTMENT_CODE = /^[A-Za-z0-9-]{1,16}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,39}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function decode(body: Buffer | string): { ok: true; value: Record<string, unknown> } | { ok: false; why: string } {
  const size = typeof body === 'string' ? Buffer.byteLength(body, 'utf8') : body.length;
  // Refused before deserialisation (§3.3, §19.2).
  if (size > MAX_PAYLOAD_BYTES) return { ok: false, why: `payload of ${size} bytes exceeds ${MAX_PAYLOAD_BYTES}` };
  let parsed: unknown;
  try {
    parsed = JSON.parse(typeof body === 'string' ? body : body.toString('utf8'));
  } catch {
    return { ok: false, why: 'payload is not valid JSON' };
  }
  if (!isRecord(parsed)) return { ok: false, why: 'payload is not a JSON object' };
  return { ok: true, value: parsed };
}

/** undefined when supported, otherwise why: a malformed version, or an unknown major. */
function schemaProblem(value: unknown): { unsupported: boolean; why: string } | undefined {
  if (typeof value !== 'string') return { unsupported: false, why: 'schemaVersion is missing' };
  const match = /^(\d+)\.(\d+)$/.exec(value);
  if (!match) return { unsupported: false, why: 'schemaVersion is malformed' };
  if (Number(match[1]) !== SUPPORTED_SCHEMA_MAJOR) return { unsupported: true, why: `schemaVersion ${value} is not supported` };
  return undefined;
}

export function parseCommand(body: Buffer | string): CommandParse {
  const decoded = decode(body);
  if (!decoded.ok) return { kind: 'uncorrelatable', why: decoded.why };
  const raw = decoded.value;
  const { messageId, operationId, compartmentId } = raw;
  if (!isCanonicalUuid(messageId) || !isCanonicalUuid(operationId) || !isCanonicalUuid(compartmentId)) {
    return { kind: 'uncorrelatable', why: 'messageId, operationId or compartmentId is not a canonical UUID' };
  }
  const correlation: CommandCorrelation = { commandMessageId: messageId, operationId, compartmentId };
  const readableExpiry = parseInstant(raw.expiresAt);
  const invalid = (detail: string, reason: 'INVALID_PAYLOAD' | 'UNSUPPORTED_SCHEMA' = 'INVALID_PAYLOAD') =>
    ({ kind: 'invalid', correlation, reason, detail, ...(readableExpiry !== undefined ? { expiresAtMs: readableExpiry } : {}) }) as const;

  const schema = schemaProblem(raw.schemaVersion);
  if (schema) return invalid(schema.why, schema.unsupported ? 'UNSUPPORTED_SCHEMA' : 'INVALID_PAYLOAD');
  if (raw.type !== COMMAND_TYPE) return invalid(`type must be ${COMMAND_TYPE}`);
  if (!isCanonicalUuid(raw.lockerId)) return invalid('lockerId is not a canonical UUID');
  const issuedAtMs = parseInstant(raw.issuedAt);
  const expiresAtMs = parseInstant(raw.expiresAt);
  if (issuedAtMs === undefined || expiresAtMs === undefined) return invalid('issuedAt or expiresAt is not an RFC 3339 UTC instant');
  if (expiresAtMs <= issuedAtMs) return invalid('expiresAt is not after issuedAt');
  return {
    kind: 'command',
    correlation,
    command: { messageId, operationId, lockerId: raw.lockerId, compartmentId, issuedAtMs, expiresAtMs },
  };
}

export function parseDisplay(body: Buffer | string): DisplayParse {
  const decoded = decode(body);
  if (!decoded.ok) return { kind: 'uncorrelatable', why: decoded.why };
  const raw = decoded.value;
  const { messageId, operationId, compartmentId } = raw;
  if (!isCanonicalUuid(messageId) || !isCanonicalUuid(operationId) || !isCanonicalUuid(compartmentId)) {
    return { kind: 'uncorrelatable', why: 'messageId, operationId or compartmentId is not a canonical UUID' };
  }
  const payload = isRecord(raw.payload) ? raw.payload : undefined;
  const revision = raw.displayRevision;
  const displayRevision = Number.isSafeInteger(revision) && (revision as number) >= 0 ? (revision as number) : undefined;
  const challengeId =
    raw.type === 'DISPLAY_ACCESS_CHALLENGE' && isCanonicalUuid(payload?.challengeId) ? payload.challengeId : undefined;
  const correlation: DisplayCorrelation = {
    displayMessageId: messageId,
    operationId,
    compartmentId,
    ...(challengeId !== undefined ? { challengeId } : {}),
    ...(displayRevision !== undefined ? { displayRevision } : {}),
  };
  const invalid = (why: string) => ({ kind: 'invalid', correlation, why }) as const;

  const schema = schemaProblem(raw.schemaVersion);
  if (schema) return invalid(schema.why);
  const type = raw.type;
  if (typeof type !== 'string' || !(DISPLAY_TYPES as readonly string[]).includes(type)) {
    return invalid(`type must be one of ${DISPLAY_TYPES.join(', ')}`);
  }
  if (!isCanonicalUuid(raw.lockerId)) return invalid('lockerId is not a canonical UUID');
  if (!isCanonicalUuid(raw.targetDeviceSessionId)) return invalid('targetDeviceSessionId is not a canonical UUID');
  if (displayRevision === undefined) return invalid('displayRevision is not a non-negative integer');
  const issuedAtMs = parseInstant(raw.issuedAt);
  const expiresAtMs = parseInstant(raw.expiresAt);
  if (issuedAtMs === undefined || expiresAtMs === undefined) return invalid('issuedAt or expiresAt is not an RFC 3339 UTC instant');
  if (expiresAtMs <= issuedAtMs) return invalid('expiresAt is not after issuedAt');
  if (!payload) return invalid('payload is not an object');
  const action = payload.action;
  if (typeof action !== 'string' || !(DISPLAY_ACTIONS as readonly string[]).includes(action)) {
    return invalid(`payload.action must be one of ${DISPLAY_ACTIONS.join(', ')}`);
  }
  const compartmentCode = payload.compartmentCode;
  if (typeof compartmentCode !== 'string' || !COMPARTMENT_CODE.test(compartmentCode)) {
    return invalid('payload.compartmentCode is invalid');
  }

  let content: ChallengeContent | StatusContent;
  if (type === 'DISPLAY_ACCESS_CHALLENGE') {
    if (challengeId === undefined) return invalid('payload.challengeId is not a canonical UUID');
    if (typeof payload.token !== 'string' || !TOKEN.test(payload.token)) return invalid('payload.token is not 32 bytes of base64url');
    content = { kind: 'challenge', challengeId, action: action as DisplayAction, compartmentCode, token: payload.token };
  } else {
    const { status, reasonCode } = payload;
    if (typeof status !== 'string' || !CODE.test(status)) return invalid('payload.status is not a status code');
    if (!('reasonCode' in payload) || (reasonCode !== null && (typeof reasonCode !== 'string' || !CODE.test(reasonCode)))) {
      return invalid('payload.reasonCode must be null or a code');
    }
    content = { kind: 'status', action: action as DisplayAction, compartmentCode, status, reasonCode: reasonCode as string | null };
  }
  return {
    kind: 'instruction',
    correlation,
    instruction: {
      type: type as DisplayType,
      messageId,
      lockerId: raw.lockerId,
      operationId,
      compartmentId,
      targetDeviceSessionId: raw.targetDeviceSessionId,
      displayRevision,
      issuedAtMs,
      expiresAtMs,
      content,
    },
  };
}

/** Doc 10 §27.1 QR content, read by the technician application only. */
export function qrUriFor(lockerId: string, instruction: DisplayInstruction & { content: ChallengeContent }): string {
  const c = instruction.content;
  return `aegis://local-access?v=1&challengeId=${c.challengeId}&operationId=${instruction.operationId}&lockerId=${lockerId}&token=${c.token}`;
}
