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
   * Counts established connections only, those that published an ONLINE, over the
   * whole run across boots: 0 is the last one (the current connection while online),
   * 1 the one before. A failed attempt is never counted, so a reconnection that
   * needed several attempts does not shift the index. Only for HEARTBEAT and
   * DEVICE_AVAILABILITY, the types that carry a connectionId.
   */
  readonly connectionsAgo?: number;
}

/**
 * Bounds of the log, so that a long run keeps a constant memory footprint. Established
 * connections and failed attempts have separate bounds, so a long outage of failed
 * attempts never evicts an established connection.
 */
export const MAX_TRACKED_BOOTS = 16;
export const MAX_TRACKED_CONNECTIONS = 32;
export const MAX_TRACKED_FAILED_ATTEMPTS = 32;
/** Operational events (acknowledgements, door, lock, RFID, display): the most recent ones. */
export const MAX_TRACKED_EVENTS = 64;

const BOOT_SCOPED_TYPES: readonly string[] = ['HEARTBEAT', 'DEVICE_AVAILABILITY', 'DEVICE_RESTARTED'];

interface Entry {
  readonly message: OutboundMessage;
  readonly bootCount: number;
  readonly connectionId: string | undefined;
}

function connectionOf(message: OutboundMessage): string | undefined {
  const payload = message.payload;
  return 'connectionId' in payload ? payload.connectionId : undefined;
}

function isOperationalEvent(entry: Entry): boolean {
  return !BOOT_SCOPED_TYPES.includes(entry.message.payload.type);
}

/**
 * Remembers what the simulator emitted, Last Wills included, so that a scenario can
 * replay a late or duplicate delivery. Per connection it keeps the Will, ONLINE,
 * SHUTDOWN and only the last heartbeat; per boot it keeps DEVICE_RESTARTED; and it
 * keeps the last operational events (acknowledgements, door, lock, RFID, display). The Wills
 * of attempts that never published ONLINE are kept within their own bound but are not
 * counted by `connectionsAgo`; a later Will is always a more recent match.
 */
export class EmissionLog {
  #entries: Entry[] = [];
  readonly #boots: number[] = [];
  /** Connections that published an ONLINE, oldest first. */
  readonly #established: string[] = [];
  /** Prepared connections without an ONLINE yet: the pending attempt and failed ones. */
  readonly #attempts: string[] = [];

  /** Declares a new boot; older boots beyond the bound are forgotten. */
  beginBoot(bootCount: number): void {
    this.#boots.push(bootCount);
    while (this.#boots.length > MAX_TRACKED_BOOTS) {
      const dropped = this.#boots.shift();
      this.#entries = this.#entries.filter((e) => e.bootCount !== dropped);
    }
  }

  /** Declares a newly prepared connection attempt; it counts once it publishes ONLINE. */
  beginConnection(connectionId: string): void {
    this.#attempts.push(connectionId);
    this.#forgetBeyond(this.#attempts, MAX_TRACKED_FAILED_ATTEMPTS + 1);
  }

  record(message: OutboundMessage): void {
    const entry: Entry = { message, bootCount: message.payload.bootCount, connectionId: connectionOf(message) };
    const payload = message.payload;
    if (payload.type === 'DEVICE_AVAILABILITY' && payload.status === 'ONLINE') this.#establish(payload.connectionId);
    if (message.payload.type === 'HEARTBEAT') {
      this.#entries = this.#entries.filter(
        (e) => !(e.message.payload.type === 'HEARTBEAT' && e.connectionId === entry.connectionId),
      );
    }
    this.#entries.push(entry);
    if (isOperationalEvent(entry) && this.#entries.filter(isOperationalEvent).length > MAX_TRACKED_EVENTS) {
      this.#entries.splice(this.#entries.findIndex(isOperationalEvent), 1);
    }
  }

  find(selector: ReplaySelector): OutboundMessage | undefined {
    const boot = selector.bootsAgo === undefined ? undefined : this.#boots.at(-1 - selector.bootsAgo);
    const connection =
      selector.connectionsAgo === undefined ? undefined : this.#established.at(-1 - selector.connectionsAgo);
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

  #establish(connectionId: string): void {
    const index = this.#attempts.indexOf(connectionId);
    if (index < 0) return;
    this.#attempts.splice(index, 1);
    this.#established.push(connectionId);
    this.#forgetBeyond(this.#established, MAX_TRACKED_CONNECTIONS);
  }

  #forgetBeyond(connections: string[], max: number): void {
    while (connections.length > max) {
      const dropped = connections.shift();
      this.#entries = this.#entries.filter((e) => e.connectionId !== dropped);
    }
  }
}
