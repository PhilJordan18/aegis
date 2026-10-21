import {
  CANONICAL_UUID,
  CELL_ADDRESS_MAX,
  CELL_ADDRESS_MIN,
  HEARTBEAT_INTERVAL_MS,
  type CellConnectionStatus,
  type DoorState,
  type LockState,
  type ReaderStatus,
} from './contract.ts';

/**
 * Fictitious locker of the local broker ACL (infra/mqtt/acl) and of the doc 09/10
 * examples. A1 reuses the documented example compartmentId; A2 reuses the id of the
 * design fixture (docs/design/asset-lifecycle/prototype/data/fixture.js). Both are
 * configurable demo values, not an approved backend seed.
 */
export const DEFAULT_LOCKER_ID = 'd46a74ae-39dc-460b-8af0-38fc791b376a';
export const DEFAULT_COMPARTMENTS: readonly CompartmentConfig[] = [
  { code: 'A1', compartmentId: '1ae77ae3-8490-4f09-9412-a7816b77bff9', cellAddress: 1 },
  { code: 'A2', compartmentId: '5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10', cellAddress: 2 },
];
export const DEFAULT_BROKER_URL = 'mqtt://127.0.0.1:1883';
export const DEFAULT_FIRMWARE_VERSION = '0.1.0-sim';
/** Not a contract-controlled value: doc 10 §13.1 only shows WATCHDOG. */
export const DEFAULT_RESET_REASON = 'POWER_ON';
export const DEFAULT_RSSI_DBM = -55;

export interface CompartmentConfig {
  /** Readable code used by scenarios only; it never appears in a payload. */
  readonly code: string;
  readonly compartmentId: string;
  readonly cellAddress: number;
  readonly connectionStatus?: CellConnectionStatus;
  readonly readerStatus?: ReaderStatus;
  readonly doorState?: DoorState;
  readonly lockState?: LockState;
}

export interface SimulatorConfig {
  readonly brokerUrl: string;
  readonly username: string;
  readonly password: string;
  readonly lockerId: string;
  readonly deviceKey: string;
  readonly compartments: readonly CompartmentConfig[];
  readonly firmwareVersion: string;
  readonly resetReason: string;
  readonly rssiDbm: number;
  readonly heartbeatIntervalMs: number;
  /** Allows plaintext MQTT to a non-loopback host, e.g. a private Docker network. */
  readonly allowInsecureRemote: boolean;
  readonly caFile?: string;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Plaintext MQTT is only acceptable on an isolated simulator network (doc 10 §4.2).
 * A remote broker requires TLS unless the caller opts in explicitly.
 */
export function assertTransportAllowed(brokerUrl: string, allowInsecureRemote: boolean): void {
  let url: URL;
  try {
    url = new URL(brokerUrl);
  } catch {
    throw new ConfigError('AEGIS_MQTT_URL is not a valid URL');
  }
  if (url.protocol === 'mqtts:') return;
  if (url.protocol !== 'mqtt:') {
    throw new ConfigError(`unsupported broker protocol ${url.protocol}; use mqtt: or mqtts:`);
  }
  if (!LOOPBACK_HOSTS.has(url.hostname) && !allowInsecureRemote) {
    throw new ConfigError(
      `plaintext MQTT to ${url.hostname} is refused; use mqtts: or set AEGIS_SIM_ALLOW_INSECURE_REMOTE=true on an isolated network only`,
    );
  }
}

export function validateConfig(config: SimulatorConfig): SimulatorConfig {
  if (!CANONICAL_UUID.test(config.lockerId)) {
    throw new ConfigError('lockerId must be a canonical lowercase UUID');
  }
  if (config.password.length === 0) {
    throw new ConfigError('AEGIS_MQTT_DEVICE_PASSWORD is required');
  }
  if (config.username.length === 0) {
    throw new ConfigError('MQTT username must not be empty');
  }
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(config.deviceKey)) {
    throw new ConfigError('deviceKey must be 1-64 characters among letters, digits, ".", "_" and "-"');
  }
  if (config.compartments.length === 0 || config.compartments.length > 16) {
    throw new ConfigError('between 1 and 16 compartments are required');
  }
  const codes = new Set<string>();
  const ids = new Set<string>();
  const addresses = new Set<number>();
  for (const c of config.compartments) {
    if (!/^[A-Za-z0-9-]{1,16}$/.test(c.code)) throw new ConfigError(`invalid compartment code ${JSON.stringify(c.code)}`);
    if (!CANONICAL_UUID.test(c.compartmentId)) {
      throw new ConfigError(`compartment ${c.code}: compartmentId must be a canonical lowercase UUID`);
    }
    if (!Number.isInteger(c.cellAddress) || c.cellAddress < CELL_ADDRESS_MIN || c.cellAddress > CELL_ADDRESS_MAX) {
      throw new ConfigError(`compartment ${c.code}: cellAddress must be an integer in ${CELL_ADDRESS_MIN}..${CELL_ADDRESS_MAX}`);
    }
    if (codes.has(c.code)) throw new ConfigError(`duplicate compartment code ${c.code}`);
    if (ids.has(c.compartmentId)) throw new ConfigError(`duplicate compartmentId ${c.compartmentId}`);
    if (addresses.has(c.cellAddress)) throw new ConfigError(`duplicate cellAddress ${c.cellAddress}`);
    codes.add(c.code);
    ids.add(c.compartmentId);
    addresses.add(c.cellAddress);
  }
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(config.resetReason)) {
    throw new ConfigError('resetReason must be an UPPER_SNAKE_CASE value');
  }
  if (config.firmwareVersion.length === 0 || config.firmwareVersion.length > 32) {
    throw new ConfigError('firmwareVersion must be 1-32 characters');
  }
  if (!Number.isInteger(config.rssiDbm) || config.rssiDbm > 0 || config.rssiDbm < -127) {
    throw new ConfigError('rssiDbm must be an integer in -127..0');
  }
  if (!Number.isInteger(config.heartbeatIntervalMs) || config.heartbeatIntervalMs < 100) {
    throw new ConfigError('heartbeatIntervalMs must be an integer >= 100');
  }
  assertTransportAllowed(config.brokerUrl, config.allowInsecureRemote);
  return config;
}

