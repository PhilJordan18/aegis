import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reconnectDelayMs } from '../../src/backoff.ts';
import { ConfigError, DEFAULT_LOCKER_ID, assertTransportAllowed, configFromEnv, parseCompartments } from '../../src/config.ts';

describe('configuration from environment', () => {
  it('defaults to the fictitious locker of infra/mqtt/acl with A1 and A2', () => {
    const config = configFromEnv({ AEGIS_MQTT_DEVICE_PASSWORD: 'x' });
    expect(config.lockerId).toBe('d46a74ae-39dc-460b-8af0-38fc791b376a');
    expect(config.username).toBe(DEFAULT_LOCKER_ID);
    expect(config.brokerUrl).toBe('mqtt://127.0.0.1:1883');
    expect(config.heartbeatIntervalMs).toBe(10_000);
    expect(config.compartments.map((c) => [c.code, c.cellAddress])).toEqual([
      ['A1', 1],
      ['A2', 2],
    ]);
  });

  it('requires the device password and never defaults it', () => {
    expect(() => configFromEnv({})).toThrow('AEGIS_MQTT_DEVICE_PASSWORD is required');
  });

  it('reads locker, compartments and device facts', () => {
    const config = configFromEnv({
      AEGIS_MQTT_DEVICE_PASSWORD: 'x',
      AEGIS_SIM_LOCKER_ID: '0b9f3c1e-6a2d-4e8f-9c7b-1d2e3f4a5b6c',
      AEGIS_SIM_COMPARTMENTS: 'B1:f3a1c2d4-5b6e-4f70-8a91-b2c3d4e5f607:3',
      AEGIS_SIM_RESET_REASON: 'WATCHDOG',
      AEGIS_SIM_RSSI_DBM: '-70',
    });
    expect(config.username).toBe('0b9f3c1e-6a2d-4e8f-9c7b-1d2e3f4a5b6c');
    expect(config.deviceKey).toBe('sim-0b9f3c1e-6a2d-4e8f-9c7b-1d2e3f4a5b6c');
    expect(config.compartments).toEqual([{ code: 'B1', compartmentId: 'f3a1c2d4-5b6e-4f70-8a91-b2c3d4e5f607', cellAddress: 3 }]);
    expect(config.resetReason).toBe('WATCHDOG');
    expect(config.rssiDbm).toBe(-70);
  });

  it.each([
    [{ AEGIS_SIM_LOCKER_ID: 'D46A74AE-39DC-460B-8AF0-38FC791B376A' }, 'canonical lowercase'],
    [{ AEGIS_SIM_COMPARTMENTS: 'A1:1ae77ae3-8490-4f09-9412-a7816b77bff9:1,A1:5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10:2' }, 'duplicate compartment code'],
    [{ AEGIS_SIM_COMPARTMENTS: 'A1:1ae77ae3-8490-4f09-9412-a7816b77bff9:1,A2:5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10:1' }, 'duplicate cellAddress'],
    [{ AEGIS_SIM_COMPARTMENTS: 'A1:1ae77ae3-8490-4f09-9412-a7816b77bff9:0' }, 'cellAddress'],
    [{ AEGIS_SIM_COMPARTMENTS: 'A1:not-a-uuid:1' }, 'canonical lowercase UUID'],
    [{ AEGIS_SIM_RSSI_DBM: '12' }, 'rssiDbm'],
    [{ AEGIS_SIM_RESET_REASON: 'power on' }, 'resetReason'],
    [{ AEGIS_SIM_RESET_REASON: 'DEEP_SLEEP' }, 'resetReason must be one of POWER_ON, EXTERNAL_RESET'],
    [{ AEGIS_SIM_BOOT_COUNT: '0' }, 'bootCount'],
    [{ AEGIS_SIM_BOOT_COUNT: 'one' }, 'AEGIS_SIM_BOOT_COUNT must be an integer'],
  ])('rejects %o', (env, message) => {
    expect(() => configFromEnv({ AEGIS_MQTT_DEVICE_PASSWORD: 'x', ...env })).toThrow(message);
  });

  it.each(['POWER_ON', 'EXTERNAL_RESET', 'SOFTWARE_RESET', 'WATCHDOG', 'PANIC', 'BROWNOUT', 'UNKNOWN'])(
    'accepts the controlled resetReason %s (D1)',
    (reason) => {
      expect(configFromEnv({ AEGIS_MQTT_DEVICE_PASSWORD: 'x', AEGIS_SIM_RESET_REASON: reason }).resetReason).toBe(reason);
    },
  );

  it('keeps the boot count state outside the repository by default', () => {
    const config = configFromEnv({ AEGIS_MQTT_DEVICE_PASSWORD: 'x', XDG_STATE_HOME: '/var/tmp/xdg-state' });
    expect(config.bootCountFile).toBe('/var/tmp/xdg-state/aegis/hub-simulator/boot-counts.json');
    expect(config).not.toHaveProperty('firstBootCount');
    const home = configFromEnv({ AEGIS_MQTT_DEVICE_PASSWORD: 'x' });
    expect(home.bootCountFile).toBe(join(homedir(), '.local', 'state', 'aegis', 'hub-simulator', 'boot-counts.json'));
  });

  it('reads the boot count file and the first boot count', () => {
    const config = configFromEnv({
      AEGIS_MQTT_DEVICE_PASSWORD: 'x',
      AEGIS_SIM_BOOT_COUNT_FILE: '/var/tmp/aegis-sim/counts.json',
      AEGIS_SIM_BOOT_COUNT: '12',
    });
    expect(config.bootCountFile).toBe('/var/tmp/aegis-sim/counts.json');
    expect(config.firstBootCount).toBe(12);
  });

  it('parses the compartment specification', () => {
    expect(parseCompartments(' A1:1ae77ae3-8490-4f09-9412-a7816b77bff9:1 , ')).toHaveLength(1);
    expect(() => parseCompartments('A1:1')).toThrow(ConfigError);
  });
});

describe('transport policy (doc 10 §4.2)', () => {
  it('allows plaintext only towards loopback unless explicitly opted in', () => {
    expect(() => assertTransportAllowed('mqtt://127.0.0.1:1883', false)).not.toThrow();
    expect(() => assertTransportAllowed('mqtt://localhost:1883', false)).not.toThrow();
    expect(() => assertTransportAllowed('mqtt://broker.example.org:1883', false)).toThrow('refused');
    expect(() => assertTransportAllowed('mqtt://mosquitto:1883', true)).not.toThrow();
    expect(() => assertTransportAllowed('mqtts://broker.example.org:8883', false)).not.toThrow();
    expect(() => assertTransportAllowed('ws://127.0.0.1:9001', false)).toThrow('unsupported');
  });
});

describe('reconnect backoff (doc 10 §18)', () => {
  it('follows 1, 2, 4, 8, 16 then 30 seconds without jitter', () => {
    const delays = Array.from({ length: 8 }, (_, attempt) => reconnectDelayMs(attempt, () => 0.5));
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });

  it('keeps jitter within +/-20 % and never above 30 s', () => {
    expect(reconnectDelayMs(0, () => 0)).toBe(800);
    expect(reconnectDelayMs(0, () => 1)).toBe(1_200);
    expect(reconnectDelayMs(4, () => 1)).toBe(19_200);
    expect(reconnectDelayMs(9, () => 1)).toBe(30_000);
  });
});
