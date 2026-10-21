import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { reconnectDelayMs } from './backoff.ts';
import { FileBootCounter, type BootCounter } from './boot-counter.ts';
import {
  clientIdFor,
  type CellConnectionStatus,
  type DoorState,
  type LockState,
  type ReaderStatus,
  type ResetReason,
} from './contract.ts';
import type { SimulatorConfig } from './config.ts';
import { EmissionLog, type ReplaySelector } from './emission-log.ts';
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
  /** An already emitted message handed again to the transport, byte for byte. */
  replayed: [message: OutboundMessage];
  reconnectScheduled: [delayMs: number, attempt: number];
  sessionStarted: [deviceSessionId: string, bootCount: number];
  publishFailed: [message: OutboundMessage, error: Error];
  transportError: [error: Error];
}

export interface SimulatorDependencies {
  readonly transportFactory?: TransportFactory;
  readonly now?: () => number;
  readonly newId?: () => string;
  readonly random?: () => number;
  /** Defaults to the state file of `config.bootCountFile`. */
  readonly bootCounter?: BootCounter;
}

/** Bound of each shutdown step, so that stop() never waits on the broker forever. */
export const STOP_STEP_TIMEOUT_MS = 5_000;

async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} within ${ms} ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Heartbeat-visible state of one cell. Door and lock events belong to SIM-02 (#39). */
export type CompartmentPatch = Partial<{
  connectionStatus: CellConnectionStatus;
  readerStatus: ReaderStatus;
  doorState: DoorState;
  lockState: LockState;
}>;

/**
 * Simulated Aegis Locker Node for the status contract (schema 2.0): availability with
 * a Last Will per connection, DEVICE_RESTARTED once per boot, and a heartbeat every
 * 10 seconds.
 *
 * It never takes a business decision and, in this slice, consumes no command.
 */
export class HubSimulator extends EventEmitter<SimulatorEvents> {
  readonly config: SimulatorConfig;
  readonly #transportFactory: TransportFactory;
  readonly #now: () => number;
  readonly #newId: () => string;
  readonly #random: () => number;
  readonly #bootCounter: BootCounter;
  readonly #compartments = new Map<string, CompartmentStatus>();
  readonly #emitted = new EmissionLog();

  #state: SimulatorState = 'idle';
  #session: DeviceSession | undefined;
  #resetReason: ResetReason;
  #restartAnnounced = false;
  #transport: Transport | undefined;
  /** The MQTT connection being attempted or in use, and the Will prepared for it. */
  #connectionId: string | undefined;
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
    this.#bootCounter =
      deps.bootCounter ?? new FileBootCounter(config.bootCountFile, config.deviceKey, config.firstBootCount);
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

  get bootCount(): number | undefined {
    return this.#session?.bootCount;
  }

  /** The connection being attempted or in use; every connection attempt gets a new one. */
  get connectionId(): string | undefined {
    return this.#connectionId;
  }

  get clientId(): string {
    return clientIdFor(this.config.deviceKey);
  }

  /** Boots the hub: the next persisted bootCount, a new deviceSessionId, sequence 0, then connect. */
  start(): void {
    if (this.#state !== 'idle' && this.#state !== 'stopped') {
      throw new Error(`cannot start from state ${this.#state}`);
    }
    // Reserved before anything is emitted, like the firmware's NVS write at boot.
    const bootCount = this.#bootCounter.next();
    this.#session = new DeviceSession(this.#newId(), bootCount, this.#now());
    this.#emitted.beginBoot(bootCount);
    this.#restartAnnounced = false;
    this.#reconnectAttempt = 0;
    this.emit('sessionStarted', this.#session.deviceSessionId, bootCount);
    const will = this.#prepareConnection();
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
   * Clean shutdown (doc 10 §15.2): publish OFFLINE `SHUTDOWN` on the current
   * connection, then DISCONNECT so the broker discards the Last Will. Nothing else is
   * published on the connection after SHUTDOWN. Always resolves: a PUBACK that never
   * comes is abandoned after 5 s, and a DISCONNECT that does not complete within 5 s
   * falls back to closing the socket, in which case the broker publishes the Will.
   */
  async stop(): Promise<void> {
    const transport = this.#transport;
    if (!transport || this.#state === 'stopped' || this.#state === 'stopping') return;
    const wasOnline = this.#state === 'online';
    // Leaving `online` first stops heartbeats, replays and reconnections.
    this.#setState('stopping');
    this.#clearTimers();
    if (wasOnline) {
      const offline = buildOffline(this.#context(), this.#currentConnectionId(), 'SHUTDOWN');
      this.#emitted.record(offline);
      this.emit('sent', offline);
      let acknowledged = false;
      try {
        await withTimeout(transport.publish(offline.topic, offline.body, offline.delivery), STOP_STEP_TIMEOUT_MS, 'SHUTDOWN not acknowledged');
        acknowledged = true;
        this.emit('delivered', offline);
      } catch (error) {
        // The heartbeat timeout remains the backend's reference (doc 10 §15.2).
        this.emit('publishFailed', offline, error as Error);
      }
      try {
        await withTimeout(transport.disconnect({ abandonInFlight: !acknowledged }), STOP_STEP_TIMEOUT_MS, 'DISCONNECT not completed');
      } catch (error) {
        this.emit('transportError', error as Error);
        await withTimeout(transport.destroy(), STOP_STEP_TIMEOUT_MS, 'socket not closed').catch(() => undefined);
      }
    } else {
      await withTimeout(transport.destroy(), STOP_STEP_TIMEOUT_MS, 'socket not closed').catch(() => undefined);
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

  /**
   * Crash followed by a new boot: bootCount + 1, a new deviceSessionId, and
   * DEVICE_RESTARTED with `resetReason`.
   */
  async restart(resetReason?: ResetReason): Promise<void> {
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

  /**
   * Republishes an already emitted message verbatim (same body, so same messageId,
   * sequence and timestamp) on the current connection, with its original topic, QoS
   * and retain. It simulates a late or duplicate delivery, for example the Will of a
   * previous connection; a replayed retained message also replaces the retained one.
   * Resolves once the broker acknowledged it (QoS 1) or it was written (QoS 0).
   */
  async replay(selector: ReplaySelector): Promise<OutboundMessage> {
    const transport = this.#transport;
    if (this.#state !== 'online' || !transport) {
      throw new Error(`cannot replay from state ${this.#state}`);
    }
    const message = this.#emitted.find(selector);
    if (!message) throw new Error(`no emitted message matches ${JSON.stringify(selector)}`);
    this.emit('replayed', message);
    try {
      await transport.publish(message.topic, message.body, message.delivery);
    } catch (error) {
      this.emit('publishFailed', message, error as Error);
      throw error;
    }
    this.emit('delivered', message);
    return message;
  }

  /** Publishes a heartbeat now, outside the periodic schedule. */
  publishHeartbeat(): void {
    if (this.#state !== 'online' || !this.#transport) return;
    this.#publish(
      this.#transport,
      buildHeartbeat(this.#context(), {
        connectionId: this.#currentConnectionId(),
        firmwareVersion: this.config.firmwareVersion,
        clockSynchronized: true,
        rssiDbm: this.config.rssiDbm,
        compartments: [...this.#compartments.values()],
      }),
    );
  }

  #onConnect(transport: Transport): void {
    if (transport !== this.#transport || this.#state === 'stopping' || this.#state === 'stopped') return;
    this.#reconnectAttempt = 0;
    this.#setState('online');
    // Doc 10 §18 order after (re)connection: ONLINE, DEVICE_RESTARTED on a real boot,
    // then an immediate heartbeat carrying the current cell states.
    this.#publish(transport, buildOnline(this.#context(), this.#currentConnectionId()));
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
    // Every attempt gets a new connectionId and Will, even when no CONNACK was seen:
    // the broker stores the Will as soon as it accepts the CONNECT [MQTT-3.1.2-8], so
    // a lost CONNACK may already have armed it, and publishing it would close that
    // connectionId for good.
    const will = this.#prepareConnection();
    transport.setWill({ topic: will.topic, body: will.body, delivery: will.delivery });
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

  /** A new connectionId and its Last Will, numbered now, before each CONNECT (decision D6). */
  #prepareConnection(): OutboundMessage {
    const connectionId = this.#newId();
    this.#connectionId = connectionId;
    this.#emitted.beginConnection(connectionId);
    const will = buildOffline(this.#context(), connectionId, 'CONNECTION_LOST');
    this.#emitted.record(will);
    this.emit('willPrepared', will);
    return will;
  }

  #currentConnectionId(): string {
    if (!this.#connectionId) throw new Error('no prepared connection');
    return this.#connectionId;
  }

  #publish(transport: Transport, message: OutboundMessage): void {
    this.#emitted.record(message);
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
