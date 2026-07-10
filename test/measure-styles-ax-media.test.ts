import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CAPTURE_ROOT, writeJsonPrivate, writeBinaryPrivate } from '../src/session/artifacts.js';
import type { CDPClient } from '../src/cdp/client.js';
import type { SnapshotContext } from '../src/cdp/measure/types.js';
import type { RawSourceMap } from '../src/cdp/source-map.js';

import { collectQueries } from '../src/cdp/measure/collectors/queries.js';
import { collectAx } from '../src/cdp/measure/collectors/ax.js';
import { collectMedia, computeObjectFitCrop } from '../src/cdp/measure/collectors/media.js';
import { collectStyles, computeSpecificity } from '../src/cdp/measure/collectors/styles.js';

// ============================================================================
// Fixtures
// ============================================================================

const QUERIES_CANNED = {
  environment: {
    width: 390,
    height: 844,
    dpr: 2,
    colorScheme: 'light',
    pointer: 'coarse',
    hover: 'none',
    reducedMotion: 'no-preference',
    forcedColors: 'none',
  },
  mediaQueries: [{ query: '(max-width: 640px)', matched: true, affectedSelectors: ['.card-grid'] }],
  containerQueries: [],
};

const AX_NODES_CANNED = [
  {
    nodeId: '1',
    ignored: false,
    role: { type: 'internalRole', value: 'button' },
    name: { type: 'computedString', value: 'Send' },
    backendDOMNodeId: 42,
  },
];

const MEDIA_FACT_IMG = {
  tag: 'img',
  cssPath: 'img:nth-of-type(1)',
  rect: { x: 0, y: 0, width: 400, height: 300 },
  visible: true,
  naturalWidth: 1600,
  naturalHeight: 900,
  currentSrc: 'https://example.test/hero.jpg',
  decodeState: 'complete',
  poster: null,
  objectFit: 'cover',
  objectPosition: '50% 50%',
  contextType: null,
  backingWidth: null,
  backingHeight: null,
  src: null,
  crossOrigin: null,
  dpr: 2,
};

// Reuses the exact known-good VLQ fixture from `test/source-map-provenance.test.ts`
// (two generated lines: line 0 has segments at genCol 0 -> app.jsx:1:0 and
// genCol 5 -> app.jsx:1:10; line 1 has one segment at genCol 2 -> app.jsx:2:3).
// mapGeneratedPosition(fixtureMap, 0, 5) resolves to app.jsx:1:10 — that's
// what our `padding-top` range (startLine:0, startColumn:5) must resolve to.
const SOURCE_MAP_FIXTURE: RawSourceMap = {
  version: 3,
  sources: ['app.jsx'],
  sourcesContent: ['export const original = "authored source";'],
  names: [],
  mappings: 'AAAA,KAAU;EACP',
};
const SOURCE_MAP_DATA_URI = `data:application/json;base64,${Buffer.from(JSON.stringify(SOURCE_MAP_FIXTURE), 'utf8').toString('base64')}`;
const STYLES_GENERATED_TEXT = `.chat .message-card{padding-top:12px}\n/*# sourceMappingURL=${SOURCE_MAP_DATA_URI} */`;

const STYLES_FACTS_CANNED = [{ cssPath: 'div:nth-of-type(1)', computed: { 'padding-top': '12px' } }];

const STYLES_MATCHED_CANNED = {
  matchedCSSRules: [
    {
      rule: {
        styleSheetId: 'ss1',
        selectorList: { selectors: [{ text: '.chat .message-card' }], text: '.chat .message-card' },
        origin: 'regular',
        style: {
          cssProperties: [
            { name: 'padding-top', value: '12px', range: { startLine: 0, startColumn: 5, endLine: 0, endColumn: 20 } },
          ],
        },
      },
      matchingSelectors: [0],
    },
  ],
};

const STYLES_SHORTHAND_FACTS_CANNED = [{ cssPath: 'div:nth-of-type(1)', computed: { 'margin-top': '4px' } }];

const STYLES_SHORTHAND_MATCHED_CANNED = {
  matchedCSSRules: [
    {
      rule: {
        styleSheetId: 'ss1',
        selectorList: { selectors: [{ text: '.chat .message-card' }], text: '.chat .message-card' },
        origin: 'regular',
        style: {
          cssProperties: [
            {
              name: 'margin',
              value: '4px 8px',
              range: { startLine: 0, startColumn: 5, endLine: 0, endColumn: 20 },
              longhandProperties: [
                { name: 'margin-top', value: '4px' },
                { name: 'margin-right', value: '8px' },
                { name: 'margin-bottom', value: '4px' },
                { name: 'margin-left', value: '8px' },
              ],
            },
            // Real CDP's flattened restatement tail — no range, mirrors real Chrome shape
            // (confirmed empirically against real headless Chrome; see roadmap.md).
            { name: 'margin-top', value: '4px' },
            { name: 'margin-right', value: '8px' },
            { name: 'margin-bottom', value: '4px' },
            { name: 'margin-left', value: '8px' },
          ],
        },
      },
      matchingSelectors: [0],
    },
  ],
};

const STYLES_NO_RANGE_FACTS_CANNED = [{ cssPath: 'div:nth-of-type(1)', computed: { 'padding-top': '12px' } }];

const STYLES_NO_RANGE_MATCHED_CANNED = {
  matchedCSSRules: [
    {
      rule: {
        styleSheetId: 'ss1',
        selectorList: { selectors: [{ text: '.chat .message-card' }], text: '.chat .message-card' },
        origin: 'regular',
        style: {
          // No range on the declaration, AND no `rule.style.range` either — genuinely NO range
          // exists anywhere for this property (the total-absence case, distinct from the
          // rule-level-fallback case `STYLES_MATCHED_CANNED`'s `source-range-unresolved` test covers).
          cssProperties: [{ name: 'padding-top', value: '12px' }],
        },
      },
      matchingSelectors: [0],
    },
  ],
};

// ============================================================================
// Stub CDP client — pattern-matches on method, and on `Runtime.evaluate`'s
// `expression` marker comment, exactly like `test/snapshot-settledness.test.ts`.
// ============================================================================

