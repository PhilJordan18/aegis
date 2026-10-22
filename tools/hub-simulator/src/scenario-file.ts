import { readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

import { ScenarioError, parseScenario, type Scenario } from './scenario.ts';

/** Scenario files are small JSON documents written by the developer who runs the simulator. */
export const MAX_SCENARIO_BYTES = 256 * 1024;

/**
 * Reads the scenario named on the command line: a regular `.json` file of at most
 * MAX_SCENARIO_BYTES, inside `baseDir` (the current directory) once symbolic links are
 * resolved, then the same validation as any scenario. A mistyped or crafted path can
 * therefore not load a file from elsewhere.
 */
export function loadScenarioFile(path: string, baseDir: string = process.cwd()): Scenario {
  let base: string;
  let file: string;
  try {
    base = realpathSync(baseDir);
    file = realpathSync(resolve(baseDir, path));
  } catch (error) {
    throw new ScenarioError(`cannot read the scenario file ${path}: ${(error as Error).message}`);
  }
  if (!file.startsWith(base + sep)) {
    throw new ScenarioError(`a scenario file must be inside ${base}: ${path}`);
  }
  if (extname(file).toLowerCase() !== '.json') {
    throw new ScenarioError(`a scenario file must end in .json: ${path}`);
  }
  const stats = statSync(file);
  if (!stats.isFile()) throw new ScenarioError(`a scenario must be a regular file: ${path}`);
  if (stats.size > MAX_SCENARIO_BYTES) {
    throw new ScenarioError(`a scenario file is at most ${MAX_SCENARIO_BYTES} bytes: ${path}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ScenarioError(`invalid JSON in ${path}: ${(error as Error).message}`);
  }
  return parseScenario(raw);
}
