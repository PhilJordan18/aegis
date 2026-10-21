import { once } from 'node:events';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { mqttTransportFactory, type Transport } from '../../src/transport.ts';

const CONNACK_ACCEPTED = Buffer.from([0x20, 0x02, 0x00, 0x00]);
const DISCONNECT = Buffer.from([0xe0, 0x00]);

interface FakeBroker {
  readonly url: string;
  received(): Buffer;
  /** The broker side of the first connection. */
  socket(): Socket;
}

/**
 * A loopback broker that accepts the CONNECT, never acknowledges a publish (lost
 * PUBACK) and, with `halfOpen`, never closes its side after the client's FIN.
 */
async function fakeBroker(halfOpen: boolean): Promise<FakeBroker> {
  const chunks: Buffer[] = [];
  const sockets: Socket[] = [];
  const server = createServer({ allowHalfOpen: halfOpen }, (socket) => {
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
  servers.push({ server, sockets });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    url: `mqtt://127.0.0.1:${port}`,
    received: () => Buffer.concat(chunks),
    socket: () => sockets[0]!,
  };
}

async function connect(url: string): Promise<Transport> {
  const transport = mqttTransportFactory({
    brokerUrl: url,
    clientId: 'aegis-locker-transport-test',
    username: 'u',
    password: 'p',
    will: { topic: 't/status', body: '{}', delivery: { qos: 1, retain: true } },
  });
  const connected = new Promise<void>((resolve) => transport.on('connect', () => resolve()));
  transport.on('error', () => undefined);
  await connected;
  return transport;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const servers: Array<{ server: Server; sockets: Socket[] }> = [];

afterEach(async () => {
  for (const { server, sockets } of servers.splice(0)) {
    sockets.forEach((s) => s.destroy());
    await new Promise((r) => server.close(r));
  }
});

describe('mqtt transport shutdown', () => {
  it('abandons a publish whose PUBACK never comes and still sends DISCONNECT', { timeout: 5_000 }, async () => {
    const broker = await fakeBroker(false);
    const transport = await connect(broker.url);

    let settled = false;
    const publish = transport.publish('t/status', '{"reason":"SHUTDOWN"}', { qos: 1, retain: true }).then(
      () => (settled = true),
      () => (settled = true),
    );
    await sleep(100);
    expect(settled).toBe(false);

    await transport.disconnect();
    await publish;
    await sleep(50);
    expect(broker.received().subarray(-2)).toEqual(DISCONNECT);
  });

  it('destroys the socket a broker keeps half-open after DISCONNECT', { timeout: 5_000 }, async () => {
    const broker = await fakeBroker(true);
    const transport = await connect(broker.url);

    let disconnected = false;
    void transport.disconnect().then(() => (disconnected = true));
    await sleep(200);
    // DISCONNECT and FIN were sent, but the broker never closes its side.
    expect(broker.received().subarray(-2)).toEqual(DISCONNECT);
    expect(disconnected).toBe(false);

    await transport.destroy();
    // A write from the broker now hits a closed socket instead of a live reader.
    const brokerSide = broker.socket();
    // events.once would reject on the expected EPIPE; only the close matters here.
    const closed = new Promise<void>((resolve) => brokerSide.once('close', () => resolve()));
    for (let i = 0; i < 20 && !brokerSide.destroyed; i++) {
      brokerSide.write(Buffer.from([0xd0, 0x00]));
      await sleep(25);
    }
    await closed;
    expect(brokerSide.destroyed).toBe(true);
  });
});
