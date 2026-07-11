import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

// T4 regression: session interaction screenshots (shots/*.png) must land
// private (0600) under a 0700 shots/ dir, matching the private-artifact
// posture of every other session artifact. Before the fix autoScreenshot
// wrote via fs.writeFileSync (umask-derived 0644).

import { CAPTURE_ROOT, DIR_MODE, FILE_MODE } from '../src/session/artifacts.js';
import { setActiveSession, clearActiveSession } from '../src/session-context.js';
import { autoScreenshot } from '../src/cdp/screenshot.js';
import type { CDPClient } from '../src/cdp/client.js';

function mode(p: string): number {
  return fs.statSync(p).mode & 0o777;
}

// A tiny 1x1 PNG payload, base64-encoded like Page.captureScreenshot returns.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// Fake CDPClient: answers only the calls captureScreenshot makes.
function fakeClient(): CDPClient {
  return {
    async send(method: string): Promise<unknown> {
      if (method === 'Page.getLayoutMetrics') {
        return { cssVisualViewport: { clientWidth: 800, clientHeight: 600, pageX: 0, pageY: 0 } };
      }
      if (method === 'Runtime.evaluate') {
        return { result: { value: 1 } };
      }
      if (method === 'Page.captureScreenshot') {
        return { data: PNG_BASE64 };
      }
      return {};
    },
  } as unknown as CDPClient;
}

test('autoScreenshot writes the shot 0600 under a 0700 shots/ dir', async () => {
  const prevNodeId = process.env.CRTR_NODE_ID;
  process.env.CRTR_NODE_ID = 'test-node-t4';
  fs.mkdirSync(CAPTURE_ROOT, { recursive: true });
  const dir = path.join(CAPTURE_ROOT, `interaction-perm-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  try {
    fs.mkdirSync(dir, { recursive: true });
    clearActiveSession();
    setActiveSession({ sessionId: 'sess-t4', dir, harId: null, targetId: null, stepCount: 0 });

    const shotPath = await autoScreenshot(fakeClient(), 'click', 'Create applet');
    assert.ok(shotPath, 'expected a shot path');
    assert.ok(shotPath!.startsWith(dir), 'shot must be under the session dir');

    assert.equal(mode(shotPath!), FILE_MODE, 'screenshot file must be 0600');
    assert.equal(mode(path.dirname(shotPath!)), DIR_MODE, 'shots/ dir must be 0700');
  } finally {
    clearActiveSession();
    if (prevNodeId === undefined) delete process.env.CRTR_NODE_ID;
    else process.env.CRTR_NODE_ID = prevNodeId;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
