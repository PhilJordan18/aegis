import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { reconnectDelayMs } from './backoff.ts';
import { clientIdFor, type CellConnectionStatus, type DoorState, type LockState, type ReaderStatus } from './contract.ts';
import type { SimulatorConfig } from './config.ts';
import {
  DeviceSession,
  buildDeviceRestarted,
  buildHeartbeat,
  buildOffline,
  buildOnline,
  type CompartmentStatus,
  type MessageContext,
  type OutboundMessage,
} from './messages.ts';
import { mqttTransportFactory, type Transport, type TransportFactory } from './transport.ts';

export type SimulatorState = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'stopping' | 'stopped';

export interface SimulatorEvents {
  state: [state: SimulatorState];
  /** Handed to the transport, in send order. */
  sent: [message: OutboundMessage];
  /** Acknowledged by the broker (QoS 1) or written to the socket (QoS 0). */
  delivered: [message: OutboundMessage];
  willPrepared: [message: OutboundMessage];
  reconnectScheduled: [delayMs: number, attempt: number];
  sessionStarted: [deviceSessionId: string];
  publishFailed: [message: OutboundMessage, error: Error];
  transportError: [error: Error];
}

export interface SimulatorDependencies {
  readonly transportFactory?: TransportFactory;
  readonly now?: () => number;
  readonly newId?: () => string;
  readonly random?: () => number;
}

/** Heartbeat-visible state of one cell. Door and lock events belong to SIM-02 (#39). */
export type CompartmentPatch = Partial<{
  connectionStatus: CellConnectionStatus;
  readerStatus: ReaderStatus;
  doorState: DoorState;
  lockState: LockState;
}>;

/**
 * Simulated Aegis Locker Node for the P0.0 status contract: availability with a Last
 * Will, DEVICE_RESTARTED once per boot, and a heartbeat every 10 seconds.
 *
 * It never takes a business decision and, in this slice, consumes no command.
 */
export class HubSimulator extends EventEmitter<SimulatorEvents> {
  readonly config: SimulatorConfig;
  readonly #transportFactory: TransportFactory;
  readonly #now: () => number;
  readonly #newId: () => string;
  readonly #random: () => number;
  readonly #compartments = new Map<string, CompartmentStatus>();

  #state: SimulatorState = 'idle';
  #session: DeviceSession | undefined;
  #resetReason: string;
  #restartAnnounced = false;
  #transport: Transport | undefined;
  #willArmed = false;
  #reconnectAttempt = 0;
  #heartbeatTimer: NodeJS.Timeout | undefined;
  #reconnectTimer: NodeJS.Timeout | undefined;
  #onlineWaiters: Array<() => void> = [];

