import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EventBroker, handleBridgeRequest } from '../src/cdp/bridge/server.js';

class FakeEventClient {
  private handlers = new Map<
    string,
    Array<(params: unknown, sessionId?: string) => void>
  >();
  calls: Array<{
    method: string;
    params: Record<string, unknown>;
    timeout: number;
    sessionId?: string;
  }> = [];
  rejectMethod: string | undefined;
  rejectDelayMs = 0;

  on(event: string, handler: (params: unknown, sessionId?: string) => void): void {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
  }

  fire(event: string, params: unknown, sessionId?: string): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(params, sessionId);
    }
  }

  async send(
    method: string,
    params: Record<string, unknown> = {},
    timeout = 60000,
    sessionId?: string,
  ): Promise<unknown> {
    this.calls.push({ method, params, timeout, sessionId });
    if (method === this.rejectMethod) {
      if (this.rejectDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.rejectDelayMs));
      }
      throw new Error(`send failed: ${method}`);
    }
    this.fire('Page.loadEventFired', { firedBy: method, sessionId }, sessionId);
    return { sent: method, sessionId };
  }
}

test('EventBroker drops pre-arm events and delivers only a future same-key event', async () => {
  const client = new FakeEventClient();
  const broker = new EventBroker(client);

  client.fire('Test.ready', { generation: 'before' }, 'session-A');
  await assert.rejects(
    broker.wait('Test.ready', 'session-A', 15).result(),
    /Timed out.*Test\.ready.*session-A/,
  );

  const pending = broker.wait('Test.ready', 'session-A', 100).result();
  client.fire('Test.ready', { generation: 'after' }, 'session-A');
  assert.deepEqual(await pending, { generation: 'after' });
});

test('EventBroker isolates browser-global, session A, and session B waiters by exact event envelope scope', async () => {
  const client = new FakeEventClient();
  const broker = new EventBroker(client);

  const global = broker.wait('Test.changed', undefined, 100).result();
  const sessionA = broker.wait('Test.changed', 'session-A', 100).result();
  const sessionB = broker.wait('Test.changed', 'session-B', 100).result();

  client.fire('Test.changed', { scope: 'A' }, 'session-A');
  client.fire('Test.changed', { scope: 'global' });
  client.fire('Test.changed', { scope: 'B' }, 'session-B');

  assert.deepEqual(await global, { scope: 'global' });
  assert.deepEqual(await sessionA, { scope: 'A' });
  assert.deepEqual(await sessionB, { scope: 'B' });
});

test('EventBroker broadcasts one event to all already-armed same-key waiters and does not replay it later', async () => {
  const client = new FakeEventClient();
  const broker = new EventBroker(client);

  const first = broker.wait('Test.broadcast', 'session-A', 100).result();
  const second = broker.wait('Test.broadcast', 'session-A', 100).result();
  const event = { generation: 1 };
  client.fire('Test.broadcast', event, 'session-A');

  assert.deepEqual(await Promise.all([first, second]), [event, event]);
  await assert.rejects(
    broker.wait('Test.broadcast', 'session-A', 15).result(),
    /Timed out.*Test\.broadcast.*session-A/,
    'a waiter armed after the broadcast must not consume event history',
  );
});

test('one EventBroker waiter timing out removes only itself', async () => {
  const client = new FakeEventClient();
  const broker = new EventBroker(client);

  const expiring = broker.wait('Test.independent', 'session-A', 15).result();
  const surviving = broker.wait('Test.independent', 'session-A', 100).result();
  await assert.rejects(expiring, /Timed out.*Test\.independent.*session-A/);

  client.fire('Test.independent', { delivered: true }, 'session-A');
  assert.deepEqual(await surviving, { delivered: true });
});

test('cancelling one EventBroker waiter preserves a same-key surviving waiter', async () => {
  const client = new FakeEventClient();
  const broker = new EventBroker(client);
  const cancelled = broker.wait('Test.cancel', 'session-A', 100);
  const surviving = broker.wait('Test.cancel', 'session-A', 100);

  cancelled.cancel();
  client.fire('Test.cancel', { delivered: true }, 'session-A');

  assert.equal(await cancelled.result(), undefined);
  assert.deepEqual(await surviving.result(), { delivered: true });
});

test('plain bridge cancels its armed event wait when the triggering send fails', async () => {
  const client = new FakeEventClient();
  client.rejectMethod = 'Page.reload';
  const broker = new EventBroker(client);

  const response = await handleBridgeRequest(
    {
      reqId: 1,
      method: 'Page.reload',
      waitEvent: 'Page.loadEventFired',
      timeoutMs: 15,
    },
    client,
    broker,
    async () => {
      throw new Error('attach must not run for a global request');
    },
  );
  assert.deepEqual(response, { reqId: 1, ok: false, error: 'send failed: Page.reload' });
});

test('plain bridge preserves a delayed method failure after the event deadline without an unhandled rejection', async () => {
  const client = new FakeEventClient();
  client.rejectMethod = 'Page.reload';
  client.rejectDelayMs = 30;
  const broker = new EventBroker(client);

  const response = await handleBridgeRequest(
    {
      reqId: 1,
      method: 'Page.reload',
      waitEvent: 'Page.loadEventFired',
      timeoutMs: 10,
    },
    client,
    broker,
    async () => {
      throw new Error('attach must not run for a global request');
    },
  );
  assert.deepEqual(response, { reqId: 1, ok: false, error: 'send failed: Page.reload' });
});

test('plain bridge arms before synchronous send for browser-global and attached-target scopes, preserving result separately', async () => {
  const client = new FakeEventClient();
  const broker = new EventBroker(client);
  const attach = async (targetId: string): Promise<string> => {
    assert.equal(targetId, 'target-A');
    return 'session-A';
  };

  const targetResponse = await handleBridgeRequest(
    {
      reqId: 1,
      targetId: 'target-A',
      method: 'Page.reload',
      waitEvent: 'Page.loadEventFired',
      timeoutMs: 100,
    },
    client,
    broker,
    attach,
  );
  assert.deepEqual(targetResponse, {
    reqId: 1,
    ok: true,
    result: { sent: 'Page.reload', sessionId: 'session-A' },
    event: { firedBy: 'Page.reload', sessionId: 'session-A' },
  });

  const globalResponse = await handleBridgeRequest(
    {
      reqId: 2,
      method: 'Browser.getVersion',
      waitEvent: 'Page.loadEventFired',
      timeoutMs: 100,
    },
    client,
    broker,
    attach,
  );
  assert.deepEqual(globalResponse, {
    reqId: 2,
    ok: true,
    result: { sent: 'Browser.getVersion', sessionId: undefined },
    event: { firedBy: 'Browser.getVersion', sessionId: undefined },
  });
  assert.deepEqual(
    client.calls.map(({ method, sessionId }) => ({ method, sessionId })),
    [
      { method: 'Page.reload', sessionId: 'session-A' },
      { method: 'Browser.getVersion', sessionId: undefined },
    ],
  );
});