/**
 * Parses `A1:<uuid>:1,A2:<uuid>:2` (code:compartmentId:cellAddress).
 */
export function parseCompartments(spec: string): CompartmentConfig[] {
  return spec
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const parts = entry.split(':');
      if (parts.length !== 3) {
        throw new ConfigError(`AEGIS_SIM_COMPARTMENTS entry ${JSON.stringify(entry)} must be code:compartmentId:cellAddress`);
      }
      const [code, compartmentId, address] = parts as [string, string, string];
      if (!/^\d+$/.test(address)) throw new ConfigError(`compartment ${code}: cellAddress must be an integer`);
      return { code, compartmentId, cellAddress: Number(address) };
    });
}

function parseInteger(name: string, raw: string): number {
  if (!/^-?\d+$/.test(raw)) throw new ConfigError(`${name} must be an integer`);
  return Number(raw);
}

/**
 * Builds the configuration from environment variables only, so that no credential
 * ever lives in the repository or on a command line.
 */
export function configFromEnv(env: NodeJS.ProcessEnv): SimulatorConfig {
  const lockerId = env.AEGIS_SIM_LOCKER_ID ?? DEFAULT_LOCKER_ID;
  const caFile = env.AEGIS_MQTT_CA_FILE;
  return validateConfig({
    brokerUrl: env.AEGIS_MQTT_URL ?? DEFAULT_BROKER_URL,
    // The local broker authenticates the hub with its lockerId as username.
    username: env.AEGIS_MQTT_DEVICE_USERNAME ?? lockerId,
    password: env.AEGIS_MQTT_DEVICE_PASSWORD ?? '',
    lockerId,
    deviceKey: env.AEGIS_SIM_DEVICE_KEY ?? `sim-${lockerId}`,
    compartments: env.AEGIS_SIM_COMPARTMENTS ? parseCompartments(env.AEGIS_SIM_COMPARTMENTS) : DEFAULT_COMPARTMENTS,
    firmwareVersion: env.AEGIS_SIM_FIRMWARE_VERSION ?? DEFAULT_FIRMWARE_VERSION,
    resetReason: env.AEGIS_SIM_RESET_REASON ?? DEFAULT_RESET_REASON,
    rssiDbm: env.AEGIS_SIM_RSSI_DBM ? parseInteger('AEGIS_SIM_RSSI_DBM', env.AEGIS_SIM_RSSI_DBM) : DEFAULT_RSSI_DBM,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    allowInsecureRemote: env.AEGIS_SIM_ALLOW_INSECURE_REMOTE === 'true',
    ...(caFile ? { caFile } : {}),
  });
}

/** Defaults for programmatic use; the password must still be supplied by the caller. */
export function defineConfig(overrides: Partial<SimulatorConfig> & Pick<SimulatorConfig, 'password'>): SimulatorConfig {
  const lockerId = overrides.lockerId ?? DEFAULT_LOCKER_ID;
  return validateConfig({
    brokerUrl: DEFAULT_BROKER_URL,
    username: lockerId,
    lockerId,
    deviceKey: `sim-${lockerId}`,
    compartments: DEFAULT_COMPARTMENTS,
    firmwareVersion: DEFAULT_FIRMWARE_VERSION,
    resetReason: DEFAULT_RESET_REASON,
    rssiDbm: DEFAULT_RSSI_DBM,
    heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    allowInsecureRemote: false,
    ...overrides,
  });
}
