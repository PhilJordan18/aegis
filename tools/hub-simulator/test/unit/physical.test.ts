import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { A1, A2, COMMANDS, command, online } from './hub-harness.ts';

const TAG = 'E20034120123456789000001';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-16T14:31:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('checkout and return observations (doc 10 §11, §12)', () => {
  it('checkout: door, lock and a healthy scan without the tag, all carrying the operationId', async () => {
    const h = online();
    h.sim.putTag('A1', TAG);
    const c = command();
    h.transport().deliver(COMMANDS, c.body);
    await vi.advanceTimersByTimeAsync(2_000);
    h.sim.openDoor('A1');
    h.sim.takeTag('A1', TAG);
    await vi.advanceTimersByTimeAsync(3_000);
    h.sim.closeDoor('A1');
    await vi.advanceTimersByTimeAsync(3_000);

    expect(h.events().map((e) => e.type)).toEqual([
      'COMMAND_ACKNOWLEDGED',
      'LOCK_UNLOCKED',
      'DOOR_OPENED',
      'DOOR_CLOSED',
      'LOCK_LOCKED',
      'RFID_SCAN_COMPLETED',
    ]);
    for (const e of h.events().slice(1)) expect(e).toMatchObject({ operationId: c.operationId, compartmentId: A1 });
    expect(h.events('DOOR_OPENED')[0]).toMatchObject({ doorState: 'OPEN', timestamp: '2026-09-16T14:31:02Z' });
    expect(h.events('DOOR_CLOSED')[0]).toMatchObject({ doorState: 'CLOSED', timestamp: '2026-09-16T14:31:05Z' });
    expect(h.events('LOCK_LOCKED')[0]).toMatchObject({ lockState: 'LOCKED' });
    expect(h.events('RFID_SCAN_COMPLETED')[0]).toMatchObject({
      windowStartedAt: '2026-09-16T14:31:05Z',
      windowEndedAt: '2026-09-16T14:31:08Z',
      readerStatus: 'HEALTHY',
      observedIdentifiers: [],
    });
    // The physical sequence is over: the cell no longer belongs to the operation.
    expect(h.sim.compartment('A1').operationId).toBeUndefined();
    expect(h.sim.compartment('A1')).toMatchObject({ doorState: 'CLOSED', lockState: 'LOCKED' });
  });

  it('return: the scan after closing reports the expected tag with three reads', async () => {
    const h = online();
    const c = command();
    h.transport().deliver(COMMANDS, c.body);
    h.sim.openDoor('A1');
    h.sim.putTag('A1', TAG);
    h.sim.closeDoor('A1');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(h.events('RFID_SCAN_COMPLETED')[0]).toMatchObject({
      operationId: c.operationId,
      readerStatus: 'HEALTHY',
      observedIdentifiers: [{ identifierType: 'RFID_UHF', identifierValue: TAG, readCount: 3 }],
    });
  });

  it('missing tag: a return closed without the asset gives a healthy empty scan', async () => {
    const h = online();
    h.transport().deliver(COMMANDS, command().body);
    h.sim.openDoor('A1');
    h.sim.closeDoor('A1');
    await vi.advanceTimersByTimeAsync(3_000);
    expect(h.events('RFID_SCAN_COMPLETED')[0]).toMatchObject({ readerStatus: 'HEALTHY', observedIdentifiers: [] });
  });

  it('a faulted reader or an unreachable cell never attests presence nor absence', async () => {
    const h = online();
    h.sim.putTag('A1', TAG);
    h.sim.putTag('A2', TAG);
    h.sim.updateCompartment('A1', { readerStatus: 'FAULTED' });
    h.sim.updateCompartment('A2', { connectionStatus: 'DISCONNECTED' });
    await Promise.all([h.sim.scanRfid('A1'), h.sim.scanRfid('A2'), vi.advanceTimersByTimeAsync(3_000)]);
    expect(h.events('RFID_SCAN_COMPLETED')).toEqual([
      expect.objectContaining({ compartmentId: A1, readerStatus: 'FAULTED', observedIdentifiers: [] }),
      expect.objectContaining({ compartmentId: A2, readerStatus: 'UNKNOWN', observedIdentifiers: [] }),
    ]);
  });

  it('a scan outside any operation carries no operationId; a weak read is reported as such', async () => {
    const h = online();
    h.sim.putTag('A2', TAG, 1);
    await Promise.all([h.sim.scanRfid('A2', 1_000), vi.advanceTimersByTimeAsync(1_000)]);
    const scan = h.events('RFID_SCAN_COMPLETED')[0]!;
    expect(scan).not.toHaveProperty('operationId');
    expect(scan.observedIdentifiers).toEqual([{ identifierType: 'RFID_UHF', identifierValue: TAG, readCount: 1 }]);
  });
});

