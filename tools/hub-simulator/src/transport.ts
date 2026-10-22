import { readFileSync } from 'node:fs';
import mqtt from 'mqtt';
import { CLEAN_SESSION, KEEPALIVE_SECONDS, MQTT_PROTOCOL_VERSION, type Delivery } from './contract.ts';

export interface WillMessage {
  readonly topic: string;
  readonly body: string;
  readonly delivery: Delivery;
}

export interface TransportOptions {
  readonly brokerUrl: string;
  readonly clientId: string;
  readonly username: string;
  readonly password: string;
  readonly will: WillMessage;
  readonly caFile?: string;
}

/** Delivery facts of an inbound PUBLISH that the hub must check itself (§7.2). */
export interface InboundMeta {
  readonly retain: boolean;
  readonly qos: number;
  readonly dup: boolean;
}

export interface TransportEvents {
  connect(sessionPresent: boolean): void;
  close(): void;
  error(error: Error): void;
  /**
   * An inbound PUBLISH. The listener runs synchronously before the PUBACK, so a hub
   * that dies while handling a QoS 1 message never acknowledges it and the broker
   * redelivers it on the next connection of the persistent session.
   */
  message(topic: string, body: Buffer, meta: InboundMeta): void;
}

/**
 * The subset of an MQTT client the simulator needs. Reconnection is driven by the
 * simulator itself (doc 10 §18 backoff), never by the transport.
 */
export interface Transport {
  on<E extends keyof TransportEvents>(event: E, listener: TransportEvents[E]): void;
  /** Resolves once the broker acknowledged a QoS 1 publish or a QoS 0 publish was written. */
  publish(topic: string, body: string, delivery: Delivery): Promise<void>;
  /** Subscribes with QoS 1; resolves on SUBACK and rejects when the broker refuses a topic. */
  subscribe(topics: readonly string[]): Promise<void>;
  /** Replaces the Last Will used by the next (re)connection. */
  setWill(will: WillMessage): void;
  /** Reconnects with the same session stores, so unacknowledged QoS 1 messages are resent. */
  reconnect(): void;
  /** Simulates a network loss: the socket closes without DISCONNECT and the client stays usable. */
  dropSocket(): void;
  /**
   * Abandons unacknowledged QoS 1 messages and writes DISCONNECT at once, so the
   * broker discards the Last Will. Resolves once the socket has closed, which a
   * broker that keeps half-open sockets may never do.
   */
  disconnect(): Promise<void>;
  /**
   * Closes the socket now. Without a prior DISCONNECT the broker publishes the Last
   * Will; after one, it only releases a socket the broker left half-open. A message
   * being handled when destroy() is called is never acknowledged.
   */
  destroy(): Promise<void>;
}

export type TransportFactory = (options: TransportOptions) => Transport;

export const mqttTransportFactory: TransportFactory = (options) => {
  const toWill = (will: WillMessage) => ({
    topic: will.topic,
    payload: Buffer.from(will.body, 'utf8'),
    qos: will.delivery.qos,
    retain: will.delivery.retain,
  });
  const client = mqtt.connect(options.brokerUrl, {
    protocolVersion: MQTT_PROTOCOL_VERSION,
    clientId: options.clientId,
    username: options.username,
    password: options.password,
    clean: CLEAN_SESSION,
    keepalive: KEEPALIVE_SECONDS,
    reconnectPeriod: 0,
    connectTimeout: 10_000,
    // A heartbeat that could not be sent is stale after 10 s; never replay it later.
    queueQoSZero: false,
    will: toWill(options.will),
    ...(options.caFile ? { ca: readFileSync(options.caFile), rejectUnauthorized: true } : {}),
  });
  // mqtt.js emits 'message', then calls handleMessage and sends the PUBACK from its
  // callback. Withholding the callback once the hub is destroyed models a power loss
  // between the reception of a command and its acknowledgement (§23.6 point 2).
  let abandoned = false;
  const handleMessage = client.handleMessage.bind(client);
  client.handleMessage = (packet, callback) => {
    if (abandoned) return;
    handleMessage(packet, callback);
  };

  return {
    on(event, listener) {
      if (event === 'connect') {
        client.on('connect', (packet) => (listener as TransportEvents['connect'])(packet.sessionPresent));
      } else if (event === 'close') {
        client.on('close', listener as TransportEvents['close']);
      } else if (event === 'message') {
        client.on('message', (topic, body, packet) =>
          (listener as TransportEvents['message'])(topic, body, { retain: packet.retain, qos: packet.qos, dup: packet.dup }),
        );
      } else {
        client.on('error', listener as TransportEvents['error']);
      }
    },
    publish(topic, body, delivery) {
      return new Promise((resolve, reject) => {
        client.publish(topic, body, { qos: delivery.qos, retain: delivery.retain }, (error) =>
          error ? reject(error) : resolve(),
        );
      });
    },
    async subscribe(topics) {
      const granted = await client.subscribeAsync([...topics], { qos: 1 });
      // MQTT 3.1.1 SUBACK return code 0x80: refused by the broker ACL.
      const refused = granted.filter((g) => g.qos === 128).map((g) => g.topic);
      if (refused.length > 0) throw new Error(`subscription refused for ${refused.join(', ')}`);
    },
    setWill(will) {
      // mqtt.js rebuilds the CONNECT packet from options on every reconnect.
      client.options.will = toWill(will);
    },
    reconnect() {
      client.reconnect({ incomingStore: client.incomingStore, outgoingStore: client.outgoingStore });
    },
    dropSocket() {
      client.stream.destroy();
    },
    disconnect() {
      // mqtt.js would otherwise wait for `outgoingEmpty`, forever if a PUBACK is lost.
      for (const id of Object.keys(client.outgoing)) client.removeOutgoingMessage(Number(id));
      return client.endAsync(false);
    },
    destroy() {
      abandoned = true;
      if (!client.disconnecting) return client.endAsync(true);
      // end() is a no-op once a DISCONNECT is under way, so the socket would stay
      // open while waiting for the broker's FIN: destroy it directly.
      const stream = client.stream;
      if (stream.destroyed) return Promise.resolve();
      const closed = new Promise<void>((resolve) => stream.once('close', () => resolve()));
      stream.destroy();
      return closed;
    },
  };
};
