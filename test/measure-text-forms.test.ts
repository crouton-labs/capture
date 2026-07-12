import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { closeChrome, spawnHeadlessChrome } from './fixtures/chrome.js';

import { CAPTURE_ROOT, ensurePrivateDir, writeJsonPrivate } from '../src/session/artifacts.js';
import { CDPClient } from '../src/cdp/client.js';
import { enableDomainsForSnap } from '../src/cdp/domains.js';
import type { SnapshotContext, SnapshotWriter } from '../src/cdp/measure/types.js';
import { collectText } from '../src/cdp/measure/collectors/text.js';
import { collectForms } from '../src/cdp/measure/collectors/forms.js';

// A fake JWT-shaped token — three dot-separated segments, each >=10 chars
// of `[A-Za-z0-9_-]`. Used to prove a PLAIN (non-form, non-password) text
// element carrying a secret-shaped run gets redacted in `text.json`.
const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
const RAW_PASSWORD = 'hunter2super';

// ============================================================================
// Adversarial sentinels — three distinct secret shapes, planted (mid-prose
// AND punctuation-delimited) into every page-controlled output field this
// module owns. Distinct from FAKE_JWT above so a failing assertion here
// can't be masked by a coincidental match against the happy-path fixtures.
// ============================================================================
const SK_SENTINEL = 'sk-ADVSK1111aaaaBBBBccccDDDDeeeeFFFF';
const JWT_SENTINEL = 'eyJhbGciOiJBRFYiLCJ0eXAiOiJKV1QifQ.eyJhZHZlcnNhcmlhbCI6InNlbnRpbmVsIn0.QURWX0pXVF9TSUdOQVRVUkVfU0VOVElORUw';
const GH_PAT_SENTINEL = 'github_pat_ADVPATaaaa1111BBBBcccc2222DDDDeeee3333FFFFgggg4444';

/**
 * Stands in for `CDPClient` — no real Chrome, no real websocket. `send`
 * models the CDP-only identity bridge `text.ts`/`forms.ts` now use in
 * place of the old page-observable `window.__captureTextEls`/
 * `__captureFormEls` global: the walk's `Runtime.evaluate({returnByValue:
 * false})` returns an `objectId` for its held `{ facts, elements }`
 * return value (`TEXT_RESULT_OBJECT_ID`/`FORMS_RESULT_OBJECT_ID` here);
 * `Runtime.getProperties` on that id resolves `facts`'/`elements`'s own
 * `objectId`s; `Runtime.callFunctionOn({returnByValue:true})` on the
 * `facts` id reads the by-value records/coverage counts back out;
 * `Runtime.getProperties` on the `elements` id resolves each matched
 * element's own `objectId` (exactly like the real bridge's per-index
 * resolution); and `Runtime.releaseObject` frees every held id — see
 * `geometry.ts`'s module doc for the shared (non-stubbed) primitives this
 * mirrors.
 *
 * `objectIdsByIndex` maps a walk record's ARRAY INDEX (the same index the
 * real held `elements` array holds that element at) to a fake `objectId`
 * string; an index NOT present is left unresolved, exactly like a real
 * element CDP couldn't bridge. `describeNodeByObjectId` then maps that
 * fake `objectId` to the `DOM.describeNode` result (`nodeId`/
 * `backendNodeId`) it should resolve to.
 */
const TEXT_RESULT_OBJECT_ID = 'text-result-obj';
const TEXT_FACTS_OBJECT_ID = 'text-facts-obj';
const TEXT_ELEMENTS_OBJECT_ID = 'text-elements-obj';
const FORMS_RESULT_OBJECT_ID = 'forms-result-obj';
const FORMS_FACTS_OBJECT_ID = 'forms-facts-obj';
const FORMS_ELEMENTS_OBJECT_ID = 'forms-elements-obj';

class StubCdpClient {
  calls: Array<{ method: string; params?: Record<string, unknown> }> = [];

  constructor(
    private readonly opts: {
      textRecords?: unknown[];
      formRecords?: unknown[];
      objectIdsByIndex?: Record<number, string>;
      describeNodeByObjectId?: Record<string, { nodeId?: number; backendNodeId?: number }>;
      platformFontsByNodeId?: Map<number, { fonts: Array<{ familyName: string; isCustomFont: boolean }> }>;
      iframesNotWalked?: number;
      shadowRootsNotWalked?: number;
      elementsTotal?: number;
      controlsTotal?: number;
      // When set, every Runtime.releaseObject call for that collector's held
      // object ids throws — exercises the unconditional-release /
      // `bridgeCleanupFailed` fact.
      throwOnTextCleanup?: boolean;
      throwOnFormCleanup?: boolean;
    } = {},
  ) {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });

    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      // The walk itself: `returnByValue:false` now hands back only an
      // `objectId` for the held `{ facts, elements }` return value — never a
      // by-value result, and never a page-observable global.
      if (expression.includes('MAX_ELEMENTS')) {
        return { result: { objectId: TEXT_RESULT_OBJECT_ID } };
      }
      if (expression.includes('MAX_CONTROLS')) {
        return { result: { objectId: FORMS_RESULT_OBJECT_ID } };
      }
      return { result: {} };
    }

    if (method === 'Runtime.getProperties') {
      const objectId = (params as { objectId?: string }).objectId;
      if (objectId === TEXT_RESULT_OBJECT_ID) {
        return {
          result: [
            { name: 'facts', value: { objectId: TEXT_FACTS_OBJECT_ID } },
            { name: 'elements', value: { objectId: TEXT_ELEMENTS_OBJECT_ID } },
          ],
        };
      }
      if (objectId === FORMS_RESULT_OBJECT_ID) {
        return {
          result: [
            { name: 'facts', value: { objectId: FORMS_FACTS_OBJECT_ID } },
            { name: 'elements', value: { objectId: FORMS_ELEMENTS_OBJECT_ID } },
          ],
        };
      }
      if (objectId === TEXT_ELEMENTS_OBJECT_ID || objectId === FORMS_ELEMENTS_OBJECT_ID) {
        const map = this.opts.objectIdsByIndex ?? {};
        const result = Object.entries(map).map(([idx, id]) => ({ name: idx, value: { objectId: id } }));
        return { result };
      }
      return { result: [] };
    }

    if (method === 'Runtime.callFunctionOn') {
      const objectId = (params as { objectId?: string }).objectId;
      if (objectId === TEXT_FACTS_OBJECT_ID) {
        return {
          result: {
            value: {
              records: this.opts.textRecords ?? [],
              iframesNotWalked: this.opts.iframesNotWalked ?? 0,
              shadowRootsNotWalked: this.opts.shadowRootsNotWalked ?? 0,
              elementsTotal: this.opts.elementsTotal ?? (this.opts.textRecords ?? []).length,
            },
          },
        };
      }
      if (objectId === FORMS_FACTS_OBJECT_ID) {
        return {
          result: {
            value: {
              records: this.opts.formRecords ?? [],
              iframesNotWalked: this.opts.iframesNotWalked ?? 0,
              shadowRootsNotWalked: this.opts.shadowRootsNotWalked ?? 0,
              controlsTotal: this.opts.controlsTotal ?? (this.opts.formRecords ?? []).length,
            },
          },
        };
      }
      return { result: {} };
    }

    if (method === 'Runtime.releaseObject') {
      const objectId = (params as { objectId?: string }).objectId ?? '';
      if (this.opts.throwOnTextCleanup && objectId.startsWith('text-')) {
        throw new Error('text release object failed');
      }
      if (this.opts.throwOnFormCleanup && objectId.startsWith('forms-')) {
        throw new Error('forms release object failed');
      }
      return {};
    }

    if (method === 'DOM.describeNode') {
      const objectId = (params as { objectId?: string }).objectId;
      const entry = objectId !== undefined ? this.opts.describeNodeByObjectId?.[objectId] : undefined;
      return { node: entry ?? {} };
    }

    if (method === 'CSS.getPlatformFontsForNode') {
      const nodeId = (params as { nodeId?: number }).nodeId;
      const entry = nodeId !== undefined ? this.opts.platformFontsByNodeId?.get(nodeId) : undefined;
      return entry ?? {};
    }

    return {};
  }
}

/** Same seam `test/snapshot-settledness.test.ts` uses: `text.ts`/`forms.ts` declare `ctx.client` as the concrete `CDPClient` class, so a plain stub needs an `as unknown as CDPClient` cast. Both collectors only ever call `.send()` on it. */
function asClient(stub: StubCdpClient): CDPClient {
  return stub as unknown as CDPClient;
}

