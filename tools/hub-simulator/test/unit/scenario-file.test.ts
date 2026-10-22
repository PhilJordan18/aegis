import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MAX_SCENARIO_BYTES, loadScenarioFile } from '../../src/scenario-file.ts';
import { ScenarioError } from '../../src/scenario.ts';

const root = mkdtempSync(join(tmpdir(), 'aegis-scenario-file-'));
const base = join(root, 'base');
const outside = join(root, 'outside');
mkdirSync(base);
mkdirSync(outside);
const write = (dir: string, name: string, body: string) => {
  const path = join(dir, name);
  writeFileSync(path, body);
  return path;
};
const valid = JSON.stringify({ steps: [{ do: 'stop' }] });

describe('loadScenarioFile', () => {
  it('loads a valid .json scenario inside the base directory, by relative or absolute path', () => {
    const path = write(base, 'ok.json', valid);
    expect(loadScenarioFile('ok.json', base).steps).toHaveLength(1);
    expect(loadScenarioFile(path, base).steps).toHaveLength(1);
  });

  it.each([
    ['another extension', () => write(base, 'steps.txt', '{"steps":[]}'), '.json'],
    ['a directory', () => { const path = join(base, 'folder.json'); mkdirSync(path, { recursive: true }); return path; }, 'regular file'],
    ['a missing file', () => join(base, 'missing.json'), 'cannot read'],
    ['a file over the size limit', () => write(base, 'big.json', ' '.repeat(MAX_SCENARIO_BYTES + 1)), 'at most'],
    ['invalid JSON', () => write(base, 'broken.json', '{"steps": ['), 'invalid JSON'],
    ['a file outside the base directory', () => write(outside, 'elsewhere.json', valid), 'must be inside'],
    ['a relative path escaping with ..', () => { write(outside, 'up.json', valid); return '../outside/up.json'; }, 'must be inside'],
    ['a symbolic link pointing outside', () => { const target = write(outside, 'target.json', valid); const link = join(base, 'link.json'); symlinkSync(target, link); return link; }, 'must be inside'],
  ])('refuses %s with a ScenarioError', (_label, make, message) => {
    const path = make();
    expect(() => loadScenarioFile(path, base)).toThrow(ScenarioError);
    expect(() => loadScenarioFile(path, base)).toThrow(message);
  });
});
