import { once } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import WebSocket, { WebSocketServer } from 'ws';

import { CDPClient } from '../src/cdp/client.js';

test('CDPClient event callbacks preserve flattened envelope sessionId and unscoped undefined', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');

  const connected = once(server, 'connection');
  const client = new CDPClient(`ws://127.0.0.1:${address.port}`);
  const [peer] = (await connected) as [WebSocket];
  await client.waitReady();

  const received: Array<{ params: unknown; sessionId?: string }> = [];
  const complete = new Promise<void>((resolve) => {
    client.on('Runtime.consoleAPICalled', (params, sessionId) => {
      received.push({ params, sessionId });
      if (received.length === 2) resolve();
    });
  });

  peer.send(
    JSON.stringify({
      method: 'Runtime.consoleAPICalled',
      params: { value: 'target A' },
      sessionId: 'session-A',
    }),
  );
  peer.send(
    JSON.stringify({
      method: 'Runtime.consoleAPICalled',
      params: { value: 'browser global' },
    }),
  );

  try {
    await complete;
    assert.deepEqual(received, [
      { params: { value: 'target A' }, sessionId: 'session-A' },
      { params: { value: 'browser global' }, sessionId: undefined },
    ]);
  } finally {
    client.close();
    peer.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