function freshSnapDir(label: string): string {
  return path.join(CAPTURE_ROOT, `measure-text-forms-test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

/** Builds a real `SnapshotWriter` backed by the U03 secure-fs helpers (same primitives `snapshot.ts`'s `makeWriter` uses), scoped to `dir`, so these tests exercise the real `SnapshotWriter` write path rather than an in-memory stand-in. */
function makeWriter(dir: string): SnapshotWriter {
  return {
    json(filename: string, value: unknown): void {
      writeJsonPrivate(path.join(dir, filename), value);
    },
    binary(filename: string, data: Buffer): void {
      fs.writeFileSync(path.join(dir, filename), data);
    },
  };
}

function buildContext(client: StubCdpClient, dir: string): SnapshotContext {
  return {
    client: asClient(client),
    dir,
    snapId: path.basename(dir),
    url: 'http://example.test',
    viewport: null,
    settled: true,
    freezeAnimations: false,
    captureUnsettled: false,
    pixels: false,
    state: [],
    unstableRegions: [],
    write: makeWriter(dir),
  };
}

function readJson(dir: string, filename: string): any {
  return JSON.parse(fs.readFileSync(path.join(dir, filename), 'utf-8'));
}

function rawJson(dir: string, filename: string): string {
  return fs.readFileSync(path.join(dir, filename), 'utf-8');
}

// ============================================================================
// collectText
// ============================================================================

const WRAPPED_TEXT_RECORD = {
  markId: 'txt-0',
  selector: '.wrapped-text',
  text: 'Hello wrapped world',
  lines: [
    { x: 0, y: 0, width: 120, height: 16, baseline: 12.5 },
    { x: 0, y: 16, width: 60, height: 16, baseline: 28.5 },
  ],
  wrapOffsets: [11],
  writingMode: 'horizontal-tb',
  direction: 'ltr',
  bidiOrder: 'ltr',
  fontFamily: 'CustomFont, sans-serif',
  fontSize: '14px',
  fontWeight: '400',
  lineHeight: '20px',
  isContentEditable: false,
  truncated: false,
  truncationStyle: 'none',
  scrollWidth: 120,
  clientWidth: 120,
};

const TRUNCATED_TEXT_RECORD = {
  markId: 'txt-1',
  selector: '.truncated-text',
  text: 'This is a very long truncated string that overflows',
  lines: [{ x: 0, y: 0, width: 100, height: 16, baseline: 12.0 }],
  wrapOffsets: [],
  writingMode: 'horizontal-tb',
  direction: 'ltr',
  bidiOrder: 'ltr',
  fontFamily: 'Arial, sans-serif',
  fontSize: '14px',
  fontWeight: '400',
  lineHeight: '20px',
  isContentEditable: false,
  truncated: true,
  truncationStyle: 'ellipsis',
  scrollWidth: 500,
  clientWidth: 100,
};

const TOKEN_TEXT_RECORD = {
  markId: 'txt-2',
  selector: '.token-display',
  text: FAKE_JWT,
  lines: [{ x: 0, y: 0, width: 300, height: 16, baseline: 12.0 }],
  wrapOffsets: [],
  writingMode: 'horizontal-tb',
  direction: 'ltr',
  bidiOrder: 'ltr',
  fontFamily: 'monospace',
  fontSize: '12px',
  fontWeight: '400',
  lineHeight: '18px',
  isContentEditable: false,
  truncated: false,
  truncationStyle: 'none',
  scrollWidth: 300,
  clientWidth: 300,
};

// Index 0 (WRAPPED_TEXT_RECORD, in every fixture array below) is the one
// element the stub resolves an objectId for via the object-id bridge — the
// only element in these fixtures whose identity (nodeId/backendNodeId) is
// resolvable; every other record is left unresolved on purpose.
const RESOLVES_INDEX_0 = {
  objectIdsByIndex: { 0: 'obj-0' },
  describeNodeByObjectId: { 'obj-0': { nodeId: 501, backendNodeId: 9001 } },
};

test('collectText: wrapped text lines carry wrapAfterChar from the fixture wrapOffsets', async () => {
  const dir = freshSnapDir('text-wrapped');
  ensurePrivateDir(dir);
  try {
    const client = new StubCdpClient({
      textRecords: [WRAPPED_TEXT_RECORD, TRUNCATED_TEXT_RECORD, TOKEN_TEXT_RECORD],
      ...RESOLVES_INDEX_0,
      // keyed by the DOM.describeNode-resolved `nodeId` (501), not backendNodeId (9001) — collectText calls CSS.getPlatformFontsForNode({nodeId}).
      platformFontsByNodeId: new Map([[501, { fonts: [{ familyName: 'Arial', isCustomFont: false }] }]]),
    });
    await collectText(buildContext(client, dir));

    const written = readJson(dir, 'text.json');
    const wrapped = written.elements.find((e: any) => e.id === 'txt-0');
    assert.ok(wrapped, 'expected the wrapped-text element to be present');
    assert.equal(wrapped.lines.length, 2);
    assert.equal(wrapped.lines[0].wrapAfterChar, 11);
    assert.equal(wrapped.lines[1].wrapAfterChar, undefined);
    // baseline passes through unchanged.
    assert.equal(wrapped.lines[0].baseline, 12.5);
    assert.equal(wrapped.lines[1].baseline, 28.5);
    // backendNodeId resolves via the object-id bridge for the one resolved element.
    assert.equal(wrapped.backendNodeId, 9001);
    // platform-font fallback: Arial doesn't appear in "CustomFont, sans-serif".
    assert.equal(wrapped.fallbackUsed, true);
    assert.deepEqual(wrapped.platformFonts, [{ familyName: 'Arial', isCustomFont: false }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectText: truncated text facts (truncated, truncationStyle, scroll/client width) pass through', async () => {
  const dir = freshSnapDir('text-truncated');
  ensurePrivateDir(dir);
  try {
    const client = new StubCdpClient({
      textRecords: [WRAPPED_TEXT_RECORD, TRUNCATED_TEXT_RECORD, TOKEN_TEXT_RECORD],
      ...RESOLVES_INDEX_0,
    });
    await collectText(buildContext(client, dir));

    const written = readJson(dir, 'text.json');
    const truncated = written.elements.find((e: any) => e.id === 'txt-1');
    assert.ok(truncated);
    assert.equal(truncated.truncated, true);
    assert.equal(truncated.truncationStyle, 'ellipsis');
    assert.equal(truncated.scrollWidth, 500);
    assert.equal(truncated.clientWidth, 100);
    // Not a resolved element (only index 0 resolves): backendNodeId is an explicit
    // null + identityUnresolved:true (I-3/I-5 honesty fix), never a silently omitted key.
    assert.equal(truncated.backendNodeId, null);
    assert.equal(truncated.identityUnresolved, true);
    // No resolved node → no platform-fonts lookup was ever made. `fallbackUsed`
    // is `null` (never `false`) so a read that never happened can't be
    // mistaken for a genuine "no fallback" observation (I-4/I-5 honesty fix).
    assert.equal(truncated.platformFontsAvailable, false);
    assert.equal(truncated.platformFontsUnavailableReason, 'platform-fonts-node-id-unresolved');
    assert.equal(truncated.fallbackUsed, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectText: a JWT-shaped run on a PLAIN text element is redacted and the raw token never appears in text.json', async () => {
  const dir = freshSnapDir('text-token');
  ensurePrivateDir(dir);
  try {
    const client = new StubCdpClient({
      textRecords: [WRAPPED_TEXT_RECORD, TRUNCATED_TEXT_RECORD, TOKEN_TEXT_RECORD],
      ...RESOLVES_INDEX_0,
    });
    await collectText(buildContext(client, dir));

    const written = readJson(dir, 'text.json');
    const token = written.elements.find((e: any) => e.id === 'txt-2');
    assert.ok(token);
    assert.equal(token.redacted, true);
    assert.equal(token.redactionReason, 'secret-shaped-value');
    assert.equal(token.text, undefined);
    assert.equal(token.textLength, FAKE_JWT.length);

    const rawFileText = rawJson(dir, 'text.json');
    assert.ok(!rawFileText.includes(FAKE_JWT), 'raw JWT-shaped token must never appear in text.json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectText: an unresolved object-id bridge does not crash and honestly marks backendNodeId:null + identityUnresolved:true for every element (I-3/I-5 — never a silently omitted field)', async () => {
  const dir = freshSnapDir('text-no-bridge');
  ensurePrivateDir(dir);
  try {
    const client = new StubCdpClient({
      textRecords: [WRAPPED_TEXT_RECORD],
      // No objectIdsByIndex at all — nothing resolves, exactly like CDP
      // being unable to bridge any element.
    });
    await collectText(buildContext(client, dir));

    const written = readJson(dir, 'text.json');
    assert.equal(written.elements.length, 1);
    assert.equal(written.elements[0].backendNodeId, null, 'unresolved identity must be an explicit null, never an omitted key');
    assert.equal(written.elements[0].identityUnresolved, true, 'unresolved identity must carry the explicit identityUnresolved marker');
    assert.equal(written.elements[0].id, 'txt-0');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// collectText — adversarial: internal-delimiter embeddings across text and
// page-controlled strings, plus writingMode/direction allowlist normalization
// and platform-font family-name sanitization.
// ============================================================================

const TEXT_LEAK_RECORD = {
  markId: 'txt-leak-query',
  selector: `#${JWT_SENTINEL}`,
  text: `?token=${SK_SENTINEL}&x=1`,
  lines: [{ x: 0, y: 0, width: 200, height: 16, baseline: 12 }],
  wrapOffsets: [],
  writingMode: `evil-${GH_PAT_SENTINEL}`,
  direction: `weird-${GH_PAT_SENTINEL}`,
  bidiOrder: 'ltr',
  fontFamily: `WebFont-${GH_PAT_SENTINEL}, sans-serif`,
  fontSize: SK_SENTINEL,
  fontWeight: `700 ${SK_SENTINEL} ${'bold '.repeat(500)}`,
  lineHeight: `20px ${SK_SENTINEL}:`,
  isContentEditable: false,
  truncated: false,
  truncationStyle: 'none',
  scrollWidth: 200,
  clientWidth: 200,
};

const TEXT_LEAK_EQ_RECORD = {
  ...TEXT_LEAK_RECORD,
  markId: 'txt-leak-eq',
  selector: '.text-leak-eq',
  text: `token=${SK_SENTINEL}`,
  writingMode: 'horizontal-tb',
  direction: 'ltr',
  fontFamily: 'System UI',
  fontSize: '14px',
  fontWeight: '400',
  lineHeight: '20px',
};

const TEXT_LEAK_COLON_RECORD = {
  ...TEXT_LEAK_RECORD,
  markId: 'txt-leak-colon',
  selector: '.text-leak-colon',
  text: `token:${SK_SENTINEL}`,
  writingMode: 'horizontal-tb',
  direction: 'ltr',
  fontFamily: 'System UI',
  fontSize: '14px',
  fontWeight: '400',
  lineHeight: '20px',
};

const TEXT_LEAK_PAREN_RECORD = {
  ...TEXT_LEAK_RECORD,
  markId: 'txt-leak-paren',
  selector: '.text-leak-paren',
  text: `key(${SK_SENTINEL})`,
  writingMode: 'horizontal-tb',
  direction: 'ltr',
  fontFamily: 'System UI',
  fontSize: '14px',
  fontWeight: '400',
  lineHeight: '20px',
};

test('collectText: sentinels embedded across text/selector/font/writingMode/direction never appear raw in text.json', async () => {
  const dir = freshSnapDir('text-leak');
  ensurePrivateDir(dir);
  try {
    // TEXT_LEAK_RECORD is last (index 3) in this fixture array — resolve
    // that index, since only the query record needs a resolved identity
    // (nodeId/backendNodeId) for these assertions.
    const client = new StubCdpClient({
      textRecords: [TEXT_LEAK_EQ_RECORD, TEXT_LEAK_COLON_RECORD, TEXT_LEAK_PAREN_RECORD, TEXT_LEAK_RECORD],
      objectIdsByIndex: { 3: 'obj-3' },
      describeNodeByObjectId: { 'obj-3': { nodeId: 501, backendNodeId: 9001 } },
      platformFontsByNodeId: new Map([
        [501, { fonts: [{ familyName: `WebFont-${GH_PAT_SENTINEL}`, isCustomFont: false }] }],
      ]),
    });
    await collectText(buildContext(client, dir));

    const written = readJson(dir, 'text.json');
    const eq = written.elements.find((e: any) => e.id === 'txt-leak-eq');
    assert.ok(eq);
    assert.equal(eq.redacted, false);
    assert.equal(eq.text, 'token=[REDACTED]');

    const colon = written.elements.find((e: any) => e.id === 'txt-leak-colon');
    assert.ok(colon);
    assert.equal(colon.redacted, false);
    assert.equal(colon.text, 'token:[REDACTED]');

    const paren = written.elements.find((e: any) => e.id === 'txt-leak-paren');
    assert.ok(paren);
    assert.equal(paren.redacted, false);
    assert.equal(paren.text, 'key([REDACTED])');

    const query = written.elements.find((e: any) => e.id === 'txt-leak-query');
    assert.ok(query);
    assert.equal(query.redacted, false);
    assert.equal(query.text, '?token=[REDACTED]&x=1');
    assert.equal(query.selector, '#[REDACTED]');
    assert.equal(query.writingMode, 'unknown');
    assert.equal(query.direction, 'unknown');
    assert.equal(query.font.family, 'WebFont-[REDACTED], sans-serif');
    assert.equal(query.font.size, '[REDACTED]');
    assert.ok(query.font.weight.includes('[REDACTED]'));
    assert.ok(query.font.weight.length <= 2000);
    assert.equal(query.font.lineHeight, '20px [REDACTED]:');
    assert.deepEqual(query.platformFonts, [{ familyName: 'WebFont-[REDACTED]', isCustomFont: false }]);

    const raw = rawJson(dir, 'text.json');
    assert.ok(!raw.includes(SK_SENTINEL), 'sk- sentinel must never appear raw in text.json');
    assert.ok(!raw.includes(JWT_SENTINEL), 'JWT sentinel must never appear raw in text.json');
    assert.ok(!raw.includes(GH_PAT_SENTINEL), 'github_pat_ sentinel must never appear raw in text.json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectText: a recognized writingMode/direction pair passes through unchanged', async () => {
  const dir = freshSnapDir('text-enum-ok');
  ensurePrivateDir(dir);
  try {
    const record = { ...TEXT_LEAK_RECORD, markId: 'txt-enum-ok', writingMode: 'vertical-rl', direction: 'rtl' };
    const client = new StubCdpClient({ textRecords: [record] });
    await collectText(buildContext(client, dir));

    const written = readJson(dir, 'text.json');
    const rec = written.elements.find((e: any) => e.id === 'txt-enum-ok');
    assert.equal(rec.writingMode, 'vertical-rl');
    assert.equal(rec.direction, 'rtl');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectText: an over-length selector and font.family are bounded at MAX_VALUE_LENGTH (2000)', async () => {
  const dir = freshSnapDir('text-long-fields');
  ensurePrivateDir(dir);
  try {
    const longSelector = '.' + 'a'.repeat(2500);
    const longFamily = 'Font-' + 'b '.repeat(1200); // spaced so it isn't treated as one secret-shaped run
    const record = {
      ...TEXT_LEAK_RECORD,
      markId: 'txt-long',
      selector: longSelector,
      fontFamily: longFamily,
      text: 'ordinary short text',
      writingMode: 'horizontal-tb',
      direction: 'ltr',
      lineHeight: '20px',
    };
    const client = new StubCdpClient({ textRecords: [record] });
    await collectText(buildContext(client, dir));

    const written = readJson(dir, 'text.json');
    const rec = written.elements.find((e: any) => e.id === 'txt-long');
    assert.ok(rec.selector.length <= 2000, `selector length ${rec.selector.length} must be bounded`);
    assert.ok(rec.font.family.length <= 2000, `font.family length ${rec.font.family.length} must be bounded`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// collectForms
// ============================================================================

const PASSWORD_RECORD = {
  markId: 'form-0',
  selector: '#pw',
  tagName: 'input',
  type: 'password',
  value: RAW_PASSWORD,
  valuePlaceholder: null,
  selectionStart: null,
  selectionEnd: null,
  scrollLeft: 0,
  scrollTop: 0,
  clientWidth: 120,
  clientHeight: 20,
  scrollWidth: 120,
  scrollHeight: 20,
  disabled: false,
  readOnly: false,
  required: true,
  pattern: null,
  checked: null,
  multiple: false,
  validity: {
    valid: false,
    valueMissing: false,
    typeMismatch: false,
    patternMismatch: false,
    tooLong: false,
    tooShort: true,
    rangeUnderflow: false,
    rangeOverflow: false,
    stepMismatch: false,
    badInput: false,
    customError: false,
    message: 'Password too short',
  },
  label: null,
  autofilled: false,
  pseudoState: {
    focused: true,
    hovered: false,
    active: false,
    checked: null,
    disabled: false,
    readOnly: false,
    invalid: true,
    focusVisible: true,
  },
  rect: { x: 0, y: 0, width: 120, height: 20 },
  valueLines: [{ x: 0, y: 0, width: 100, height: 16 }],
  placeholderLines: [],
  caretRect: null,
  selectionRects: [],
  visibleRange: { start: 0, end: RAW_PASSWORD.length },
  isContentEditable: false,
  autocomplete: 'current-password',
  name: 'pw',
  id: 'pw',
};

const AUTOFILLED_ADDRESS_RECORD = {
  markId: 'form-1',
  selector: '#addr',
  tagName: 'input',
  type: 'text',
  value: '123 Main Street',
  valuePlaceholder: null,
  selectionStart: 0,
  selectionEnd: 0,
  scrollLeft: 0,
  scrollTop: 0,
  clientWidth: 200,
  clientHeight: 20,
  scrollWidth: 200,
  scrollHeight: 20,
  disabled: false,
  readOnly: false,
  required: false,
  pattern: null,
  checked: null,
  multiple: false,
  validity: null,
  label: null,
  autofilled: true,
  pseudoState: {
    focused: false,
    hovered: false,
    active: false,
    checked: null,
    disabled: false,
    readOnly: false,
    invalid: false,
    focusVisible: false,
  },
  rect: { x: 0, y: 24, width: 200, height: 20 },
  valueLines: [{ x: 0, y: 24, width: 90, height: 16 }],
  placeholderLines: [],
  caretRect: null,
  selectionRects: [],
  visibleRange: { start: 0, end: 16 },
  isContentEditable: false,
  autocomplete: 'street-address',
  name: 'address',
  id: 'addr',
};

const CARET_SEARCH_RECORD = {
  markId: 'form-2',
  selector: '#search',
  tagName: 'input',
  type: 'text',
  value: 'search term',
  valuePlaceholder: null,
  selectionStart: 5,
  selectionEnd: 5,
  scrollLeft: 0,
  scrollTop: 0,
  clientWidth: 150,
  clientHeight: 20,
  scrollWidth: 150,
  scrollHeight: 20,
  disabled: false,
  readOnly: false,
  required: false,
  pattern: null,
  checked: null,
  multiple: false,
  validity: null,
  label: null,
  autofilled: false,
  pseudoState: {
    focused: true,
    hovered: true,
    active: false,
    checked: null,
    disabled: false,
    readOnly: false,
    invalid: false,
    focusVisible: true,
  },
  rect: { x: 0, y: 48, width: 150, height: 20 },
  valueLines: [{ x: 0, y: 48, width: 70, height: 16 }],
  placeholderLines: [],
  caretRect: { x: 32, y: 50, width: 1, height: 14 },
  selectionRects: [],
  visibleRange: { start: 0, end: 11 },
  isContentEditable: false,
  autocomplete: 'off',
  name: 'q',
  id: 'search',
};

// Index 0 (PASSWORD_RECORD, in every fixture array below) is the one
// control the stub resolves an objectId for.
const FORMS_RESOLVES_INDEX_0 = {
  objectIdsByIndex: { 0: 'obj-0' },
  describeNodeByObjectId: { 'obj-0': { backendNodeId: 9101 } },
};

test('collectForms: password field — the load-bearing redaction assertion', async () => {
  const dir = freshSnapDir('forms-password');
  ensurePrivateDir(dir);
  try {
    const client = new StubCdpClient({
      formRecords: [PASSWORD_RECORD, AUTOFILLED_ADDRESS_RECORD, CARET_SEARCH_RECORD],
      ...FORMS_RESOLVES_INDEX_0,
    });
    await collectForms(buildContext(client, dir));

    const written = readJson(dir, 'forms.json');
    const pw = written.controls.find((c: any) => c.id === 'form-0');
    assert.ok(pw);
    assert.equal(pw.value, undefined);
    assert.equal(pw.text, undefined);
    assert.equal(pw.valueLength, RAW_PASSWORD.length);
    assert.equal(pw.valueLength, 12);
    assert.equal(pw.redacted, true);
    assert.equal(pw.redactionReason, 'password-field');
    assert.equal(pw.backendNodeId, 9101);
    // validity message survives (it's not itself the secret) but is
    // still run through redactSecretSubstrings/capString.
    assert.equal(pw.validity.message, 'Password too short');

    const rawFileText = rawJson(dir, 'forms.json');
    assert.ok(!rawFileText.includes(RAW_PASSWORD), 'raw password must never appear anywhere in forms.json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: an autofilled non-password value is redacted with reason autofilled, raw absent', async () => {
  const dir = freshSnapDir('forms-autofill');
  ensurePrivateDir(dir);
  try {
    const client = new StubCdpClient({
      formRecords: [PASSWORD_RECORD, AUTOFILLED_ADDRESS_RECORD, CARET_SEARCH_RECORD],
      ...FORMS_RESOLVES_INDEX_0,
    });
    await collectForms(buildContext(client, dir));

    const written = readJson(dir, 'forms.json');
    const addr = written.controls.find((c: any) => c.id === 'form-1');
    assert.ok(addr);
    assert.equal(addr.redacted, true);
    assert.equal(addr.redactionReason, 'autofilled');
    assert.equal(addr.value, undefined);
    assert.equal(addr.text, undefined);
    assert.equal(addr.valueLength, '123 Main Street'.length);

    // pseudoState passes through unchanged.
    assert.deepEqual(addr.pseudoState, AUTOFILLED_ADDRESS_RECORD.pseudoState);
    // autofill fact surfaces too.
    assert.deepEqual(addr.autofill, { isAutofilled: true });
    // nativePartDimensions is always the honest-empty-default object.
    assert.deepEqual(addr.nativePartDimensions, {});

    const rawFileText = rawJson(dir, 'forms.json');
    assert.ok(!rawFileText.includes('123 Main Street'), 'raw autofilled value must never appear in forms.json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: selection/caret data and dimensions pass through for a non-redacted control', async () => {
  const dir = freshSnapDir('forms-caret');
  ensurePrivateDir(dir);
  try {
    const client = new StubCdpClient({
      formRecords: [PASSWORD_RECORD, AUTOFILLED_ADDRESS_RECORD, CARET_SEARCH_RECORD],
      ...FORMS_RESOLVES_INDEX_0,
    });
    await collectForms(buildContext(client, dir));

    const written = readJson(dir, 'forms.json');
    const search = written.controls.find((c: any) => c.id === 'form-2');
    assert.ok(search);
    assert.equal(search.redacted, false);
    assert.equal(search.value, 'search term');
    assert.equal(search.selectionStart, 5);
    assert.equal(search.selectionEnd, 5);
    assert.deepEqual(search.caretRect, { x: 32, y: 50, width: 1, height: 14 });
    assert.deepEqual(search.valueLineBoxes, CARET_SEARCH_RECORD.valueLines);
    assert.deepEqual(search.dimensions, {
      clientWidth: 150,
      clientHeight: 20,
      scrollWidth: 150,
      scrollHeight: 20,
    });
    assert.deepEqual(search.nativePartDimensions, {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: an unresolved object-id bridge does not crash and honestly marks backendNodeId:null + identityUnresolved:true (I-3/I-5 — never a silently omitted field)', async () => {
  const dir = freshSnapDir('forms-no-bridge');
  ensurePrivateDir(dir);
  try {
    const client = new StubCdpClient({ formRecords: [CARET_SEARCH_RECORD] });
    await collectForms(buildContext(client, dir));

    const written = readJson(dir, 'forms.json');
    assert.equal(written.controls.length, 1);
    assert.equal(written.controls[0].backendNodeId, null, 'unresolved identity must be an explicit null, never an omitted key');
    assert.equal(written.controls[0].identityUnresolved, true, 'unresolved identity must carry the explicit identityUnresolved marker');
    assert.equal(written.controls[0].id, 'form-2');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// collectForms — adversarial: internal-delimiter embeddings across value and
// page-controlled strings, plus visibleSubstring gating and type normalization.
// ============================================================================

const FORMS_LEAK_RECORD = {
  markId: 'form-leak-query',
  selector: `#${JWT_SENTINEL}`,
  tagName: 'input',
  type: 'text',
  value: `?token=${SK_SENTINEL}&x=1`,
  valuePlaceholder: `Enter your ${GH_PAT_SENTINEL} here`,
  selectionStart: null,
  selectionEnd: null,
  scrollLeft: 0,
  scrollTop: 0,
  clientWidth: 200,
  clientHeight: 20,
  scrollWidth: 200,
  scrollHeight: 20,
  disabled: false,
  readOnly: false,
  required: false,
  pattern: `^${SK_SENTINEL}$`,
  checked: null,
  multiple: false,
  validity: {
    valid: false,
    valueMissing: false,
    typeMismatch: false,
    patternMismatch: true,
    tooLong: false,
    tooShort: false,
    rangeUnderflow: false,
    rangeOverflow: false,
    stepMismatch: false,
    badInput: false,
    customError: false,
    message: `Value must match ${SK_SENTINEL},`,
  },
  label: { text: `API Key (${JWT_SENTINEL}):`, source: 'aria-label' },
  autofilled: false,
  pseudoState: {
    focused: false,
    hovered: false,
    active: false,
    checked: null,
    disabled: false,
    readOnly: false,
    invalid: true,
    focusVisible: false,
  },
  rect: { x: 0, y: 72, width: 200, height: 20 },
  valueLines: [{ x: 0, y: 72, width: 150, height: 16 }],
  placeholderLines: [],
  caretRect: null,
  selectionRects: [],
  visibleRange: { start: 0, end: `?token=${SK_SENTINEL}&x=1`.length },
  isContentEditable: false,
  autocomplete: 'off',
  name: 'notes',
  id: 'notes',
};

const FORMS_LEAK_EQ_RECORD = {
  ...FORMS_LEAK_RECORD,
  markId: 'form-leak-eq',
  selector: '.form-leak-eq',
  value: `token=${SK_SENTINEL}`,
  valuePlaceholder: null,
  validity: null,
  label: null,
  pattern: null,
  visibleRange: null,
  name: 'notes-eq',
  id: 'notes-eq',
};

const FORMS_LEAK_COLON_RECORD = {
  ...FORMS_LEAK_RECORD,
  markId: 'form-leak-colon',
  selector: '.form-leak-colon',
  value: `token:${SK_SENTINEL}`,
  valuePlaceholder: null,
  validity: null,
  label: null,
  pattern: null,
  visibleRange: null,
  name: 'notes-colon',
  id: 'notes-colon',
};

const FORMS_LEAK_PAREN_RECORD = {
  ...FORMS_LEAK_RECORD,
  markId: 'form-leak-paren',
  selector: '.form-leak-paren',
  value: `key(${SK_SENTINEL})`,
  valuePlaceholder: null,
  validity: null,
  label: null,
  pattern: null,
  visibleRange: null,
  name: 'notes-paren',
  id: 'notes-paren',
};

test('collectForms: sentinels embedded across value/placeholder/label/validity/selector/pattern never appear raw in forms.json', async () => {
  const dir = freshSnapDir('forms-leak');
  ensurePrivateDir(dir);
  try {
    const client = new StubCdpClient({ formRecords: [FORMS_LEAK_EQ_RECORD, FORMS_LEAK_COLON_RECORD, FORMS_LEAK_PAREN_RECORD, FORMS_LEAK_RECORD] });
    await collectForms(buildContext(client, dir));

    const written = readJson(dir, 'forms.json');
    const eq = written.controls.find((c: any) => c.id === 'form-leak-eq');
    const colon = written.controls.find((c: any) => c.id === 'form-leak-colon');
    const paren = written.controls.find((c: any) => c.id === 'form-leak-paren');
    const query = written.controls.find((c: any) => c.id === 'form-leak-query');
    assert.ok(eq);
    assert.ok(colon);
    assert.ok(paren);
    assert.ok(query);

    assert.equal(eq.redacted, true);
    assert.equal(eq.redactionReason, 'embedded-secret-value');
    assert.equal(eq.value, undefined);
    assert.equal(eq.text, undefined);
    assert.equal(eq.valueLength, `token=${SK_SENTINEL}`.length);

    assert.equal(colon.redacted, true);
    assert.equal(colon.redactionReason, 'embedded-secret-value');
    assert.equal(colon.value, undefined);
    assert.equal(colon.text, undefined);
    assert.equal(colon.valueLength, `token:${SK_SENTINEL}`.length);

    assert.equal(paren.redacted, true);
    assert.equal(paren.redactionReason, 'embedded-secret-value');
    assert.equal(paren.value, undefined);
    assert.equal(paren.text, undefined);
    assert.equal(paren.valueLength, `key(${SK_SENTINEL})`.length);

    // Query-string style value: the char-range facts survive, but the
    // visible substring text is withheld because the whole value was redacted.
    assert.equal(query.redacted, true);
    assert.equal(query.redactionReason, 'embedded-secret-value');
    assert.equal(query.value, undefined);
    assert.equal(query.text, undefined);
    assert.equal(query.valueLength, FORMS_LEAK_RECORD.value.length);
    assert.ok(query.visibleSubstring);
    assert.equal(query.visibleSubstring.start, FORMS_LEAK_RECORD.visibleRange.start);
    assert.equal(query.visibleSubstring.end, FORMS_LEAK_RECORD.visibleRange.end);
    assert.ok(!('text' in query.visibleSubstring), 'visibleSubstring.text must be absent when the value is redacted');

    // Placeholder, label, validity message, selector, and pattern are each sanitized.
    assert.equal(query.placeholder.text, 'Enter your [REDACTED] here');
    assert.equal(query.label.text, 'API Key ([REDACTED]):');
    assert.equal(query.validity.message, 'Value must match [REDACTED],');
    assert.equal(query.selector, '#[REDACTED]');
    assert.equal(query.pattern, '^[REDACTED]$');

    const raw = rawJson(dir, 'forms.json');
    assert.ok(!raw.includes(SK_SENTINEL), 'sk- sentinel must never appear raw in forms.json');
    assert.ok(!raw.includes(JWT_SENTINEL), 'JWT sentinel must never appear raw in forms.json');
    assert.ok(!raw.includes(GH_PAT_SENTINEL), 'github_pat_ sentinel must never appear raw in forms.json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: an unrecognized type value normalizes to "unknown"', async () => {
  const dir = freshSnapDir('forms-type-norm');
  ensurePrivateDir(dir);
  try {
    const record = { ...CARET_SEARCH_RECORD, markId: 'form-badtype', type: 'javascript:alert(1)' };
    const client = new StubCdpClient({ formRecords: [record] });
    await collectForms(buildContext(client, dir));

    const written = readJson(dir, 'forms.json');
    const rec = written.controls.find((c: any) => c.id === 'form-badtype');
    assert.ok(rec);
    assert.equal(rec.type, 'unknown');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: over-length placeholder/label/validity-message/pattern are bounded at MAX_VALUE_LENGTH (2000)', async () => {
  const dir = freshSnapDir('forms-long-fields');
  ensurePrivateDir(dir);
  try {
    // Spaced repeats — no individual run is secret-shaped (per the capping
    // gotcha: a single-repeated-char run WOULD get redacted, not capped),
    // so this exercises capString's cap in isolation from redaction.
    const longPlaceholder = 'Placeholder ' + 'lorem ipsum '.repeat(200);
    const longLabelText = 'Label text ' + 'foo bar baz '.repeat(200);
    const longValidityMessage = 'Validity message ' + 'alpha beta gamma '.repeat(150);
    const longPattern = '^' + 'ab '.repeat(1000) + '$';
    const record = {
      ...CARET_SEARCH_RECORD,
      markId: 'form-long',
      valuePlaceholder: longPlaceholder,
      label: { text: longLabelText, source: 'aria-label' },
      pattern: longPattern,
      validity: { ...PASSWORD_RECORD.validity, message: longValidityMessage },
    };
    const client = new StubCdpClient({ formRecords: [record] });
    await collectForms(buildContext(client, dir));

    const written = readJson(dir, 'forms.json');
    const rec = written.controls.find((c: any) => c.id === 'form-long');
    assert.ok(rec);
    assert.ok(rec.placeholder.text.length <= 2000, `placeholder length ${rec.placeholder.text.length} must be bounded`);
    assert.ok(rec.label.text.length <= 2000, `label.text length ${rec.label.text.length} must be bounded`);
    assert.ok(rec.validity.message.length <= 2000, `validity.message length ${rec.validity.message.length} must be bounded`);
    assert.ok(rec.pattern.length <= 2000, `pattern length ${rec.pattern.length} must be bounded`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// D4 — unconditional CDP-object release + bridgeCleanupFailed fact
// ============================================================================

test('collectText: the held result object is released even when the walk returns no records, and no cleanup failure is recorded on success', async () => {
  const dir = freshSnapDir('text-cleanup-empty');
  ensurePrivateDir(dir);
  try {
    const client = new StubCdpClient({ textRecords: [] });
    await collectText(buildContext(client, dir));

    const releaseCalls = client.calls.filter((c) => c.method === 'Runtime.releaseObject');
    assert.ok(releaseCalls.length >= 1, 'the held result/facts objects must be released unconditionally, even with zero walk records');
    // No live-array elements object was ever fetched (zero records), so only
    // the container + facts ids get released — never the walk's own
    // `window`/global (there is none to release: nothing was ever assigned
    // to a page-observable location).
    assert.ok(
      releaseCalls.every((c) => String(c.params?.objectId ?? '').startsWith('text-')),
      'every released object id belongs to this collector\'s own held bridge objects',
    );

    const written = readJson(dir, 'text.json');
    assert.equal(written.elements.length, 0);
    assert.ok(!('bridgeCleanupFailed' in written), 'no failure fact on a successful release');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectText: a throwing Runtime.releaseObject is surfaced as bridgeCleanupFailed: true, not swallowed', async () => {
  const dir = freshSnapDir('text-cleanup-throw');
  ensurePrivateDir(dir);
  try {
    const client = new StubCdpClient({
      textRecords: [WRAPPED_TEXT_RECORD],
      ...RESOLVES_INDEX_0,
      throwOnTextCleanup: true,
    });
    await collectText(buildContext(client, dir));

    const written = readJson(dir, 'text.json');
    assert.equal(written.bridgeCleanupFailed, true);
    // The capture still succeeds — records are written despite the release throw.
    assert.equal(written.elements.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: the held result object is released even with zero records; a throwing release surfaces bridgeCleanupFailed', async () => {
  const dir = freshSnapDir('forms-cleanup');
  ensurePrivateDir(dir);
  try {
    const emptyClient = new StubCdpClient({ formRecords: [] });
    await collectForms(buildContext(emptyClient, dir));
    const emptyRelease = emptyClient.calls.filter((c) => c.method === 'Runtime.releaseObject');
    assert.ok(emptyRelease.length >= 1, 'forms held bridge objects must be released unconditionally');
    assert.ok(!('bridgeCleanupFailed' in readJson(dir, 'forms.json')));

    const dir2 = freshSnapDir('forms-cleanup-throw');
    ensurePrivateDir(dir2);
    try {
      const throwClient = new StubCdpClient({
        formRecords: [CARET_SEARCH_RECORD],
        objectIdsByIndex: { 0: 'obj-0' },
        describeNodeByObjectId: { 'obj-0': { backendNodeId: 9101 } },
        throwOnFormCleanup: true,
      });
      await collectForms(buildContext(throwClient, dir2));
      const written = readJson(dir2, 'forms.json');
      assert.equal(written.bridgeCleanupFailed, true);
      assert.equal(written.controls.length, 1);
    } finally {
      fs.rmSync(dir2, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// D5 — frame/shadow scope coverage facts
// ============================================================================

test('collectText: coverage reports top-document scope with iframe/shadow counts', async () => {
  const dir = freshSnapDir('text-coverage');
  ensurePrivateDir(dir);
  try {
    const client = new StubCdpClient({ textRecords: [WRAPPED_TEXT_RECORD], iframesNotWalked: 2, shadowRootsNotWalked: 3 });
    await collectText(buildContext(client, dir));

    const written = readJson(dir, 'text.json');
    assert.deepEqual(written.coverage, { scope: 'top-document', iframesNotWalked: 2, shadowRootsNotWalked: 3 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: coverage reports top-document scope with iframe/shadow counts', async () => {
  const dir = freshSnapDir('forms-coverage');
  ensurePrivateDir(dir);
  try {
    const client = new StubCdpClient({ formRecords: [CARET_SEARCH_RECORD], iframesNotWalked: 1, shadowRootsNotWalked: 0 });
    await collectForms(buildContext(client, dir));

    const written = readJson(dir, 'forms.json');
    assert.deepEqual(written.coverage, { scope: 'top-document', iframesNotWalked: 1, shadowRootsNotWalked: 0 });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// D8b — bidiOrder/truncationStyle allowlist normalization, tagName sanitize,
// visibleSubstring cap, label source allowlist, rect-array caps
// ============================================================================

test('collectText: hostile bidiOrder/truncationStyle values normalize to "unknown"', async () => {
  const dir = freshSnapDir('text-enum-hostile');
  ensurePrivateDir(dir);
  try {
    const record = {
      ...WRAPPED_TEXT_RECORD,
      markId: 'txt-enum-bad',
      bidiOrder: `evil-${SK_SENTINEL}`,
      truncationStyle: `sneaky-${GH_PAT_SENTINEL}`,
    };
    const client = new StubCdpClient({ textRecords: [record] });
    await collectText(buildContext(client, dir));

    const written = readJson(dir, 'text.json');
    const rec = written.elements.find((e: any) => e.id === 'txt-enum-bad');
    assert.equal(rec.bidiOrder, 'unknown');
    assert.equal(rec.truncationStyle, 'unknown');
    const raw = rawJson(dir, 'text.json');
    assert.ok(!raw.includes(SK_SENTINEL));
    assert.ok(!raw.includes(GH_PAT_SENTINEL));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectText: a valid mixed bidiOrder and clip truncationStyle pass through', async () => {
  const dir = freshSnapDir('text-enum-valid');
  ensurePrivateDir(dir);
  try {
    const record = { ...WRAPPED_TEXT_RECORD, markId: 'txt-enum-good', bidiOrder: 'mixed', truncationStyle: 'clip' };
    const client = new StubCdpClient({ textRecords: [record] });
    await collectText(buildContext(client, dir));
    const written = readJson(dir, 'text.json');
    const rec = written.elements.find((e: any) => e.id === 'txt-enum-good');
    assert.equal(rec.bidiOrder, 'mixed');
    assert.equal(rec.truncationStyle, 'clip');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectText: an over-length lines array is capped with a factual linesTruncated count', async () => {
  const dir = freshSnapDir('text-lines-cap');
  ensurePrivateDir(dir);
  try {
    const manyLines = Array.from({ length: 620 }, (_, i) => ({ x: 0, y: i, width: 10, height: 1, baseline: null }));
    const record = { ...WRAPPED_TEXT_RECORD, markId: 'txt-many-lines', lines: manyLines, wrapOffsets: [] };
    const client = new StubCdpClient({ textRecords: [record] });
    await collectText(buildContext(client, dir));
    const written = readJson(dir, 'text.json');
    const rec = written.elements.find((e: any) => e.id === 'txt-many-lines');
    assert.equal(rec.lines.length, 500);
    assert.equal(rec.linesTruncated, 120);
    assert.equal(rec.lineCount, 620, 'lineCount is the true fact, not the capped length');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: a custom-element tagName carrying a sentinel is sanitized in forms.json', async () => {
  const dir = freshSnapDir('forms-tagname');
  ensurePrivateDir(dir);
  try {
    const record = { ...CARET_SEARCH_RECORD, markId: 'form-ce-tag', tagName: `x-${SK_SENTINEL}-widget` };
    const client = new StubCdpClient({ formRecords: [record] });
    await collectForms(buildContext(client, dir));
    const written = readJson(dir, 'forms.json');
    const rec = written.controls.find((c: any) => c.id === 'form-ce-tag');
    assert.ok(rec.tagName.includes('[REDACTED]'));
    const raw = rawJson(dir, 'forms.json');
    assert.ok(!raw.includes(SK_SENTINEL), 'sentinel in tagName must not appear raw');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: visibleSubstring.text on a long non-secret value is sanitized and capped at 2000', async () => {
  const dir = freshSnapDir('forms-visible-cap');
  ensurePrivateDir(dir);
  try {
    const longValue = 'lorem ipsum dolor '.repeat(400); // >2000 chars, no secret-shaped run
    const record = {
      ...CARET_SEARCH_RECORD,
      markId: 'form-visible-long',
      value: longValue,
      visibleRange: { start: 0, end: longValue.length },
    };
    const client = new StubCdpClient({ formRecords: [record] });
    await collectForms(buildContext(client, dir));
    const written = readJson(dir, 'forms.json');
    const rec = written.controls.find((c: any) => c.id === 'form-visible-long');
    assert.equal(rec.redacted, false);
    assert.ok(rec.visibleSubstring.text.length <= 2000, `visibleSubstring.text length ${rec.visibleSubstring.text.length} must be bounded`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: a hostile label.source normalizes to "unknown" and only known keys survive', async () => {
  const dir = freshSnapDir('forms-label-source');
  ensurePrivateDir(dir);
  try {
    const record = {
      ...CARET_SEARCH_RECORD,
      markId: 'form-label-evil',
      label: { text: 'Field label', source: 'evil-injected-source', extraKey: 'should-not-survive' },
    };
    const client = new StubCdpClient({ formRecords: [record] });
    await collectForms(buildContext(client, dir));
    const written = readJson(dir, 'forms.json');
    const rec = written.controls.find((c: any) => c.id === 'form-label-evil');
    assert.equal(rec.label.source, 'unknown');
    assert.equal(rec.label.text, 'Field label');
    assert.ok(!('extraKey' in rec.label), 'spread page keys must not survive on the explicit label object');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: an over-length selectionRects array is capped with a factual truncation count', async () => {
  const dir = freshSnapDir('forms-rects-cap');
  ensurePrivateDir(dir);
  try {
    const manyRects = Array.from({ length: 540 }, (_, i) => ({ x: 0, y: i, width: 5, height: 1 }));
    const record = { ...CARET_SEARCH_RECORD, markId: 'form-many-rects', selectionRects: manyRects };
    const client = new StubCdpClient({ formRecords: [record] });
    await collectForms(buildContext(client, dir));
    const written = readJson(dir, 'forms.json');
    const rec = written.controls.find((c: any) => c.id === 'form-many-rects');
    assert.equal(rec.selectionRects.length, 500);
    assert.equal(rec.selectionRectsTruncated, 40);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// Real-Chrome sections below spawn actual headless Chrome and drive it over
// CDP end to end — no stub, no fake object-id bridge. Shared spawn/target
// helpers are defined once and reused by both D6 and D7.
// ============================================================================

const RC_PASSWORD = 'hunter2super'; // 12 chars

async function rcNewPageTarget(port: number): Promise<string> {
  const resp = await fetch(`http://localhost:${port}/json/new?about:blank`, { method: 'PUT' });
  const json = (await resp.json()) as { webSocketDebuggerUrl?: string };
  if (!json.webSocketDebuggerUrl) throw new Error('no webSocketDebuggerUrl in /json/new response');
  return json.webSocketDebuggerUrl;
}

// ============================================================================
// D6 real-Chrome: proof that the page-side measurement walk SKIPS type=password
// geometry. The stub tests above (PASSWORD_RECORD) only assert the raw
// password is absent; they feed a hand-built record with empty
// valueLines/caretRect/selectionRects and so would NOT catch someone
// deleting the `type !== 'password'` guard in FORMS_WALK_EXPRESSION. This
// test runs the ACTUAL in-page measurement walk against a real focused+selected
// password field — the exact condition under which caret/selection/line-box
// geometry WOULD be computed for a normal field — and asserts none of it
// surfaces, while the safe `valueLength` count still does. A sibling text
// field (positive control) proves the measurement machinery is live in the
// fixture, so the password's empty geometry is the guard at work, not a dead
// walk.
// ============================================================================

// Password + text field both carry a value; both are long enough that the
// canvas measureText geometry walk yields non-empty valueLineBoxes. The
// password is focused with its full value selected so a normal field would
// emit caretRect + selectionRects + visibleSubstring.text.
const RC_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;font:16px monospace;">
<input id="pw" type="password" value="${RC_PASSWORD}" style="width:200px;">
<input id="txt" type="text" value="visible-geometry-probe" style="width:200px;">
<script>
  var pw = document.getElementById('pw');
  pw.focus();
  pw.setSelectionRange(0, pw.value.length);
</script>
</body></html>`;

const RC_FIXTURE_URL = `data:text/html,${encodeURIComponent(RC_FIXTURE_HTML)}`;

async function rcWaitForFixtureReady(client: CDPClient, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = (await client.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && document.activeElement === document.getElementById('pw')`,
      returnByValue: true,
    })) as { result?: { value?: boolean } };
    if (res.result?.value) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('fixture page did not reach readyState=complete with the password focused in time');
}

describe('D6 real-Chrome: type=password geometry is skipped by the canvas measureText value-geometry walk', () => {
  let chromeProc: ChildProcess | undefined;
  let client: CDPClient | undefined;
  let forms: any;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    chromeProc = proc;
    const wsUrl = await rcNewPageTarget(port);
    client = new CDPClient(wsUrl);
    await client.waitReady();
    await enableDomainsForSnap(client);
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: 600,
      height: 400,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.send('Page.navigate', { url: RC_FIXTURE_URL });
    await rcWaitForFixtureReady(client);

    const store: Record<string, unknown> = {};
    const writer: SnapshotWriter = {
      json(filename, value) {
        store[filename] = value;
      },
      binary(filename, data) {
        store[filename] = data;
      },
    };
    const ctx: SnapshotContext = {
      client,
      dir: '/tmp/d6-measure-text-forms-password-unused',
      snapId: 'd6-password-snap',
      url: RC_FIXTURE_URL,
      viewport: null,
      settled: true,
      freezeAnimations: false,
      captureUnsettled: false,
      pixels: false,
      state: [],
      unstableRegions: [],
      write: writer,
    };
    await collectForms(ctx);
    forms = store['forms.json'];
  }, { timeout: 30000 });

  after(async () => {
    try {
      client?.close();
    } catch {
      // already closed
    }
    try {
      await closeChrome(chromeProc);
    } catch {
      // already dead
    }
  });

  test('positive control: the sibling text field DID get value geometry (proves the geometry walk is live)', () => {
    const txt = forms.controls.find((c: any) => c.type === 'text');
    assert.ok(txt, 'text control must be present');
    assert.ok(
      Array.isArray(txt.valueLineBoxes) && txt.valueLineBoxes.length > 0,
      'the non-password text field must have non-empty valueLineBoxes — otherwise the geometry walk is dead and the password assertions below prove nothing',
    );
  });

  test('the focused+selected password field has NO valueLineBoxes / caretRect / selectionRects / visibleSubstring.text, but keeps valueLength', () => {
    const pw = forms.controls.find((c: any) => c.type === 'password');
    assert.ok(pw, 'password control must be present');

    // The safe count survives — length is a fact, the characters are not.
    assert.equal(pw.valueLength, RC_PASSWORD.length);
    assert.equal(pw.valueLength, 12);
    assert.equal(pw.redacted, true);

    // Value geometry — every field that would leak rendered-width / caret-x
    // / selection geometry of the raw password characters — is ABSENT even
    // though the field is focused with its whole value selected.
    assert.ok(
      !Array.isArray(pw.valueLineBoxes) || pw.valueLineBoxes.length === 0,
      'password valueLineBoxes must be empty (value-geometry text lines skipped)',
    );
    assert.equal(pw.caretRect, null, 'password caretRect must be null (caret geometry skipped)');
    assert.ok(
      !Array.isArray(pw.selectionRects) || pw.selectionRects.length === 0,
      'password selectionRects must be empty (selection geometry skipped)',
    );
    // visibleSubstring is derived from visibleRange, which the password guard
    // leaves null — so the object (and its .text) never appears at all.
    if (pw.visibleSubstring !== undefined) {
      assert.ok(
        !('text' in pw.visibleSubstring),
        'password visibleSubstring.text must be absent',
      );
    }

    // Belt-and-suspenders: the raw password never appears anywhere in the
    // serialized artifact.
    assert.ok(
      !JSON.stringify(forms).includes(RC_PASSWORD),
      'raw password must never appear anywhere in forms.json',
    );
  });
});

// ============================================================================
// D7 real-Chrome: the Critical baseline-contamination blocker — proves
// neither `collectText` nor `collectForms` EVER sets a
// `data-capture-text-id` / `data-capture-form-id` attribute on the live
// page, at any point during a capture (the two collectors run in the SAME
// `Promise.all` baseline phase as geometry/hittest/styles/screenshot/dom in
// the real `snapshot.ts` orchestrator — see its module doc).
//
// A same-page `MutationObserver` (installed once, before either collector
// runs) is the detector; it watches for exactly those two attribute names
// anywhere under `document.body`. A positive-control sub-test runs FIRST
// and proves the detector itself catches a manually reintroduced
// stamp/unstamp pair — the same shape of live-DOM mutation `setAttribute('data-capture-text-id', markId)` / `removeAttribute` would
// produce if either collector ever stamped an element — so the negative
// result in the second test is meaningful: had `collectText`/`collectForms`
// stamped that attribute, this test would have failed exactly the way the
// positive control proves it can.
// ============================================================================

const RC_CONTAMINATION_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;font:16px sans-serif;">
<p id="p1">Some measurable text content for the walk to find</p>
<input id="i1" type="text" value="hello world" style="width:200px;">
<script>
  window.__markerMutations = [];
  var mo = new MutationObserver(function (records) {
    records.forEach(function (r) {
      if (r.type === 'attributes' && (r.attributeName === 'data-capture-text-id' || r.attributeName === 'data-capture-form-id')) {
        window.__markerMutations.push(r.attributeName);
      }
    });
  });
  mo.observe(document.body, {
    attributes: true,
    subtree: true,
    attributeFilter: ['data-capture-text-id', 'data-capture-form-id'],
  });
</script>
</body></html>`;

const RC_CONTAMINATION_FIXTURE_URL = `data:text/html,${encodeURIComponent(RC_CONTAMINATION_FIXTURE_HTML)}`;

async function rcWaitForContaminationFixtureReady(client: CDPClient, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = (await client.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && !!window.__markerMutations`,
      returnByValue: true,
    })) as { result?: { value?: boolean } };
    if (res.result?.value) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('contamination fixture page did not become ready in time');
}

async function rcReadMarkerMutations(client: CDPClient): Promise<string[]> {
  const res = (await client.send('Runtime.evaluate', {
    expression: 'window.__markerMutations',
    returnByValue: true,
  })) as { result?: { value?: string[] } };
  return res.result?.value ?? [];
}

describe('D7 real-Chrome: baseline collectText/collectForms never mutate the DOM with a marker attribute', () => {
  let chromeProc: ChildProcess | undefined;
  let client: CDPClient | undefined;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    chromeProc = proc;
    const wsUrl = await rcNewPageTarget(port);
    client = new CDPClient(wsUrl);
    await client.waitReady();
    await enableDomainsForSnap(client);
    await client.send('Page.navigate', { url: RC_CONTAMINATION_FIXTURE_URL });
    await rcWaitForContaminationFixtureReady(client);
  }, { timeout: 30000 });

  after(async () => {
    try {
      client?.close();
    } catch {
      // already closed
    }
    try {
      await closeChrome(chromeProc);
    } catch {
      // already dead
    }
  });

  test('positive control: the MutationObserver DOES catch a manually reintroduced data-capture-text-id stamp/unstamp — proves a baseline collector marking the live DOM this way would be caught', async () => {
    if (!client) throw new Error('client not ready');
    // Stamps then unstamps a data-capture-text-id attribute on a live node,
    // directly against the fixture element, with nothing else changed — the
    // same shape of mutation a baseline collector must never produce. If
    // the observer doesn't record this, the negative result below would
    // prove nothing.
    await client.send('Runtime.evaluate', {
      expression: `document.getElementById('p1').setAttribute('data-capture-text-id', 'txt-0');`,
      returnByValue: true,
    });
    await client.send('Runtime.evaluate', {
      expression: `document.getElementById('p1').removeAttribute('data-capture-text-id');`,
      returnByValue: true,
    });
    const mutations = await rcReadMarkerMutations(client);
    assert.ok(
      mutations.includes('data-capture-text-id'),
      'the observer must catch a manually reintroduced marker stamp — otherwise the negative assertions below are meaningless',
    );

    // Reset the recorder for the real assertions below.
    await client.send('Runtime.evaluate', { expression: 'window.__markerMutations = [];', returnByValue: true });
  });

  test('collectText + collectForms running concurrently (the real baseline Promise.all shape) never set data-capture-text-id / data-capture-form-id on the live page', async () => {
    if (!client) throw new Error('client not ready');
    const store: Record<string, unknown> = {};
    const writer: SnapshotWriter = {
      json(filename, value) {
        store[filename] = value;
      },
      binary(filename, data) {
        store[filename] = data;
      },
    };
    const ctx: SnapshotContext = {
      client,
      dir: '/tmp/d7-measure-text-forms-contamination-unused',
      snapId: 'd7-contamination-snap',
      url: RC_CONTAMINATION_FIXTURE_URL,
      viewport: null,
      settled: true,
      freezeAnimations: false,
      captureUnsettled: false,
      pixels: false,
      state: [],
      unstableRegions: [],
      write: writer,
    };

    // Mirrors snapshot.ts's real baseline phase: both collectors run in the
    // SAME Promise.all — the exact shape the Critical blocker was about.
    await Promise.all([collectText(ctx), collectForms(ctx)]);

    const mutations = await rcReadMarkerMutations(client);
    assert.deepEqual(mutations, [], 'neither collector may ever set data-capture-text-id/data-capture-form-id on the live page');

    const liveMarkerCount = (await client.send('Runtime.evaluate', {
      expression: `document.querySelectorAll('[data-capture-text-id], [data-capture-form-id]').length`,
      returnByValue: true,
    })) as { result?: { value?: number } };
    assert.equal(liveMarkerCount.result?.value, 0, 'no element may carry either marker attribute after capture');

    // Confirm the fix didn't break the join key this was all for — both
    // collectors still resolve backendNodeId for the elements they walk.
    const text = store['text.json'] as { elements: Array<{ id: string; backendNodeId?: number }> };
    const forms = store['forms.json'] as { controls: Array<{ id: string; backendNodeId?: number }> };
    const p1 = text.elements.find((e) => e.id === 'txt-0');
    const i1 = forms.controls.find((c) => c.id === 'form-0');
    assert.ok(p1, 'the <p> text element must be present in text.json');
    assert.equal(typeof p1?.backendNodeId, 'number', 'text.json element must still carry a resolved backendNodeId');
    assert.ok(i1, 'the <input> control must be present in forms.json');
    assert.equal(typeof i1?.backendNodeId, 'number', 'forms.json control must still carry a resolved backendNodeId');
  });
});

// ============================================================================
// D8 real-Chrome: the reported Major — a page-defined setter for the
// predictable, guessable global names `window.__captureTextEls`/
// `window.__captureFormEls` (the OLD side-channel names) must never fire
// during a real capture, because the fixed collectText/collectForms no
// longer assign to `window` (or any other page-observable location) AT
// ALL — the walk's return value is read back purely through CDP's own
// remote-object identity (`Runtime.getProperties`/`Runtime.callFunctionOn`/
// `Runtime.releaseObject`), never through re-evaluating a named-global
// expression. A same-page setter recorder (installed once, before either
// collector runs) is the detector; a positive-control sub-test runs FIRST
// and proves the detector itself catches a manually reintroduced
// `window.__captureTextEls = []` / `window.__captureFormEls = []` — the
// EXACT reported reproduction (`Object.defineProperty(window,
// '__captureTextEls', { set(){...} })`) — so the negative result in the
// second test is meaningful: had collectText/collectForms still assigned
// that global, this test would have failed exactly the way the positive
// control proves it can.
// ============================================================================

const RC_SETTER_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;font:16px sans-serif;">
<p id="p1">Some measurable text content for the walk to find</p>
<input id="i1" type="text" value="hello world" style="width:200px;">
<script>
  window.__setterFired = [];
  Object.defineProperty(window, '__captureTextEls', {
    configurable: true,
    set: function () { window.__setterFired.push('__captureTextEls'); },
    get: function () { return undefined; },
  });
  Object.defineProperty(window, '__captureFormEls', {
    configurable: true,
    set: function () { window.__setterFired.push('__captureFormEls'); },
    get: function () { return undefined; },
  });
</script>
</body></html>`;

const RC_SETTER_FIXTURE_URL = `data:text/html,${encodeURIComponent(RC_SETTER_FIXTURE_HTML)}`;

async function rcWaitForSetterFixtureReady(client: CDPClient, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = (await client.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && Array.isArray(window.__setterFired)`,
      returnByValue: true,
    })) as { result?: { value?: boolean } };
    if (res.result?.value) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('setter contamination fixture page did not become ready in time');
}

async function rcReadSetterFired(client: CDPClient): Promise<string[]> {
  const res = (await client.send('Runtime.evaluate', {
    expression: 'window.__setterFired',
    returnByValue: true,
  })) as { result?: { value?: string[] } };
  return res.result?.value ?? [];
}

describe('D8 real-Chrome: baseline collectText/collectForms never trigger a page-defined __captureTextEls/__captureFormEls setter', () => {
  let chromeProc: ChildProcess | undefined;
  let client: CDPClient | undefined;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    chromeProc = proc;
    const wsUrl = await rcNewPageTarget(port);
    client = new CDPClient(wsUrl);
    await client.waitReady();
    await enableDomainsForSnap(client);
    await client.send('Page.navigate', { url: RC_SETTER_FIXTURE_URL });
    await rcWaitForSetterFixtureReady(client);
  }, { timeout: 30000 });

  after(async () => {
    try {
      client?.close();
    } catch {
      // already closed
    }
    try {
      await closeChrome(chromeProc);
    } catch {
      // already dead
    }
  });

  test('positive control: the recorder DOES catch a manually reintroduced window.__captureTextEls/__captureFormEls assignment', async () => {
    if (!client) throw new Error('client not ready');
    // Assigns directly to `window.__captureTextEls`/`window.__captureFormEls`
    // against the live fixture's predefined setters, with nothing else
    // changed — the same shape of page-observable global assignment a
    // baseline collector must never make. If the recorder doesn't catch
    // this, the negative result below would prove nothing.
    await client.send('Runtime.evaluate', { expression: 'window.__captureTextEls = [];', returnByValue: true });
    await client.send('Runtime.evaluate', { expression: 'window.__captureFormEls = [];', returnByValue: true });
    const fired = await rcReadSetterFired(client);
    assert.ok(fired.includes('__captureTextEls'), 'the recorder must catch a manually reintroduced __captureTextEls assignment');
    assert.ok(fired.includes('__captureFormEls'), 'the recorder must catch a manually reintroduced __captureFormEls assignment');

    // Reset the recorder for the real assertions below.
    await client.send('Runtime.evaluate', { expression: 'window.__setterFired = [];', returnByValue: true });
  });

  test('collectText + collectForms running concurrently (the real baseline Promise.all shape) never trigger the __captureTextEls/__captureFormEls setter', async () => {
    if (!client) throw new Error('client not ready');
    const store: Record<string, unknown> = {};
    const writer: SnapshotWriter = {
      json(filename, value) {
        store[filename] = value;
      },
      binary(filename, data) {
        store[filename] = data;
      },
    };
    const ctx: SnapshotContext = {
      client,
      dir: '/tmp/d8-measure-text-forms-setter-unused',
      snapId: 'd8-setter-snap',
      url: RC_SETTER_FIXTURE_URL,
      viewport: null,
      settled: true,
      freezeAnimations: false,
      captureUnsettled: false,
      pixels: false,
      state: [],
      unstableRegions: [],
      write: writer,
    };

    // Mirrors snapshot.ts's real baseline phase: both collectors run in the
    // SAME Promise.all — the exact shape the reported Major was about.
    await Promise.all([collectText(ctx), collectForms(ctx)]);

    const fired = await rcReadSetterFired(client);
    assert.deepEqual(
      fired,
      [],
      'neither collector may ever assign to window.__captureTextEls/__captureFormEls (or trigger any page-defined setter for them)',
    );

    // Confirm the fix didn't break the join key this was all for — both
    // collectors still resolve backendNodeId for the elements they walk.
    const text = store['text.json'] as { elements: Array<{ id: string; backendNodeId?: number }> };
    const forms = store['forms.json'] as { controls: Array<{ id: string; backendNodeId?: number }> };
    const p1 = text.elements.find((e) => e.id === 'txt-0');
    const i1 = forms.controls.find((c) => c.id === 'form-0');
    assert.ok(p1, 'the <p> text element must be present in text.json');
    assert.equal(typeof p1?.backendNodeId, 'number', 'text.json element must still carry a resolved backendNodeId');
    assert.ok(i1, 'the <input> control must be present in forms.json');
    assert.equal(typeof i1?.backendNodeId, 'number', 'forms.json control must still carry a resolved backendNodeId');
  });
});

// ============================================================================
// D9 real-Chrome: proves collectForms's measurement (a detached,
// never-appended <canvas>) never mutates document.body at all (childList
// OR attributes). D7 above only ever watched for the two specific
// `data-capture-*-id` attribute names; this test's observer is broad
// (`childList: true, subtree: true, attributes: true`) so it would catch
// ANY document.body mutation, not just those two attributes. A positive
// control (append+remove an unrelated node) proves the observer fires at
// all before trusting its zero-mutations result against the real
// collector, and a textarea alongside the focused/selected single-line
// input exercises the wrapped-layout-unavailable path in the same run.
// ============================================================================

const RC_MUTATION_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;font:16px monospace;">
<input id="i1" type="text" value="hello mutation world" style="width:200px;">
<textarea id="ta1" style="width:200px;height:60px;">line one wraps across possibly multiple visual lines in a narrow box</textarea>
<script>
  window.__d9Mutations = [];
  var mo = new MutationObserver(function (records) {
    records.forEach(function (r) { window.__d9Mutations.push(r.type); });
  });
  mo.observe(document.body, { childList: true, subtree: true, attributes: true });
  var i1 = document.getElementById('i1');
  i1.focus();
  i1.setSelectionRange(2, 7);
</script>
</body></html>`;

const RC_MUTATION_FIXTURE_URL = `data:text/html,${encodeURIComponent(RC_MUTATION_FIXTURE_HTML)}`;

async function rcWaitForMutationFixtureReady(client: CDPClient, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = (await client.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && document.activeElement === document.getElementById('i1') && Array.isArray(window.__d9Mutations)`,
      returnByValue: true,
    })) as { result?: { value?: boolean } };
    if (res.result?.value) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('D9 mutation fixture page did not become ready (focused input) in time');
}

async function rcFlushMicrotasks(client: CDPClient): Promise<void> {
  await client.send('Runtime.evaluate', {
    expression: 'new Promise(function (resolve) { queueMicrotask(function () { queueMicrotask(resolve); }); })',
    returnByValue: true,
    awaitPromise: true,
  });
}

async function rcReadD9Mutations(client: CDPClient): Promise<string[]> {
  const res = (await client.send('Runtime.evaluate', {
    expression: 'window.__d9Mutations',
    returnByValue: true,
  })) as { result?: { value?: string[] } };
  return res.result?.value ?? [];
}

describe('D9 real-Chrome: collectForms never mutates document.body (childList or attributes)', () => {
  let chromeProc: ChildProcess | undefined;
  let client: CDPClient | undefined;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    chromeProc = proc;
    const wsUrl = await rcNewPageTarget(port);
    client = new CDPClient(wsUrl);
    await client.waitReady();
    await enableDomainsForSnap(client);
    await client.send('Page.navigate', { url: RC_MUTATION_FIXTURE_URL });
    await rcWaitForMutationFixtureReady(client);
  }, { timeout: 30000 });

  after(async () => {
    try {
      client?.close();
    } catch {
      // already closed
    }
    try {
      await closeChrome(chromeProc);
    } catch {
      // already dead
    }
  });

  test('positive control: the childList/attributes observer DOES catch a manually appended+removed node — proves the detector is live', async () => {
    if (!client) throw new Error('client not ready');
    await client.send('Runtime.evaluate', {
      expression: `(function () { var d = document.createElement('div'); document.body.appendChild(d); document.body.removeChild(d); })();`,
      returnByValue: true,
    });
    await rcFlushMicrotasks(client);
    const mutations = await rcReadD9Mutations(client);
    assert.ok(
      mutations.includes('childList'),
      'the observer must catch a manually appended+removed node — otherwise the negative result below proves nothing',
    );

    // Reset the recorder for the real assertion below.
    await client.send('Runtime.evaluate', { expression: 'window.__d9Mutations = [];', returnByValue: true });
  });

  test('collectForms against a focused+selected single-line input and a textarea records ZERO document.body mutations, and both controls still resolve their facts', async () => {
    if (!client) throw new Error('client not ready');
    const store: Record<string, unknown> = {};
    const writer: SnapshotWriter = {
      json(filename, value) {
        store[filename] = value;
      },
      binary(filename, data) {
        store[filename] = data;
      },
    };
    const ctx: SnapshotContext = {
      client,
      dir: '/tmp/d9-measure-text-forms-mutation-unused',
      snapId: 'd9-mutation-snap',
      url: RC_MUTATION_FIXTURE_URL,
      viewport: null,
      settled: true,
      freezeAnimations: false,
      captureUnsettled: false,
      pixels: false,
      state: [],
      unstableRegions: [],
      write: writer,
    };

    await collectForms(ctx);
    await rcFlushMicrotasks(client);

    const mutations = await rcReadD9Mutations(client);
    assert.deepEqual(mutations, [], 'collectForms must never mutate document.body — no childList and no attribute changes');

    const forms = store['forms.json'] as { controls: Array<Record<string, any>> };
    const input = forms.controls.find((c) => c.selector?.includes('#i1') || c.tagName === 'input');
    const textarea = forms.controls.find((c) => c.tagName === 'textarea');
    assert.ok(input, 'the single-line <input> control must be present');
    assert.ok(textarea, 'the <textarea> control must be present');

    // Single-line input: identity + geometry facts still resolve, and
    // redaction behaves correctly for a non-secret plain value.
    assert.equal(typeof input!.backendNodeId, 'number', 'input backendNodeId must resolve via the CDP identity bridge');
    assert.equal(input!.redacted, false);
    assert.equal(input!.value, 'hello mutation world');
    assert.ok(Array.isArray(input!.valueLineBoxes) && input!.valueLineBoxes.length > 0, 'input valueLineBoxes must be present');
    assert.ok(input!.caretRect || input!.selectionRects?.length, 'input caret/selection geometry must be present (focused with a non-empty selection)');
    assert.deepEqual(input!.selectionStart != null ? input!.selectionStart : null, 2);
    assert.equal(input!.selectionEnd, 7);
    assert.ok(Array.isArray(input!.selectionRects) && input!.selectionRects.length > 0, 'input selectionRects must be present for a non-collapsed selection');
    assert.ok(input!.visibleSubstring, 'input visibleRange/visibleSubstring geometry must be present');
    assert.equal(input!.textLayout, undefined, 'a single-line input has no textLayout-unavailable marker');

    // Textarea: non-layout facts still resolve, and the wrapped-layout
    // facts are marked factually unavailable rather than approximated.
    assert.equal(typeof textarea!.backendNodeId, 'number', 'textarea backendNodeId must resolve via the CDP identity bridge');
    assert.equal(textarea!.redacted, false);
    assert.ok(typeof textarea!.value === 'string' && textarea!.value.length > 0);
    assert.equal(typeof textarea!.scroll?.left, 'number');
    assert.equal(typeof textarea!.scroll?.top, 'number');
    assert.equal(typeof textarea!.dimensions?.clientWidth, 'number');
    assert.equal(typeof textarea!.dimensions?.scrollHeight, 'number');
    assert.ok(textarea!.rect);
    assert.ok(textarea!.pseudoState);
    assert.deepEqual(textarea!.autofill, { isAutofilled: false });
    assert.deepEqual(textarea!.textLayout, { available: false, reason: 'textarea-wrapping-requires-layout' });
    assert.ok(!Array.isArray(textarea!.valueLineBoxes) || textarea!.valueLineBoxes.length === 0, 'textarea valueLineBoxes must be empty, not approximated');
    assert.equal(textarea!.caretRect, null, 'textarea caretRect must be null, not approximated');
    assert.ok(!Array.isArray(textarea!.selectionRects) || textarea!.selectionRects.length === 0, 'textarea selectionRects must be empty, not approximated');
    assert.equal(textarea!.visibleSubstring, undefined, 'textarea has no visibleRange, so no visibleSubstring fact');
  });
});

// ============================================================================
// D10 real-Chrome: an invalid control's `invalid` event must never fire
// during the baseline walk. `checkValidity()`/`reportValidity()` are NOT
// pure reads on an invalid control — the browser synchronously dispatches
// a page-observable `invalid` event, and page code listening for it can
// mutate the DOM before `screenshot.png`/`dom.html` are captured. This
// fixture wires an `invalid` listener that appends a node to document.body
// when it fires, so any reintroduction of `checkValidity()`/
// `reportValidity()` in the baseline walk turns into an observed mutation
// here. A positive control (append+remove an unrelated node) proves the
// observer is live before trusting the zero-mutations result, and the
// control's `validity.valid` fact must still resolve to `false`.
// ============================================================================

const RC_INVALID_FIXTURE_HTML = `<!DOCTYPE html><html><body style="margin:0;font:16px monospace;">
<input id="inv" type="email" value="not-an-email" required style="width:200px;">
<script>
  window.__d10Mutations = [];
  var mo = new MutationObserver(function (records) {
    records.forEach(function (r) { window.__d10Mutations.push(r.type); });
  });
  mo.observe(document.body, { childList: true, subtree: true, attributes: true });
  var inv = document.getElementById('inv');
  inv.addEventListener('invalid', function () {
    var d = document.createElement('div');
    d.id = 'invalid-event-leaked-mutation';
    document.body.appendChild(d);
  });
  window.__d10Ready = true;
</script>
</body></html>`;

const RC_INVALID_FIXTURE_URL = `data:text/html,${encodeURIComponent(RC_INVALID_FIXTURE_HTML)}`;

async function rcWaitForInvalidFixtureReady(client: CDPClient, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = (await client.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete' && window.__d10Ready === true`,
      returnByValue: true,
    })) as { result?: { value?: boolean } };
    if (res.result?.value) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('D10 invalid-control fixture page did not become ready in time');
}

async function rcReadD10Mutations(client: CDPClient): Promise<string[]> {
  const res = (await client.send('Runtime.evaluate', {
    expression: 'window.__d10Mutations',
    returnByValue: true,
  })) as { result?: { value?: string[] } };
  return res.result?.value ?? [];
}

describe('D10 real-Chrome: collectForms never fires an invalid control\'s `invalid` event (checkValidity/reportValidity are not pure reads)', () => {
  let chromeProc: ChildProcess | undefined;
  let client: CDPClient | undefined;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    chromeProc = proc;
    const wsUrl = await rcNewPageTarget(port);
    client = new CDPClient(wsUrl);
    await client.waitReady();
    await enableDomainsForSnap(client);
    await client.send('Page.navigate', { url: RC_INVALID_FIXTURE_URL });
    await rcWaitForInvalidFixtureReady(client);
  }, { timeout: 30000 });

  after(async () => {
    try {
      client?.close();
    } catch {
      // already closed
    }
    try {
      await closeChrome(chromeProc);
    } catch {
      // already dead
    }
  });

  test('positive control: the childList/attributes observer DOES catch a manually appended+removed node — proves the detector is live', async () => {
    if (!client) throw new Error('client not ready');
    await client.send('Runtime.evaluate', {
      expression: `(function () { var d = document.createElement('div'); document.body.appendChild(d); document.body.removeChild(d); })();`,
      returnByValue: true,
    });
    await rcFlushMicrotasks(client);
    const mutations = await rcReadD10Mutations(client);
    assert.ok(
      mutations.includes('childList'),
      'the observer must catch a manually appended+removed node — otherwise the negative result below proves nothing',
    );

    // Reset the recorder for the real assertion below.
    await client.send('Runtime.evaluate', { expression: 'window.__d10Mutations = [];', returnByValue: true });
  });

  test('collectForms against an invalid required control records ZERO document.body mutations, and validity.valid resolves false', async () => {
    if (!client) throw new Error('client not ready');
    const store: Record<string, unknown> = {};
    const writer: SnapshotWriter = {
      json(filename, value) {
        store[filename] = value;
      },
      binary(filename, data) {
        store[filename] = data;
      },
    };
    const ctx: SnapshotContext = {
      client,
      dir: '/tmp/d10-measure-text-forms-invalid-unused',
      snapId: 'd10-invalid-snap',
      url: RC_INVALID_FIXTURE_URL,
      viewport: null,
      settled: true,
      freezeAnimations: false,
      captureUnsettled: false,
      pixels: false,
      state: [],
      unstableRegions: [],
      write: writer,
    };

    await collectForms(ctx);
    await rcFlushMicrotasks(client);

    const mutations = await rcReadD10Mutations(client);
    assert.deepEqual(
      mutations,
      [],
      'collectForms must never fire the invalid control\'s `invalid` event — no childList and no attribute changes',
    );

    const forms = store['forms.json'] as { controls: Array<Record<string, any>> };
    const control = forms.controls.find((c) => c.selector === '#inv');
    assert.ok(control, 'the invalid <input> control must be present in forms.json');
    assert.equal(typeof control!.backendNodeId, 'number', 'control backendNodeId must resolve via the CDP identity bridge');
    assert.equal(control!.validity?.valid, false, 'validity.valid must be false for the invalid control');
    assert.equal(control!.validity?.typeMismatch, true, 'validity.typeMismatch must be true for a malformed email value');
    assert.equal(control!.redacted, false);
    assert.equal(control!.value, 'not-an-email');
  });
});
