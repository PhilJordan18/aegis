import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { reconnectDelayMs } from './backoff.ts';
import { FileBootCounter, type BootCounter } from './boot-counter.ts';
import { CommandJournalFullError, FileCommandJournal, type CommandJournal, type JournalEntry } from './command-journal.ts';
import {
  CHALLENGE_MAX_DISPLAY_MS,
  RFID_IDENTIFIER_MAX_LENGTH,
  RFID_MAX_IDENTIFIERS,
  RFID_READ_COUNT_MAX,
  RFID_WINDOW_MAX_MS,
  STATUS_MAX_DISPLAY_MS,
  clientIdFor,
  topicFor,
  type CellConnectionStatus,
  type CommandRejectReason,
  type DisplayAction,
  type DisplayRejectReason,
  type DoorState,
  type LockState,
  type ReaderStatus,
  type ResetReason,
} from './contract.ts';
import type { SimulatorConfig } from './config.ts';
import { EmissionLog, type ReplaySelector } from './emission-log.ts';
import { parseCommand, parseDisplay, qrUriFor, type ChallengeContent, type DisplayInstruction } from './inbound.ts';
import {
  DeviceSession,
  buildChallengeDisplayed,
  buildCommandAcknowledged,
  buildCommandRejected,
  buildDeviceRestarted,
  buildDisplayRejected,
  buildDoorEvent,
  buildHeartbeat,
  buildLockEvent,
  buildOffline,
  buildOnline,
  buildRfidScan,
  type CommandCorrelation,
  type CompartmentStatus,
  type DisplayCorrelation,
  type MessageContext,
  type ObservationScope,
  type OutboundMessage,
} from './messages.ts';
import { mqttTransportFactory, type InboundMeta, type Transport, type TransportFactory } from './transport.ts';

export type SimulatorState = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'stopping' | 'stopped';

/**
 * What the hub did with an inbound command or display message, for logs and tests.
 * It never carries the display token nor the QR content (§22.1).
 */
export interface InboundReport {
  readonly channel: 'commands' | 'display';
  readonly outcome: 'IGNORED' | 'ACCEPTED' | 'ALREADY_APPLIED' | 'REJECTED' | 'DISPLAYED' | 'REACKNOWLEDGED';
  readonly messageId?: string;
  readonly operationId?: string;
  readonly reason?: CommandRejectReason | DisplayRejectReason;
  /** Local diagnostic only, never published. */
  readonly why?: string;
}

/** What the simulated screen shows. Only the `screen` accessor exposes the QR content. */
export type ScreenView =
  | { readonly kind: 'IDLE' }
  | {
      readonly kind: 'ACCESS_CHALLENGE';
      readonly operationId: string;
      readonly compartmentId: string;
      readonly compartmentCode: string;
      readonly action: DisplayAction;
      readonly challengeId: string;
      readonly displayRevision: number;
      readonly until: string;
      /** §27.1 URI the technician application scans; a secret, never logged. */
      readonly qrUri: string;
    }
  | {
      readonly kind: 'OPERATION_STATUS';
      readonly operationId: string;
      readonly compartmentId: string;
      readonly compartmentCode: string;
      readonly action: DisplayAction;
      readonly status: string;
      readonly reasonCode: string | null;
      readonly displayRevision: number;
      readonly until: string;
    };

/** A screen change without the QR content, safe to log. */
export type RedactedScreenView = Exclude<ScreenView, { kind: 'ACCESS_CHALLENGE' }> | Omit<Extract<ScreenView, { kind: 'ACCESS_CHALLENGE' }>, 'qrUri'>;

/** One-shot faults injected into the next accepted command (scenario negative cases). */
export const ACTUATION_FAULTS = ['LOCK_ACTUATION_FAILED', 'CRASH_DURING_ACTUATION'] as const;
export type ActuationFault = (typeof ACTUATION_FAULTS)[number];

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
  /** The broker granted the commands and display subscriptions of this connection. */
  subscribed: [topics: readonly string[]];
  inbound: [report: InboundReport];
  /** The lock of a cell was driven open. Counted by tests: a duplicate never adds one. */
  actuated: [compartmentId: string, operationId: string];
  screen: [view: RedactedScreenView];
  /** The command journal could not be written; the hub then refuses to actuate. */
  journalError: [error: Error];
}

export interface SimulatorDependencies {
  readonly transportFactory?: TransportFactory;
  readonly now?: () => number;
  readonly newId?: () => string;
  readonly random?: () => number;
  /** Defaults to the state file of `config.bootCountFile`. */
  readonly bootCounter?: BootCounter;
  /** Defaults to the state file of `config.commandJournalFile`. */
  readonly commandJournal?: CommandJournal;
}

/** Bound of each shutdown step, so that stop() never waits on the broker forever. */
export const STOP_STEP_TIMEOUT_MS = 5_000;

/** Events prepared while the connection is down, published after the next ONLINE (§18). */
export const MAX_QUEUED_EVENTS = 64;

/** Display messages whose outcome is remembered in a boot, to answer duplicates alike. */
export const MAX_REMEMBERED_DISPLAYS = 64;

/** A command being answered, with its expiresAt when it could be read (journal retention). */
type HandledCommand = CommandCorrelation & { readonly expiresAt?: number };

/** Doc 10 §12.2: the return proof needs at least three coherent reads. */
export const DEFAULT_READ_COUNT = 3;

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

/**
 * Heartbeat-visible state of one cell, changed without publishing any event (fault
 * set-up). Physical actions that the hub observes go through openDoor(), closeDoor(),
 * putTag() and takeTag().
 */
