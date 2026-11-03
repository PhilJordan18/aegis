// DEVICE_ERROR INBOUND_MESSAGE_INVALID (doc 10 §7.2, §13.2, §20; schema 3.0, #98): the
// report of a commands or display message that the hub ignores because it was retained
// or cannot be correlated. The detail is built from fixed texts only, so that no value
// of the ignored payload (the display token above all) can reach events.
import { DETAIL_MAX_LENGTH, INBOUND_REPORT_WINDOW_MS } from './contract.ts';
import type { UncorrelatableCause } from './inbound.ts';

export type InboundChannel = 'commands' | 'display';
export type InboundIssue = 'RETAINED' | 'UNCORRELATABLE';

const CAUSE_TEXT: Readonly<Record<UncorrelatableCause, string>> = {
  PAYLOAD_TOO_LARGE: 'payload larger than 16 KiB',
  INVALID_JSON: 'payload is not valid JSON',
  NOT_AN_OBJECT: 'payload is not a JSON object',
  CORRELATION_MISSING: 'messageId, operationId or compartmentId missing or not a canonical UUID',
};

/** The bounded detail of a report; `suppressed` counts the messages not reported since the previous one. */
export function inboundReportDetail(
  channel: InboundChannel,
  issue: InboundIssue,
  cause: UncorrelatableCause | undefined,
  suppressed: number,
): string {
  const what =
    issue === 'RETAINED'
      ? `A retained ${channel} message was ignored: neither executed, displayed nor journaled.`
      : `A ${channel} message cannot be correlated (${CAUSE_TEXT[cause ?? 'CORRELATION_MISSING']}); it was ignored.`;
  const tail = suppressed > 0 ? ` ${suppressed} similar message(s) not reported since the previous report.` : '';
  return `${what}${tail}`.slice(0, DETAIL_MAX_LENGTH);
}

/**
 * Doc 10 §13.2 reporting limit (proposal of #98, awaiting confirmation): at most one
 * report per (channel, issue) per window, so at most four per minute whatever the
 * flood. Kept in RAM and recreated at every boot, like the firmware's counters, which
 * are never written to NVS. The clock stands for the hub's monotonic clock.
 */
export class InboundReportLimiter {
  readonly #windowMs: number;
  readonly #keys = new Map<string, { reportedAtMs: number; suppressed: number }>();

  constructor(windowMs = INBOUND_REPORT_WINDOW_MS) {
    this.#windowMs = windowMs;
  }

  /** The number of messages suppressed since the previous report when this one is published, otherwise undefined. */
  admit(channel: InboundChannel, issue: InboundIssue, nowMs: number): { readonly suppressed: number } | undefined {
    const key = `${channel}/${issue}`;
    const state = this.#keys.get(key);
    if (state && nowMs - state.reportedAtMs < this.#windowMs) {
      state.suppressed += 1;
      return undefined;
    }
    this.#keys.set(key, { reportedAtMs: nowMs, suppressed: 0 });
    return { suppressed: state?.suppressed ?? 0 };
  }
}