class StubCdpClient {
  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureQueriesInventory')) return { result: { value: QUERIES_CANNED } };
      if (expression.includes('__captureStylesInventory'))
        return { result: { value: { elements: STYLES_FACTS_CANNED, iframesNotWalked: 0, shadowRootsNotWalked: 0 } } };
      if (expression.includes('__captureMediaInventory')) return { result: { value: [MEDIA_FACT_IMG] } };
      return { result: {} };
    }
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelector') return { nodeId: 42 };
    if (method === 'DOM.describeNode') return { node: { backendNodeId: 999 } };
    if (method === 'CSS.getMatchedStylesForNode') return STYLES_MATCHED_CANNED;
    if (method === 'CSS.getStyleSheetText') return { text: STYLES_GENERATED_TEXT };
    if (method === 'Accessibility.getFullAXTree') return { nodes: AX_NODES_CANNED };
    return {};
  }
}

function asClient(stub: { send(method: string, params?: Record<string, unknown>): Promise<unknown> }): CDPClient {
  return stub as unknown as CDPClient;
}

/**
 * A styles-only stub — tailored `Runtime.evaluate` facts and a tailored `CSS.getMatchedStylesForNode`
 * response, for tests exercising `collectStyles`'s cascade/provenance logic in isolation (duplicate
 * declarations, multi-selector specificity, inline-vs-stylesheet importance) without pulling in the
 * shared canned fixtures used by the other collectors' tests.
 */
class StylesOnlyStubCdpClient {
  constructor(
    private readonly facts: unknown[],
    private readonly matched: unknown,
  ) {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('__captureStylesInventory'))
        return { result: { value: { elements: this.facts, iframesNotWalked: 0, shadowRootsNotWalked: 0 } } };
      return { result: {} };
    }
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelector') return { nodeId: 42 };
    if (method === 'DOM.describeNode') return { node: { backendNodeId: 999 } };
    if (method === 'CSS.getMatchedStylesForNode') return this.matched;
    return {};
  }
}

