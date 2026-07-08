import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  axisAlignedRectFromQuad,
  composeFrameTransform,
  getContentQuadBox,
  toTopViewportQuad,
  type Quad,
} from '../src/cdp/coordinates.js';
import type { CDPClient } from '../src/cdp/client.js';

/** A minimal CDPClient.send stub — no Chrome, no websocket. */
function stubClient(handlers: Record<string, (params: unknown) => unknown>): CDPClient {
  return {
    send: async (method: string, params: unknown) => {
      const handler = handlers[method];
      if (!handler) throw new Error(`Unexpected CDP call: ${method}`);
      return handler(params);
    },
  } as unknown as CDPClient;
}

test('axisAlignedRectFromQuad derives bounds from a rotated (non-axis-aligned) quad', () => {
  // A square rotated 45deg around (10,10), corners at top/right/bottom/left.
  const quad: Quad = [10, 0, 20, 10, 10, 20, 0, 10];
  const rect = axisAlignedRectFromQuad(quad);
  assert.deepEqual(rect, { x: 0, y: 0, width: 20, height: 20 });
});

test('getContentQuadBox preserves every fragment quad and the full box model, without collapsing to a rect', async () => {
  const client = stubClient({
    'DOM.getContentQuads': () => ({
      quads: [
        [0, 0, 10, 0, 10, 5, 0, 5],
        [0, 5, 8, 5, 8, 10, 0, 10],
      ],
    }),
    'DOM.getBoxModel': () => ({
      model: {
        content: [0, 0, 10, 0, 10, 10, 0, 10],
        padding: [-2, -2, 12, -2, 12, 12, -2, 12],
        border: [-4, -4, 14, -4, 14, 14, -4, 14],
        margin: [-6, -6, 16, -6, 16, 16, -6, 16],
        width: 10,
        height: 10,
      },
    }),
  });

  const box = await getContentQuadBox(client, { backendNodeId: 42 });

  assert.equal(box.quads.length, 2, 'a wrapped inline element yields more than one preserved quad');
  assert.deepEqual(box.quads[0], [0, 0, 10, 0, 10, 5, 0, 5]);
  assert.deepEqual(box.quads[1], [0, 5, 8, 5, 8, 10, 0, 10]);
  assert.deepEqual(box.boxModel.content, [0, 0, 10, 0, 10, 10, 0, 10]);
  assert.deepEqual(box.boxModel.margin, [-6, -6, 16, -6, 16, 16, -6, 16]);
  assert.equal(box.boxModel.width, 10);
  assert.equal(box.boxModel.height, 10);
});

test('getContentQuadBox rejects a malformed (non-8-number) quad instead of silently truncating it', async () => {
  const client = stubClient({
    'DOM.getContentQuads': () => ({ quads: [[0, 0, 10, 0, 10, 10]] }),
    'DOM.getBoxModel': () => ({
      model: { content: [0, 0, 10, 0, 10, 10, 0, 10], padding: [], border: [], margin: [], width: 10, height: 10 },
    }),
  });

  await assert.rejects(() => getContentQuadBox(client, { backendNodeId: 1 }), /8-number quad/);
});

test('composeFrameTransform + toTopViewportQuad stitches a nested-iframe (offset + scale) chain into top-viewport space', () => {
  // Top frame -> iframe A at (100,50), no scale -> iframe B nested inside A at (10,20), scale 0.5.
  const transform = composeFrameTransform([
    { dx: 100, dy: 50 },
    { dx: 10, dy: 20, scaleX: 0.5, scaleY: 0.5 },
  ]);

  assert.deepEqual(transform, { dx: 110, dy: 70, scaleX: 0.5, scaleY: 0.5 });

  const localQuad: Quad = [0, 0, 4, 0, 4, 4, 0, 4];
  const topQuad = toTopViewportQuad(localQuad, transform);

  assert.deepEqual(topQuad, [110, 70, 112, 70, 112, 72, 110, 72]);
});

test('composeFrameTransform with an empty chain is the identity transform', () => {
  const transform = composeFrameTransform([]);
  const quad: Quad = [1, 2, 3, 2, 3, 4, 1, 4];
  assert.deepEqual(toTopViewportQuad(quad, transform), quad);
});

test('composeFrameTransform composes three nested frames in outermost-to-innermost order', () => {
  const transform = composeFrameTransform([
    { dx: 10, dy: 0 },
    { dx: 0, dy: 20, scaleX: 2, scaleY: 2 },
    { dx: 5, dy: 5 },
  ]);

  // dx1=10, s1=1 -> dx=10, scale=1
  // dx2=0,dy2=20, s2=2 -> dx=10+0*1=10, dy=0+20*1=20, scale=2
  // dx3=5,dy3=5, s3=1 -> dx=10+5*2=20, dy=20+5*2=30, scale=2
  assert.deepEqual(transform, { dx: 20, dy: 30, scaleX: 2, scaleY: 2 });
});
