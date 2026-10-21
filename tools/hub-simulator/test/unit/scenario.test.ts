import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MemoryBootCounter } from '../../src/boot-counter.ts';
import { defineConfig } from '../../src/config.ts';
import { ScenarioError, parseScenario, runScenario } from '../../src/scenario.ts';
import { HubSimulator } from '../../src/simulator.ts';
import { fakeTransportFactory, type FakeTransport } from './fake-transport.ts';

describe('scenario parsing', () => {
  it('accepts every committed scenario', () => {
    const dir = new URL('../../scenarios/', import.meta.url);
    for (const file of readdirSync(dir)) {
      expect(() => parseScenario(JSON.parse(readFileSync(new URL(file, dir), 'utf8'))), file).not.toThrow();
    }
  });

  it.each([
    [{}, 'steps'],
    [{ steps: [{ wait: -1 }] }, 'step 0: wait'],
    [{ steps: [{ do: 'unlock' }] }, 'unknown action'],
    [{ steps: [{ do: 'restart', resetReason: 'oops' }] }, 'resetReason'],
    [{ steps: [{ do: 'restart', resetReason: 'DEEP_SLEEP' }] }, 'resetReason must be one of'],
    [{ steps: [{ do: 'replay' }] }, 'type must be one of'],
    [{ steps: [{ do: 'replay', type: 'HEARTBEAT', reason: 'SHUTDOWN' }] }, 'reason only applies'],
    [{ steps: [{ do: 'replay', type: 'DEVICE_AVAILABILITY', reason: 'GONE' }] }, 'reason must be one of'],
    [{ steps: [{ do: 'replay', type: 'HEARTBEAT', bootsAgo: 1, connectionsAgo: 1 }] }, 'not both'],
    [{ steps: [{ do: 'replay', type: 'HEARTBEAT', connectionsAgo: -1 }] }, 'connectionsAgo must be'],
    [{ steps: [{ do: 'replay', type: 'HEARTBEAT', bootsAgo: 16 }] }, 'bootsAgo must be an integer in 0..15'],
    [{ steps: [{ do: 'replay', type: 'DEVICE_RESTARTED', connectionsAgo: 1 }] }, 'select it with bootsAgo'],
    [{ steps: [{ do: 'replay', type: 'HEARTBEAT', messageId: 'x' }] }, 'unknown replay field'],
    [{ steps: [{ do: 'updateCompartment', code: 'A1', patch: { doorState: 'AJAR' } }] }, 'doorState must be one of'],
    [{ steps: [{ do: 'updateCompartment', code: 'A1', patch: { assetId: 'x' } }] }, 'unknown patch field'],
  ])('rejects %o', (raw, message) => {
    expect(() => parseScenario(raw)).toThrow(ScenarioError);
    expect(() => parseScenario(raw)).toThrow(message);
  });
});

describe('scenario execution', () => {
  it('drives the simulator step by step', async () => {
    const { factory, instances } = fakeTransportFactory();
    const sim = new HubSimulator(defineConfig({ password: 'test-only' }), {
      transportFactory: factory,
      random: () => 0.5,
      bootCounter: new MemoryBootCounter(),
    });
    const waits: number[] = [];
    const scenario = parseScenario({
      steps: [
        { do: 'updateCompartment', code: 'A1', patch: { readerStatus: 'FAULTED' } },
        { do: 'publishHeartbeat' },
        { wait: 2500 },
        { do: 'restart', resetReason: 'WATCHDOG' },
        { do: 'stop' },
      ],
    });
    sim.start();
    instances[0]!.brokerAccept();
    await runScenario(sim, scenario, async (ms) => {
      waits.push(ms);
    });
    expect(waits).toEqual([2500]);
    expect(instances[0]!.types()).toEqual(['DEVICE_AVAILABILITY', 'DEVICE_RESTARTED', 'HEARTBEAT', 'HEARTBEAT']);
    expect(instances[0]!.published[3]!.payload.compartments).toEqual(
      expect.arrayContaining([expect.objectContaining({ cellAddress: 1, readerStatus: 'FAULTED' })]),
    );
    expect(instances[0]!.destroys).toBe(1);
    expect(instances).toHaveLength(2);
    expect(sim.state).toBe('stopped');
  });

  it('replays the Will of the previous connection and the DEVICE_RESTARTED of the previous boot', async () => {
    const { factory, instances } = fakeTransportFactory();
    // The broker accepts every CONNECT on the next tick.
    const autoAccept: typeof factory = (options) => {
      const t = factory(options);
      setTimeout(() => (t as FakeTransport).brokerAccept(), 0);
      return t;
    };
    const sim = new HubSimulator(defineConfig({ password: 'test-only' }), {
      transportFactory: autoAccept,
      random: () => 0.5,
      bootCounter: new MemoryBootCounter(),
    });
    sim.start();
    await sim.waitUntilOnline(1_000);
    const firstWill = instances[0]!.will.body;
    const firstRestart = instances[0]!.published.find((p) => p.payload.type === 'DEVICE_RESTARTED')!.body;
    await runScenario(
      sim,
      parseScenario({
        steps: [
          { do: 'restart', resetReason: 'PANIC' },
          { do: 'waitOnline', timeoutMs: 1000 },
          { do: 'replay', type: 'DEVICE_AVAILABILITY', reason: 'CONNECTION_LOST', connectionsAgo: 1 },
          { do: 'replay', type: 'DEVICE_RESTARTED', bootsAgo: 1 },
          { do: 'stop' },
        ],
      }),
    );
    const second = instances[1]!.published;
    expect(second.map((p) => p.payload.type)).toEqual([
      'DEVICE_AVAILABILITY',
      'DEVICE_RESTARTED',
      'HEARTBEAT',
      'DEVICE_AVAILABILITY',
      'DEVICE_RESTARTED',
      'DEVICE_AVAILABILITY',
    ]);
    expect(second[3]!.body).toBe(firstWill);
    expect(second[4]!.body).toBe(firstRestart);
    expect(second[5]!.payload).toMatchObject({ reason: 'SHUTDOWN', bootCount: 2 });
  });
});