export type CompartmentPatch = Partial<{
  connectionStatus: CellConnectionStatus;
  readerStatus: ReaderStatus;
  doorState: DoorState;
  lockState: LockState;
}>;

interface Scan {
  readonly timer: NodeJS.Timeout;
  readonly resolve: () => void;
}

/** One simulated cell: the physical world (door, tags) and what the hub drives (lock). */
interface Cell {
  readonly code: string;
  readonly compartmentId: string;
  readonly cellAddress: number;
  connectionStatus: CellConnectionStatus;
  readerStatus: ReaderStatus;
  doorState: DoorState;
  lockState: LockState;
  /** Tags physically inside the cell, with the read count a scan reports. */
  readonly tags: Map<string, number>;
  /**
   * The operation whose physical sequence is under way in this cell: from the
   * actuation to the scan that follows the door closing, or to the relock of an
   * unlock that nobody used. Lost on reboot, like the firmware's RAM.
   */
  operationId: string | undefined;
  doorOpenedInOperation: boolean;
  unlockTimer: NodeJS.Timeout | undefined;
  readonly scans: Set<Scan>;
}

interface ScreenState {
  readonly view: Exclude<ScreenView, { kind: 'IDLE' }>;
  readonly timer: NodeJS.Timeout;
}

type DisplayOutcome =
  | { readonly accepted: true; readonly correlation: DisplayCorrelation; readonly kind: 'challenge' | 'status' }
  | { readonly accepted: false; readonly correlation: DisplayCorrelation; readonly reason: DisplayRejectReason };

/**
 * Simulated Aegis Locker Node (schema 2.0). Status: availability with a Last Will per
 * connection, DEVICE_RESTARTED once per boot, a heartbeat every 10 seconds. Commands:
 * technical validation, a durable deduplication journal, actuation of the targeted
 * cell, deterministic acknowledgement. Display: the access challenge and its
 * acknowledgement. Physical observations: door, lock and RFID events produced by
 * scripted physical actions.
 *
 * It never authorises anything: it executes what the backend already decided and
 * reports what it observes.
 */
export class HubSimulator extends EventEmitter<SimulatorEvents> {
  readonly config: SimulatorConfig;
  readonly #transportFactory: TransportFactory;
  readonly #now: () => number;
  readonly #newId: () => string;
  readonly #random: () => number;
  readonly #bootCounter: BootCounter;
  readonly #journal: CommandJournal;
  readonly #cells = new Map<string, Cell>();
  readonly #emitted = new EmissionLog();
  readonly #commandsTopic: string;
  readonly #displayTopic: string;

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
  #crashing: Promise<void> | undefined;

  #clockSynchronized = true;
  #screenAvailable = true;
  #armedFault: ActuationFault | undefined;
  #screen: ScreenState | undefined;
  /** Highest display revision accepted in this boot (§27.4). */
  #displayRevision: number | undefined;
  readonly #displayOutcomes = new Map<string, DisplayOutcome>();
  /** PREVIOUS_EXECUTION_UNCERTAIN rejections to publish after the first ONLINE of the boot. */
  #uncertainReports: JournalEntry[] = [];
  #queued: OutboundMessage[] = [];

