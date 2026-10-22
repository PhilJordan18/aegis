import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MAX_SCENARIO_BYTES, loadScenarioFile } from '../../src/scenario-file.ts';
import { ScenarioError } from '../../src/scenario.ts';

const dir = mkdtempSync(join(tmpdir(), 'aegis-scenario-file-'));
const write = (name: string, body: string) => {
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
};

describe('loadScenarioFile', () => {
  it('loads a valid .json scenario', () => {
    const path = write('ok.json', JSON.stringify({ steps: [{ do: 'stop' }] }));
    expect(loadScenarioFile(path).steps).toHaveLength(1);
  });

  it.each([
    ['another extension', () => write('steps.txt', '{"steps":[]}'), '.json'],
    ['a directory', () => { const path = join(dir, 'folder.json'); mkdirSync(path, { recursive: true }); return path; }, 'regular file'],
    ['a missing file', () => join(dir, 'missing.json'), 'cannot read'],
    ['a file over the size limit', () => write('big.json', ' '.repeat(MAX_SCENARIO_BYTES + 1)), 'at most'],
    ['invalid JSON', () => write('broken.json', '{"steps": ['), 'invalid JSON'],
  ])('refuses %s with a ScenarioError', (_label, make, message) => {
    const path = make();
    expect(() => loadScenarioFile(path)).toThrow(ScenarioError);
    expect(() => loadScenarioFile(path)).toThrow(message);
  });
});
