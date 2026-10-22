#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { BootCounterError } from './boot-counter.ts';
import { CommandJournalError } from './command-journal.ts';
import { ConfigError, configFromEnv } from './config.ts';
import type { OutboundMessage } from './messages.ts';
import { ScenarioError, parseScenario, runScenario, type Scenario } from './scenario.ts';
import { HubSimulator } from './simulator.ts';

const USAGE = `Usage: node src/cli.ts [--scenario <file.json>] [--log-payloads]

Runs the Aegis hub simulator until SIGINT/SIGTERM (clean OFFLINE) or until a
scenario ends with "stop" or "crash". Kill it with SIGKILL to trigger the Last Will.
It subscribes to its locker's commands and display topics, executes valid
UNLOCK_COMPARTMENT commands on the simulated cells and acknowledges them. It never
logs the display token nor the QR content.

Environment (credentials are never accepted as arguments):
  AEGIS_MQTT_DEVICE_PASSWORD   required, device secret (local: infra/docker/.env.example)
  AEGIS_MQTT_URL               default mqtt://127.0.0.1:1883
  AEGIS_MQTT_DEVICE_USERNAME   default the locker id
  AEGIS_MQTT_CA_FILE           optional CA bundle for mqtts:
  AEGIS_SIM_LOCKER_ID          default d46a74ae-39dc-460b-8af0-38fc791b376a
  AEGIS_SIM_DEVICE_KEY         default sim-<lockerId>; clientId is aegis-locker-<deviceKey>
  AEGIS_SIM_COMPARTMENTS       default A1:1ae77ae3-8490-4f09-9412-a7816b77bff9:1,A2:5c1d0b7e-2f4a-4d3b-9a61-0e8b7c2d4f10:2
  AEGIS_SIM_FIRMWARE_VERSION   default 0.1.0-sim
  AEGIS_SIM_RESET_REASON       default POWER_ON; one of POWER_ON, EXTERNAL_RESET, SOFTWARE_RESET,
                               WATCHDOG, PANIC, BROWNOUT, UNKNOWN
  AEGIS_SIM_BOOT_COUNT_FILE    default $XDG_STATE_HOME/aegis/hub-simulator/boot-count-<deviceKey>.json
                               (~/.local/state/... without XDG_STATE_HOME); keep it outside the repository
  AEGIS_SIM_BOOT_COUNT         optional bootCount of the first boot (tests, deliberate reset)
  AEGIS_SIM_COMMAND_JOURNAL_FILE  default $XDG_STATE_HOME/aegis/hub-simulator/command-journal-<deviceKey>.json;
                               the deduplication journal (doc 10 §16.1), outside the repository
  AEGIS_SIM_UNLOCK_WINDOW_MS   default 15000; relock delay after an accepted unlock (1000..120000)
  AEGIS_SIM_RFID_WINDOW_MS     default 3000; RFID scan window after a door closes (100..10000)
  AEGIS_SIM_RSSI_DBM           default -55
  AEGIS_SIM_ALLOW_INSECURE_REMOTE  "true" to allow mqtt: to a non-loopback host on an isolated network
`;

function log(event: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`);
}

function describe(message: OutboundMessage, withPayload: boolean): Record<string, unknown> {
  const p = message.payload;
  const pick = (...keys: string[]) =>
    Object.fromEntries(keys.filter((k) => k in p).map((k) => [k, (p as unknown as Record<string, unknown>)[k]]));
  return {
    type: p.type,
    topic: message.topic,
    qos: message.delivery.qos,
    retain: message.delivery.retain,
    messageId: p.messageId,
    sequence: p.sequence,
    deviceSessionId: p.deviceSessionId,
    bootCount: p.bootCount,
    // Hub payloads never hold a secret; the display token stays in the inbound message.
    ...pick('connectionId', 'status', 'reason', 'commandMessageId', 'operationId', 'compartmentId', 'result', 'displayMessageId'),
    ...(withPayload ? { payload: p } : {}),
  };
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      scenario: { type: 'string' },
      'log-payloads': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  if (values.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const config = configFromEnv(process.env);
  const scenario: Scenario | undefined = values.scenario
    ? parseScenario(JSON.parse(readFileSync(values.scenario, 'utf8')))
    : undefined;
  const withPayload = values['log-payloads'];

  const simulator = new HubSimulator(config);
  simulator.on('state', (state) => log('state', { state }));
  simulator.on('sessionStarted', (deviceSessionId, bootCount) => log('session_started', { deviceSessionId, bootCount }));
  simulator.on('willPrepared', (m) => log('will_prepared', describe(m, withPayload)));
  simulator.on('replayed', (m) => log('replayed', describe(m, withPayload)));
  simulator.on('delivered', (m) => log('delivered', describe(m, withPayload)));
  simulator.on('publishFailed', (m, error) => log('publish_failed', { ...describe(m, false), error: error.message }));
  simulator.on('reconnectScheduled', (delayMs, attempt) => log('reconnect_scheduled', { delayMs, attempt }));
  simulator.on('transportError', (error) => log('transport_error', { error: error.message }));
  simulator.on('subscribed', (topics) => log('subscribed', { topics }));
  simulator.on('inbound', (report) => log('inbound', { ...report }));
  simulator.on('actuated', (compartmentId, operationId) => log('actuated', { compartmentId, operationId }));
  simulator.on('screen', (view) => log('screen', { ...view }));
  simulator.on('journalError', (error) => log('journal_error', { error: error.message }));

  log('starting', {
    brokerUrl: config.brokerUrl,
    clientId: simulator.clientId,
    username: config.username,
    lockerId: config.lockerId,
    compartments: config.compartments.map((c) => c.code),
    bootCountFile: config.bootCountFile,
    commandJournalFile: config.commandJournalFile,
  });

  let shuttingDown = false;
  const done = new Promise<number>((resolve) => {
    const shutdown = (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      log('signal', { signal });
      simulator.stop().then(
        () => resolve(0),
        () => resolve(1),
      );
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  });

  simulator.start();
  if (scenario) {
    try {
      await runScenario(simulator, scenario);
      log('scenario_completed');
      if (simulator.state === 'stopped') return 0;
    } catch (error) {
      log('scenario_failed', { error: (error as Error).message });
      await simulator.stop();
      return 1;
    }
  }
  return done;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    if (
      error instanceof ConfigError ||
      error instanceof ScenarioError ||
      error instanceof BootCounterError ||
      error instanceof CommandJournalError ||
      error instanceof SyntaxError
    ) {
      process.stderr.write(`hub-simulator: ${error.message}\n`);
      process.exit(2);
    }
    process.stderr.write(`hub-simulator: ${(error as Error).stack ?? String(error)}\n`);
    process.exit(1);
  },
);
