import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DETAIL_MAX_LENGTH, INBOUND_REPORT_WINDOW_MS } from '../../src/contract.ts';
import { InboundReportLimiter, inboundReportDetail } from '../../src/inbound-report.ts';
import { A1, COMMANDS, DISPLAY, EVENTS, LOCKER, TOKEN, challenge, command, online, type Harness } from './hub-harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-16T14:31:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

const UNKNOWN_CELL = '7d4bd7a0-6a0e-4b8e-8e57-1f2c3d4e5f60';
const HUB_ENVELOPE = ['schemaVersion', 'messageId', 'type', 'lockerId', 'timestamp', 'deviceSessionId', 'bootCount', 'sequence'];
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** The INBOUND_MESSAGE_INVALID reports the hub published, as sent on the wire. */
function reports(h: Harness) {
  return h.instances
    .flatMap((t) => t.published)
    .filter((p) => p.payload.type === 'DEVICE_ERROR' && p.payload.errorCode === 'INBOUND_MESSAGE_INVALID');
}

/** Every UUID of a report is the hub's own (lockerId, its new messageId, its session) or a cell of the hub. */
function expectNoForeignIdentifier(h: Harness, body: string, payload: Record<string, unknown>): void {
  const own = new Set([LOCKER, payload.messageId, h.sim.deviceSessionId, ...(payload.compartmentId === A1 ? [A1] : [])]);
  for (const id of body.match(UUID) ?? []) expect(own).toContain(id);
}

