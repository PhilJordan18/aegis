import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { A1, COMMANDS, DISPLAY, EVENTS, LOCKER, OTHER_LOCKER, TOKEN, challenge, command, online, operationStatus } from './hub-harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-16T14:31:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DISPLAY_ACCESS_CHALLENGE (doc 10 §27.1, §27.2)', () => {
  it('shows the QR and acknowledges the rendering with ACCESS_CHALLENGE_DISPLAYED', () => {
    const h = online();
    const d = challenge(h.sim);
    h.transport().deliver(DISPLAY, d.body);

    expect(h.sim.screen).toEqual({
      kind: 'ACCESS_CHALLENGE',
      operationId: d.operationId,
      compartmentId: A1,
      compartmentCode: 'A1',
      action: 'CHECKOUT',
      challengeId: d.challengeId,
      displayRevision: 41,
      until: '2026-09-16T14:32:00.000Z',
      qrUri: `aegis://local-access?v=1&challengeId=${d.challengeId}&operationId=${d.operationId}&lockerId=${LOCKER}&token=${TOKEN}`,
    });
    const published = h.transport().published.at(-1)!;
    expect(published.topic).toBe(EVENTS);
    expect(published.delivery).toEqual({ qos: 1, retain: false });
    expect(published.payload).toMatchObject({
      schemaVersion: '2.0',
      type: 'ACCESS_CHALLENGE_DISPLAYED',
      lockerId: LOCKER,
      operationId: d.operationId,
      compartmentId: A1,
      displayMessageId: d.messageId,
      challengeId: d.challengeId,
      displayRevision: 41,
      deviceSessionId: h.sim.deviceSessionId,
      bootCount: 3,
    });
    expect(published.payload).not.toHaveProperty('commandMessageId');
  });

  it('never leaks the token: not in events, logs, screen notifications nor the inbound report', () => {
    const h = online();
    h.transport().deliver(DISPLAY, challenge(h.sim).body);
    h.transport().deliver(DISPLAY, challenge(h.sim, { displayRevision: 1 }).body);
    const everything = JSON.stringify([h.transport().published.map((p) => p.body), h.inbound, h.screens]);
    expect(everything).not.toContain(TOKEN);
    expect(everything).not.toContain('aegis://');
  });

  it('displays at most 60 s after issuedAt even when expiresAt is later, then returns to idle', async () => {
    const h = online();
    const issuedAt = new Date(Date.now() - 10_000).toISOString();
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    h.transport().deliver(DISPLAY, challenge(h.sim, { issuedAt, expiresAt }).body);
    await vi.advanceTimersByTimeAsync(49_999);
    expect(h.sim.screen.kind).toBe('ACCESS_CHALLENGE');
    await vi.advanceTimersByTimeAsync(1);
    expect(h.sim.screen).toEqual({ kind: 'IDLE' });
    expect(h.screens.at(-1)).toEqual({ kind: 'IDLE' });
  });

  it('never actuates a lock nor answers like a command (§23.1)', () => {
    const h = online();
    const d = challenge(h.sim);
    h.transport().deliver(DISPLAY, d.body);
    h.transport().deliver(DISPLAY, d.body, { dup: true });
    expect(h.actuations).toEqual([]);
    expect(h.events().map((e) => e.type)).toEqual(['ACCESS_CHALLENGE_DISPLAYED', 'ACCESS_CHALLENGE_DISPLAYED']);
  });

  it('acknowledges a duplicate again with a new event messageId, without showing a masked QR again', () => {
    const h = online();
    const d = challenge(h.sim);
    h.transport().deliver(DISPLAY, d.body);
    // The unlock of this operation masks its QR (§9).
    h.transport().deliver(COMMANDS, command({ operationId: d.operationId }).body);
    expect(h.sim.screen).toEqual({ kind: 'IDLE' });
    h.transport().deliver(DISPLAY, d.body, { dup: true });
    expect(h.sim.screen).toEqual({ kind: 'IDLE' });
    const acks = h.events('ACCESS_CHALLENGE_DISPLAYED');
    expect(acks).toHaveLength(2);
    expect(acks[1]).toMatchObject({ displayMessageId: d.messageId, challengeId: d.challengeId });
    expect(acks[1]!.messageId).not.toBe(acks[0]!.messageId);
    expect(h.inbound.at(-1)).toMatchObject({ channel: 'display', outcome: 'REACKNOWLEDGED' });
  });

  it('masks the challenge when the connection drops (§27.4)', async () => {
    const h = online();
    h.transport().deliver(DISPLAY, challenge(h.sim).body);
    await h.sim.dropConnection();
    expect(h.sim.screen).toEqual({ kind: 'IDLE' });
  });
});