function freshSnapDir(label: string): string {
  return path.join(CAPTURE_ROOT, `measure-styles-ax-media-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

function makeCtx(client: StubCdpClient, dir: string): SnapshotContext {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return {
    client: asClient(client),
    dir,
    snapId: 'snap-test',
    url: 'http://example.test',
    viewport: '390x844',
    settled: true,
    freezeAnimations: false,
    captureUnsettled: false,
    pixels: false,
    state: [],
    unstableRegions: [],
    write: {
      json(filename, value) {
        writeJsonPrivate(path.join(dir, filename), value);
      },
      binary(filename, data) {
        writeBinaryPrivate(path.join(dir, filename), data);
      },
    },
  };
}

function readJson(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// ============================================================================
// 1. queries.ts — a media query
// ============================================================================

test('collectQueries writes a matched media query with its affected selectors', async () => {
  const dir = freshSnapDir('queries');
  try {
    const ctx = makeCtx(new StubCdpClient(), dir);
    await collectQueries(ctx);

    const queries = readJson(path.join(dir, 'queries.json'));
    assert.equal(queries.mediaQueries.length, 1);
    assert.equal(queries.mediaQueries[0].query, '(max-width: 640px)');
    assert.equal(queries.mediaQueries[0].matched, true);
    assert.deepEqual(queries.mediaQueries[0].affectedSelectors, ['.card-grid']);
    assert.equal(queries.environment.colorScheme, 'light');
    assert.deepEqual(queries.containerQueries, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// 2. styles.ts — authored source-map provenance
// ============================================================================

test('collectStyles resolves authored source-map provenance for the winning padding-top declaration', async () => {
  const dir = freshSnapDir('styles');
  try {
    const ctx = makeCtx(new StubCdpClient(), dir);
    await collectStyles(ctx);

    const styles = readJson(path.join(dir, 'styles.json'));
    assert.equal(styles.elements.length, 1);
    const element = styles.elements[0];
    assert.equal(element.backendNodeId, 999);
    assert.equal(element.identityUnresolved, undefined, 'a resolved element keeps its numeric backendNodeId and has NO identityUnresolved marker');
    assert.deepEqual(styles.identity, { available: true }, 'report-level identity availability fact is explicit on a healthy run');
    assert.equal(styles.available, true, 'the styles inventory eval succeeded');

    const paddingTop = element.winningDeclarations.find((d: any) => d.property === 'padding-top');
    assert.ok(paddingTop, 'expected a padding-top winning declaration');
    assert.equal(paddingTop.value, '12px');
    assert.equal(paddingTop.selector, '.chat .message-card');
    assert.equal(paddingTop.specificity, '0-2-0');
    assert.deepEqual(paddingTop.authored, { file: 'app.jsx', line: 1, column: 10 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectStyles reports the COMPUTED value as `value`, keeping the raw declaration as `declaredValue`', async () => {
  const dir = freshSnapDir('styles-computed-value');
  try {
    const facts = [{ cssPath: 'div:nth-of-type(1)', computed: { 'padding-top': '20px' } }];
    const matched = {
      matchedCSSRules: [
        {
          rule: {
            selectorList: { selectors: [{ text: '.box' }], text: '.box' },
            origin: 'regular',
            style: { cssProperties: [{ name: 'padding-top', value: '1.25rem' }] },
          },
          matchingSelectors: [0],
        },
      ],
    };
    const ctx = makeCtx(new StylesOnlyStubCdpClient(facts, matched) as unknown as StubCdpClient, dir);
    await collectStyles(ctx);

    const styles = readJson(path.join(dir, 'styles.json'));
    const paddingTop = styles.elements[0].winningDeclarations.find((d: any) => d.property === 'padding-top');
    assert.equal(paddingTop.value, '20px', 'value must be the computed style value, not the raw declaration');
    assert.equal(paddingTop.declaredValue, '1.25rem');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectStyles picks the matching selector with the highest specificity from a multi-selector rule', async () => {
  const dir = freshSnapDir('styles-multi-selector');
  try {
    const facts = [{ cssPath: 'div:nth-of-type(1)', computed: { color: 'rgb(1, 2, 3)' } }];
    const matched = {
      matchedCSSRules: [
        {
          rule: {
            selectorList: { selectors: [{ text: '.card' }, { text: '#hero' }], text: '.card, #hero' },
            origin: 'regular',
            style: { cssProperties: [{ name: 'color', value: 'blue' }] },
          },
          // Both selectors in the list match the node (e.g. `#hero.card`) — CDP reports both indices.
          matchingSelectors: [0, 1],
        },
      ],
    };
    const ctx = makeCtx(new StylesOnlyStubCdpClient(facts, matched) as unknown as StubCdpClient, dir);
    await collectStyles(ctx);

    const styles = readJson(path.join(dir, 'styles.json'));
    const color = styles.elements[0].winningDeclarations.find((d: any) => d.property === 'color');
    assert.equal(color.selector, '#hero', 'the higher-specificity matching selector (#hero) must win, not the first-listed (.card)');
    assert.equal(color.specificity, '1-0-0');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectStyles: inline !important beats stylesheet !important', async () => {
  const dir = freshSnapDir('styles-inline-important');
  try {
    const facts = [{ cssPath: 'div:nth-of-type(1)', computed: { color: 'rgb(9, 9, 9)' } }];
    const matched = {
      inlineStyle: { cssProperties: [{ name: 'color', value: 'red', important: true }] },
      matchedCSSRules: [
        {
          rule: {
            selectorList: { selectors: [{ text: '#a #b #c' }], text: '#a #b #c' },
            origin: 'regular',
            style: { cssProperties: [{ name: 'color', value: 'blue', important: true }] },
          },
          matchingSelectors: [0],
        },
      ],
    };
    const ctx = makeCtx(new StylesOnlyStubCdpClient(facts, matched) as unknown as StubCdpClient, dir);
    await collectStyles(ctx);

    const styles = readJson(path.join(dir, 'styles.json'));
    const color = styles.elements[0].winningDeclarations.find((d: any) => d.property === 'color');
    assert.equal(color.selector, 'inline', 'inline !important must beat a higher-specificity stylesheet !important rule');
    assert.equal(color.important, true);
    assert.equal(color.value, 'rgb(9, 9, 9)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectStyles: the later same-property declaration within one rule wins (CSS source order)', async () => {
  const dir = freshSnapDir('styles-duplicate-declaration');
  try {
    const facts = [{ cssPath: 'div:nth-of-type(1)', computed: { color: 'rgb(0, 0, 255)' } }];
    const matched = {
      matchedCSSRules: [
        {
          rule: {
            selectorList: { selectors: [{ text: '.x' }], text: '.x' },
            origin: 'regular',
            style: {
              cssProperties: [
                { name: 'color', value: 'red' },
                { name: 'color', value: 'blue' },
              ],
            },
          },
          matchingSelectors: [0],
        },
      ],
    };
    const ctx = makeCtx(new StylesOnlyStubCdpClient(facts, matched) as unknown as StubCdpClient, dir);
    await collectStyles(ctx);

    const styles = readJson(path.join(dir, 'styles.json'));
    const color = styles.elements[0].winningDeclarations.find((d: any) => d.property === 'color');
    assert.equal(color.declaredValue, 'blue', 'the later declaration in source order must win, not the first (`.find`) match');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectStyles: !important beats a later normal declaration of the same property, within one rule (importance resolves before source order)', async () => {
  const dir = freshSnapDir('styles-duplicate-declaration-importance');
  try {
    const facts = [{ cssPath: 'div:nth-of-type(1)', computed: { color: 'rgb(255, 0, 0)' } }];
    const matched = {
      matchedCSSRules: [
        {
          rule: {
            selectorList: { selectors: [{ text: '.x' }], text: '.x' },
            origin: 'regular',
            style: {
              cssProperties: [
                { name: 'color', value: 'red', important: true },
                { name: 'color', value: 'blue' },
              ],
            },
          },
          matchingSelectors: [0],
        },
      ],
    };
    const ctx = makeCtx(new StylesOnlyStubCdpClient(facts, matched) as unknown as StubCdpClient, dir);
    await collectStyles(ctx);

    const styles = readJson(path.join(dir, 'styles.json'));
    const color = styles.elements[0].winningDeclarations.find((d: any) => d.property === 'color');
    assert.equal(color.declaredValue, 'red', 'the earlier !important declaration must win, not the later normal one');
    assert.equal(color.important, true);
    assert.equal(color.value, 'rgb(255, 0, 0)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectStyles: inline duplicate declarations (same importance) resolve by source order, later wins', async () => {
  const dir = freshSnapDir('styles-inline-duplicate');
  try {
    const facts = [{ cssPath: 'div:nth-of-type(1)', computed: { color: 'rgb(0, 0, 255)' } }];
    const matched = {
      inlineStyle: {
        cssProperties: [
          { name: 'color', value: 'red' },
          { name: 'color', value: 'blue' },
        ],
      },
    };
    const ctx = makeCtx(new StylesOnlyStubCdpClient(facts, matched) as unknown as StubCdpClient, dir);
    await collectStyles(ctx);

    const styles = readJson(path.join(dir, 'styles.json'));
    const color = styles.elements[0].winningDeclarations.find((d: any) => d.property === 'color');
    assert.equal(color.declaredValue, 'blue', 'the later inline declaration must win, not the first (`.find`) match');
    assert.equal(color.selector, 'inline');
    assert.equal(color.important, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectStyles: inline duplicate declarations where the later one is !important wins over the earlier normal one', async () => {
  const dir = freshSnapDir('styles-inline-duplicate-important');
  try {
    const facts = [{ cssPath: 'div:nth-of-type(1)', computed: { color: 'rgb(0, 0, 255)' } }];
    const matched = {
      inlineStyle: {
        cssProperties: [
          { name: 'color', value: 'red' },
          { name: 'color', value: 'blue', important: true },
        ],
      },
    };
    const ctx = makeCtx(new StylesOnlyStubCdpClient(facts, matched) as unknown as StubCdpClient, dir);
    await collectStyles(ctx);

    const styles = readJson(path.join(dir, 'styles.json'));
    const color = styles.elements[0].winningDeclarations.find((d: any) => d.property === 'color');
    assert.equal(color.declaredValue, 'blue', 'the !important inline declaration must win');
    assert.equal(color.selector, 'inline');
    assert.equal(color.important, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectStyles: unavailable provenance (no CDP nodeId) leaves winningDeclarations empty, distinct from "no declaration"', async () => {
  const dir = freshSnapDir('styles-provenance-unavailable');
  try {
    const facts = [{ cssPath: 'div:nth-of-type(1)', computed: { color: 'rgb(0, 0, 0)' } }];
    class NoNodeIdStub {
      async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        if (method === 'Runtime.evaluate') {
          const expression = String((params as { expression?: unknown }).expression ?? '');
          if (expression.includes('__captureStylesInventory'))
            return { result: { value: { elements: facts, iframesNotWalked: 0, shadowRootsNotWalked: 0 } } };
          return { result: {} };
        }
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
        if (method === 'DOM.querySelector') return { nodeId: undefined };
        return {};
      }
    }
    const ctx = makeCtx(new NoNodeIdStub() as unknown as StubCdpClient, dir);
    await collectStyles(ctx);

    const styles = readJson(path.join(dir, 'styles.json'));
    const element = styles.elements[0];
    assert.equal(element.provenanceUnavailable, true);
    assert.deepEqual(element.winningDeclarations, []);
    // I-3: this element's SELECTOR failed to resolve (DOM.querySelector returned no nodeId) while
    // the whole run stayed healthy (DOM.getDocument succeeded) -- a per-element miss, distinct from
    // a whole-run identity failure, but still an explicit null+identityUnresolved, never an omitted key.
    assert.equal(element.backendNodeId, null, 'I-3: explicit null when this element\'s selector did not resolve, not an omitted field');
    assert.equal(element.identityUnresolved, true);
    assert.deepEqual(styles.identity, { available: true }, 'the whole run is healthy (DOM.getDocument succeeded) -- only this one element failed to resolve');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// Phase-3 honesty sweep: styles.ts report-level `available`/`unavailableReason`
// (Class A, I-5) and whole-run `identity` availability (Class B, I-3/I-4).
// ============================================================================

test('collectStyles: STYLES_SCRIPT eval returning no value reports available:false with a reason -- RED: pre-fix code coerced this to an empty inventory (elements:[]) with no available field at all (empty-success)', async () => {
  const dir = freshSnapDir('styles-availability-no-value');
  try {
    class NoValueStub {
      async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        if (method === 'Runtime.evaluate') {
          const expression = String((params as { expression?: unknown }).expression ?? '');
          if (expression.includes('__captureStylesInventory')) return { result: {} }; // no `value` field at all
          return { result: {} };
        }
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
        return {};
      }
    }
    const ctx = makeCtx(new NoValueStub() as unknown as StubCdpClient, dir);
    await collectStyles(ctx);

    const styles = readJson(path.join(dir, 'styles.json'));
    assert.equal(styles.available, false, 'expected available:false when the inventory eval returns no value -- old code silently emitted elements:[] with no available field at all (RED)');
    assert.equal(styles.unavailableReason, 'styles-evaluate-returned-no-value');
    assert.deepEqual(styles.elements, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectStyles: STYLES_SCRIPT eval throwing reports available:false with a reason', async () => {
  const dir = freshSnapDir('styles-availability-throws');
  try {
    class ThrowingEvalStub {
      async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        if (method === 'Runtime.evaluate') {
          const expression = String((params as { expression?: unknown }).expression ?? '');
          if (expression.includes('__captureStylesInventory')) throw new Error('simulated styles evaluate failure');
          return { result: {} };
        }
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
        return {};
      }
    }
    const ctx = makeCtx(new ThrowingEvalStub() as unknown as StubCdpClient, dir);
    await collectStyles(ctx);

    const styles = readJson(path.join(dir, 'styles.json'));
    assert.equal(styles.available, false, 'expected available:false when the inventory eval throws');
    assert.equal(styles.unavailableReason, 'styles-evaluate-threw');
    assert.deepEqual(styles.elements, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectStyles: a genuinely empty inventory (elements:[] present) reports available:true, distinct from an unavailable read', async () => {
  const dir = freshSnapDir('styles-availability-healthy-empty');
  try {
    class HealthyEmptyStub {
      async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        if (method === 'Runtime.evaluate') {
          const expression = String((params as { expression?: unknown }).expression ?? '');
          if (expression.includes('__captureStylesInventory'))
            return { result: { value: { elements: [], total: 0, iframesNotWalked: 0, shadowRootsNotWalked: 0 } } };
          return { result: {} };
        }
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
        return {};
      }
    }
    const ctx = makeCtx(new HealthyEmptyStub() as unknown as StubCdpClient, dir);
    await collectStyles(ctx);

    const styles = readJson(path.join(dir, 'styles.json'));
    assert.equal(styles.available, true, 'a genuinely empty (but present) inventory is honest empty success, not unavailable');
    assert.equal(styles.unavailableReason, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectStyles: DOM.getDocument throwing reports identity: { available: false, reason }, and every element gets backendNodeId:null + identityUnresolved:true -- RED: pre-fix code left backendNodeId simply omitted (undefined), no identityUnresolved, no report-level identity fact at all', async () => {
  const dir = freshSnapDir('styles-identity-throws');
  try {
    const facts = [{ cssPath: 'div:nth-of-type(1)', computed: { color: 'rgb(0, 0, 0)' } }];
    class ThrowingDocStub {
      async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        if (method === 'Runtime.evaluate') {
          const expression = String((params as { expression?: unknown }).expression ?? '');
          if (expression.includes('__captureStylesInventory'))
            return { result: { value: { elements: facts, iframesNotWalked: 0, shadowRootsNotWalked: 0 } } };
          return { result: {} };
        }
        if (method === 'DOM.getDocument') throw new Error('simulated DOM.getDocument failure');
        return {};
      }
    }
    const ctx = makeCtx(new ThrowingDocStub() as unknown as StubCdpClient, dir);
    await collectStyles(ctx);

    const styles = readJson(path.join(dir, 'styles.json'));
    assert.equal(styles.identity.available, false, 'expected identity.available:false when DOM.getDocument throws');
    assert.equal(styles.identity.reason, 'dom-getdocument-unavailable');
    assert.equal(styles.elements[0].backendNodeId, null, 'RED: old code left this field simply undefined/omitted');
    assert.equal(styles.elements[0].identityUnresolved, true, 'RED: old code never set this field at all');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectStyles: DOM.getDocument returning no root.nodeId reports identity: { available: false, reason }', async () => {
  const dir = freshSnapDir('styles-identity-noroot');
  try {
    const facts = [{ cssPath: 'div:nth-of-type(1)', computed: { color: 'rgb(0, 0, 0)' } }];
    class NoRootDocStub {
      async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        if (method === 'Runtime.evaluate') {
          const expression = String((params as { expression?: unknown }).expression ?? '');
          if (expression.includes('__captureStylesInventory'))
            return { result: { value: { elements: facts, iframesNotWalked: 0, shadowRootsNotWalked: 0 } } };
          return { result: {} };
        }
        if (method === 'DOM.getDocument') return {}; // no root field
        return {};
      }
    }
    const ctx = makeCtx(new NoRootDocStub() as unknown as StubCdpClient, dir);
    await collectStyles(ctx);

    const styles = readJson(path.join(dir, 'styles.json'));
    assert.equal(styles.identity.available, false, 'expected identity.available:false when DOM.getDocument returns no root');
    assert.equal(styles.identity.reason, 'dom-getdocument-unavailable');
    assert.equal(styles.elements[0].backendNodeId, null);
    assert.equal(styles.elements[0].identityUnresolved, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test(
  "collectStyles resolves the shorthand declaration's authored source-map location for a synthesized longhand winner (margin-top from `margin: 4px 8px`), not a rule-level fallback",
  async () => {
    const dir = freshSnapDir('styles-shorthand-longhand');
    try {
      class ShorthandStub {
        async send(method: string, params: Record<string, unknown> = {}) {
          if (method === 'Runtime.evaluate') {
            const expr = String((params as any).expression ?? '');
            if (expr.includes('__captureStylesInventory'))
              return { result: { value: { elements: STYLES_SHORTHAND_FACTS_CANNED, iframesNotWalked: 0, shadowRootsNotWalked: 0 } } };
            return { result: {} };
          }
          if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
          if (method === 'DOM.querySelector') return { nodeId: 42 };
          if (method === 'DOM.describeNode') return { node: { backendNodeId: 999 } };
          if (method === 'CSS.getMatchedStylesForNode') return STYLES_SHORTHAND_MATCHED_CANNED;
          if (method === 'CSS.getStyleSheetText') return { text: STYLES_GENERATED_TEXT };
          return {};
        }
      }
      const ctx = makeCtx(new ShorthandStub() as any, dir);
      await collectStyles(ctx);
      const styles = readJson(path.join(dir, 'styles.json'));
      const marginTop = styles.elements[0].winningDeclarations.find((d: any) => d.property === 'margin-top');
      assert.ok(marginTop, 'expected a margin-top winning declaration synthesized from the margin shorthand');
      assert.equal(marginTop.declaredValue, '4px');
      assert.deepEqual(
        marginTop.authored,
        { file: 'app.jsx', line: 1, column: 10 },
        "resolves via the SHORTHAND declaration's own range, not a rule-level/0:0 fallback",
      );
      assert.equal(marginTop.winnerApproximate, undefined, 'an accurately-traced synthesized-longhand source is not approximate');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

test("collectStyles: winnerApproximate + 'source-range-unresolved' fires when only a rule-level range fallback is traceable", async () => {
  const dir = freshSnapDir('styles-source-range-unresolved');
  try {
    const facts = [{ cssPath: 'div:nth-of-type(1)', computed: { 'padding-top': '12px' } }];
    const matched = {
      matchedCSSRules: [
        {
          rule: {
            styleSheetId: 'ss1',
            selectorList: { selectors: [{ text: '.chat .message-card' }], text: '.chat .message-card' },
            origin: 'regular',
            style: {
              // No range on the declaration itself, and no shorthand backfills one — the ONLY
              // range anywhere is the rule's own span, so the fallback is a genuine substitution.
              cssProperties: [{ name: 'padding-top', value: '12px' }],
              range: { startLine: 3, startColumn: 0, endLine: 5, endColumn: 1 },
            },
          },
          matchingSelectors: [0],
        },
      ],
    };
    const ctx = makeCtx(new StylesOnlyStubCdpClient(facts, matched) as unknown as StubCdpClient, dir);
    await collectStyles(ctx);

    const styles = readJson(path.join(dir, 'styles.json'));
    const paddingTop = styles.elements[0].winningDeclarations.find((d: any) => d.property === 'padding-top');
    assert.equal(paddingTop.winnerApproximate, true);
    assert.equal(paddingTop.winnerApproximateReason, 'source-range-unresolved');
    assert.deepEqual(
      paddingTop.range,
      { startLine: 3, startColumn: 0, endLine: 5, endColumn: 1 },
      'range falls back to the whole rule span, the fact that makes this a fabricated substitution',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectStyles: a matching selector using :where()/:is() flags winnerApproximate without re-picking the v1 winner', async () => {
  const dir = freshSnapDir('styles-where-is-approximate');
  try {
    const facts = [{ cssPath: 'div:nth-of-type(1)', computed: { color: 'rgb(1, 2, 3)' } }];
    const matched = {
      matchedCSSRules: [
        {
          rule: {
            selectorList: { selectors: [{ text: ':where(.a, .b) .box' }], text: ':where(.a, .b) .box' },
            origin: 'regular',
            style: { cssProperties: [{ name: 'color', value: 'blue' }] },
          },
          matchingSelectors: [0],
        },
      ],
    };
    const ctx = makeCtx(new StylesOnlyStubCdpClient(facts, matched) as unknown as StubCdpClient, dir);
    await collectStyles(ctx);

    const styles = readJson(path.join(dir, 'styles.json'));
    const color = styles.elements[0].winningDeclarations.find((d: any) => d.property === 'color');
    assert.equal(color.winnerApproximate, true);
    assert.equal(color.winnerApproximateReason, 'selector-specificity-where-is-present');
    assert.equal(color.declaredValue, 'blue', 'the v1 winner is still reported, not re-picked');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectStyles: a normal selector (no :where()/:is()) does not flag winnerApproximate — the flag is selective, not blanket', async () => {
  const dir = freshSnapDir('styles-where-is-control');
  try {
    const facts = [{ cssPath: 'div:nth-of-type(1)', computed: { color: 'rgb(1, 2, 3)' } }];
    const matched = {
      matchedCSSRules: [
        {
          rule: {
            selectorList: { selectors: [{ text: '.box' }], text: '.box' },
            origin: 'regular',
            style: { cssProperties: [{ name: 'color', value: 'blue' }] },
          },
          matchingSelectors: [0],
        },
      ],
    };
    const ctx = makeCtx(new StylesOnlyStubCdpClient(facts, matched) as unknown as StubCdpClient, dir);
    await collectStyles(ctx);

    const styles = readJson(path.join(dir, 'styles.json'));
    const color = styles.elements[0].winningDeclarations.find((d: any) => d.property === 'color');
    assert.equal(color.winnerApproximate, undefined);
    assert.equal(color.winnerApproximateReason, undefined);
    assert.equal(color.declaredValue, 'blue');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test(
  'collectStyles: no range anywhere (no declaration range, no rule.style.range) leaves range/authored/generated/winnerApproximate all honestly absent, even with a source-capable client',
  async () => {
    const dir = freshSnapDir('styles-no-range-anywhere');
    try {
      // A fully source-capable client: `CSS.getStyleSheetText` returns real generated text (with
      // a resolvable source map), and `CSS.styleSheetAdded` fires on `CSS.enable` so `styleSheetUrls`
      // is populated with a real URL — proving the absence below is not an artifact of the client
      // being unable to resolve source, but a genuine "no range anywhere" fact.
      class SourceCapableNoRangeStub {
        private listeners = new Map<string, (params: unknown) => void>();
        async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
          if (method === 'Runtime.evaluate') {
            const expr = String((params as any).expression ?? '');
            if (expr.includes('__captureStylesInventory'))
              return { result: { value: { elements: STYLES_NO_RANGE_FACTS_CANNED, iframesNotWalked: 0, shadowRootsNotWalked: 0 } } };
            return { result: {} };
          }
          if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
          if (method === 'DOM.querySelector') return { nodeId: 42 };
          if (method === 'DOM.describeNode') return { node: { backendNodeId: 999 } };
          if (method === 'CSS.getMatchedStylesForNode') return STYLES_NO_RANGE_MATCHED_CANNED;
          if (method === 'CSS.getStyleSheetText') return { text: STYLES_GENERATED_TEXT };
          if (method === 'CSS.enable') {
            const handler = this.listeners.get('CSS.styleSheetAdded');
            if (handler) handler({ header: { styleSheetId: 'ss1', sourceURL: 'https://example.test/app.css' } });
            return {};
          }
          if (method === 'CSS.disable') return {};
          return {};
        }
        on(event: string, handler: (params: unknown) => void): void {
          this.listeners.set(event, handler);
        }
      }
      const ctx = makeCtx(new SourceCapableNoRangeStub() as any, dir);
      await collectStyles(ctx);
      const styles = readJson(path.join(dir, 'styles.json'));
      assert.equal(styles.styleSheetHeaders.available, true, 'the stub is source-capable — header capture must actually succeed');
      const paddingTop = styles.elements[0].winningDeclarations.find((d: any) => d.property === 'padding-top');
      assert.ok(paddingTop, 'expected a padding-top winning declaration');
      assert.equal(paddingTop.declaredValue, '12px');
      assert.equal(paddingTop.range, undefined, 'no range anywhere (no declaration range, no rule.style.range) is honest absence');
      assert.equal(paddingTop.authored, undefined, 'no authored location without a real range to seed source resolution');
      assert.equal(paddingTop.generated, undefined, 'no generated location without a real range to seed source resolution — never a fabricated 0:0');
      assert.equal(paddingTop.winnerApproximate, undefined, 'total absence is unflagged, not approximate');
      assert.equal(paddingTop.winnerApproximateReason, undefined);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

// ============================================================================
// 3. ax.ts — AX role/name mapping
// ============================================================================

test('collectAx flattens role/name/backendNodeId from the AX tree', async () => {
  const dir = freshSnapDir('ax');
  try {
    const ctx = makeCtx(new StubCdpClient(), dir);
    await collectAx(ctx);

    const ax = readJson(path.join(dir, 'ax.json'));
    assert.equal(ax.nodes.length, 1);
    assert.equal(ax.nodes[0].role, 'button');
    assert.equal(ax.nodes[0].axName, 'Send');
    assert.equal(ax.nodes[0].backendNodeId, 42);
    assert.equal(ax.nodes[0].ignored, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectAx caps the written node count and records the overflow as `truncated`', async () => {
  const dir = freshSnapDir('ax-cap');
  try {
    const bigTree = Array.from({ length: 5005 }, (_, i) => ({
      nodeId: String(i),
      ignored: false,
      role: { type: 'internalRole', value: 'generic' },
      backendDOMNodeId: i,
    }));
    class BigAxStub {
      async send(method: string): Promise<unknown> {
        if (method === 'Accessibility.getFullAXTree') return { nodes: bigTree };
        return {};
      }
    }
    const ctx = makeCtx(new BigAxStub() as unknown as StubCdpClient, dir);
    await collectAx(ctx);

    const ax = readJson(path.join(dir, 'ax.json'));
    assert.equal(ax.nodes.length, 5000, 'the written node count must be capped, not the full page-controlled tree size');
    assert.equal(ax.truncated, 5);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// 4. media.ts — image object-fit crop facts
// ============================================================================

test('collectMedia computes cover crop facts for an image', async () => {
  const dir = freshSnapDir('media');
  try {
    const ctx = makeCtx(new StubCdpClient(), dir);
    await collectMedia(ctx);

    const media = readJson(path.join(dir, 'media.json'));
    assert.equal(media.elements.length, 1);
    const el = media.elements[0];
    assert.equal(el.tag, 'img');
    assert.equal(el.naturalWidth, 1600);
    assert.equal(el.naturalHeight, 900);
    assert.equal(el.renderedWidth, 400);
    assert.equal(el.renderedHeight, 300);

    // Hand-computed: scale = max(400/1600, 300/900) = max(0.25, 0.3333...) = 1/3.
    // scaledW = 1600/3 = 533.33..., scaledH = 900/3 = 300.
    // cropW = (533.33... - 400) / (1/3) = 400; cropH = (300 - 300) / (1/3) = 0.
    // Position 50%/50% splits each crop evenly: left/right = 200/200, top/bottom = 0/0.
    assert.equal(el.crop.mode, 'cover');
    assert.ok(Math.abs(el.crop.croppedLeftPx - 200) < 1);
    assert.ok(Math.abs(el.crop.croppedRightPx - 200) < 1);
    assert.ok(Math.abs(el.crop.croppedTopPx - 0) < 1);
    assert.ok(Math.abs(el.crop.croppedBottomPx - 0) < 1);
    assert.equal(media.available, true, 'the MEDIA_SCRIPT inventory eval succeeded');
    assert.equal(media.unavailableReason, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// Phase-3 honesty sweep: media.ts report-level `available`/`unavailableReason`
// (Class A, I-5) -- the MEDIA_SCRIPT inventory read, DISTINCT from `identity`
// (which covers backendNodeId resolution, exercised separately in
// measure-ax-queries-media-invariants.test.ts's "Finding I-4" describe block).
// ============================================================================

test('collectMedia: MEDIA_SCRIPT eval returning no value reports available:false with a reason -- RED: pre-fix code coerced this to an empty elements array with no available field at all (empty-success)', async () => {
  const dir = freshSnapDir('media-availability-no-value');
  try {
    class NoValueMediaStub {
      async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        if (method === 'Runtime.evaluate') {
          const expression = String((params as { expression?: unknown }).expression ?? '');
          if (expression.includes('__captureMediaInventory')) return { result: {} }; // no `value` field at all
          return { result: {} };
        }
        return {};
      }
    }
    const ctx = makeCtx(new NoValueMediaStub() as unknown as StubCdpClient, dir);
    await collectMedia(ctx);

    const media = readJson(path.join(dir, 'media.json'));
    assert.equal(media.available, false, 'expected available:false when the inventory eval returns no value -- old code silently emitted elements:[] with no available field at all (RED)');
    assert.equal(media.unavailableReason, 'media-evaluate-returned-no-value');
    assert.deepEqual(media.elements, []);
    assert.deepEqual(media.identity, { available: true }, 'identity (backendNodeId-resolution availability) is a distinct fact from the inventory-read availability');
    assert.deepEqual(
      media.totalCount,
      { available: false, reason: 'media-total-not-attempted-primary-unavailable' },
      'the companion MEDIA_TOTAL_SCRIPT read is never even attempted when the primary inventory is unavailable -- totalCount must say so explicitly, not default to a success-shaped {available:true,total:facts.length} (facts.length is 0 here, the synthetic empty-failure value, not a measured total)',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectMedia: MEDIA_SCRIPT eval throwing reports available:false with a reason', async () => {
  const dir = freshSnapDir('media-availability-throws');
  try {
    class ThrowingMediaStub {
      async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        if (method === 'Runtime.evaluate') {
          const expression = String((params as { expression?: unknown }).expression ?? '');
          if (expression.includes('__captureMediaInventory')) throw new Error('simulated media evaluate failure');
          return { result: {} };
        }
        return {};
      }
    }
    const ctx = makeCtx(new ThrowingMediaStub() as unknown as StubCdpClient, dir);
    await collectMedia(ctx);

    const media = readJson(path.join(dir, 'media.json'));
    assert.equal(media.available, false, 'expected available:false when the inventory eval throws');
    assert.equal(media.unavailableReason, 'media-evaluate-threw');
    assert.deepEqual(media.elements, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectMedia: a genuinely empty inventory (value:[] present) reports available:true, distinct from an unavailable read', async () => {
  const dir = freshSnapDir('media-availability-healthy-empty');
  try {
    class HealthyEmptyMediaStub {
      async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        if (method === 'Runtime.evaluate') {
          const expression = String((params as { expression?: unknown }).expression ?? '');
          if (expression.includes('__captureMediaInventory')) return { result: { value: [] } };
          if (expression.includes('__captureMediaTotal')) return { result: { value: 0 } };
          return { result: {} };
        }
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
        return {};
      }
    }
    const ctx = makeCtx(new HealthyEmptyMediaStub() as unknown as StubCdpClient, dir);
    await collectMedia(ctx);

    const media = readJson(path.join(dir, 'media.json'));
    assert.equal(media.available, true, 'a genuinely empty (but present) inventory is honest empty success, not unavailable');
    assert.equal(media.unavailableReason, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// (I-5) -- the `MEDIA_TOTAL_SCRIPT` companion cap-count read, DISTINCT from the primary
// `MEDIA_SCRIPT` inventory read exercised above. RED pre-fix: the inventory succeeds with
// exactly `MEDIA_MAX_ELEMENTS` (200) kept elements (the in-page walk's own cap -- see
// media.ts's `MEDIA_SCRIPT`), so a real page could genuinely have MORE than 200 media
// elements with the excess silently dropped, but the total-count read that would reveal
// that (`MEDIA_TOTAL_SCRIPT`) returns a non-number. Pre-fix code coerced that failed read to
// `total = facts.length` (200), so `elementsTruncated` came out `undefined` -- indistinguishable
// from "the page genuinely had exactly 200 elements, none truncated". That is a failed read
// silently rendered as a success claim of exhaustive enumeration -- the exact I-5 violation.
// Post-fix, `media.json` must carry an explicit `totalCount: { available: false, reason: ... }`
// so a downstream reader can distinguish "provably exhaustive" from "count unknown, possibly
// truncated", and must NOT report `elementsTruncated` at all (an absence that would, without
// `totalCount`, still misleadingly read as "not truncated").
test('collectMedia: MEDIA_TOTAL_SCRIPT eval returning a non-number reports totalCount:unavailable rather than coercing to facts.length -- RED: pre-fix code silently substituted facts.length as the total, suppressing elementsTruncated and over-claiming exhaustive enumeration', async () => {
  const dir = freshSnapDir('media-total-count-unavailable');
  const facts = Array.from({ length: 200 }, (_, i) => ({ ...MEDIA_FACT_IMG, cssPath: `img:nth-of-type(${i + 1})` }));
  try {
    class BadTotalMediaStub {
      async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
        if (method === 'Runtime.evaluate') {
          const expression = String((params as { expression?: unknown }).expression ?? '');
          if (expression.includes('__captureMediaInventory')) return { result: { value: facts } };
          // The companion total-count read: real CDP would return a number here. Simulate the
          // failure mode described in the finding -- a present but non-numeric `value` (also
          // covers the `value: undefined` case, since both fail `typeof === 'number'`).
          if (expression.includes('__captureMediaTotal')) return { result: { value: 'NaN' } };
          return { result: {} };
        }
        if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
        return {};
      }
    }
    const ctx = makeCtx(new BadTotalMediaStub() as unknown as StubCdpClient, dir);
    await collectMedia(ctx);

    const media = readJson(path.join(dir, 'media.json'));
    assert.equal(media.available, true, 'the primary MEDIA_SCRIPT inventory read itself succeeded -- this failure is isolated to the companion total-count read');
    assert.equal(media.elements.length, 200, 'expected all 200 kept (capped) element records to still be emitted');
    assert.deepEqual(
      media.totalCount,
      { available: false, reason: 'media-total-evaluate-returned-non-number' },
      'expected an explicit totalCount:unavailable fact when MEDIA_TOTAL_SCRIPT returns a non-number -- old code had no totalCount field at all and silently assumed total === facts.length',
    );
    assert.equal(
      media.elementsTruncated,
      undefined,
      'elementsTruncated must be absent (unknown), not a value implying "no truncation" derived from the failed total read',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// Direct unit tests — pure helpers, no CDP stubbing needed
// ============================================================================

test('computeSpecificity: two class selectors -> "0-2-0"', () => {
  const spec = computeSpecificity('.chat .message-card');
  assert.deepEqual(spec, { a: 0, b: 2, c: 0 });
});

test('computeSpecificity: type + class + pseudo-class -> "0-2-1"', () => {
  const spec = computeSpecificity('button.primary:hover');
  assert.deepEqual(spec, { a: 0, b: 2, c: 1 });
});

test('computeSpecificity: id selector -> a=1', () => {
  const spec = computeSpecificity('#header .nav-item');
  assert.deepEqual(spec, { a: 1, b: 1, c: 0 });
});

test('computeObjectFitCrop: cover with default centered position', () => {
  const crop = computeObjectFitCrop({ w: 1600, h: 900 }, { w: 400, h: 300 }, 'cover', '50% 50%');
  assert.ok(crop && crop.mode === 'cover');
  if (crop && crop.mode === 'cover') {
    assert.ok(Math.abs(crop.croppedLeftPx - 200) < 1);
    assert.ok(Math.abs(crop.croppedRightPx - 200) < 1);
    assert.ok(Math.abs(crop.croppedTopPx - 0) < 1);
    assert.ok(Math.abs(crop.croppedBottomPx - 0) < 1);
  }
});

test('computeObjectFitCrop: contain letterboxes/pillarboxes symmetrically at center (exact hand-computed values)', () => {
  const crop = computeObjectFitCrop({ w: 1280, h: 720 }, { w: 390, h: 720 }, 'contain', '50% 50%');
  assert.ok(crop && crop.mode === 'contain');
  // Hand-computed: scale = min(390/1280, 720/720) = 0.3046875 (width-bound).
  // scaledW = 390, scaledH = 219.375. padW = 0, padH = 500.625.
  // Centered (50%/50%) splits the vertical pad evenly; there's no horizontal pad to split.
  if (crop && crop.mode === 'contain') {
    assert.equal(crop.letterboxTopPx, 250.31);
    assert.equal(crop.letterboxBottomPx, 250.31);
    assert.equal(crop.pillarboxLeftPx, 0);
    assert.equal(crop.pillarboxRightPx, 0);
  }
});

test('computeObjectFitCrop: cover with a single bare keyword defaults the OTHER axis to 50% (axis-aware, not positional)', () => {
  // A single keyword ('left') sets only the horizontal axis; the old positional parser ignored a
  // single-token value entirely and defaulted both axes to 50%, which would wrongly center-crop here.
  const crop = computeObjectFitCrop({ w: 300, h: 100 }, { w: 100, h: 100 }, 'cover', 'left');
  assert.ok(crop && crop.mode === 'cover');
  if (crop && crop.mode === 'cover') {
    assert.equal(crop.croppedLeftPx, 0);
    assert.equal(crop.croppedRightPx, 200);
    assert.equal(crop.croppedTopPx, 0);
    assert.equal(crop.croppedBottomPx, 0);
  }
});

test('computeObjectFitCrop: cover with "bottom left" assigns each keyword to its OWN axis regardless of token order', () => {
  // The old positional parser mapped tokens by position (1st -> x, 2nd -> y) even after keyword
  // substitution, so 'bottom left' -> ['100%', '0%'] -> posX=100 posY=0, which is backwards: 'bottom'
  // must always set the vertical axis and 'left' the horizontal axis, no matter which comes first.
  const crop = computeObjectFitCrop({ w: 100, h: 300 }, { w: 100, h: 100 }, 'cover', 'bottom left');
  assert.ok(crop && crop.mode === 'cover');
  if (crop && crop.mode === 'cover') {
    assert.equal(crop.croppedLeftPx, 0);
    assert.equal(crop.croppedRightPx, 0);
    assert.equal(crop.croppedTopPx, 200, 'bottom must crop from the top, not the bottom, when the image overflows vertically');
    assert.equal(crop.croppedBottomPx, 0);
  }
});

test('computeObjectFitCrop: scale-down behaves like contain when the natural size exceeds the rendered box', () => {
  const crop = computeObjectFitCrop({ w: 1000, h: 1000 }, { w: 200, h: 100 }, 'scale-down', '50% 50%');
  assert.ok(crop && crop.mode === 'contain');
  if (crop && crop.mode === 'contain') {
    assert.equal(crop.letterboxTopPx, 0);
    assert.equal(crop.letterboxBottomPx, 0);
    assert.equal(crop.pillarboxLeftPx, 50);
    assert.equal(crop.pillarboxRightPx, 50);
  }
});

test('computeObjectFitCrop: scale-down behaves like none when the natural size already fits the rendered box', () => {
  const crop = computeObjectFitCrop({ w: 100, h: 50 }, { w: 200, h: 100 }, 'scale-down', '50% 50%');
  assert.ok(crop && crop.mode === 'none');
});

test('computeObjectFitCrop: returns null when natural dimensions are unknown', () => {
  const crop = computeObjectFitCrop(null, { w: 400, h: 300 }, 'cover', '50% 50%');
  assert.equal(crop, null);
});

test('computeObjectFitCrop: fill reports distortion when aspect ratios diverge', () => {
  const crop = computeObjectFitCrop({ w: 100, h: 100 }, { w: 200, h: 100 }, 'fill', '50% 50%');
  assert.ok(crop && crop.mode === 'fill');
  if (crop && crop.mode === 'fill') {
    assert.equal(crop.distorted, true);
  }
});