describe('DEVICE_ERROR INBOUND_MESSAGE_INVALID (doc 10 §7.2, §13.2, §20, §23.2 points 11 and 13-14)', () => {
  it.each([
    ['unreadable JSON', '{not json', 'payload is not valid JSON'],
    ['not an object', '[]', 'payload is not a JSON object'],
    ['oversized', JSON.stringify({ padding: 'x'.repeat(16 * 1024) }), 'payload larger than 16 KiB'],
    ['no messageId', JSON.stringify({ ...JSON.parse(command().body), messageId: undefined }), 'missing or not a canonical UUID'],
    ['no operationId', JSON.stringify({ ...JSON.parse(command().body), operationId: undefined }), 'missing or not a canonical UUID'],
    ['non-canonical compartmentId', JSON.stringify({ ...JSON.parse(command().body), compartmentId: 'A1' }), 'missing or not a canonical UUID'],
  ])('reports an uncorrelatable command (%s) once, as a WARNING without operationId, and actuates nothing', (_, body, cause) => {
    const h = online();
    h.transport().deliver(COMMANDS, body);
    expect(h.actuations).toEqual([]);
    const [report, ...others] = reports(h);
    expect(others).toEqual([]);
    expect(report!.topic).toBe(EVENTS);
    expect(report!.delivery).toEqual({ qos: 1, retain: false });
    expect(report!.payload).toMatchObject({ schemaVersion: '3.0', lockerId: LOCKER, errorCode: 'INBOUND_MESSAGE_INVALID', severity: 'WARNING' });
    expect(Object.keys(report!.payload).sort()).toEqual(
      [...HUB_ENVELOPE, 'errorCode', 'severity', 'detail', ...(report!.payload.compartmentId ? ['compartmentId'] : [])].sort(),
    );
    expect(report!.payload).not.toHaveProperty('operationId');
    expect(report!.payload).not.toHaveProperty('commandMessageId');
    expect(report!.payload.detail).toContain(cause);
    expect((report!.payload.detail as string).length).toBeLessThanOrEqual(DETAIL_MAX_LENGTH);
    // Only COMMAND_REJECTED and acknowledgements answer a command; none is invented here.
    expect(h.events().filter((e) => e.type !== 'DEVICE_ERROR')).toEqual([]);
  });

  it('names the cell only when compartmentId is a canonical UUID of a cell of this hub', () => {
    const cases = [
      [JSON.stringify({ type: 'UNLOCK_COMPARTMENT', compartmentId: A1 }), A1],
      [JSON.stringify({ type: 'UNLOCK_COMPARTMENT', compartmentId: UNKNOWN_CELL }), undefined],
      [JSON.stringify({ type: 'UNLOCK_COMPARTMENT', compartmentId: A1.toUpperCase() }), undefined],
      [JSON.stringify({ type: 'UNLOCK_COMPARTMENT', cell: A1 }), undefined],
    ] as const;
    for (const [body, expected] of cases) {
      const h = online();
      h.transport().deliver(COMMANDS, body);
      const [report] = reports(h);
      if (expected === undefined) expect(report!.payload).not.toHaveProperty('compartmentId');
      else expect(report!.payload.compartmentId).toBe(expected);
    }
  });

  it('never carries a value of the ignored payload: no token, no operationId, no messageId, no foreign identifier', () => {
    const h = online();
    const operationId = randomUUID();
    const messageId = randomUUID();
    const challengeId = randomUUID();
    // Uncorrelatable (no compartmentId) but full of readable identifiers and the token.
    const uncorrelatable = JSON.stringify({
      schemaVersion: '3.0',
      type: 'DISPLAY_ACCESS_CHALLENGE',
      messageId,
      operationId,
      lockerId: LOCKER,
      payload: { challengeId, action: 'CHECKOUT', compartmentCode: 'A1', token: TOKEN },
    });
    h.transport().deliver(DISPLAY, uncorrelatable);
    const retained = challenge(h.sim, { operationId: randomUUID(), challengeId: randomUUID() });
    h.transport().deliver(DISPLAY, retained.body, { retain: true });
    expect(h.sim.screen).toEqual({ kind: 'IDLE' });

    const sent = reports(h);
    expect(sent).toHaveLength(2);
    const wire = h.instances.flatMap((t) => t.published).map((p) => p.body).join('\n');
    const local = JSON.stringify([h.inbound, h.screens]);
    for (const secret of [TOKEN, 'local-access', operationId, messageId, challengeId, retained.operationId, retained.messageId, retained.challengeId]) {
      expect(wire).not.toContain(secret);
    }
    expect(local).not.toContain(TOKEN);
    for (const r of sent) expectNoForeignIdentifier(h, r.body, r.payload);
    // The retained challenge names a cell of the hub; the uncorrelatable one has none.
    expect(sent.map((r) => r.payload.compartmentId)).toEqual([undefined, A1]);
  });

  it('a retained command consumes nothing: delivered again without retain, it is executed normally', () => {
    const h = online();
    const c = command();
    h.transport().deliver(COMMANDS, c.body, { retain: true });
    expect(h.actuations).toEqual([]);
    expect(h.journal.findByMessageId(c.messageId)).toBeUndefined();
    const [report] = reports(h);
    expect(report!.payload).toMatchObject({ compartmentId: A1, severity: 'WARNING' });
    expect(report!.payload).not.toHaveProperty('operationId');
    expect(report!.payload.detail).toBe('A retained commands message was ignored: neither executed, displayed nor journaled.');
    expect(report!.body).not.toContain(c.operationId);
    expect(report!.body).not.toContain(c.messageId);

    h.transport().deliver(COMMANDS, c.body);
    expect(h.actuations).toEqual([{ compartmentId: A1, operationId: c.operationId }]);
    expect(h.events('COMMAND_ACKNOWLEDGED')).toEqual([expect.objectContaining({ commandMessageId: c.messageId, result: 'ACCEPTED' })]);
  });

  it('a retained display instruction is neither displayed nor recorded: live, it is displayed', () => {
    const h = online();
    const d = challenge(h.sim);
    h.transport().deliver(DISPLAY, d.body, { retain: true });
    expect(h.sim.screen).toEqual({ kind: 'IDLE' });
    expect(h.events('ACCESS_CHALLENGE_DISPLAYED')).toEqual([]);
    h.transport().deliver(DISPLAY, d.body);
    expect(h.sim.screen).toMatchObject({ kind: 'ACCESS_CHALLENGE', challengeId: d.challengeId });
    expect(h.events('ACCESS_CHALLENGE_DISPLAYED')).toHaveLength(1);
  });

  it('a correlatable 2.0 message is rejected as before, never reported as INBOUND_MESSAGE_INVALID (§3.2, §23.2 point 16)', () => {
    const h = online();
    const c = command({ schemaVersion: '2.0' });
    h.transport().deliver(COMMANDS, c.body);
    h.transport().deliver(DISPLAY, challenge(h.sim, { schemaVersion: '2.0' }).body);
    expect(h.actuations).toEqual([]);
    expect(h.sim.screen).toEqual({ kind: 'IDLE' });
    expect(h.events().map((e) => e.reason)).toEqual(['UNSUPPORTED_SCHEMA', 'INVALID_DISPLAY_PAYLOAD']);
    expect(reports(h)).toEqual([]);
  });
});