describe('wrong compartment and forced doors', () => {
  it('a locked door only opens when forced, and its events carry no operationId', () => {
    const h = online();
    const c = command();
    h.transport().deliver(COMMANDS, c.body);
    expect(() => h.sim.openDoor('A2')).toThrow(/locked; set forced/);
    h.sim.openDoor('A2', { forced: true });
    h.sim.closeDoor('A2');
    const a2 = h.events().filter((e) => e.compartmentId === A2);
    expect(a2.map((e) => e.type)).toEqual(['DOOR_OPENED', 'DOOR_CLOSED']);
    for (const e of a2) expect(e).not.toHaveProperty('operationId');
  });

  it('an asset returned into the neighbouring cell is seen by that cell only', async () => {
    const h = online();
    const c = command();
    h.transport().deliver(COMMANDS, c.body);
    h.sim.openDoor('A1');
    h.sim.putTag('A2', TAG);
    h.sim.closeDoor('A1');
    await Promise.all([h.sim.scanRfid('A2'), vi.advanceTimersByTimeAsync(3_000)]);
    const scans = h.events('RFID_SCAN_COMPLETED');
    expect(scans).toEqual([
      expect.objectContaining({ compartmentId: A1, operationId: c.operationId, observedIdentifiers: [] }),
      expect.objectContaining({ compartmentId: A2, observedIdentifiers: [expect.objectContaining({ identifierValue: TAG })] }),
    ]);
    expect(scans[1]).not.toHaveProperty('operationId');
  });

  it('refuses impossible physical steps', () => {
    const h = online();
    expect(() => h.sim.closeDoor('A1')).toThrow(/not open/);
    expect(() => h.sim.takeTag('A1', TAG)).toThrow(/not in cell/);
    expect(() => h.sim.putTag('A1', '')).toThrow(/identifier/);
    expect(() => h.sim.putTag('A1', TAG, 0)).toThrow(/readCount/);
    expect(() => h.sim.openDoor('Z9')).toThrow(/unknown compartment/);
  });
});

describe('door left open and the unlock window (doc 10 §9.2)', () => {
  it('relocks at the end of the window while the door stays open, and blocks other commands until it closes', async () => {
    const h = online({ unlockWindowMs: 5_000 });
    const c = command();
    h.transport().deliver(COMMANDS, c.body);
    h.sim.openDoor('A1');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.events('LOCK_LOCKED')).toEqual([expect.objectContaining({ operationId: c.operationId })]);
    h.transport().deliver(COMMANDS, command({ compartmentId: A2 }).body);
    expect(h.events('COMMAND_REJECTED').at(-1)).toMatchObject({ reason: 'LOCAL_OPERATION_IN_PROGRESS' });
    h.sim.closeDoor('A1');
    // Already relocked: closing does not lock again.
    expect(h.events('LOCK_LOCKED')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3_000);
    h.transport().deliver(COMMANDS, command({ compartmentId: A2 }).body);
    expect(h.events('COMMAND_ACKNOWLEDGED').at(-1)).toMatchObject({ compartmentId: A2, result: 'ACCEPTED' });
  });

  it('keeps the unlock window running while the network is down, and queues the events', async () => {
    const h = online({ unlockWindowMs: 5_000 });
    const c = command();
    h.transport().deliver(COMMANDS, c.body);
    await h.sim.dropConnection();
    h.sim.openDoor('A1');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.sim.compartment('A1').lockState).toBe('LOCKED');
    const before = h.transport().published.length;
    h.accept();
    const after = h.transport().published.slice(before).map((p) => p.payload);
    expect(after.map((p) => p.type)).toEqual(['DEVICE_AVAILABILITY', 'HEARTBEAT', 'DOOR_OPENED', 'LOCK_LOCKED']);
    // Sequences are those of the preparation, before the new ONLINE.
    expect(after[2]!.sequence as number).toBeLessThan(after[0]!.sequence as number);
    expect(after[2]).toMatchObject({ operationId: c.operationId });
  });

  it('a reboot with the door open loses the operation and returns the lock to its safe state', async () => {
    const h = online();
    h.transport().deliver(COMMANDS, command().body);
    h.sim.openDoor('A1');
    await h.sim.crash();
    // The hub is off: the physical change is not observed.
    h.sim.closeDoor('A1');
    h.sim.openDoor('A1', { forced: true });
    h.sim.start();
    h.accept();
    const beat = h.transport().published.find((p) => p.payload.type === 'HEARTBEAT')!.payload;
    expect(beat.compartments).toEqual(
      expect.arrayContaining([expect.objectContaining({ compartmentId: A1, doorState: 'OPEN', lockState: 'LOCKED' })]),
    );
    h.sim.closeDoor('A1');
    const closed = h.events('DOOR_CLOSED');
    expect(closed).toHaveLength(1);
    expect(closed[0]).not.toHaveProperty('operationId');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.events('RFID_SCAN_COMPLETED')).toEqual([]);
  });
});
