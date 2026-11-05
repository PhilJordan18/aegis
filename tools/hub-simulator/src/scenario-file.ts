import { closeSync, fstatSync, openSync, readSync, realpathSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

import { ScenarioError, parseScenario, type Scenario } from './scenario.ts';

/** Scenario files are small JSON documents written by the developer who runs the simulator. */
export const MAX_SCENARIO_BYTES = 256 * 1024;

/**
 * Reads the scenario named on the command line: a regular `.json` file of at most
 * MAX_SCENARIO_BYTES, inside `baseDir` (the current directory) once symbolic links are
 * resolved, then the same validation as any scenario. The file is opened once and
 * checked through its descriptor, so it cannot be swapped between the checks and the
 * read, and never more than the limit is read.
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
  const prefix = base.endsWith(sep) ? base : base + sep;
  if (!file.startsWith(prefix)) {
    throw new ScenarioError(`a scenario file must be inside ${base}: ${path}`);
  }
  if (extname(file).toLowerCase() !== '.json') {
    throw new ScenarioError(`a scenario file must end in .json: ${path}`);
  }
  let text: string;
  let fd: number | undefined;
  try {
    fd = openSync(file, 'r');
    if (!fstatSync(fd).isFile()) throw new ScenarioError(`a scenario must be a regular file: ${path}`);
    const buffer = Buffer.alloc(MAX_SCENARIO_BYTES + 1);
    let length = 0;
    for (let read = -1; read !== 0 && length < buffer.length; length += read) {
      read = readSync(fd, buffer, length, buffer.length - length, null);
    }
    if (length > MAX_SCENARIO_BYTES) {
      throw new ScenarioError(`a scenario file is at most ${MAX_SCENARIO_BYTES} bytes: ${path}`);
    }
    text = buffer.subarray(0, length).toString('utf8');
  } catch (error) {
    if (error instanceof ScenarioError) throw error;
    throw new ScenarioError(`cannot read the scenario file ${path}: ${(error as Error).message}`);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ScenarioError(`invalid JSON in ${path}: ${(error as Error).message}`);
  }
  return parseScenario(raw);
}