describe('reporting limit (doc 10 §13.2 proposal, §23.2 point 15)', () => {
  it('a flood yields at most one report per topic and case per window, four in all', () => {
    const h = online();
    for (let i = 0; i < 100; i += 1) {
      h.transport().deliver(COMMANDS, '{not json');
      h.transport().deliver(COMMANDS, command().body, { retain: true });
      h.transport().deliver(DISPLAY, 'not json');
      h.transport().deliver(DISPLAY, challenge(h.sim).body, { retain: true });
    }
    expect(h.actuations).toEqual([]);
    expect(reports(h).map((r) => r.payload.detail)).toEqual([
      'A commands message cannot be correlated (payload is not valid JSON); it was ignored.',
      'A retained commands message was ignored: neither executed, displayed nor journaled.',
      'A display message cannot be correlated (payload is not valid JSON); it was ignored.',
      'A retained display message was ignored: neither executed, displayed nor journaled.',
    ]);
    expect(h.inbound.filter((r) => r.report === 'SUPPRESSED')).toHaveLength(396);
  });

  it('reports again after the window, counting the messages it did not report', () => {
    const h = online();
    h.transport().deliver(COMMANDS, '{not json');
    for (let i = 0; i < 7; i += 1) h.transport().deliver(COMMANDS, '[]');
    vi.advanceTimersByTime(INBOUND_REPORT_WINDOW_MS - 1);
    h.transport().deliver(COMMANDS, '[]');
    expect(reports(h)).toHaveLength(1);
    vi.advanceTimersByTime(1);
    h.transport().deliver(COMMANDS, '[]');
    const sent = reports(h);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.payload.detail).toBe(
      'A commands message cannot be correlated (payload is not a JSON object); it was ignored. 8 similar message(s) not reported since the previous report.',
    );
    // The count restarts with each report.
    vi.advanceTimersByTime(INBOUND_REPORT_WINDOW_MS);
    h.transport().deliver(COMMANDS, '[]');
    expect(reports(h)[2]!.payload.detail).not.toContain('similar');
  });

  it('starts from zero at every boot, without any persisted counter', async () => {
    const h = online();
    h.transport().deliver(COMMANDS, '{not json');
    h.transport().deliver(COMMANDS, '{not json');
    await h.sim.restart();
    h.accept();
    h.transport().deliver(COMMANDS, '{not json');
    const sent = reports(h);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.payload.deviceSessionId).not.toBe(sent[0]!.payload.deviceSessionId);
    expect(sent[1]!.payload.detail).not.toContain('similar');
  });
});

describe('InboundReportLimiter and inboundReportDetail', () => {
  it('keys the window by channel and issue', () => {
    const limiter = new InboundReportLimiter(1_000);
    expect(limiter.admit('commands', 'UNCORRELATABLE', 0)).toEqual({ suppressed: 0 });
    expect(limiter.admit('commands', 'UNCORRELATABLE', 999)).toBeUndefined();
    expect(limiter.admit('commands', 'RETAINED', 999)).toEqual({ suppressed: 0 });
    expect(limiter.admit('display', 'UNCORRELATABLE', 999)).toEqual({ suppressed: 0 });
    expect(limiter.admit('commands', 'UNCORRELATABLE', 1_000)).toEqual({ suppressed: 1 });
  });

  it('ends the window when the clock steps back, so reports are never silenced until it catches up', () => {
    const limiter = new InboundReportLimiter(60_000);
    expect(limiter.admit('commands', 'UNCORRELATABLE', 3_600_000)).toEqual({ suppressed: 0 });
    expect(limiter.admit('commands', 'UNCORRELATABLE', 3_600_001)).toBeUndefined();
    expect(limiter.admit('commands', 'UNCORRELATABLE', 0)).toEqual({ suppressed: 1 });
    expect(limiter.admit('commands', 'UNCORRELATABLE', 59_999)).toBeUndefined();
  });

  it('stays within the bounded detail, whatever the count', () => {
    const detail = inboundReportDetail('display', 'UNCORRELATABLE', 'CORRELATION_MISSING', Number.MAX_SAFE_INTEGER);
    expect(detail.length).toBeLessThanOrEqual(DETAIL_MAX_LENGTH);
    expect(detail).toContain(String(Number.MAX_SAFE_INTEGER));
  });
});
