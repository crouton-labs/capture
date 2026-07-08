import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractSourceMappingURL,
  mapGeneratedPosition,
  resolveAuthoredSourceLocation,
  type RawSourceMap,
} from '../src/cdp/source-map.js';
import type { CDPClient } from '../src/cdp/client.js';

function stubClient(handlers: Record<string, (params: unknown) => unknown>): CDPClient {
  return {
    send: async (method: string, params: unknown) => {
      const handler = handlers[method];
      if (!handler) throw new Error(`Unexpected CDP call: ${method}`);
      return handler(params);
    },
  } as unknown as CDPClient;
}

// Hand-built fixture source map (source-map-v3). Two generated lines:
//   line 0: two segments, "AAAA" (genCol 0 -> app.jsx:1:0) and "KAAU" (genCol 5 -> app.jsx:1:10)
//   line 1: one segment, "EACP" (genCol 2 -> app.jsx:2:3)
const fixtureMap: RawSourceMap = {
  version: 3,
  sources: ['app.jsx'],
  sourcesContent: ['export const original = "authored source";'],
  names: [],
  mappings: 'AAAA,KAAU;EACP',
};

test('mapGeneratedPosition resolves the exact authored position at a mapped generated column', () => {
  const pos = mapGeneratedPosition(fixtureMap, 0, 5);
  assert.deepEqual(pos, {
    file: 'app.jsx',
    line: 1,
    column: 10,
    sourceContent: 'export const original = "authored source";',
  });
});

test('mapGeneratedPosition resolves the nearest preceding mapping when the column falls between two segments', () => {
  // Column 7 has no exact mapping on line 0; nearest preceding is genCol 5 -> app.jsx:1:10.
  const pos = mapGeneratedPosition(fixtureMap, 0, 7);
  assert.equal(pos?.line, 1);
  assert.equal(pos?.column, 10);
});

test('mapGeneratedPosition resolves the first segment on a line', () => {
  const pos = mapGeneratedPosition(fixtureMap, 0, 0);
  assert.deepEqual(pos, {
    file: 'app.jsx',
    line: 1,
    column: 0,
    sourceContent: 'export const original = "authored source";',
  });
});

test('mapGeneratedPosition tracks running source-line/column deltas across a second generated line', () => {
  const pos = mapGeneratedPosition(fixtureMap, 1, 2);
  assert.equal(pos?.line, 2);
  assert.equal(pos?.column, 3);
});

test('mapGeneratedPosition returns null for a generated line with no mappings at all', () => {
  const pos = mapGeneratedPosition(fixtureMap, 2, 0);
  assert.equal(pos, null);
});

test('extractSourceMappingURL finds a block-comment sourceMappingURL (CSS convention) and prefers the last one present', () => {
  const text = '.a{color:red}\n/*# sourceMappingURL=first.css.map */\n.b{color:blue}\n/*# sourceMappingURL=chat.css.map */';
  assert.equal(extractSourceMappingURL(text), 'chat.css.map');
});

test('extractSourceMappingURL returns null when no sourceMappingURL comment is present', () => {
  assert.equal(extractSourceMappingURL('.a{color:red}'), null);
});

test('resolveAuthoredSourceLocation resolves authored file/line/column end-to-end via an inline base64 sourceMappingURL', async () => {
  const mapJson = JSON.stringify(fixtureMap);
  const mapDataURI = `data:application/json;base64,${Buffer.from(mapJson, 'utf8').toString('base64')}`;
  const generatedText = `.chat .message-card{padding:12px}\n/*# sourceMappingURL=${mapDataURI} */`;

  const client = stubClient({
    'CSS.getStyleSheetText': (params) => {
      assert.equal((params as { styleSheetId: string }).styleSheetId, 'sheet-1');
      return { text: generatedText };
    },
  });

  const resolved = await resolveAuthoredSourceLocation(client, {
    styleSheetId: 'sheet-1',
    sourceURL: 'http://localhost:5173/src/styles/chat.css',
    line: 0,
    column: 5,
  });

  assert.equal(resolved.kind, 'authored');
  if (resolved.kind === 'authored') {
    assert.equal(resolved.file, 'app.jsx');
    assert.equal(resolved.line, 1);
    assert.equal(resolved.column, 10);
    assert.equal(resolved.sourceContent, 'export const original = "authored source";');
    assert.deepEqual(resolved.generated, {
      sourceURL: 'http://localhost:5173/src/styles/chat.css',
      line: 0,
      column: 5,
    });
  }
});

test('resolveAuthoredSourceLocation degrades to the generated source location when no sourceMappingURL is present', async () => {
  const client = stubClient({
    'CSS.getStyleSheetText': () => ({ text: '.a{color:red}' }),
  });

  const resolved = await resolveAuthoredSourceLocation(client, {
    styleSheetId: 'sheet-2',
    sourceURL: 'https://prod.example.com/assets/app.min.css',
    line: 4,
    column: 12,
  });

  assert.deepEqual(resolved, {
    kind: 'generated',
    sourceURL: 'https://prod.example.com/assets/app.min.css',
    line: 4,
    column: 12,
  });
});

test('resolveAuthoredSourceLocation degrades to the generated location when the styleSheetId lookup itself fails', async () => {
  const client = stubClient({
    'CSS.getStyleSheetText': () => {
      throw new Error('No stylesheet for id sheet-stale');
    },
  });

  const resolved = await resolveAuthoredSourceLocation(client, {
    styleSheetId: 'sheet-stale',
    sourceURL: 'https://prod.example.com/assets/app.min.css',
    line: 0,
    column: 0,
  });

  assert.equal(resolved.kind, 'generated');
});
