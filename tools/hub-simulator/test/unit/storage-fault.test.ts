import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_QUEUED_EVENTS } from '../../src/simulator.ts';
import { A1, A2, COMMANDS, EVENTS, command, online, type Harness } from './hub-harness.ts';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-16T14:31:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Forced door cycles on A2, outside any operation: two events each. */
function forcedCycles(h: Harness, cycles: number): void {
  for (let i = 0; i < cycles; i += 1) {
    h.sim.openDoor('A2', { forced: true });
    h.sim.closeDoor('A2');
  }
}

/** What the hub published since `from` on its current connection. */
function publishedSince(h: Harness, from: number) {
  return h.transport().published.slice(from);
}

describe('local queue overflow (doc 10 §18, §13.2, §23.6 point 4)', () => {
  it('overflow while offline, reconnection, then STORAGE_FAULT before the kept events, without any invented confirmation', async () => {
    const h = online();
    const c = command();
    h.transport().deliver(COMMANDS, c.body);
    await h.sim.dropConnection();

    // Offline: the operation's door opens (kept), then forced cycles on A2 fill the
    // queue, then the operation's close, relock and scan no longer fit.
    h.sim.openDoor('A1');
    forcedCycles(h, 40);
    h.sim.closeDoor('A1');
    await vi.advanceTimersByTimeAsync(3_000);

    const before = h.transport().published.length;
    h.accept();
    const after = publishedSince(h, before);
    const types = after.map((p) => p.payload.type);
    expect(types.slice(0, 2)).toEqual(['DEVICE_AVAILABILITY', 'HEARTBEAT']);

    const errors = after.filter((p) => p.payload.type === 'DEVICE_ERROR');
    expect(errors).toHaveLength(2);
    for (const error of errors) {
      expect(error.topic).toBe(EVENTS);
      expect(error.delivery).toEqual({ qos: 1, retain: false });
      expect(error.payload).toMatchObject({ errorCode: 'STORAGE_FAULT' });
      expect((error.payload.detail as string).length).toBeLessThanOrEqual(240);
    }
    // The touched operation is named, so that the backend treats it as uncertain.
    expect(errors[0]!.payload).toMatchObject({ operationId: c.operationId, compartmentId: A1, severity: 'CRITICAL' });
    expect(errors[1]!.payload).toMatchObject({ compartmentId: A2, severity: 'WARNING' });
    expect(errors[1]!.payload).not.toHaveProperty('operationId');

    // Reported before the events the queue kept, which keep their original order.
    const kept = after.slice(4);
    expect(types.slice(2, 4)).toEqual(['DEVICE_ERROR', 'DEVICE_ERROR']);
    expect(kept).toHaveLength(MAX_QUEUED_EVENTS);
    expect(kept[0]!.payload).toMatchObject({ type: 'DOOR_OPENED', operationId: c.operationId });
    expect(kept.slice(1).every((p) => p.payload.compartmentId === A2)).toBe(true);

    // The lost close and scan are not invented: no closing nor RFID proof of the operation.
    const ofOperation = h.events().filter((e) => e.operationId === c.operationId).map((e) => e.type);
    expect(ofOperation).not.toContain('DOOR_CLOSED');
    expect(ofOperation).not.toContain('RFID_SCAN_COMPLETED');
  });

  it('reports a loss once: the next reconnection without overflow publishes no STORAGE_FAULT', async () => {
    const h = online();
    await h.sim.dropConnection();
    forcedCycles(h, MAX_QUEUED_EVENTS / 2 + 1);
    h.accept();
    expect(h.events('DEVICE_ERROR')).toEqual([expect.objectContaining({ errorCode: 'STORAGE_FAULT', compartmentId: A2, severity: 'WARNING' })]);

    await h.sim.dropConnection();
    forcedCycles(h, 1);
    h.accept();
    expect(h.events('DEVICE_ERROR')).toHaveLength(1);
  });

  it('a queue that only filled up, without losing anything, publishes no STORAGE_FAULT', async () => {
    const h = online();
    await h.sim.dropConnection();
    forcedCycles(h, MAX_QUEUED_EVENTS / 2);
    h.accept();
    expect(h.events('DEVICE_ERROR')).toEqual([]);
    expect(h.events('DOOR_OPENED')).toHaveLength(MAX_QUEUED_EVENTS / 2);
  });

  it('a reboot loses the queue and its losses: DEVICE_RESTARTED, not STORAGE_FAULT, reports the uncertainty (§13.1)', async () => {
    const h = online();
    await h.sim.dropConnection();
    forcedCycles(h, MAX_QUEUED_EVENTS);
    await h.sim.restart('POWER_ON');
    h.accept();
    expect(h.events('DEVICE_ERROR')).toEqual([]);
    expect(h.events('DEVICE_RESTARTED')).toHaveLength(2);
  });
});
