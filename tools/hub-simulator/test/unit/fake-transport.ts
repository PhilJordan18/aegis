import type { Delivery } from '../../src/contract.ts';
import type { Transport, TransportEvents, TransportFactory, TransportOptions, WillMessage } from '../../src/transport.ts';

export interface PublishedRecord {
  topic: string;
  body: string;
  payload: Record<string, unknown>;
  delivery: Delivery;
}

/** In-memory transport: the test decides when the broker accepts or drops the connection. */
export class FakeTransport implements Transport {
  readonly options: TransportOptions;
  will: WillMessage;
  readonly published: PublishedRecord[] = [];
  connected = false;
  reconnects = 0;
  disconnects = 0;
  destroys = 0;
  /** false: the broker never acknowledges a QoS 1 publish (lost PUBACK). */
  acknowledge = true;
  /** true: the broker reads DISCONNECT but keeps the socket half-open. */
  hangDisconnect = false;
  /** Socket state as the broker sees it. */
  socketOpen = false;
  #inFlight = 0;
  readonly #listeners: { [E in keyof TransportEvents]: TransportEvents[E][] } = { connect: [], close: [], error: [] };

  constructor(options: TransportOptions) {
    this.options = options;
    this.will = options.will;
  }

  on<E extends keyof TransportEvents>(event: E, listener: TransportEvents[E]): void {
    this.#listeners[event].push(listener);
  }

  publish(topic: string, body: string, delivery: Delivery): Promise<void> {
    if (!this.connected) return Promise.reject(new Error('not connected'));
    this.published.push({ topic, body, payload: JSON.parse(body) as Record<string, unknown>, delivery });
    if (delivery.qos === 1 && !this.acknowledge) {
      this.#inFlight++;
      return new Promise(() => {});
    }
    return Promise.resolve();
  }

  setWill(will: WillMessage): void {
    this.will = will;
  }

  reconnect(): void {
    this.reconnects++;
  }

  dropSocket(): void {
    this.brokerClose();
  }

  get inFlight(): number {
    return this.#inFlight;
  }

  /** Abandons in-flight QoS 1 messages and writes DISCONNECT, like the mqtt transport. */
  disconnect(): Promise<void> {
    this.#inFlight = 0;
    this.disconnects++;
    this.connected = false;
    if (this.hangDisconnect) return new Promise(() => {});
    this.socketOpen = false;
    return Promise.resolve();
  }

  destroy(): Promise<void> {
    this.destroys++;
    this.connected = false;
    this.socketOpen = false;
    return Promise.resolve();
  }

  /** The broker accepts the CONNECT. */
  brokerAccept(): void {
    this.connected = true;
    this.socketOpen = true;
    for (const l of this.#listeners.connect) l(false);
  }

  /** The socket closes without DISCONNECT (network loss or refused connection). */
  brokerClose(): void {
    this.connected = false;
    for (const l of this.#listeners.close) l();
  }

  types(): string[] {
    return this.published.map((p) => String(p.payload.type));
  }
}

export function fakeTransportFactory(): { factory: TransportFactory; instances: FakeTransport[] } {
  const instances: FakeTransport[] = [];
  return {
    instances,
    factory: (options) => {
      const t = new FakeTransport(options);
      instances.push(t);
      return t;
    },
  };
}
