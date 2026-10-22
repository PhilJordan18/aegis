import { readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';

import { ScenarioError, parseScenario, type Scenario } from './scenario.ts';

/** Scenario files are small JSON documents written by the developer who runs the simulator. */
export const MAX_SCENARIO_BYTES = 256 * 1024;

/**
 * Reads the scenario named on the command line: a regular `.json` file of at most
 * MAX_SCENARIO_BYTES, then the same validation as any scenario. The path comes from
 * the local user, who could read the file anyway; the checks keep a mistyped path
 * from loading something else.
 */
export function loadScenarioFile(path: string): Scenario {
  const file = resolve(path);
  if (extname(file).toLowerCase() !== '.json') {
    throw new ScenarioError(`a scenario file must end in .json: ${file}`);
  }
  let size: number;
  try {
    const stats = statSync(file);
    if (!stats.isFile()) throw new ScenarioError(`a scenario must be a regular file: ${file}`);
    size = stats.size;
  } catch (error) {
    if (error instanceof ScenarioError) throw error;
    throw new ScenarioError(`cannot read the scenario file ${file}: ${(error as Error).message}`);
  }
  if (size > MAX_SCENARIO_BYTES) {
    throw new ScenarioError(`a scenario file is at most ${MAX_SCENARIO_BYTES} bytes: ${file}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new ScenarioError(`invalid JSON in ${file}: ${(error as Error).message}`);
  }
  return parseScenario(raw);
}