describe('DISPLAY_REJECTED (doc 10 §27.2, §27.4)', () => {
  it('rejects an instruction for a previous boot with TARGET_SESSION_MISMATCH', async () => {
    const h = online();
    const oldSession = h.sim.deviceSessionId!;
    await h.sim.restart();
    h.accept();
    const d = challenge(h.sim, { targetDeviceSessionId: oldSession });
    h.transport().deliver(DISPLAY, d.body);
    expect(h.sim.screen).toEqual({ kind: 'IDLE' });
    expect(h.events()).toEqual([
      expect.objectContaining({
        type: 'DISPLAY_REJECTED',
        reason: 'TARGET_SESSION_MISMATCH',
        displayMessageId: d.messageId,
        challengeId: d.challengeId,
        displayRevision: 41,
        operationId: d.operationId,
        compartmentId: A1,
      }),
    ]);
  });

  it.each([
    ['DISPLAY_EXPIRED', { issuedAt: '2026-09-16T14:29:00Z', expiresAt: '2026-09-16T14:31:00Z' }],
    ['DISPLAY_EXPIRED', { issuedAt: '2026-09-16T14:30:00Z', expiresAt: '2026-09-16T14:35:00Z' }],
    ['INVALID_DISPLAY_PAYLOAD', { payload: { token: 'short' } }],
    ['INVALID_DISPLAY_PAYLOAD', { payload: { action: 'OPEN' } }],
    ['INVALID_DISPLAY_PAYLOAD', { lockerId: OTHER_LOCKER }],
    ['INVALID_DISPLAY_PAYLOAD', { compartmentId: '7d4bd7a0-6a0e-4b8e-8e57-1f2c3d4e5f60' }],
    ['INVALID_DISPLAY_PAYLOAD', { schemaVersion: '1.0' }],
    ['INVALID_DISPLAY_PAYLOAD', { displayRevision: -1 }],
  ] as const)('rejects with %s (%o)', (reason, overrides) => {
    const h = online();
    h.transport().deliver(DISPLAY, challenge(h.sim, overrides as Parameters<typeof challenge>[1]).body);
    expect(h.sim.screen).toEqual({ kind: 'IDLE' });
    expect(h.events()).toEqual([expect.objectContaining({ type: 'DISPLAY_REJECTED', reason })]);
    expect(h.events()[0]).not.toHaveProperty('commandMessageId');
  });

  it('rejects SCREEN_UNAVAILABLE when the screen is off or the clock is not synchronised', () => {
    const h = online();
    h.sim.setScreenAvailable(false);
    h.transport().deliver(DISPLAY, challenge(h.sim).body);
    h.sim.setScreenAvailable(true);
    h.sim.setClockSynchronized(false);
    h.transport().deliver(DISPLAY, challenge(h.sim).body);
    expect(h.events().map((e) => e.reason)).toEqual(['SCREEN_UNAVAILABLE', 'SCREEN_UNAVAILABLE']);
  });

  it('rejects a revision that is not higher than the last accepted one', () => {
    const h = online();
    h.transport().deliver(DISPLAY, challenge(h.sim, { displayRevision: 41 }).body);
    h.transport().deliver(DISPLAY, challenge(h.sim, { displayRevision: 41 }).body);
    h.transport().deliver(DISPLAY, challenge(h.sim, { displayRevision: 40 }).body);
    expect(h.events().map((e) => e.reason ?? e.type)).toEqual([
      'ACCESS_CHALLENGE_DISPLAYED',
      'STALE_DISPLAY_REVISION',
      'STALE_DISPLAY_REVISION',
    ]);
    expect(h.sim.screen).toMatchObject({ displayRevision: 41 });
  });

  it('repeats the same rejection for a duplicate', () => {
    const h = online();
    h.sim.setScreenAvailable(false);
    const d = challenge(h.sim);
    h.transport().deliver(DISPLAY, d.body);
    h.sim.setScreenAvailable(true);
    h.transport().deliver(DISPLAY, d.body, { dup: true });
    expect(h.events().map((e) => e.reason)).toEqual(['SCREEN_UNAVAILABLE', 'SCREEN_UNAVAILABLE']);
    expect(h.sim.screen).toEqual({ kind: 'IDLE' });
  });

  it('ignores retained or uncorrelatable instructions without publishing anything', () => {
    const h = online();
    h.transport().deliver(DISPLAY, challenge(h.sim).body, { retain: true });
    h.transport().deliver(DISPLAY, JSON.stringify({ type: 'DISPLAY_ACCESS_CHALLENGE', messageId: randomUUID() }));
    h.transport().deliver(DISPLAY, 'not json');
    expect(h.events()).toEqual([]);
    expect(h.inbound.map((r) => r.outcome)).toEqual(['IGNORED', 'IGNORED', 'IGNORED']);
  });
});

describe('DISPLAY_OPERATION_STATUS (doc 10 §27.3)', () => {
  it('replaces the challenge with a higher revision, for 30 s, without any acknowledgement', async () => {
    const h = online();
    const d = challenge(h.sim, { displayRevision: 41 });
    h.transport().deliver(DISPLAY, d.body);
    const s = operationStatus(h.sim, { operationId: d.operationId, displayRevision: 42, status: 'CONFIRMED' });
    h.transport().deliver(DISPLAY, s.body);
    expect(h.sim.screen).toMatchObject({ kind: 'OPERATION_STATUS', status: 'CONFIRMED', reasonCode: null, displayRevision: 42 });
    expect(h.events().map((e) => e.type)).toEqual(['ACCESS_CHALLENGE_DISPLAYED']);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.sim.screen).toEqual({ kind: 'IDLE' });
  });

  it('rejects a stale status without a challengeId in the correlation', () => {
    const h = online();
    h.transport().deliver(DISPLAY, operationStatus(h.sim, { displayRevision: 50 }).body);
    const s = operationStatus(h.sim, { displayRevision: 49 });
    h.transport().deliver(DISPLAY, s.body);
    const rejected = h.events()[0]!;
    expect(rejected).toMatchObject({ type: 'DISPLAY_REJECTED', reason: 'STALE_DISPLAY_REVISION', displayMessageId: s.messageId });
    expect(rejected).not.toHaveProperty('challengeId');
  });
});
