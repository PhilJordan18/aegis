import { describe, expect, it } from 'vitest';
import { parseInstant } from '../../src/contract.ts';
import { parseCommand, parseDisplay } from '../../src/inbound.ts';
import { TOKEN } from './hub-harness.ts';

const COMMAND = {
  schemaVersion: '2.0',
  messageId: '55c71961-21a3-4b2e-8b92-7f237e881a20',
  type: 'UNLOCK_COMPARTMENT',
  operationId: '2f38d3b6-c18f-4a74-aa9a-2d574286013f',
  lockerId: 'd46a74ae-39dc-460b-8af0-38fc791b376a',
  compartmentId: '1ae77ae3-8490-4f09-9412-a7816b77bff9',
  issuedAt: '2026-09-16T14:31:00Z',
  expiresAt: '2026-09-16T14:33:00Z',
};

describe('parseInstant (doc 10 §3.3)', () => {
  it.each([
    ['2026-09-16T14:31:00Z', Date.parse('2026-09-16T14:31:00Z')],
    ['2026-09-16T14:31:00.5Z', Date.parse('2026-09-16T14:31:00.500Z')],
    ['2026-09-16T14:31:00.123Z', Date.parse('2026-09-16T14:31:00.123Z')],
  ])('accepts %s', (value, expected) => {
    expect(parseInstant(value)).toBe(expected);
  });

  it.each(['2026-09-16T14:31Z', '2026-09-16T14:31:00', '2026-09-16T14:31:00+00:00', '2026-09-16T14:31:00.1234Z', '2026-02-30T00:00:00Z', 42])(
    'refuses %s',
    (value) => {
      expect(parseInstant(value)).toBeUndefined();
    },
  );
});

describe('parseCommand (doc 10 §8.2, §9)', () => {
  it('parses the contract example', () => {
    expect(parseCommand(JSON.stringify(COMMAND))).toEqual({
      kind: 'command',
      correlation: { commandMessageId: COMMAND.messageId, operationId: COMMAND.operationId, compartmentId: COMMAND.compartmentId },
      command: {
        messageId: COMMAND.messageId,
        operationId: COMMAND.operationId,
        lockerId: COMMAND.lockerId,
        compartmentId: COMMAND.compartmentId,
        issuedAtMs: Date.parse(COMMAND.issuedAt),
        expiresAtMs: Date.parse(COMMAND.expiresAt),
      },
    });
  });

  it.each([
    [{ schemaVersion: undefined }, 'INVALID_PAYLOAD'],
    [{ schemaVersion: '1.0' }, 'UNSUPPORTED_SCHEMA'],
    [{ schemaVersion: '2' }, 'INVALID_PAYLOAD'],
    [{ type: 'COMMAND_ACKNOWLEDGED' }, 'INVALID_PAYLOAD'],
    [{ lockerId: undefined }, 'INVALID_PAYLOAD'],
    [{ issuedAt: undefined }, 'INVALID_PAYLOAD'],
    [{ expiresAt: '2026-09-16T14:30:59Z' }, 'INVALID_PAYLOAD'],
  ])('refuses %o with %s', (patch, reason) => {
    expect(parseCommand(JSON.stringify({ ...COMMAND, ...patch }))).toMatchObject({ kind: 'invalid', reason });
  });

  it.each([{ messageId: 'not-a-uuid' }, { operationId: undefined }, { compartmentId: 'A1' }])('cannot correlate %o', (patch) => {
    expect(parseCommand(JSON.stringify({ ...COMMAND, ...patch })).kind).toBe('uncorrelatable');
  });
});

describe('parseDisplay (doc 10 §27)', () => {
  const CHALLENGE = {
    schemaVersion: '2.0',
    messageId: 'fd6c4a94-4ac4-4a91-9249-59347c3b648b',
    type: 'DISPLAY_ACCESS_CHALLENGE',
    lockerId: 'd46a74ae-39dc-460b-8af0-38fc791b376a',
    compartmentId: '1ae77ae3-8490-4f09-9412-a7816b77bff9',
    operationId: '2f38d3b6-c18f-4a74-aa9a-2d574286013f',
    targetDeviceSessionId: '1b24299c-028f-4c9f-a942-1c1ce36be899',
    displayRevision: 41,
    issuedAt: '2026-09-16T14:31:00Z',
    expiresAt: '2026-09-16T14:32:00Z',
    payload: {
      challengeId: '9d65cbae-4610-4e40-a314-3b93af07be9c',
      action: 'CHECKOUT',
      compartmentCode: 'A1',
      token: TOKEN,
    },
  };

  it('parses the contract example with its correlation', () => {
    const parsed = parseDisplay(JSON.stringify(CHALLENGE));
    expect(parsed).toMatchObject({
      kind: 'instruction',
      correlation: {
        displayMessageId: CHALLENGE.messageId,
        operationId: CHALLENGE.operationId,
        compartmentId: CHALLENGE.compartmentId,
        challengeId: CHALLENGE.payload.challengeId,
        displayRevision: 41,
      },
    });
  });

  it.each([
    { payload: { ...CHALLENGE.payload, token: 'q3P0n8y5XbT1sZr7Kd2Wc9Hf4Lm6Vg0Ja1Ue8Ni3Ro5=' } },
    { payload: { ...CHALLENGE.payload, compartmentCode: '' } },
    { targetDeviceSessionId: undefined },
    { displayRevision: 1.5 },
    { type: 'DISPLAY_SOMETHING' },
  ])('refuses %o as INVALID_DISPLAY_PAYLOAD material', (patch) => {
    expect(parseDisplay(JSON.stringify({ ...CHALLENGE, ...patch })).kind).toBe('invalid');
  });

  it('requires reasonCode, possibly null, in an operation status', () => {
    const status = {
      ...CHALLENGE,
      type: 'DISPLAY_OPERATION_STATUS',
      payload: { action: 'RETURN', compartmentCode: 'A1', status: 'ANOMALY', reasonCode: 'TAG_NOT_SEEN' },
    };
    expect(parseDisplay(JSON.stringify(status)).kind).toBe('instruction');
    const { reasonCode: _, ...withoutReason } = status.payload;
    expect(parseDisplay(JSON.stringify({ ...status, payload: withoutReason })).kind).toBe('invalid');
  });
});
