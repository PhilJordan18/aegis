import type { AvailabilityReason, HubMessageType } from './contract.ts';
import type { OutboundMessage } from './messages.ts';

/**
 * Selects an already emitted message to republish verbatim. Without `bootsAgo` or
 * `connectionsAgo`, the most recent match of the whole run is chosen.
 */
export interface ReplaySelector {
  readonly type: HubMessageType;
  /** DEVICE_AVAILABILITY only; CONNECTION_LOST designates a prepared Last Will. */
  readonly reason?: AvailabilityReason;
  /** 0 is the current boot, 1 the previous one. */
  readonly bootsAgo?: number;
  /**
   * 0 is the connection prepared last, 1 the one before, counted over the whole run
   * across boots. Not applicable to DEVICE_RESTARTED, which carries no connectionId.
   */
  readonly connectionsAgo?: number;
}

/** Bounds of the log, so that a long run keeps a constant memory footprint. */
export const MAX_TRACKED_BOOTS = 16;
export const MAX_TRACKED_CONNECTIONS = 32;

interface Entry {
  readonly message: OutboundMessage;
  readonly bootCount: number;
  readonly connectionId: string | undefined;
}

function connectionOf(message: OutboundMessage): string | undefined {
  const payload = message.payload;
  return payload.type === 'DEVICE_RESTARTED' ? undefined : payload.connectionId;
}

/**
 * Remembers what the simulator emitted, Last Wills included, so that a scenario can
 * replay a late or duplicate delivery. Per connection it keeps the Will, ONLINE,
 * SHUTDOWN and only the last heartbeat; per boot it keeps DEVICE_RESTARTED.
 */
export class EmissionLog {
  #entries: Entry[] = [];
  readonly #boots: number[] = [];
  readonly #connections: string[] = [];

  /** Declares a new boot; older boots beyond the bound are forgotten. */
  beginBoot(bootCount: number): void {
    this.#boots.push(bootCount);
    while (this.#boots.length > MAX_TRACKED_BOOTS) {
      const dropped = this.#boots.shift();
      this.#entries = this.#entries.filter((e) => e.bootCount !== dropped);
    }
  }

  /** Declares a newly prepared connection; older connections beyond the bound are forgotten. */
  beginConnection(connectionId: string): void {
    this.#connections.push(connectionId);
    while (this.#connections.length > MAX_TRACKED_CONNECTIONS) {
      const dropped = this.#connections.shift();
      this.#entries = this.#entries.filter((e) => e.connectionId !== dropped);
    }
  }

  record(message: OutboundMessage): void {
    const entry: Entry = { message, bootCount: message.payload.bootCount, connectionId: connectionOf(message) };
    if (message.payload.type === 'HEARTBEAT') {
      this.#entries = this.#entries.filter(
        (e) => !(e.message.payload.type === 'HEARTBEAT' && e.connectionId === entry.connectionId),
      );
    }
    this.#entries.push(entry);
  }

  find(selector: ReplaySelector): OutboundMessage | undefined {
    const boot = selector.bootsAgo === undefined ? undefined : this.#boots.at(-1 - selector.bootsAgo);
    const connection =
      selector.connectionsAgo === undefined ? undefined : this.#connections.at(-1 - selector.connectionsAgo);
    if (selector.bootsAgo !== undefined && boot === undefined) return undefined;
    if (selector.connectionsAgo !== undefined && connection === undefined) return undefined;
    for (let i = this.#entries.length - 1; i >= 0; i--) {
      const entry = this.#entries[i]!;
      const payload = entry.message.payload;
      if (payload.type !== selector.type) continue;
      if (selector.reason !== undefined && (payload.type !== 'DEVICE_AVAILABILITY' || payload.reason !== selector.reason)) {
        continue;
      }
      if (boot !== undefined && entry.bootCount !== boot) continue;
      if (connection !== undefined && entry.connectionId !== connection) continue;
      return entry.message;
    }
    return undefined;
  }
}