  constructor(config: SimulatorConfig, deps: SimulatorDependencies = {}) {
    super();
    this.config = config;
    this.#transportFactory = deps.transportFactory ?? mqttTransportFactory;
    this.#now = deps.now ?? Date.now;
    this.#newId = deps.newId ?? randomUUID;
    this.#random = deps.random ?? Math.random;
    this.#bootCounter =
      deps.bootCounter ?? new FileBootCounter(config.bootCountFile, config.deviceKey, config.firstBootCount);
    this.#journal = deps.commandJournal ?? new FileCommandJournal(config.commandJournalFile, config.deviceKey);
    this.#resetReason = config.resetReason;
    this.#commandsTopic = topicFor(config.lockerId, 'commands');
    this.#displayTopic = topicFor(config.lockerId, 'display');
    for (const c of config.compartments) {
      this.#cells.set(c.code, {
        code: c.code,
        compartmentId: c.compartmentId,
        cellAddress: c.cellAddress,
        connectionStatus: c.connectionStatus ?? 'CONNECTED',
        readerStatus: c.readerStatus ?? 'HEALTHY',
        doorState: c.doorState ?? 'CLOSED',
        lockState: c.lockState ?? 'LOCKED',
        tags: new Map(),
        operationId: undefined,
        doorOpenedInOperation: false,
        unlockTimer: undefined,
        scans: new Set(),
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

  /** What the screen shows now, QR content included: what the technician would scan. */
  get screen(): ScreenView {
    return this.#screen?.view ?? { kind: 'IDLE' };
  }

  /** Heartbeat view of one cell, by its scenario code. */
  compartment(code: string): CompartmentStatus & { readonly tags: ReadonlyMap<string, number>; readonly operationId?: string } {
    const cell = this.#cell(code);
    return {
      ...this.#status(cell),
      tags: new Map(cell.tags),
      ...(cell.operationId !== undefined ? { operationId: cell.operationId } : {}),
    };
  }

  /**
   * Boots the hub: the next persisted bootCount, a new deviceSessionId, sequence 0,
   * the command journal read back (an EXECUTING entry becomes uncertain), the locks in
   * their safe state, then connect.
   */
  start(): void {
    if (this.#state !== 'idle' && this.#state !== 'stopped') {
      throw new Error(`cannot start from state ${this.#state}`);
    }
    // Reserved before anything is emitted, like the firmware's NVS write at boot.
    const bootCount = this.#bootCounter.next();
    this.#uncertainReports = this.#journal.recover(this.#now());
    this.#session = new DeviceSession(this.#newId(), bootCount, this.#now());
    this.#emitted.beginBoot(bootCount);
    this.#restartAnnounced = false;
    this.#reconnectAttempt = 0;
    this.#resetVolatileState();
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
    transport.on('message', (topic, body, meta) => {
      if (transport !== this.#transport || this.#state !== 'online') return;
      this.#receive(topic, body, meta);
    });
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
   * comes is abandoned after 5 s, then DISCONNECT is written at once; if the socket
   * has not closed 5 s later (a broker keeping it half-open), it is destroyed. The
   * DISCONNECT was already written, so the broker that reads it discards the Will.
   */
  async stop(): Promise<void> {
    const transport = this.#transport;
    if (!transport || this.#state === 'stopped' || this.#state === 'stopping') return;
    const wasOnline = this.#state === 'online';
    // Leaving `online` first stops heartbeats, replays, reconnections and inbound handling.
    this.#setState('stopping');
    // A command arriving now is not handled: it must stay unacknowledged, so that the
    // broker redelivers it to the next connection of the session.
    transport.withholdAcknowledgements();
    this.#clearNetworkTimers();
    this.#clearLocalTimers();
    if (wasOnline) {
      const offline = buildOffline(this.#context(), this.#currentConnectionId(), 'SHUTDOWN');
      this.#emitted.record(offline);
      this.emit('sent', offline);
      try {
        await withTimeout(transport.publish(offline.topic, offline.body, offline.delivery), STOP_STEP_TIMEOUT_MS, 'SHUTDOWN not acknowledged');
        this.emit('delivered', offline);
      } catch (error) {
        // The heartbeat timeout remains the backend's reference (doc 10 §15.2).
        this.emit('publishFailed', offline, error as Error);
      }
      try {
        await withTimeout(transport.disconnect(), STOP_STEP_TIMEOUT_MS, 'socket not closed after DISCONNECT');
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

  /**
   * Abrupt failure (power loss): the socket closes without DISCONNECT, the broker
   * publishes the Will, and a message being handled is never acknowledged.
   */
  crash(): Promise<void> {
    const transport = this.#transport;
    if (!transport || this.#state === 'stopped') return Promise.resolve();
    // A crash already under way (a fault during actuation) is the same crash.
    if (this.#crashing) return this.#crashing;
    this.#setState('stopping');
    this.#clearNetworkTimers();
    this.#clearLocalTimers();
    this.#crashing = transport
      .destroy()
      .catch((error: Error) => this.emit('transportError', error))
      .then(() => {
        this.#crashing = undefined;
        this.#transport = undefined;
        this.#setState('stopped');
      });
    return this.#crashing;
  }

  /**
   * Crash followed by a new boot: bootCount + 1, a new deviceSessionId, and
   * DEVICE_RESTARTED with `resetReason`. `offlineMs` keeps the hub powered off that
   * long first, so that commands published meanwhile wait in the broker session.
   */
  async restart(resetReason?: ResetReason, offlineMs = 0): Promise<void> {
    await this.crash();
    if (offlineMs > 0) await new Promise((resolve) => setTimeout(resolve, offlineMs));
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

  /** Changes what the next heartbeats report for one cell, without any event. */
  updateCompartment(code: string, patch: CompartmentPatch): void {
    Object.assign(this.#cell(code), patch);
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
        clockSynchronized: this.#clockSynchronized,
        rssiDbm: this.config.rssiDbm,
        compartments: [...this.#cells.values()].map((c) => this.#status(c)),
      }),
    );
  }

  /**
   * Hands a message to the hub as if the broker had delivered it on `commands` or
   * `display`: same validation, journal and acknowledgements. For scenarios run
   * without a backend; with a backend, the backend publishes.
   */
  deliver(channel: 'commands' | 'display', body: string, meta: Partial<InboundMeta> = {}): void {
    if (this.#state !== 'online') throw new Error(`cannot receive a message from state ${this.#state}`);
    this.#receive(channel === 'commands' ? this.#commandsTopic : this.#displayTopic, Buffer.from(body, 'utf8'), {
      retain: false,
      qos: 1,
      dup: false,
      ...meta,
    });
  }

  /** NTP state (§17.1): an unsynchronised hub refuses commands and display instructions. */
  setClockSynchronized(synchronized: boolean): void {
    this.#clockSynchronized = synchronized;
  }

  /** A switched-off or broken screen refuses display instructions (§23.1). */
  setScreenAvailable(available: boolean): void {
    this.#screenAvailable = available;
    if (!available) this.#clearScreen();
  }

  /** The next command that passes validation suffers this fault instead of a clean actuation. */
  armFault(fault: ActuationFault): void {
    this.#armedFault = fault;
  }

  /**
   * Resolves once the lock of a cell is unlocked by a command (already unlocked
   * included); rejects after `timeoutMs`. Lets a physical script follow the unlock
   * that a real backend decided.
   */
  waitUntilUnlocked(code: string, timeoutMs = 60_000): Promise<void> {
    const cell = this.#cell(code);
    if (cell.lockState === 'UNLOCKED') return Promise.resolve();
    return new Promise((resolve, reject) => {
      const listener = (compartmentId: string) => {
        if (compartmentId !== cell.compartmentId) return;
        cleanup();
        resolve();
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`${code} not unlocked after ${timeoutMs} ms`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        this.off('actuated', listener);
      };
      this.on('actuated', listener);
    });
  }

  /**
   * Somebody opens the door. A locked door only opens when `forced`, which models a
   * break-in or a faulty latch: the event then carries no operationId unless an
   * operation is under way in that cell.
   */
  openDoor(code: string, options: { readonly forced?: boolean } = {}): void {
    const cell = this.#cell(code);
    if (cell.doorState === 'OPEN') throw new Error(`door of ${code} is already open`);
    if (cell.lockState !== 'UNLOCKED' && options.forced !== true) {
      throw new Error(`door of ${code} is ${cell.lockState.toLowerCase()}; set forced to simulate a forced opening`);
    }
    cell.doorState = 'OPEN';
    if (cell.operationId !== undefined) cell.doorOpenedInOperation = true;
    const scope = this.#scope(cell);
    this.#observe((ctx) => buildDoorEvent(ctx, scope, 'OPEN'));
  }

  /**
   * Somebody closes the door. The hub relocks a lock still open, then, inside an
   * operation, runs the RFID scan window that proves presence or absence (§12.2).
   */
  closeDoor(code: string): void {
    const cell = this.#cell(code);
    if (cell.doorState !== 'OPEN') throw new Error(`door of ${code} is not open`);
    cell.doorState = 'CLOSED';
    const scope = this.#scope(cell);
    this.#observe((ctx) => buildDoorEvent(ctx, scope, 'CLOSED'));
    if (cell.lockState === 'UNLOCKED') this.#relock(cell);
    const operationId = cell.operationId;
    if (operationId !== undefined) {
      void this.#scan(cell, this.config.rfidWindowMs, () => {
        if (cell.operationId === operationId) this.#endOperation(cell);
      });
    }
  }

  /** A tag enters the cell; `readCount` is what the next scans report for it. */
  putTag(code: string, identifier: string, readCount = DEFAULT_READ_COUNT): void {
    const cell = this.#cell(code);
    if (identifier.length === 0 || identifier.length > RFID_IDENTIFIER_MAX_LENGTH || !/^[\x21-\x7e]+$/.test(identifier)) {
      throw new Error(`tag identifier must be 1-${RFID_IDENTIFIER_MAX_LENGTH} printable ASCII characters`);
    }
    if (!Number.isInteger(readCount) || readCount < 1 || readCount > RFID_READ_COUNT_MAX) {
      throw new Error(`readCount must be an integer in 1..${RFID_READ_COUNT_MAX}`);
    }
    if (!cell.tags.has(identifier) && cell.tags.size >= RFID_MAX_IDENTIFIERS) {
      throw new Error(`cell ${code} already holds ${RFID_MAX_IDENTIFIERS} tags`);
    }
    cell.tags.set(identifier, readCount);
  }

  takeTag(code: string, identifier: string): void {
    const cell = this.#cell(code);
    if (!cell.tags.delete(identifier)) throw new Error(`tag ${identifier} is not in cell ${code}`);
  }

  /**
   * Runs one RFID scan window on a cell now and resolves once RFID_SCAN_COMPLETED is
   * prepared (or the hub went down meanwhile). It carries the operationId of the
   * operation under way in that cell, if any.
   */
  scanRfid(code: string, windowMs = this.config.rfidWindowMs): Promise<void> {
    if (!Number.isInteger(windowMs) || windowMs <= 0 || windowMs > RFID_WINDOW_MAX_MS) {
      throw new Error(`windowMs must be an integer in 1..${RFID_WINDOW_MAX_MS}`);
    }
    return this.#scan(this.#cell(code), windowMs);
  }

  #onConnect(transport: Transport): void {
    if (transport !== this.#transport || this.#state === 'stopping' || this.#state === 'stopped') return;
    this.#reconnectAttempt = 0;
    this.#setState('online');
    // A persistent session may exist without these subscriptions (created by another
    // build), so the hub subscribes on every connection rather than trusting
    // sessionPresent. Retained messages this may bring are ignored (§7.2).
    const topics = [this.#commandsTopic, this.#displayTopic];
    transport.subscribe(topics).then(
      () => this.emit('subscribed', topics),
      (error: Error) => {
        // A SUBSCRIBE cut short by a crash or a lost socket is not an error of the current connection.
        if (transport === this.#transport && this.#state === 'online') this.emit('transportError', error);
      },
    );
    // Doc 10 §18 order after (re)connection: ONLINE, DEVICE_RESTARTED on a real boot,
    // an immediate heartbeat carrying the current cell states, then the rest.
    this.#publish(transport, buildOnline(this.#context(), this.#currentConnectionId()));
    const firstConnection = !this.#restartAnnounced;
    if (firstConnection) {
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
    if (firstConnection) {
      for (const entry of this.#uncertainReports.splice(0)) this.#reportUncertain(transport, entry);
    }
    for (const message of this.#queued.splice(0)) this.#publish(transport, message);
    this.#heartbeatTimer = setInterval(() => this.publishHeartbeat(), this.config.heartbeatIntervalMs);
    for (const waiter of this.#onlineWaiters.splice(0)) waiter();
  }

  #onClose(transport: Transport): void {
    if (transport !== this.#transport || this.#state === 'stopping' || this.#state === 'stopped') return;
    // Only the network timers stop: the unlock window and the scans run locally (§9.2).
    this.#clearNetworkTimers();
    // Doc 10 §27.4: a connection loss before authorisation masks the challenge.
    if (this.#screen?.view.kind === 'ACCESS_CHALLENGE') this.#clearScreen();
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

  #receive(topic: string, body: Buffer, meta: InboundMeta): void {
    if (topic === this.#commandsTopic) this.#handleCommand(body, meta);
    else if (topic === this.#displayTopic) this.#handleDisplay(body, meta);
  }

  // ---- Commands (doc 10 §9, §10, §16.1) -------------------------------------------

  #handleCommand(body: Buffer, meta: InboundMeta): void {
    // Doc 10 §7.2: a retained command is never executed, however it was produced.
    if (meta.retain) {
      this.emit('inbound', { channel: 'commands', outcome: 'IGNORED', why: 'retained command' });
      return;
    }
    const parsed = parseCommand(body);
    if (parsed.kind === 'uncorrelatable') {
      // COMMAND_REJECTED requires messageId, operationId and compartmentId (§20).
      this.emit('inbound', { channel: 'commands', outcome: 'IGNORED', why: parsed.why });
      return;
    }
    const expiresAt = parsed.kind === 'command' ? parsed.command.expiresAtMs : parsed.expiresAtMs;
    const correlation: HandledCommand = { ...parsed.correlation, ...(expiresAt !== undefined ? { expiresAt } : {}) };
    // Deduplication first: a redelivery gets the known outcome, whatever its age.
    const known = this.#journal.findByMessageId(correlation.commandMessageId);
    if (known) {
      this.#answerKnown(known, { ...correlation, operationId: known.operationId, compartmentId: known.compartmentId });
      return;
    }
    if (parsed.kind === 'invalid') {
      this.#rejectCommand(correlation, parsed.reason, parsed.detail);
      return;
    }
    const command = parsed.command;
    if (command.lockerId !== this.config.lockerId) {
      this.#rejectCommand(correlation, 'WRONG_LOCKER', 'The command targets another locker.');
      return;
    }
    const cell = this.#cellById(command.compartmentId);
    if (!cell) {
      this.#rejectCommand(correlation, 'UNKNOWN_COMPARTMENT', 'No cell of this hub has this compartmentId.');
      return;
    }
    if (!this.#clockSynchronized) {
      this.#rejectCommand(correlation, 'CLOCK_NOT_SYNCHRONIZED', 'The hub clock is not synchronised.');
      return;
    }
    if (this.#now() >= command.expiresAtMs) {
      this.#rejectCommand(correlation, 'COMMAND_EXPIRED', 'The command expired before execution.');
      return;
    }
    // operationId protects the workflow against a second, different command (§16.1).
    const consumed = this.#journal.findExecutedByOperation(command.operationId);
    if (consumed) {
      if (consumed.compartmentId !== command.compartmentId) {
        // ALREADY_APPLIED would name a cell that was never unlocked for this operation.
        this.#rejectCommand(correlation, 'INVALID_PAYLOAD', 'This operation was already executed on another compartment.');
        return;
      }
      this.#answerKnown(consumed, correlation, true);
      return;
    }
    const busy = [...this.#cells.values()].find((c) => c.operationId !== undefined);
    if (busy) {
      this.#rejectCommand(correlation, 'LOCAL_OPERATION_IN_PROGRESS', 'Another physical operation is under way on this locker.');
      return;
    }
    if (cell.connectionStatus !== 'CONNECTED') {
      this.#rejectCommand(correlation, 'CELL_UNREACHABLE', 'The target cell does not answer on the local bus.');
      return;
    }
    if (cell.doorState !== 'CLOSED') {
      this.#rejectCommand(correlation, 'DOOR_STATE_UNSAFE', 'The door of the target cell is not closed.');
      return;
    }
    this.#execute(correlation, cell);
  }

  #execute(correlation: HandledCommand, cell: Cell): void {
    const base = {
      messageId: correlation.commandMessageId,
      operationId: correlation.operationId,
      compartmentId: correlation.compartmentId,
      executed: true,
      ...(correlation.expiresAt !== undefined ? { expiresAt: correlation.expiresAt } : {}),
    };
    try {
      // Durable before the irreversible action (§9.1, §16.1).
      this.#journal.record({ ...base, state: 'EXECUTING', recordedAt: this.#now() });
    } catch (error) {
      this.emit('journalError', error as Error);
      const detail =
        error instanceof CommandJournalFullError
          ? 'The command journal is full of commands that must not be forgotten; nothing was actuated.'
          : 'The command journal cannot be written; nothing was actuated.';
      this.#rejectCommand(correlation, 'INTERNAL_DEVICE_ERROR', detail);
      return;
    }
    // Doc 10 §9: the QR of this operation disappears as execution starts.
    if (this.#screen?.view.kind === 'ACCESS_CHALLENGE' && this.#screen.view.operationId === correlation.operationId) {
      this.#clearScreen();
    }
    const fault = this.#armedFault;
    this.#armedFault = undefined;

    if (fault === 'LOCK_ACTUATION_FAILED') {
      const detail = 'The lock did not report the expected state after actuation.';
      this.#record({ ...base, state: 'REJECTED', reason: 'LOCK_ACTUATION_FAILED', detail, recordedAt: this.#now() });
      this.#publishEvent(buildCommandRejected(this.#context(), correlation, 'LOCK_ACTUATION_FAILED', detail));
      this.emit('inbound', this.#commandReport(correlation, 'REJECTED', 'LOCK_ACTUATION_FAILED'));
      return;
    }

    cell.lockState = 'UNLOCKED';
    this.emit('actuated', cell.compartmentId, correlation.operationId);
    if (fault === 'CRASH_DURING_ACTUATION') {
      // Power lost after the actuation, before the result is journaled or acknowledged:
      // the entry stays EXECUTING and the command is never PUBACKed.
      this.emit('inbound', { ...this.#commandReport(correlation, 'IGNORED'), why: 'hub crashed during actuation' });
      void this.crash();
      return;
    }
    cell.operationId = correlation.operationId;
    cell.doorOpenedInOperation = false;
    cell.unlockTimer = setTimeout(() => this.#unlockWindowElapsed(cell), this.config.unlockWindowMs);
    // If this write fails, memory follows the decision, so that redeliveries of this
    // boot get ALREADY_APPLIED; the durable copy stays EXECUTING, so that after a
    // reboot the command is reported uncertain. It is never executed twice.
    this.#record({ ...base, state: 'ACKNOWLEDGED', recordedAt: this.#now() });
    this.#publishEvent(buildCommandAcknowledged(this.#context(), correlation, 'ACCEPTED'));
    const scope = this.#scope(cell);
    this.#observe((ctx) => buildLockEvent(ctx, scope, 'UNLOCKED'));
    this.emit('inbound', this.#commandReport(correlation, 'ACCEPTED'));
  }

  /**
   * Answers with the outcome already journaled, without any actuation (§10.1, §16.1).
   * `newCommand`: a different command of an already executed operation, journaled in
   * turn so that its own redeliveries get the same answer.
   */
  #answerKnown(known: JournalEntry, correlation: HandledCommand, newCommand = false): void {
    // EXECUTING is only found after the boot that crashed, already turned uncertain;
    // journaled synchronously, it cannot be seen by a redelivery in the same boot.
    const acknowledged = known.state === 'ACKNOWLEDGED';
    const reason = known.reason ?? 'LOCAL_OPERATION_IN_PROGRESS';
    const detail = known.detail ?? 'The command is still executing.';
    if (newCommand) {
      this.#record({
        messageId: correlation.commandMessageId,
        operationId: correlation.operationId,
        compartmentId: correlation.compartmentId,
        executed: false,
        recordedAt: this.#now(),
        ...(correlation.expiresAt !== undefined ? { expiresAt: correlation.expiresAt } : {}),
        ...(acknowledged ? { state: 'ACKNOWLEDGED' as const } : { state: 'REJECTED' as const, reason, detail }),
      });
    }
    if (acknowledged) {
      this.#publishEvent(buildCommandAcknowledged(this.#context(), correlation, 'ALREADY_APPLIED'));
      this.emit('inbound', this.#commandReport(correlation, 'ALREADY_APPLIED'));
      return;
    }
    this.#publishEvent(buildCommandRejected(this.#context(), correlation, reason, detail));
    this.emit('inbound', this.#commandReport(correlation, 'REJECTED', reason));
  }

  #rejectCommand(correlation: HandledCommand, reason: CommandRejectReason, detail: string): void {
    this.#record({
      messageId: correlation.commandMessageId,
      operationId: correlation.operationId,
      compartmentId: correlation.compartmentId,
      state: 'REJECTED',
      executed: false,
      reason,
      detail,
      recordedAt: this.#now(),
      ...(correlation.expiresAt !== undefined ? { expiresAt: correlation.expiresAt } : {}),
    });
    this.#publishEvent(buildCommandRejected(this.#context(), correlation, reason, detail));
    this.emit('inbound', this.#commandReport(correlation, 'REJECTED', reason));
  }

  #reportUncertain(transport: Transport, entry: JournalEntry): void {
    const correlation = { commandMessageId: entry.messageId, operationId: entry.operationId, compartmentId: entry.compartmentId };
    const message = buildCommandRejected(this.#context(), correlation, 'PREVIOUS_EXECUTION_UNCERTAIN', entry.detail ?? '');
    this.#publish(transport, message, () => {
      try {
        this.#journal.markReported(entry.messageId, this.#now());
      } catch (error) {
        this.emit('journalError', error as Error);
      }
    });
  }

  /**
   * A journal write after the decision: memory follows the decision even if it cannot
   * be made durable; a failure is reported and the answer still goes out.
   */
  #record(entry: JournalEntry): void {
    try {
      this.#journal.record(entry, entry.recordedAt, { followDecision: true });
    } catch (error) {
      this.emit('journalError', error as Error);
    }
  }

  #commandReport(correlation: CommandCorrelation, outcome: InboundReport['outcome'], reason?: CommandRejectReason): InboundReport {
    return {
      channel: 'commands',
      outcome,
      messageId: correlation.commandMessageId,
      operationId: correlation.operationId,
      ...(reason !== undefined ? { reason } : {}),
    };
  }

  // ---- Display (doc 10 §27) -------------------------------------------------------

  #handleDisplay(body: Buffer, meta: InboundMeta): void {
    if (meta.retain) {
      this.emit('inbound', { channel: 'display', outcome: 'IGNORED', why: 'retained display instruction' });
      return;
    }
    const parsed = parseDisplay(body);
    if (parsed.kind === 'uncorrelatable') {
      this.emit('inbound', { channel: 'display', outcome: 'IGNORED', why: parsed.why });
      return;
    }
    const correlation = parsed.correlation;
    const known = this.#displayOutcomes.get(correlation.displayMessageId);
    if (known) {
      // Doc 10 §27.4: a duplicate is acknowledged again, never shown again.
      if (!known.accepted) {
        this.#publishEvent(buildDisplayRejected(this.#context(), known.correlation, known.reason));
        this.emit('inbound', this.#displayReport(known.correlation, 'REJECTED', known.reason));
      } else if (known.kind === 'challenge') {
        this.#publishEvent(buildChallengeDisplayed(this.#context(), challengeCorrelation(known.correlation)));
        this.emit('inbound', this.#displayReport(known.correlation, 'REACKNOWLEDGED'));
      } else {
        this.emit('inbound', { ...this.#displayReport(known.correlation, 'IGNORED'), why: 'duplicate status' });
      }
      return;
    }
    if (parsed.kind === 'invalid') {
      this.#rejectDisplay(correlation, 'INVALID_DISPLAY_PAYLOAD', parsed.why);
      return;
    }
    const instruction = parsed.instruction;
    if (instruction.lockerId !== this.config.lockerId) {
      this.#rejectDisplay(correlation, 'INVALID_DISPLAY_PAYLOAD', 'lockerId of another locker');
      return;
    }
    const cell = this.#cellById(instruction.compartmentId);
    if (!cell) {
      this.#rejectDisplay(correlation, 'INVALID_DISPLAY_PAYLOAD', 'unknown compartmentId');
      return;
    }
    if (instruction.targetDeviceSessionId !== this.#session?.deviceSessionId) {
      this.#rejectDisplay(correlation, 'TARGET_SESSION_MISMATCH', 'instruction for another boot');
      return;
    }
    if (!this.#screenAvailable || !this.#clockSynchronized) {
      this.#rejectDisplay(correlation, 'SCREEN_UNAVAILABLE', this.#screenAvailable ? 'clock not synchronised' : 'screen unavailable');
      return;
    }
    // The hub never extends the display beyond its maximum after issuedAt (§27.1, §27.3).
    const maxMs = instruction.content.kind === 'challenge' ? CHALLENGE_MAX_DISPLAY_MS : STATUS_MAX_DISPLAY_MS;
    // An issuedAt in the future cannot keep the QR longer than the maximum from now either.
    const untilMs = Math.min(instruction.expiresAtMs, instruction.issuedAtMs + maxMs, this.#now() + maxMs);
    if (this.#now() >= untilMs) {
      this.#rejectDisplay(correlation, 'DISPLAY_EXPIRED', 'display deadline passed');
      return;
    }
    if (this.#displayRevision !== undefined && instruction.displayRevision <= this.#displayRevision) {
      this.#rejectDisplay(correlation, 'STALE_DISPLAY_REVISION', `revision ${instruction.displayRevision} <= ${this.#displayRevision}`);
      return;
    }
    this.#displayRevision = instruction.displayRevision;
    this.#show(instruction, untilMs);
    const kind = instruction.content.kind;
    this.#rememberDisplay(correlation.displayMessageId, { accepted: true, correlation, kind });
    if (kind === 'challenge') {
      // Published after the QR is rendered, not on PUBACK (§27.2).
      this.#publishEvent(buildChallengeDisplayed(this.#context(), challengeCorrelation(correlation)));
    }
    this.emit('inbound', this.#displayReport(correlation, 'DISPLAYED'));
  }

  #rejectDisplay(correlation: DisplayCorrelation, reason: DisplayRejectReason, why: string): void {
    this.#rememberDisplay(correlation.displayMessageId, { accepted: false, correlation, reason });
    this.#publishEvent(buildDisplayRejected(this.#context(), correlation, reason));
    this.emit('inbound', { ...this.#displayReport(correlation, 'REJECTED', reason), why });
  }

  #rememberDisplay(messageId: string, outcome: DisplayOutcome): void {
    this.#displayOutcomes.set(messageId, outcome);
    if (this.#displayOutcomes.size > MAX_REMEMBERED_DISPLAYS) {
      this.#displayOutcomes.delete(this.#displayOutcomes.keys().next().value!);
    }
  }

  #displayReport(correlation: DisplayCorrelation, outcome: InboundReport['outcome'], reason?: DisplayRejectReason): InboundReport {
    return {
      channel: 'display',
      outcome,
      messageId: correlation.displayMessageId,
      operationId: correlation.operationId,
      ...(reason !== undefined ? { reason } : {}),
    };
  }

  #show(instruction: DisplayInstruction, untilMs: number): void {
    const until = new Date(untilMs).toISOString();
    const common = {
      operationId: instruction.operationId,
      compartmentId: instruction.compartmentId,
      compartmentCode: instruction.content.compartmentCode,
      action: instruction.content.action,
      displayRevision: instruction.displayRevision,
      until,
    };
    const content = instruction.content;
    const view: Exclude<ScreenView, { kind: 'IDLE' }> =
      content.kind === 'challenge'
        ? {
            kind: 'ACCESS_CHALLENGE',
            ...common,
            challengeId: content.challengeId,
            qrUri: qrUriFor(this.config.lockerId, instruction as DisplayInstruction & { content: ChallengeContent }),
          }
        : { kind: 'OPERATION_STATUS', ...common, status: content.status, reasonCode: content.reasonCode };
    if (this.#screen) clearTimeout(this.#screen.timer);
    const timer = setTimeout(() => this.#clearScreen(), Math.max(0, untilMs - this.#now()));
    this.#screen = { view, timer };
    this.emit('screen', redact(view));
  }

  #clearScreen(): void {
    if (!this.#screen) return;
    clearTimeout(this.#screen.timer);
    this.#screen = undefined;
    this.emit('screen', { kind: 'IDLE' });
  }

  // ---- Physical observations (doc 10 §11, §12) ------------------------------------

  #unlockWindowElapsed(cell: Cell): void {
    cell.unlockTimer = undefined;
    if (cell.lockState === 'UNLOCKED') this.#relock(cell);
    // Nobody opened the door: the operation's physical sequence ends with the relock.
    if (cell.operationId !== undefined && !cell.doorOpenedInOperation && cell.doorState === 'CLOSED') this.#endOperation(cell);
  }

  #relock(cell: Cell): void {
    if (cell.unlockTimer) clearTimeout(cell.unlockTimer);
    cell.unlockTimer = undefined;
    cell.lockState = 'LOCKED';
    const scope = this.#scope(cell);
    this.#observe((ctx) => buildLockEvent(ctx, scope, 'LOCKED'));
  }

  #endOperation(cell: Cell): void {
    cell.operationId = undefined;
    cell.doorOpenedInOperation = false;
  }

  #scan(cell: Cell, windowMs: number, onCompleted?: () => void): Promise<void> {
    const startedMs = this.#now();
    const scope = this.#scope(cell);
    return new Promise((resolve) => {
      const scan: Scan = {
        resolve,
        timer: setTimeout(() => {
          cell.scans.delete(scan);
          // A cell that does not answer cannot attest a scan: UNKNOWN, no identifier.
          const readerStatus = cell.connectionStatus === 'CONNECTED' ? cell.readerStatus : 'UNKNOWN';
          const observed =
            readerStatus === 'HEALTHY'
              ? [...cell.tags].map(([identifierValue, readCount]) => ({ identifierValue, readCount }))
              : [];
          const endedMs = this.#now();
          this.#observe((ctx) =>
            buildRfidScan(ctx, scope, { windowStartedMs: startedMs, windowEndedMs: endedMs, readerStatus, observed }),
          );
          onCompleted?.();
          resolve();
        }, windowMs),
      };
      cell.scans.add(scan);
    });
  }

  #scope(cell: Cell): ObservationScope {
    return { compartmentId: cell.compartmentId, operationId: cell.operationId };
  }

  /**
   * An observation of a running hub: published when online, queued (bounded) while
   * the connection is down, and lost while the hub is off.
   */
  #observe(build: (ctx: MessageContext) => OutboundMessage): void {
    if (this.#state === 'idle' || this.#state === 'stopping' || this.#state === 'stopped') return;
    this.#publishEvent(build(this.#context()));
  }

  #publishEvent(message: OutboundMessage): void {
    const transport = this.#transport;
    if (this.#state === 'online' && transport) {
      this.#publish(transport, message);
      return;
    }
    if (this.#queued.length >= MAX_QUEUED_EVENTS) {
      // The firmware would raise STORAGE_FAULT after reconnecting (§18), not modelled here.
      this.emit('publishFailed', message, new Error(`local event queue full (${MAX_QUEUED_EVENTS})`));
      return;
    }
    this.#queued.push(message);
  }

  // ---- Common ---------------------------------------------------------------------

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

  #publish(transport: Transport, message: OutboundMessage, onDelivered?: () => void): void {
    this.#emitted.record(message);
    this.emit('sent', message);
    transport.publish(message.topic, message.body, message.delivery).then(
      () => {
        this.emit('delivered', message);
        onDelivered?.();
      },
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

  #cell(code: string): Cell {
    const cell = this.#cells.get(code);
    if (!cell) throw new Error(`unknown compartment code ${code}`);
    return cell;
  }

  #cellById(compartmentId: string): Cell | undefined {
    return [...this.#cells.values()].find((c) => c.compartmentId === compartmentId);
  }

  #status(cell: Cell): CompartmentStatus {
    return {
      compartmentId: cell.compartmentId,
      cellAddress: cell.cellAddress,
      connectionStatus: cell.connectionStatus,
      readerStatus: cell.readerStatus,
      doorState: cell.doorState,
      lockState: cell.lockState,
    };
  }

  /** What a reboot loses: RAM state, screen, queue; the locks return to their safe state. */
  #resetVolatileState(): void {
    this.#clearLocalTimers();
    this.#displayRevision = undefined;
    this.#displayOutcomes.clear();
    this.#queued = [];
    this.#armedFault = undefined;
    for (const cell of this.#cells.values()) {
      this.#endOperation(cell);
      if (cell.lockState === 'UNLOCKED') cell.lockState = 'LOCKED';
    }
  }

  #clearNetworkTimers(): void {
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#heartbeatTimer = undefined;
    this.#reconnectTimer = undefined;
  }

  /** The hub stops: unlock windows, scans and the screen end without any event. */
  #clearLocalTimers(): void {
    for (const cell of this.#cells.values()) {
      if (cell.unlockTimer) clearTimeout(cell.unlockTimer);
      cell.unlockTimer = undefined;
      for (const scan of cell.scans) {
        clearTimeout(scan.timer);
        scan.resolve();
      }
      cell.scans.clear();
    }
    if (this.#screen) clearTimeout(this.#screen.timer);
    this.#screen = undefined;
  }

  #setState(state: SimulatorState): void {
    if (this.#state === state) return;
    this.#state = state;
    this.emit('state', state);
  }
}

/** An accepted challenge always has both; parseDisplay refuses it otherwise. */
function challengeCorrelation(c: DisplayCorrelation): DisplayCorrelation & { challengeId: string; displayRevision: number } {
  if (c.challengeId === undefined || c.displayRevision === undefined) throw new Error('incomplete challenge correlation');
  return { ...c, challengeId: c.challengeId, displayRevision: c.displayRevision };
}

function redact(view: Exclude<ScreenView, { kind: 'IDLE' }>): RedactedScreenView {
  if (view.kind !== 'ACCESS_CHALLENGE') return view;
  const { qrUri: _, ...rest } = view;
  return rest;
}