  constructor(config: SimulatorConfig, deps: SimulatorDependencies = {}) {
    super();
    this.config = config;
    this.#transportFactory = deps.transportFactory ?? mqttTransportFactory;
    this.#now = deps.now ?? Date.now;
    this.#newId = deps.newId ?? randomUUID;
    this.#random = deps.random ?? Math.random;
    this.#resetReason = config.resetReason;
    for (const c of config.compartments) {
      this.#compartments.set(c.code, {
        compartmentId: c.compartmentId,
        cellAddress: c.cellAddress,
        connectionStatus: c.connectionStatus ?? 'CONNECTED',
        readerStatus: c.readerStatus ?? 'HEALTHY',
        doorState: c.doorState ?? 'CLOSED',
        lockState: c.lockState ?? 'LOCKED',
      });
    }
  }

  get state(): SimulatorState {
    return this.#state;
  }

  get deviceSessionId(): string | undefined {
    return this.#session?.deviceSessionId;
  }

  get clientId(): string {
    return clientIdFor(this.config.deviceKey);
  }

  /** Boots the hub: a new deviceSessionId, sequence 0, then connect. */
  start(): void {
    if (this.#state !== 'idle' && this.#state !== 'stopped') {
      throw new Error(`cannot start from state ${this.#state}`);
    }
    this.#session = new DeviceSession(this.#newId(), this.#now());
    this.#restartAnnounced = false;
    this.#reconnectAttempt = 0;
    this.emit('sessionStarted', this.#session.deviceSessionId);
    const will = this.#prepareWill();
    this.#setState('connecting');
    const transport = this.#transportFactory({
      brokerUrl: this.config.brokerUrl,
      clientId: this.clientId,
      username: this.config.username,
      password: this.config.password,
      will: { topic: will.topic, body: will.body, delivery: will.delivery },
      ...(this.config.caFile ? { caFile: this.config.caFile } : {}),
    });
    this.#transport = transport;
    transport.on('connect', () => this.#onConnect(transport));
    transport.on('close', () => this.#onClose(transport));
    transport.on('error', (error) => this.emit('transportError', error));
  }

  /** Resolves when the hub is online; rejects after `timeoutMs`. */
  waitUntilOnline(timeoutMs = 10_000): Promise<void> {
    if (this.#state === 'online') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`not online after ${timeoutMs} ms`)), timeoutMs);
      this.#onlineWaiters.push(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /**
   * Clean shutdown (doc 10 §15.2): publish OFFLINE, then DISCONNECT so the broker
   * discards the Last Will.
   */
  async stop(): Promise<void> {
    const transport = this.#transport;
    if (!transport || this.#state === 'stopped' || this.#state === 'stopping') return;
    const wasOnline = this.#state === 'online';
    this.#setState('stopping');
    this.#clearTimers();
    if (wasOnline) {
      const offline = buildOffline(this.#context());
      try {
        this.emit('sent', offline);
        let timer: NodeJS.Timeout | undefined;
        // A lost PUBACK must not block shutdown; the heartbeat timeout remains the reference.
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('OFFLINE not acknowledged within 5 s')), 5_000);
        });
        try {
          await Promise.race([transport.publish(offline.topic, offline.body, offline.delivery), timeout]);
        } finally {
          clearTimeout(timer);
        }
        this.emit('delivered', offline);
      } catch (error) {
        this.emit('publishFailed', offline, error as Error);
      }
      await transport.disconnect();
    } else {
      await transport.destroy();
    }
    this.#transport = undefined;
    this.#setState('stopped');
  }

  /** Abrupt failure: the socket closes without DISCONNECT and the broker publishes the Will. */
  async crash(): Promise<void> {
    const transport = this.#transport;
    if (!transport || this.#state === 'stopped') return;
    this.#setState('stopping');
    this.#clearTimers();
    await transport.destroy();
    this.#transport = undefined;
    this.#setState('stopped');
  }

  /** Crash followed by a new boot, which announces DEVICE_RESTARTED with `resetReason`. */
  async restart(resetReason?: string): Promise<void> {
    await this.crash();
    if (resetReason !== undefined) this.#resetReason = resetReason;
    this.start();
  }

  /** Network loss without reboot: the Will fires, then the hub reconnects in the same session. */
  async dropConnection(): Promise<void> {
    const transport = this.#transport;
    if (this.#state !== 'online' || !transport) {
      throw new Error(`cannot drop the connection from state ${this.#state}`);
    }
    const lost = new Promise<void>((resolve) => {
      const listener = (state: SimulatorState) => {
        if (state === 'online') return;
        this.off('state', listener);
        resolve();
      };
      this.on('state', listener);
    });
    transport.dropSocket();
    await lost;
  }

  /** Changes what the next heartbeats report for one cell, identified by its code. */
  updateCompartment(code: string, patch: CompartmentPatch): void {
    const current = this.#compartments.get(code);
    if (!current) throw new Error(`unknown compartment code ${code}`);
    this.#compartments.set(code, { ...current, ...patch });
  }

  /** Publishes a heartbeat now, outside the periodic schedule. */
  publishHeartbeat(): void {
    if (this.#state !== 'online' || !this.#transport) return;
    this.#publish(
      this.#transport,
      buildHeartbeat(this.#context(), {
        firmwareVersion: this.config.firmwareVersion,
        clockSynchronized: true,
        rssiDbm: this.config.rssiDbm,
        compartments: [...this.#compartments.values()],
      }),
    );
  }

  #onConnect(transport: Transport): void {
    if (transport !== this.#transport || this.#state === 'stopping' || this.#state === 'stopped') return;
    this.#willArmed = true;
    this.#reconnectAttempt = 0;
    this.#setState('online');
    // Doc 10 §18 order after (re)connection: ONLINE, DEVICE_RESTARTED on a real boot,
    // then an immediate heartbeat carrying the current cell states.
    this.#publish(transport, buildOnline(this.#context()));
    if (!this.#restartAnnounced) {
      this.#restartAnnounced = true;
      this.#publish(
        transport,
        buildDeviceRestarted(this.#context(), {
          resetReason: this.#resetReason,
          firmwareVersion: this.config.firmwareVersion,
        }),
      );
    }
    this.publishHeartbeat();
    this.#heartbeatTimer = setInterval(() => this.publishHeartbeat(), this.config.heartbeatIntervalMs);
    for (const waiter of this.#onlineWaiters.splice(0)) waiter();
  }

  #onClose(transport: Transport): void {
    if (transport !== this.#transport || this.#state === 'stopping' || this.#state === 'stopped') return;
    this.#clearTimers();
    if (this.#willArmed) {
      // The broker has consumed the previous Will; a later loss is a new logical fact
      // and needs a new messageId (doc 10 §8.1).
      this.#willArmed = false;
      const will = this.#prepareWill();
      transport.setWill({ topic: will.topic, body: will.body, delivery: will.delivery });
    }
    const attempt = this.#reconnectAttempt++;
    const delay = reconnectDelayMs(attempt, this.#random);
    this.#setState('reconnecting');
    this.emit('reconnectScheduled', delay, attempt);
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined;
      if (this.#transport !== transport || this.#state !== 'reconnecting') return;
      this.#setState('connecting');
      transport.reconnect();
    }, delay);
  }

  #prepareWill(): OutboundMessage {
    const will = buildOffline(this.#context());
    this.emit('willPrepared', will);
    return will;
  }

  #publish(transport: Transport, message: OutboundMessage): void {
    this.emit('sent', message);
    transport.publish(message.topic, message.body, message.delivery).then(
      () => this.emit('delivered', message),
      (error: Error) => this.emit('publishFailed', message, error),
    );
  }

  #context(): MessageContext {
    if (!this.#session) throw new Error('no device session');
    return {
      lockerId: this.config.lockerId,
      session: this.#session,
      nowMs: this.#now(),
      newMessageId: this.#newId,
    };
  }

  #clearTimers(): void {
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#heartbeatTimer = undefined;
    this.#reconnectTimer = undefined;
  }

  #setState(state: SimulatorState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.emit('state', state);
  }
}
