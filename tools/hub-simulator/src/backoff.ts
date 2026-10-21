import { RECONNECT_BASE_MS, RECONNECT_MAX_MS } from './contract.ts';

/** +/-20 % jitter so a fleet of hubs restarted together does not reconnect in lockstep. */
const JITTER_RATIO = 0.2;

/**
 * Doc 10 §18: exponential backoff with jitter, 1 s, 2 s, 4 s, 8 s, 16 s, then at
 * most 30 s. `attempt` starts at 0 for the first retry after a connection loss.
 */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const exponent = Math.min(Math.max(0, Math.floor(attempt)), 5);
  const nominal = Math.min(RECONNECT_BASE_MS * 2 ** exponent, RECONNECT_MAX_MS);
  const jitter = 1 + JITTER_RATIO * (2 * random() - 1);
  return Math.min(Math.round(nominal * jitter), RECONNECT_MAX_MS);
}
