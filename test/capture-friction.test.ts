import { EventEmitter } from 'node:events';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PNG } from 'pngjs';
import { captureScreenshot } from '../src/cdp/screenshot.js';
import { HARRecorder } from '../src/cdp/har-recorder.js';
import { waitForPageLoad } from '../src/session/commands.js';
import type { CDPClient } from '../src/cdp/client.js';

class ScreenshotClient {
  readonly calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  private captures = 0;
  private readonly rawPng: string;

  constructor() {
    const png = new PNG({ width: 2000, height: 1000 });
    png.data.fill(255);
    this.rawPng = PNG.sync.write(png).toString('base64');
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });
    if (method === 'Page.getLayoutMetrics') {
      return { cssVisualViewport: { clientWidth: 2000, clientHeight: 1000, pageX: 0, pageY: 0 } };
    }
    if (method === 'Runtime.evaluate') return { result: { value: 2 } };
    if (method === 'Page.captureScreenshot') {
      this.captures++;
      return { data: this.captures === 1 ? '' : this.rawPng };
    }
    return {};
  }
}

test('screenshot retries an empty clipped capture and never returns a 0-byte PNG', async () => {
  const client = new ScreenshotClient();
  const result = await captureScreenshot(client as unknown as CDPClient);
  const decoded = PNG.sync.read(result);

  assert.ok(result.length > 0);
  assert.deepEqual({ width: decoded.width, height: decoded.height }, { width: 1600, height: 800 });
  const captures = client.calls.filter((call) => call.method === 'Page.captureScreenshot');
  assert.equal(captures.length, 2);
  assert.equal((captures[1].params.clip as { scale: number }).scale, 1);
});

class NetworkClient extends EventEmitter {
  async send(): Promise<unknown> { return {}; }
}

test('HAR recording emits WebSocket handshakes and frames as filterable entries', async () => {
  const client = new NetworkClient();
  const recorder = new HARRecorder(client as unknown as CDPClient);
  await recorder.start();

  client.emit('Network.webSocketCreated', { requestId: 'ws-1', url: 'wss://echo.example/socket' });
  client.emit('Network.webSocketWillSendHandshakeRequest', {
    requestId: 'ws-1',
    timestamp: 12,
    wallTime: 1_700_000_000,
    request: { headers: { Upgrade: 'websocket' } },
  });
  client.emit('Network.webSocketHandshakeResponseReceived', {
    requestId: 'ws-1',
    response: { status: 101, headers: { Upgrade: 'websocket' } },
  });
  client.emit('Network.webSocketFrameSent', {
    requestId: 'ws-1', timestamp: 12.5, response: { opcode: 1, payloadData: 'ping' },
  });
  client.emit('Network.webSocketFrameReceived', {
    requestId: 'ws-1', timestamp: 12.6, response: { opcode: 1, payloadData: 'pong' },
  });

  const [entry] = recorder.finishPartial().log.entries;
  assert.equal(entry.request.url, 'wss://echo.example/socket');
  assert.equal(entry.response.status, 101);
  assert.equal(entry._resourceType, 'websocket');
  assert.deepEqual(entry._webSocketMessages, [
    { type: 'send', time: 1_700_000_000.5, opcode: 1, data: 'ping' },
    { type: 'receive', time: 1_700_000_000.6, opcode: 1, data: 'pong' },
  ]);
});

class AlreadyLoadedClient extends EventEmitter {
  async waitReady(): Promise<void> {}

  async send(method: string): Promise<unknown> {
    return method === 'Runtime.evaluate' ? { result: { value: 'complete' } } : {};
  }
}

test('page-load wait completes immediately when the page already reached readyState complete', async () => {
  const started = Date.now();
  const timedOut = await waitForPageLoad(new AlreadyLoadedClient(), 1_000);
  assert.equal(timedOut, false);
  assert.ok(Date.now() - started < 100);
});
