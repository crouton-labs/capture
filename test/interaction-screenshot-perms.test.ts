import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

// T4 regression, retargeted onto the conformed driving verb: a `page click`
// auto-screenshot (shots/*.png) must land private (0600) under a 0700 shots/
// dir, matching the private-artifact posture of every other session artifact.
// The click drives the REAL autoScreenshot/session-context path — only the
// connection seam is stubbed — so the permission contract is proven through
// the new invocation end to end.

import { CAPTURE_ROOT, DIR_MODE, FILE_MODE } from '../src/session/artifacts.js';
import { setActiveSession, clearActiveSession } from '../src/session-context.js';
import { cmdPageClick, __setPageInputDepsForTest } from '../src/cdp/commands/page/click.js';
import type { ParsedArgs, CDPTarget } from '../src/cdp/types.js';

function mode(p: string): number {
  return fs.statSync(p).mode & 0o777;
}

// A tiny 1x1 PNG payload, base64-encoded like Page.captureScreenshot returns.
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// Fake CDP client: answers the resolution, click-dispatch, and screenshot
// calls a real `page click ax:…` makes.
function fakeClient() {
  return {
    async send(method: string): Promise<unknown> {
      switch (method) {
        case 'Accessibility.enable':
        case 'Accessibility.disable':
        case 'DOM.enable':
        case 'DOM.scrollIntoViewIfNeeded':
        case 'Input.dispatchMouseEvent':
          return {};
        case 'Accessibility.getFullAXTree':
          return {
            nodes: [
              { nodeId: '5', backendDOMNodeId: 201, role: { value: 'button' }, name: { value: 'Create applet' } },
            ],
          };
        case 'DOM.getBoxModel':
          return { model: { content: [10, 10, 30, 10, 30, 20, 10, 20] } };
        case 'Page.getLayoutMetrics':
          return { cssVisualViewport: { clientWidth: 800, clientHeight: 600, pageX: 0, pageY: 0 } };
        case 'Runtime.evaluate':
          return { result: { value: 1 } };
        case 'Page.captureScreenshot':
          return { data: PNG_BASE64 };
        default:
          return {};
      }
    },
  };
}

const FAKE_TAB: CDPTarget = { id: 'tab-1', title: '', url: 'https://fixture.test/', type: 'page' };

test('page click auto-screenshot writes the shot 0600 under a 0700 shots/ dir', async () => {
  const prevNodeId = process.env.CRTR_NODE_ID;
  process.env.CRTR_NODE_ID = 'test-node-t4';
  fs.mkdirSync(CAPTURE_ROOT, { recursive: true });
  const dir = path.join(CAPTURE_ROOT, `interaction-perm-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const restoreDeps = __setPageInputDepsForTest({
    withConnection: (async (_parsed: ParsedArgs, fn: (c: unknown, t: CDPTarget) => Promise<unknown>) =>
      fn(fakeClient(), FAKE_TAB)) as never,
  });

  const origWrite = process.stdout.write.bind(process.stdout);
  let stdout = '';
  process.stdout.write = ((chunk: unknown) => {
    stdout += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    return true;
  }) as typeof process.stdout.write;

  try {
    fs.mkdirSync(dir, { recursive: true });
    clearActiveSession();
    setActiveSession({ sessionId: 'sess-t4', dir, harId: null, targetId: null, stepCount: 0 });

    await cmdPageClick({ command: 'page', positional: ['ax:Create applet'] } as ParsedArgs, []);

    const match = stdout.match(/screenshot: (\S+\.png)/);
    assert.ok(match, `expected a screenshot path in the <clicked> block, got:\n${stdout}`);
    const shotPath = match![1];
    assert.ok(shotPath.startsWith(dir), 'shot must be under the session dir');

    assert.equal(mode(shotPath), FILE_MODE, 'screenshot file must be 0600');
    assert.equal(mode(path.dirname(shotPath)), DIR_MODE, 'shots/ dir must be 0700');
  } finally {
    process.stdout.write = origWrite;
    restoreDeps();
    clearActiveSession();
    if (prevNodeId === undefined) delete process.env.CRTR_NODE_ID;
    else process.env.CRTR_NODE_ID = prevNodeId;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
