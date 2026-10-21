import { once } from 'node:events';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { mqttTransportFactory } from '../../src/transport.ts';

const CONNACK_ACCEPTED = Buffer.from([0x20, 0x02, 0x00, 0x00]);
const DISCONNECT = Buffer.from([0xe0, 0x00]);

/** A broker that accepts the CONNECT but never acknowledges a publish (lost PUBACK). */
async function silentBroker(): Promise<{ server: Server; url: string; received: () => Buffer }> {
  const chunks: Buffer[] = [];
  const sockets: Socket[] = [];
  const server = createServer((socket) => {
    sockets.push(socket);
    let connected = false;
    socket.on('data', (chunk) => {
      chunks.push(chunk);
      if (!connected) {
        connected = true;
        socket.write(CONNACK_ACCEPTED);
      }
    });
    socket.on('error', () => undefined);
  });
  server.on('close', () => sockets.forEach((s) => s.destroy()));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return { server, url: `mqtt://127.0.0.1:${port}`, received: () => Buffer.concat(chunks) };
}

let server: Server | undefined;

afterEach(async () => {
  if (server) await new Promise((r) => server!.close(r));
  server = undefined;
});

describe('mqtt transport shutdown with a lost PUBACK', () => {
  it('abandons the unacknowledged publish and still sends DISCONNECT', { timeout: 5_000 }, async () => {
    const broker = await silentBroker();
    server = broker.server;
    const transport = mqttTransportFactory({
      brokerUrl: broker.url,
      clientId: 'aegis-locker-transport-test',
      username: 'u',
      password: 'p',
      will: { topic: 't/status', body: '{}', delivery: { qos: 1, retain: true } },
    });
    const connected = new Promise<void>((resolve) => transport.on('connect', () => resolve()));
    transport.on('error', () => undefined);
    await connected;

    let settled = false;
    const publish = transport.publish('t/status', '{"reason":"SHUTDOWN"}', { qos: 1, retain: true }).then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((r) => setTimeout(r, 100));
    expect(settled).toBe(false);

    await transport.disconnect({ abandonInFlight: true });
    await publish;
    await new Promise((r) => setTimeout(r, 50));
    const bytes = broker.received();
    expect(bytes.subarray(-2)).toEqual(DISCONNECT);
  });
});
