import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defineConfig } from '../../src/config.ts';
import { ScenarioError, parseScenario, runScenario } from '../../src/scenario.ts';
import { HubSimulator } from '../../src/simulator.ts';
import { fakeTransportFactory } from './fake-transport.ts';

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
    const sim = new HubSimulator(defineConfig({ password: 'test-only' }), { transportFactory: factory, random: () => 0.5 });
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
});
