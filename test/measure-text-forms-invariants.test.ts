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

// ============================================================================
// C4 remediation — text.ts / forms.ts.
//
// A1: text.ts's baseline metric is ALWAYS canvas-derived (never a native
// line-box reading), but takes two branches — a per-font `measureText('Hg')`
// `actualBoundingBoxDescent` reading (the best-precision path) and a crude
// `rect.height * 0.2` heuristic when that metric is unavailable. Only the
// crude fallback lacked an honest marker; `baselineApproximate` now flags it.
//
// A2: forms.ts's single-line native-control y/height rects use a
// `1.2 * font-size` line-height heuristic whenever Chrome's computed
// `line-height` is the literal `normal` keyword rather than a used px value
// — the COMMON case for a control with no authored `line-height` (verified
// against real headless Chrome below: `getComputedStyle(input).lineHeight`
// is `'normal'` for a plain `<input>` with no CSS `line-height` set).
// `lineHeightApproximate` now flags this.
//
// C: the top-level `MAX_TEXT_ELEMENTS`/`MAX_FORMS_CONTROLS` caps now emit a
// concise `coverage.elementsTotal`/`elementsTruncated` (resp.
// `controlsTotal`/`controlsTruncated`) fact — same conditional-truncation
// convention as the file's existing per-field rect/line caps — instead of
// silently dropping excess elements/controls.
// ============================================================================

// ----------------------------------------------------------------------------
// Local test doubles — mirrors the CDP-only identity bridge stub in
// test/measure-text-forms.test.ts (not imported from there per the brief:
// new adversarial tests live in their own dedicated file).
// ----------------------------------------------------------------------------

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
      elementsTotal?: number;
      controlsTotal?: number;
      iframesNotWalked?: number;
      shadowRootsNotWalked?: number;
    } = {},
  ) {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    this.calls.push({ method, params });

    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
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
      // No resolved element identities needed for these caps-only tests.
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

    if (method === 'Runtime.releaseObject') return {};
    if (method === 'DOM.describeNode') return { node: {} };
    if (method === 'CSS.getPlatformFontsForNode') return {};

    return {};
  }
}

function asClient(stub: StubCdpClient): CDPClient {
  return stub as unknown as CDPClient;
}

function freshSnapDir(label: string): string {
  return path.join(CAPTURE_ROOT, `measure-text-forms-invariants-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
}

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

const MINIMAL_TEXT_RECORD = {
  markId: 'txt-0',
  selector: '.p',
  text: 'hello world',
  lines: [{ x: 0, y: 0, width: 100, height: 16, baseline: 12, baselineApproximate: false }],
  wrapOffsets: [],
  writingMode: 'horizontal-tb',
  direction: 'ltr',
  bidiOrder: 'ltr',
  fontFamily: 'sans-serif',
  fontSize: '16px',
  fontWeight: '400',
  lineHeight: '20px',
  isContentEditable: false,
  truncated: false,
  truncationStyle: 'none',
  scrollWidth: 100,
  clientWidth: 100,
};

const MINIMAL_FORM_RECORD = {
  markId: 'form-0',
  selector: '#i',
  tagName: 'input',
  type: 'text',
  value: 'hi',
  valuePlaceholder: null,
  selectionStart: null,
  selectionEnd: null,
  scrollLeft: 0,
  scrollTop: 0,
  clientWidth: 100,
  clientHeight: 20,
  scrollWidth: 100,
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
    focused: false,
    hovered: false,
    active: false,
    checked: null,
    disabled: false,
    readOnly: false,
    invalid: false,
    focusVisible: false,
  },
  rect: { x: 0, y: 0, width: 100, height: 20 },
  valueLines: [],
  placeholderLines: [],
  caretRect: null,
  selectionRects: [],
  visibleRange: null,
  isContentEditable: false,
  autocomplete: null,
  name: null,
  id: 'i',
};

// ============================================================================
// T11/T12/F17/F18 — malformed-field honesty on an otherwise-present facts
// object (I-4/I-5, Layer 2). `MalformedFactsStubCdpClient` hands back an
// ARBITRARY `facts` value verbatim (never shaped through the normal
// `StubCdpClient` opts), so a test can omit `records` entirely or give a
// coverage field the wrong type — exactly the "facts object read back fine
// but a named field on it is missing/malformed" case the `?? default`
// pattern used to coerce into a silent benign success.
// ============================================================================

class MalformedFactsStubCdpClient {
  constructor(private readonly opts: { textFacts?: unknown; formFacts?: unknown } = {}) {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('MAX_ELEMENTS')) return { result: { objectId: TEXT_RESULT_OBJECT_ID } };
      if (expression.includes('MAX_CONTROLS')) return { result: { objectId: FORMS_RESULT_OBJECT_ID } };
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
      // No resolved element identities needed for these malformed-field tests.
      return { result: [] };
    }

    if (method === 'Runtime.callFunctionOn') {
      const objectId = (params as { objectId?: string }).objectId;
      if (objectId === TEXT_FACTS_OBJECT_ID) return { result: { value: this.opts.textFacts } };
      if (objectId === FORMS_FACTS_OBJECT_ID) return { result: { value: this.opts.formFacts } };
      return { result: {} };
    }

    if (method === 'Runtime.releaseObject') return {};
    if (method === 'DOM.describeNode') return { node: {} };
    if (method === 'CSS.getPlatformFontsForNode') return {};

    return {};
  }
}

function asMalformedClient(stub: MalformedFactsStubCdpClient): CDPClient {
  return stub as unknown as CDPClient;
}

function buildMalformedContext(client: MalformedFactsStubCdpClient, dir: string): SnapshotContext {
  return {
    client: asMalformedClient(client),
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

test('collectText: T11 — a facts object that read back fine but has no `records` field at all reports available:false / unavailableReason:walk-records-malformed, never a fabricated empty-success result (fails pre-fix)', async () => {
  const dir = freshSnapDir('text-t11-records-missing');
  ensurePrivateDir(dir);
  try {
    const client = new MalformedFactsStubCdpClient({
      textFacts: { iframesNotWalked: 0, shadowRootsNotWalked: 0, elementsTotal: 0 },
    });
    await collectText(buildMalformedContext(client, dir));

    const written = readJson(dir, 'text.json');
    assert.equal(written.available, false, 'a missing records field must not read as available:true');
    assert.equal(written.unavailableReason, 'walk-records-malformed');
    assert.deepEqual(written.elements, [], 'no records field means no elements can honestly be reported');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectText: T11 — a `records` field present but the wrong type (a string, not an array) is treated the same as missing — available:false / unavailableReason:walk-records-malformed', async () => {
  const dir = freshSnapDir('text-t11-records-wrong-type');
  ensurePrivateDir(dir);
  try {
    const client = new MalformedFactsStubCdpClient({
      textFacts: { records: 'not-an-array', iframesNotWalked: 0, shadowRootsNotWalked: 0, elementsTotal: 0 },
    });
    await collectText(buildMalformedContext(client, dir));

    const written = readJson(dir, 'text.json');
    assert.equal(written.available, false);
    assert.equal(written.unavailableReason, 'walk-records-malformed');
    assert.deepEqual(written.elements, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: F17 — a facts object that read back fine but has no `records` field at all reports available:false / unavailableReason:walk-records-malformed, never a fabricated empty-success result (fails pre-fix)', async () => {
  const dir = freshSnapDir('forms-f17-records-missing');
  ensurePrivateDir(dir);
  try {
    const client = new MalformedFactsStubCdpClient({
      formFacts: { iframesNotWalked: 0, shadowRootsNotWalked: 0, controlsTotal: 0 },
    });
    await collectForms(buildMalformedContext(client, dir));

    const written = readJson(dir, 'forms.json');
    assert.equal(written.available, false, 'a missing records field must not read as available:true');
    assert.equal(written.unavailableReason, 'walk-records-malformed');
    assert.deepEqual(written.controls, [], 'no records field means no controls can honestly be reported');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: F17 — a `records` field present but the wrong type (a string, not an array) is treated the same as missing — available:false / unavailableReason:walk-records-malformed', async () => {
  const dir = freshSnapDir('forms-f17-records-wrong-type');
  ensurePrivateDir(dir);
  try {
    const client = new MalformedFactsStubCdpClient({
      formFacts: { records: 42, iframesNotWalked: 0, shadowRootsNotWalked: 0, controlsTotal: 0 },
    });
    await collectForms(buildMalformedContext(client, dir));

    const written = readJson(dir, 'forms.json');
    assert.equal(written.available, false);
    assert.equal(written.unavailableReason, 'walk-records-malformed');
    assert.deepEqual(written.controls, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectText: T12 — a valid records array but non-numeric elementsTotal/iframesNotWalked/shadowRootsNotWalked reports per-field *Unavailable markers, never silent zero/raw.length defaults (fails pre-fix)', async () => {
  const dir = freshSnapDir('text-t12-coverage-malformed');
  ensurePrivateDir(dir);
  try {
    const client = new MalformedFactsStubCdpClient({
      textFacts: {
        records: [MINIMAL_TEXT_RECORD],
        iframesNotWalked: 'nope',
        shadowRootsNotWalked: null,
        elementsTotal: 'also-nope',
      },
    });
    await collectText(buildMalformedContext(client, dir));

    const written = readJson(dir, 'text.json');
    assert.equal(written.available, true, 'records themselves are valid, so overall availability is unaffected');
    assert.equal(written.elements.length, 1);
    assert.equal(written.coverage.iframesNotWalked, 0, 'the coerced default value is still emitted for shape compatibility');
    assert.equal(written.coverage.iframesNotWalkedUnavailable, true, 'but must be flagged malformed rather than presented as a genuine zero');
    assert.equal(written.coverage.shadowRootsNotWalked, 0);
    assert.equal(written.coverage.shadowRootsNotWalkedUnavailable, true);
    assert.equal(written.coverage.elementsTotalUnavailable, true, 'a non-numeric elementsTotal must never silently fall back to raw.length looking like a real total');
    assert.ok(!('elementsTotal' in written.coverage), 'a malformed elementsTotal must not itself appear as if it were a real total fact');
    assert.ok(!('elementsTruncated' in written.coverage), 'truncation cannot be honestly computed from a malformed total');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectText: T12 positive control — valid numeric coverage fields carry no malformed markers at all', async () => {
  const dir = freshSnapDir('text-t12-coverage-valid');
  ensurePrivateDir(dir);
  try {
    const client = new MalformedFactsStubCdpClient({
      textFacts: { records: [MINIMAL_TEXT_RECORD], iframesNotWalked: 2, shadowRootsNotWalked: 1, elementsTotal: 1 },
    });
    await collectText(buildMalformedContext(client, dir));

    const written = readJson(dir, 'text.json');
    assert.equal(written.coverage.iframesNotWalked, 2);
    assert.equal(written.coverage.shadowRootsNotWalked, 1);
    assert.ok(!('iframesNotWalkedUnavailable' in written.coverage));
    assert.ok(!('shadowRootsNotWalkedUnavailable' in written.coverage));
    assert.ok(!('elementsTotalUnavailable' in written.coverage));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: F18 — a valid records array but non-numeric controlsTotal/iframesNotWalked/shadowRootsNotWalked reports per-field *Unavailable markers, never silent zero/raw.length defaults (fails pre-fix)', async () => {
  const dir = freshSnapDir('forms-f18-coverage-malformed');
  ensurePrivateDir(dir);
  try {
    const client = new MalformedFactsStubCdpClient({
      formFacts: {
        records: [MINIMAL_FORM_RECORD],
        iframesNotWalked: 'nope',
        shadowRootsNotWalked: null,
        controlsTotal: 'also-nope',
      },
    });
    await collectForms(buildMalformedContext(client, dir));

    const written = readJson(dir, 'forms.json');
    assert.equal(written.available, true, 'records themselves are valid, so overall availability is unaffected');
    assert.equal(written.controls.length, 1);
    assert.equal(written.coverage.iframesNotWalked, 0);
    assert.equal(written.coverage.iframesNotWalkedUnavailable, true);
    assert.equal(written.coverage.shadowRootsNotWalked, 0);
    assert.equal(written.coverage.shadowRootsNotWalkedUnavailable, true);
    assert.equal(written.coverage.controlsTotalUnavailable, true, 'a non-numeric controlsTotal must never silently fall back to raw.length looking like a real total');
    assert.ok(!('controlsTotal' in written.coverage), 'a malformed controlsTotal must not itself appear as if it were a real total fact');
    assert.ok(!('controlsTruncated' in written.coverage), 'truncation cannot be honestly computed from a malformed total');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: F18 positive control — valid numeric coverage fields carry no malformed markers at all', async () => {
  const dir = freshSnapDir('forms-f18-coverage-valid');
  ensurePrivateDir(dir);
  try {
    const client = new MalformedFactsStubCdpClient({
      formFacts: { records: [MINIMAL_FORM_RECORD], iframesNotWalked: 3, shadowRootsNotWalked: 0, controlsTotal: 1 },
    });
    await collectForms(buildMalformedContext(client, dir));

    const written = readJson(dir, 'forms.json');
    assert.equal(written.coverage.iframesNotWalked, 3);
    assert.ok(!('iframesNotWalkedUnavailable' in written.coverage));
    assert.ok(!('shadowRootsNotWalkedUnavailable' in written.coverage));
    assert.ok(!('controlsTotalUnavailable' in written.coverage));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// C — top-level MAX_TEXT_ELEMENTS / MAX_FORMS_CONTROLS caps now emit an
// explicit total/truncated fact instead of silently dropping (I-5).
// ============================================================================

test('collectText: exceeding the top-level element cap reports coverage.elementsTotal/elementsTruncated (fails pre-fix: no fact at all)', async () => {
  const dir = freshSnapDir('text-cap-exceeded');
  ensurePrivateDir(dir);
  try {
    // Only 1 record actually kept (as MAX_ELEMENTS would enforce), but the
    // walk found 850 qualifying candidates in total — 50 more than the cap.
    const client = new StubCdpClient({ textRecords: [MINIMAL_TEXT_RECORD], elementsTotal: 850 });
    await collectText(buildContext(client, dir));

    const written = readJson(dir, 'text.json');
    assert.equal(written.coverage.elementsTotal, 850, 'coverage must report the true total candidate count, not just what was kept');
    assert.equal(written.coverage.elementsTruncated, 849, 'elementsTruncated must be the exact drop count (850 total - 1 kept)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectText: under the cap, coverage carries no truncation fact at all (matches the file\'s existing conditional-truncation convention)', async () => {
  const dir = freshSnapDir('text-cap-not-exceeded');
  ensurePrivateDir(dir);
  try {
    const client = new StubCdpClient({ textRecords: [MINIMAL_TEXT_RECORD], elementsTotal: 1 });
    await collectText(buildContext(client, dir));

    const written = readJson(dir, 'text.json');
    assert.ok(!('elementsTotal' in written.coverage), 'elementsTotal must be omitted when nothing was capped');
    assert.ok(!('elementsTruncated' in written.coverage), 'elementsTruncated must be omitted when nothing was capped');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: exceeding the top-level control cap reports coverage.controlsTotal/controlsTruncated (fails pre-fix: no fact at all)', async () => {
  const dir = freshSnapDir('forms-cap-exceeded');
  ensurePrivateDir(dir);
  try {
    const client = new StubCdpClient({ formRecords: [MINIMAL_FORM_RECORD], controlsTotal: 320 });
    await collectForms(buildContext(client, dir));

    const written = readJson(dir, 'forms.json');
    assert.equal(written.coverage.controlsTotal, 320, 'coverage must report the true total candidate count, not just what was kept');
    assert.equal(written.coverage.controlsTruncated, 319, 'controlsTruncated must be the exact drop count (320 total - 1 kept)');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: under the cap, coverage carries no truncation fact at all', async () => {
  const dir = freshSnapDir('forms-cap-not-exceeded');
  ensurePrivateDir(dir);
  try {
    const client = new StubCdpClient({ formRecords: [MINIMAL_FORM_RECORD], controlsTotal: 1 });
    await collectForms(buildContext(client, dir));

    const written = readJson(dir, 'forms.json');
    assert.ok(!('controlsTotal' in written.coverage), 'controlsTotal must be omitted when nothing was capped');
    assert.ok(!('controlsTruncated' in written.coverage), 'controlsTruncated must be omitted when nothing was capped');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// Class A (I-5) — held-facts-read-failure honesty. A DEDICATED local stub
// (not the shared `StubCdpClient` above, per the brief) that can force each
// of the three failure points collectText/collectForms must report honestly
// via `available`/`unavailableReason`:
//   - the walk's own `Runtime.evaluate` returns no `objectId` at all
//     ('walk-evaluate-returned-no-object')
//   - the held container's `Runtime.getProperties` never surfaces a `facts`
//     own-property object id at all ('walk-facts-unavailable', missing-key
//     variant)
//   - a `facts` object id IS present, but reading it out by value via
//     `Runtime.callFunctionOn` resolves without throwing yet carries no
//     `.value` ('walk-facts-unavailable', undefined-value variant)
// plus a healthy-walk control proving the flag is neither hardcoded false
// nor hardcoded true. Reuses the file's existing TEXT_*/FORMS_*_OBJECT_ID
// constants and MINIMAL_*_RECORD fixtures (plain data, not the shared stub
// class) purely so the fake ids/records line up with what a real walk would
// hand back; the stub class itself is new and none of the file's other 4
// (pre-existing) tests or the two real-Chrome describe blocks reference it.
// ============================================================================

type AvailabilityMode =
  | 'no-object'
  | 'missing-facts-key'
  | 'facts-undefined-value'
  | 'healthy'
  | 'evaluate-throws'
  | 'container-properties-throws'
  | 'facts-read-throws';

class AvailabilityStubCdpClient {
  constructor(
    private readonly target: 'text' | 'forms',
    private readonly mode: AvailabilityMode,
  ) {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const resultObjectId = this.target === 'text' ? TEXT_RESULT_OBJECT_ID : FORMS_RESULT_OBJECT_ID;
    const factsObjectId = this.target === 'text' ? TEXT_FACTS_OBJECT_ID : FORMS_FACTS_OBJECT_ID;
    const elementsObjectId = this.target === 'text' ? TEXT_ELEMENTS_OBJECT_ID : FORMS_ELEMENTS_OBJECT_ID;
    const walkMarker = this.target === 'text' ? 'MAX_ELEMENTS' : 'MAX_CONTROLS';

    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (!expression.includes(walkMarker)) return { result: {} };
      if (this.mode === 'no-object') return { result: {} };
      if (this.mode === 'evaluate-throws') {
        // The top-level walk evaluate itself rejects (e.g. a CDP session
        // hiccup) — the collector must still emit an honest unavailable
        // artifact rather than crash uncaught.
        throw new Error('Runtime.evaluate rejected (simulated)');
      }
      return { result: { objectId: resultObjectId } };
    }

    if (method === 'Runtime.getProperties') {
      const objectId = (params as { objectId?: string }).objectId;
      if (objectId === resultObjectId) {
        if (this.mode === 'missing-facts-key') {
          // The held container resolves, but its own-properties never include
          // a `facts` key at all — simulates a walk whose return shape lost
          // the `facts` property entirely (distinct from a `facts` id that
          // resolves but reads back empty, exercised by 'facts-undefined-value').
          return { result: [{ name: 'elements', value: { objectId: elementsObjectId } }] };
        }
        if (this.mode === 'container-properties-throws') {
          // The held container's own `Runtime.getProperties` round trip
          // (ownPropertyObjectIds) rejects outright — distinct from resolving
          // with a missing/undefined `facts` key.
          throw new Error('Runtime.getProperties rejected (simulated)');
        }
        return {
          result: [
            { name: 'facts', value: { objectId: factsObjectId } },
            { name: 'elements', value: { objectId: elementsObjectId } },
          ],
        };
      }
      // No resolved element identities needed for these availability-only tests.
      return { result: [] };
    }

    if (method === 'Runtime.callFunctionOn') {
      const objectId = (params as { objectId?: string }).objectId;
      if (objectId === factsObjectId) {
        if (this.mode === 'facts-undefined-value') {
          // The facts read resolves WITHOUT throwing, but carries no `.value` —
          // the honest read must treat this identically to a hard failure.
          return { result: {} };
        }
        if (this.mode === 'facts-read-throws') {
          // The held-`facts` `Runtime.callFunctionOn` round trip (readHeldValue)
          // rejects outright — distinct from resolving with an undefined `.value`.
          throw new Error('Runtime.callFunctionOn rejected (simulated)');
        }
        const records = this.mode === 'healthy' ? [this.target === 'text' ? MINIMAL_TEXT_RECORD : MINIMAL_FORM_RECORD] : [];
        return this.target === 'text'
          ? { result: { value: { records, iframesNotWalked: 0, shadowRootsNotWalked: 0, elementsTotal: records.length } } }
          : { result: { value: { records, iframesNotWalked: 0, shadowRootsNotWalked: 0, controlsTotal: records.length } } };
      }
      return { result: {} };
    }

    if (method === 'Runtime.releaseObject') return {};
    if (method === 'DOM.describeNode') return { node: {} };
    if (method === 'CSS.getPlatformFontsForNode') return {};

    return {};
  }
}

function asAvailabilityClient(stub: AvailabilityStubCdpClient): CDPClient {
  return stub as unknown as CDPClient;
}

function buildAvailabilityContext(client: AvailabilityStubCdpClient, dir: string): SnapshotContext {
  return {
    client: asAvailabilityClient(client),
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

test('collectText: the walk Runtime.evaluate returning no objectId at all reports available:false, unavailableReason:walk-evaluate-returned-no-object, and elements:[] — never a false-positive empty-success claim', async () => {
  const dir = freshSnapDir('text-availability-no-object');
  ensurePrivateDir(dir);
  try {
    const client = new AvailabilityStubCdpClient('text', 'no-object');
    await collectText(buildAvailabilityContext(client, dir));

    const written = readJson(dir, 'text.json');
    assert.equal(written.available, false, 'a walk that never produced a held object must not report available:true');
    assert.equal(written.unavailableReason, 'walk-evaluate-returned-no-object');
    assert.deepEqual(written.elements, []);
    assert.ok(!('elementsTotal' in written.coverage), 'coverage must not fabricate an elementsTotal when the walk never ran');
    assert.ok(!('elementsTruncated' in written.coverage), 'coverage must not fabricate a truncation count when the walk never ran');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectText: a held container missing the facts own-property entirely reports available:false, unavailableReason:walk-facts-unavailable', async () => {
  const dir = freshSnapDir('text-availability-missing-facts-key');
  ensurePrivateDir(dir);
  try {
    const client = new AvailabilityStubCdpClient('text', 'missing-facts-key');
    await collectText(buildAvailabilityContext(client, dir));

    const written = readJson(dir, 'text.json');
    assert.equal(written.available, false);
    assert.equal(written.unavailableReason, 'walk-facts-unavailable');
    assert.deepEqual(written.elements, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectText: a facts object id that resolves but reads back with no .value reports available:false, unavailableReason:walk-facts-unavailable', async () => {
  const dir = freshSnapDir('text-availability-facts-undefined');
  ensurePrivateDir(dir);
  try {
    const client = new AvailabilityStubCdpClient('text', 'facts-undefined-value');
    await collectText(buildAvailabilityContext(client, dir));

    const written = readJson(dir, 'text.json');
    assert.equal(written.available, false);
    assert.equal(written.unavailableReason, 'walk-facts-unavailable');
    assert.deepEqual(written.elements, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectText: healthy control — a normal successful walk reports available:true with no unavailableReason key at all', async () => {
  const dir = freshSnapDir('text-availability-healthy');
  ensurePrivateDir(dir);
  try {
    const client = new AvailabilityStubCdpClient('text', 'healthy');
    await collectText(buildAvailabilityContext(client, dir));

    const written = readJson(dir, 'text.json');
    assert.equal(written.available, true);
    assert.ok(!('unavailableReason' in written), 'a healthy walk must not carry an unavailableReason key at all');
    assert.equal(written.elements.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: the walk Runtime.evaluate returning no objectId at all reports available:false, unavailableReason:walk-evaluate-returned-no-object, and controls:[] — never a false-positive empty-success claim', async () => {
  const dir = freshSnapDir('forms-availability-no-object');
  ensurePrivateDir(dir);
  try {
    const client = new AvailabilityStubCdpClient('forms', 'no-object');
    await collectForms(buildAvailabilityContext(client, dir));

    const written = readJson(dir, 'forms.json');
    assert.equal(written.available, false, 'a walk that never produced a held object must not report available:true');
    assert.equal(written.unavailableReason, 'walk-evaluate-returned-no-object');
    assert.deepEqual(written.controls, []);
    assert.ok(!('controlsTotal' in written.coverage), 'coverage must not fabricate a controlsTotal when the walk never ran');
    assert.ok(!('controlsTruncated' in written.coverage), 'coverage must not fabricate a truncation count when the walk never ran');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: a held container missing the facts own-property entirely reports available:false, unavailableReason:walk-facts-unavailable', async () => {
  const dir = freshSnapDir('forms-availability-missing-facts-key');
  ensurePrivateDir(dir);
  try {
    const client = new AvailabilityStubCdpClient('forms', 'missing-facts-key');
    await collectForms(buildAvailabilityContext(client, dir));

    const written = readJson(dir, 'forms.json');
    assert.equal(written.available, false);
    assert.equal(written.unavailableReason, 'walk-facts-unavailable');
    assert.deepEqual(written.controls, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: a facts object id that resolves but reads back with no .value reports available:false, unavailableReason:walk-facts-unavailable', async () => {
  const dir = freshSnapDir('forms-availability-facts-undefined');
  ensurePrivateDir(dir);
  try {
    const client = new AvailabilityStubCdpClient('forms', 'facts-undefined-value');
    await collectForms(buildAvailabilityContext(client, dir));

    const written = readJson(dir, 'forms.json');
    assert.equal(written.available, false);
    assert.equal(written.unavailableReason, 'walk-facts-unavailable');
    assert.deepEqual(written.controls, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: healthy control — a normal successful walk reports available:true with no unavailableReason key at all', async () => {
  const dir = freshSnapDir('forms-availability-healthy');
  ensurePrivateDir(dir);
  try {
    const client = new AvailabilityStubCdpClient('forms', 'healthy');
    await collectForms(buildAvailabilityContext(client, dir));

    const written = readJson(dir, 'forms.json');
    assert.equal(written.available, true);
    assert.ok(!('unavailableReason' in written), 'a healthy walk must not carry an unavailableReason key at all');
    assert.equal(written.controls.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// Class A (I-5) continued — thrown-read honesty. Unlike the four modes above
// (a top-level read that RETURNS empty/undefined), these three force the
// underlying CDP call to REJECT outright: `Runtime.evaluate` itself,
// `Runtime.getProperties` on the held container (`ownPropertyObjectIds`),
// and `Runtime.callFunctionOn` on the held `facts` object (`readHeldValue`).
// Pre-fix, any of these three throws propagates straight out of
// collectText/collectForms — the collector crashes instead of writing an
// honest `available:false` artifact. Mirrors hittest.ts's `walk-evaluate-threw`.
// ============================================================================

test('collectText: Runtime.evaluate rejecting outright reports available:false, unavailableReason:walk-evaluate-threw, and elements:[] instead of crashing the collector', async () => {
  const dir = freshSnapDir('text-availability-evaluate-throws');
  ensurePrivateDir(dir);
  try {
    const client = new AvailabilityStubCdpClient('text', 'evaluate-throws');
    await collectText(buildAvailabilityContext(client, dir));

    const written = readJson(dir, 'text.json');
    assert.equal(written.available, false, 'a thrown top-level evaluate must not report available:true');
    assert.equal(written.unavailableReason, 'walk-evaluate-threw');
    assert.deepEqual(written.elements, []);
    assert.ok(!('elementsTotal' in written.coverage), 'coverage must not fabricate an elementsTotal when the walk threw');
    assert.ok(!('elementsTruncated' in written.coverage), 'coverage must not fabricate a truncation count when the walk threw');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectText: the held-container Runtime.getProperties rejecting outright reports available:false, unavailableReason:walk-evaluate-threw, and elements:[] instead of crashing the collector', async () => {
  const dir = freshSnapDir('text-availability-container-properties-throws');
  ensurePrivateDir(dir);
  try {
    const client = new AvailabilityStubCdpClient('text', 'container-properties-throws');
    await collectText(buildAvailabilityContext(client, dir));

    const written = readJson(dir, 'text.json');
    assert.equal(written.available, false);
    assert.equal(written.unavailableReason, 'walk-evaluate-threw');
    assert.deepEqual(written.elements, []);
    assert.ok(!('elementsTotal' in written.coverage));
    assert.ok(!('elementsTruncated' in written.coverage));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectText: the held-facts Runtime.callFunctionOn rejecting outright reports available:false, unavailableReason:walk-evaluate-threw, and elements:[] instead of crashing the collector', async () => {
  const dir = freshSnapDir('text-availability-facts-read-throws');
  ensurePrivateDir(dir);
  try {
    const client = new AvailabilityStubCdpClient('text', 'facts-read-throws');
    await collectText(buildAvailabilityContext(client, dir));

    const written = readJson(dir, 'text.json');
    assert.equal(written.available, false);
    assert.equal(written.unavailableReason, 'walk-evaluate-threw');
    assert.deepEqual(written.elements, []);
    assert.ok(!('elementsTotal' in written.coverage));
    assert.ok(!('elementsTruncated' in written.coverage));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: Runtime.evaluate rejecting outright reports available:false, unavailableReason:walk-evaluate-threw, and controls:[] instead of crashing the collector', async () => {
  const dir = freshSnapDir('forms-availability-evaluate-throws');
  ensurePrivateDir(dir);
  try {
    const client = new AvailabilityStubCdpClient('forms', 'evaluate-throws');
    await collectForms(buildAvailabilityContext(client, dir));

    const written = readJson(dir, 'forms.json');
    assert.equal(written.available, false, 'a thrown top-level evaluate must not report available:true');
    assert.equal(written.unavailableReason, 'walk-evaluate-threw');
    assert.deepEqual(written.controls, []);
    assert.ok(!('controlsTotal' in written.coverage), 'coverage must not fabricate a controlsTotal when the walk threw');
    assert.ok(!('controlsTruncated' in written.coverage), 'coverage must not fabricate a truncation count when the walk threw');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: the held-container Runtime.getProperties rejecting outright reports available:false, unavailableReason:walk-evaluate-threw, and controls:[] instead of crashing the collector', async () => {
  const dir = freshSnapDir('forms-availability-container-properties-throws');
  ensurePrivateDir(dir);
  try {
    const client = new AvailabilityStubCdpClient('forms', 'container-properties-throws');
    await collectForms(buildAvailabilityContext(client, dir));

    const written = readJson(dir, 'forms.json');
    assert.equal(written.available, false);
    assert.equal(written.unavailableReason, 'walk-evaluate-threw');
    assert.deepEqual(written.controls, []);
    assert.ok(!('controlsTotal' in written.coverage));
    assert.ok(!('controlsTruncated' in written.coverage));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectForms: the held-facts Runtime.callFunctionOn rejecting outright reports available:false, unavailableReason:walk-evaluate-threw, and controls:[] instead of crashing the collector', async () => {
  const dir = freshSnapDir('forms-availability-facts-read-throws');
  ensurePrivateDir(dir);
  try {
    const client = new AvailabilityStubCdpClient('forms', 'facts-read-throws');
    await collectForms(buildAvailabilityContext(client, dir));

    const written = readJson(dir, 'forms.json');
    assert.equal(written.available, false);
    assert.equal(written.unavailableReason, 'walk-evaluate-threw');
    assert.deepEqual(written.controls, []);
    assert.ok(!('controlsTotal' in written.coverage));
    assert.ok(!('controlsTruncated' in written.coverage));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// I-5 residual — text.ts per-element `platformFontsAvailable`/`fallbackUsed`
// honesty. Pre-fix, a `CSS.getPlatformFontsForNode` failure (or the read
// never being attempted because `DOM.describeNode` didn't resolve a
// `nodeId`) left `rawPlatformFontFamilies`/`platformFonts` empty and
// `fallbackUsed` computed from that empty array as a plain `false` —
// INDISTINGUISHABLE from a genuine read that proved no fallback font was
// used. A dedicated stub (real call-site: `CSS.getPlatformFontsForNode`
// itself throws, or `DOM.describeNode` never yields a `nodeId`) drives the
// real per-element identity-bridge + font-read call sites `collectText`
// actually exercises, not a shortcut around them.
// ============================================================================

type PlatformFontsMode = 'throws' | 'success-empty' | 'success-fallback' | 'node-id-unresolved' | 'malformed';

const PF_ELEMENT_OBJECT_ID = 'text-pf-el-0';

class PlatformFontsStubCdpClient {
  constructor(private readonly mode: PlatformFontsMode) {}

  async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (method === 'Runtime.evaluate') {
      const expression = String((params as { expression?: unknown }).expression ?? '');
      if (expression.includes('MAX_ELEMENTS')) {
        return { result: { objectId: TEXT_RESULT_OBJECT_ID } };
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
      if (objectId === TEXT_ELEMENTS_OBJECT_ID) {
        // One resolved element handle — the real bridge collectText drives
        // for every text record via resolveIndexedObjectIds.
        return { result: [{ name: '0', value: { objectId: PF_ELEMENT_OBJECT_ID } }] };
      }
      return { result: [] };
    }

    if (method === 'Runtime.callFunctionOn') {
      const objectId = (params as { objectId?: string }).objectId;
      if (objectId === TEXT_FACTS_OBJECT_ID) {
        return {
          result: {
            value: {
              records: [{ ...MINIMAL_TEXT_RECORD, fontFamily: 'sans-serif' }],
              iframesNotWalked: 0,
              shadowRootsNotWalked: 0,
              elementsTotal: 1,
            },
          },
        };
      }
      return { result: {} };
    }

    if (method === 'DOM.describeNode') {
      if (this.mode === 'node-id-unresolved') {
        // DOM.describeNode itself resolves cleanly but returns no nodeId at
        // all — the real site where the font read is never even attempted,
        // distinct from CSS.getPlatformFontsForNode throwing.
        return { node: { backendNodeId: 100 } };
      }
      return { node: { nodeId: 42, backendNodeId: 100 } };
    }

    if (method === 'CSS.getPlatformFontsForNode') {
      if (this.mode === 'throws') {
        // The real call site the flagged finding targets — a genuine CDP
        // rejection, not a simulated empty result.
        throw new Error('CSS.getPlatformFontsForNode rejected (simulated)');
      }
      if (this.mode === 'success-fallback') {
        return { fonts: [{ familyName: 'Times New Roman', isCustomFont: false }] };
      }
      if (this.mode === 'malformed') {
        // T14: the CDP call resolves without throwing, but its `fonts` field
        // is missing entirely — distinct from a genuine empty-array success.
        return {};
      }
      // 'success-empty' (and 'node-id-unresolved', never reached here): a
      // genuine successful read that legitimately found no platform fonts.
      return { fonts: [] };
    }

    if (method === 'Runtime.releaseObject') return {};

    return {};
  }
}

function asPlatformFontsClient(stub: PlatformFontsStubCdpClient): CDPClient {
  return stub as unknown as CDPClient;
}

function buildPlatformFontsContext(client: PlatformFontsStubCdpClient, dir: string): SnapshotContext {
  return {
    client: asPlatformFontsClient(client),
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

test('collectText: CSS.getPlatformFontsForNode throwing reports platformFontsAvailable:false, a fixed unavailableReason, and fallbackUsed:null — NOT the benign fallbackUsed:false shape (fails pre-fix)', async () => {
  const dir = freshSnapDir('text-platform-fonts-throws');
  ensurePrivateDir(dir);
  try {
    const client = new PlatformFontsStubCdpClient('throws');
    await collectText(buildPlatformFontsContext(client, dir));

    const written = readJson(dir, 'text.json');
    assert.equal(written.elements.length, 1);
    const el = written.elements[0];
    assert.equal(el.platformFontsAvailable, false, 'a thrown platform-font read must not report platformFontsAvailable:true');
    assert.equal(el.platformFontsUnavailableReason, 'platform-fonts-read-threw');
    assert.equal(el.fallbackUsed, null, 'a failed read must never coerce to the benign fallbackUsed:false shape');
    assert.deepEqual(el.platformFonts, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectText: DOM.describeNode resolving without a nodeId (font read never attempted) reports platformFontsAvailable:false, unavailableReason:platform-fonts-node-id-unresolved, and fallbackUsed:null', async () => {
  const dir = freshSnapDir('text-platform-fonts-node-id-unresolved');
  ensurePrivateDir(dir);
  try {
    const client = new PlatformFontsStubCdpClient('node-id-unresolved');
    await collectText(buildPlatformFontsContext(client, dir));

    const written = readJson(dir, 'text.json');
    const el = written.elements[0];
    assert.equal(el.platformFontsAvailable, false);
    assert.equal(el.platformFontsUnavailableReason, 'platform-fonts-node-id-unresolved');
    assert.equal(el.fallbackUsed, null);
    assert.deepEqual(el.platformFonts, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectText: positive control — a genuine successful read that legitimately finds zero platform fonts reports platformFontsAvailable:true, fallbackUsed:false (real observation), and NO unavailableReason key', async () => {
  const dir = freshSnapDir('text-platform-fonts-success-empty');
  ensurePrivateDir(dir);
  try {
    const client = new PlatformFontsStubCdpClient('success-empty');
    await collectText(buildPlatformFontsContext(client, dir));

    const written = readJson(dir, 'text.json');
    const el = written.elements[0];
    assert.equal(el.platformFontsAvailable, true, 'a genuine empty read must still report available:true — empty is a real observation, not a failure');
    assert.ok(!('platformFontsUnavailableReason' in el), 'a genuinely available read must carry no unavailableReason key at all');
    assert.equal(el.fallbackUsed, false, 'a genuine read that found zero platform fonts legitimately reports no fallback used');
    assert.deepEqual(el.platformFonts, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectText: positive control — a genuine successful read that finds a real fallback font reports platformFontsAvailable:true and fallbackUsed:true with the sanitized font fact', async () => {
  const dir = freshSnapDir('text-platform-fonts-success-fallback');
  ensurePrivateDir(dir);
  try {
    const client = new PlatformFontsStubCdpClient('success-fallback');
    await collectText(buildPlatformFontsContext(client, dir));

    const written = readJson(dir, 'text.json');
    const el = written.elements[0];
    assert.equal(el.platformFontsAvailable, true);
    assert.ok(!('platformFontsUnavailableReason' in el));
    assert.equal(el.fallbackUsed, true, 'Times New Roman is not present in the declared sans-serif fontFamily, so this IS a genuine fallback');
    assert.deepEqual(el.platformFonts, [{ familyName: 'Times New Roman', isCustomFont: false }]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('collectText: T14 — CSS.getPlatformFontsForNode resolving without throwing but with no `fonts` field at all reports platformFontsAvailable:false, unavailableReason:platform-fonts-malformed, and fallbackUsed:null — NOT the benign zero-fonts success shape (fails pre-fix)', async () => {
  const dir = freshSnapDir('text-platform-fonts-malformed');
  ensurePrivateDir(dir);
  try {
    const client = new PlatformFontsStubCdpClient('malformed');
    await collectText(buildPlatformFontsContext(client, dir));

    const written = readJson(dir, 'text.json');
    const el = written.elements[0];
    assert.equal(el.platformFontsAvailable, false, 'a malformed fonts field must not be coerced into a genuine zero-fonts success');
    assert.equal(el.platformFontsUnavailableReason, 'platform-fonts-malformed');
    assert.equal(el.fallbackUsed, null, 'a malformed read must never coerce to the benign fallbackUsed:false shape');
    assert.deepEqual(el.platformFonts, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ============================================================================
// Real-Chrome sections — A1 (text baseline honesty) and A2 (forms
// line-height honesty). Both invariants require adversarial real-Chrome
// evidence per the observational-collector-invariants gate (I-4).
// ============================================================================


async function rcNewPageTarget(port: number): Promise<string> {
  const resp = await fetch(`http://localhost:${port}/json/new?about:blank`, { method: 'PUT' });
  const json = (await resp.json()) as { webSocketDebuggerUrl?: string };
  if (!json.webSocketDebuggerUrl) throw new Error('no webSocketDebuggerUrl in /json/new response');
  return json.webSocketDebuggerUrl;
}

async function rcWaitForReady(client: CDPClient, expr: string, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = (await client.send('Runtime.evaluate', { expression: expr, returnByValue: true })) as {
      result?: { value?: boolean };
    };
    if (res.result?.value) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`fixture page did not become ready in time: ${expr}`);
}

function memoryWriter(store: Record<string, unknown>): SnapshotWriter {
  return {
    json(filename, value) {
      store[filename] = value;
    },
    binary(filename, data) {
      store[filename] = data;
    },
  };
}

function buildRealContext(client: CDPClient, url: string, store: Record<string, unknown>): SnapshotContext {
  return {
    client,
    dir: '/tmp/measure-text-forms-invariants-unused',
    snapId: 'invariants-snap',
    url,
    viewport: null,
    settled: true,
    freezeAnimations: false,
    captureUnsettled: false,
    pixels: false,
    state: [],
    unstableRegions: [],
    write: memoryWriter(store),
  };
}

// ----------------------------------------------------------------------------
// A1 real-Chrome: text.ts's baseline is always canvas-`measureText`-derived,
// never a native line-box reading — but takes a crude `rect.height * 0.2`
// fallback whenever `TextMetrics.actualBoundingBoxDescent` for 'Hg' isn't a
// usable positive number. The FIRST sub-test proves the DEFAULT/common case
// (a normal font, unmodified Chrome) resolves the precise per-font descent
// and reports `baselineApproximate: false` — the necessary control showing
// the flag isn't just hardcoded true. The SECOND sub-test forces the crude
// fallback by monkeypatching `CanvasRenderingContext2D.prototype.measureText`
// for exactly the 'Hg' probe string the collector issues (simulating the
// real edge case of a font/engine combination where that metric is
// unavailable, without needing a specific system font to reproduce it
// deterministically) and asserts `baselineApproximate: true` — this fails
// pre-fix, where `baseline` was emitted as a plain exact-looking number with
// no marker at all.
// ----------------------------------------------------------------------------

const RC_BASELINE_NORMAL_HTML = `<!DOCTYPE html><html><body style="margin:0;font:16px sans-serif;">
<p id="p1">Some measurable text content for the walk to find</p>
</body></html>`;
const RC_BASELINE_NORMAL_URL = `data:text/html,${encodeURIComponent(RC_BASELINE_NORMAL_HTML)}`;

const RC_BASELINE_FALLBACK_HTML = `<!DOCTYPE html><html><body style="margin:0;font:16px sans-serif;">
<p id="p1">Some measurable text content for the walk to find</p>
<script>
  window.__hgMeasured = false;
  var proto = CanvasRenderingContext2D.prototype;
  var origMeasureText = proto.measureText;
  proto.measureText = function (text) {
    if (text === 'Hg') {
      window.__hgMeasured = true;
      // Stands in for a real font/engine combination where a usable
      // actualBoundingBoxDescent for this probe string is unavailable —
      // the exact condition text.ts's baselineFor() must fall back on.
      return { actualBoundingBoxDescent: 0, width: 0 };
    }
    return origMeasureText.call(this, text);
  };
  window.__fallbackReady = true;
</script>
</body></html>`;
const RC_BASELINE_FALLBACK_URL = `data:text/html,${encodeURIComponent(RC_BASELINE_FALLBACK_HTML)}`;

describe('A1 real-Chrome: text.ts baseline honesty — baselineApproximate marks the crude rect.height*0.2 fallback, never the precise path', () => {
  let chromeProc: ChildProcess | undefined;
  let client: CDPClient | undefined;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    chromeProc = proc;
    const wsUrl = await rcNewPageTarget(port);
    client = new CDPClient(wsUrl);
    await client.waitReady();
    await enableDomainsForSnap(client);
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

  test('control: an unmodified real font resolves the precise per-glyph descent, so baselineApproximate is false', async () => {
    if (!client) throw new Error('client not ready');
    await client.send('Page.navigate', { url: RC_BASELINE_NORMAL_URL });
    await rcWaitForReady(client, `document.readyState === 'complete'`);

    const store: Record<string, unknown> = {};
    await collectText(buildRealContext(client, RC_BASELINE_NORMAL_URL, store));
    const text = store['text.json'] as { elements: Array<{ id: string; lines: Array<{ baseline: number | null; baselineApproximate: boolean }> }> };
    const p1 = text.elements.find((e) => e.id === 'txt-0');
    assert.ok(p1, 'the <p> text element must be present');
    assert.ok(p1!.lines.length > 0, 'the element must have at least one measured line');
    assert.equal(typeof p1!.lines[0].baseline, 'number', 'baseline must resolve to a real number in the default/common case');
    assert.equal(p1!.lines[0].baselineApproximate, false, 'the precise actualBoundingBoxDescent path must NOT be flagged approximate');
  });

  test('a page forcing the actualBoundingBoxDescent-unavailable condition for the Hg probe makes text.ts fall back to rect.height*0.2 and flag baselineApproximate:true (fails pre-fix — no marker existed at all)', async () => {
    if (!client) throw new Error('client not ready');
    await client.send('Page.navigate', { url: RC_BASELINE_FALLBACK_URL });
    await rcWaitForReady(client, `document.readyState === 'complete' && window.__fallbackReady === true`);

    const store: Record<string, unknown> = {};
    await collectText(buildRealContext(client, RC_BASELINE_FALLBACK_URL, store));

    const hgMeasured = (await client.send('Runtime.evaluate', {
      expression: 'window.__hgMeasured',
      returnByValue: true,
    })) as { result?: { value?: boolean } };
    assert.equal(hgMeasured.result?.value, true, 'the fixture\'s Hg-probe override must actually have fired — otherwise this test proves nothing');

    const text = store['text.json'] as { elements: Array<{ id: string; lines: Array<{ baseline: number | null; baselineApproximate: boolean }> }> };
    const p1 = text.elements.find((e) => e.id === 'txt-0');
    assert.ok(p1, 'the <p> text element must be present');
    assert.ok(p1!.lines.length > 0, 'the element must have at least one measured line');
    assert.equal(p1!.lines[0].baselineApproximate, true, 'the crude rect.height*0.2 fallback must be flagged approximate');
    assert.equal(typeof p1!.lines[0].baseline, 'number', 'a fallback-derived baseline is still emitted (approximate, not withheld) — I-4 allows either an honest flag or withholding, this collector chooses the honest flag');
  });
});

// ----------------------------------------------------------------------------
// A2 real-Chrome: forms.ts's single-line native-control rects use a
// `1.2 * font-size` line-height heuristic whenever Chrome's computed
// `line-height` is the literal `normal` keyword. This is verified to be the
// COMMON case (no authored `line-height` at all) against real headless
// Chrome, not a rare edge case requiring page-side monkeypatching — so both
// sub-tests below use plain CSS, no script injection.
// ----------------------------------------------------------------------------

const RC_LINEHEIGHT_NORMAL_HTML = `<!DOCTYPE html><html><body style="margin:0;font:16px monospace;">
<input id="i1" type="text" value="hello lineheight" style="width:200px;">
</body></html>`;
const RC_LINEHEIGHT_NORMAL_URL = `data:text/html,${encodeURIComponent(RC_LINEHEIGHT_NORMAL_HTML)}`;

const RC_LINEHEIGHT_EXPLICIT_HTML = `<!DOCTYPE html><html><body style="margin:0;font:16px monospace;">
<input id="i1" type="text" value="hello lineheight" style="width:200px;line-height:20px;">
</body></html>`;
const RC_LINEHEIGHT_EXPLICIT_URL = `data:text/html,${encodeURIComponent(RC_LINEHEIGHT_EXPLICIT_HTML)}`;

describe('A2 real-Chrome: forms.ts single-line rect honesty — lineHeightApproximate marks the 1.2*font-size fallback used when Chrome computes line-height:normal', () => {
  let chromeProc: ChildProcess | undefined;
  let client: CDPClient | undefined;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    chromeProc = proc;
    const wsUrl = await rcNewPageTarget(port);
    client = new CDPClient(wsUrl);
    await client.waitReady();
    await enableDomainsForSnap(client);
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

  test('a plain <input> with NO authored line-height computes line-height:normal in real Chrome, and forms.ts flags its rects lineHeightApproximate:true (fails pre-fix — no marker existed at all)', async () => {
    if (!client) throw new Error('client not ready');
    await client.send('Page.navigate', { url: RC_LINEHEIGHT_NORMAL_URL });
    await rcWaitForReady(client, `document.readyState === 'complete'`);

    // Confirm the real-Chrome precondition this finding depends on: Chrome
    // actually reports the literal 'normal' keyword here, not a used px value.
    const computed = (await client.send('Runtime.evaluate', {
      expression: `getComputedStyle(document.getElementById('i1')).lineHeight`,
      returnByValue: true,
    })) as { result?: { value?: string } };
    assert.equal(computed.result?.value, 'normal', 'precondition: Chrome must compute line-height:normal for an unstyled input, or this test proves nothing');

    const store: Record<string, unknown> = {};
    await collectForms(buildRealContext(client, RC_LINEHEIGHT_NORMAL_URL, store));
    const forms = store['forms.json'] as { controls: Array<Record<string, any>> };
    const input = forms.controls.find((c) => c.selector === '#i1');
    assert.ok(input, 'the input control must be present');
    assert.equal(input!.lineHeightApproximate, true, 'the 1.2*font-size fallback (used because Chrome computed \'normal\') must be flagged approximate');
    assert.ok(Array.isArray(input!.valueLineBoxes) && input!.valueLineBoxes.length > 0, 'the rect must still be emitted, just flagged, not withheld');
  });

  test('control: the same input with an authored line-height gets an exact computed value and lineHeightApproximate:false', async () => {
    if (!client) throw new Error('client not ready');
    await client.send('Page.navigate', { url: RC_LINEHEIGHT_EXPLICIT_URL });
    await rcWaitForReady(client, `document.readyState === 'complete'`);

    const computed = (await client.send('Runtime.evaluate', {
      expression: `getComputedStyle(document.getElementById('i1')).lineHeight`,
      returnByValue: true,
    })) as { result?: { value?: string } };
    assert.equal(computed.result?.value, '20px', 'precondition: an authored line-height must resolve to a real px value');

    const store: Record<string, unknown> = {};
    await collectForms(buildRealContext(client, RC_LINEHEIGHT_EXPLICIT_URL, store));
    const forms = store['forms.json'] as { controls: Array<Record<string, any>> };
    const input = forms.controls.find((c) => c.selector === '#i1');
    assert.ok(input);
    assert.equal(input!.lineHeightApproximate, false, 'an authored, resolvable line-height must NOT be flagged approximate');
  });

  test('preserves the existing textarea unavailable path: a <textarea> gets textLayout.available:false and carries no lineHeightApproximate at all (N/A, not false)', async () => {
    if (!client) throw new Error('client not ready');
    const html = `<!DOCTYPE html><html><body style="margin:0;font:16px monospace;">
<textarea id="ta1" style="width:200px;height:60px;">wraps across possibly multiple visual lines in a narrow box</textarea>
</body></html>`;
    const url = `data:text/html,${encodeURIComponent(html)}`;
    await client.send('Page.navigate', { url });
    await rcWaitForReady(client, `document.readyState === 'complete'`);

    const store: Record<string, unknown> = {};
    await collectForms(buildRealContext(client, url, store));
    const forms = store['forms.json'] as { controls: Array<Record<string, any>> };
    const textarea = forms.controls.find((c) => c.tagName === 'textarea');
    assert.ok(textarea, 'the textarea control must be present');
    assert.deepEqual(textarea!.textLayout, { available: false, reason: 'textarea-wrapping-requires-layout' });
    assert.ok(!('lineHeightApproximate' in textarea!), 'a textarea never computes single-line rects, so lineHeightApproximate must be OMITTED (N/A), not false');
  });
});

// ----------------------------------------------------------------------------
// T2 real-Chrome: `findWrapOffsets()`'s binary search creates a fresh
// `Range` per candidate offset and previously mutated the search bound
// (`hi = mid; continue;`) whenever `Range.setStart`/`setEnd` threw mid-
// search — corrupting the search invariant while STILL emitting whatever
// offset the corrupted search converged to, indistinguishable from a real
// measured wrap point (I-4). This monkeypatches `Range.prototype.setStart`
// to throw for every NON-ZERO offset — the exact real call site
// (`findWrapOffsets`'s binary-search `r.setStart(textNode, mid)`, where
// `mid` is essentially never 0 for a multi-line wrap) while leaving the
// walk's own line-rect-extraction range untouched (it always calls
// `setStart(textNodes[0], 0)`, offset exactly 0), so only the wrap-offset
// search is affected, not the whole collector.
// ----------------------------------------------------------------------------

const RC_WRAP_OFFSETS_HTML = `<!DOCTYPE html><html><body style="margin:0;font:16px monospace;">
<p id="p1" style="width:120px;">Some measurable wrapped text content for the search</p>
<script>
  window.__setStartFailures = 0;
  var proto = Range.prototype;
  var origSetStart = proto.setStart;
  proto.setStart = function (node, offset) {
    if (offset !== 0) {
      window.__setStartFailures++;
      throw new Error('Range.setStart failed (simulated)');
    }
    return origSetStart.call(this, node, offset);
  };
  window.__wrapFixtureReady = true;
</script>
</body></html>`;
const RC_WRAP_OFFSETS_URL = `data:text/html,${encodeURIComponent(RC_WRAP_OFFSETS_HTML)}`;

describe('T2 real-Chrome: text.ts findWrapOffsets() honesty — a Range.setStart/setEnd failure mid-binary-search marks the wrap offset unavailable, never an exact-looking corrupted number', () => {
  let chromeProc: ChildProcess | undefined;
  let client: CDPClient | undefined;

  before(async () => {
    const { proc, port } = await spawnHeadlessChrome();
    chromeProc = proc;
    const wsUrl = await rcNewPageTarget(port);
    client = new CDPClient(wsUrl);
    await client.waitReady();
    await enableDomainsForSnap(client);
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

  test('a Range.setStart failure on every binary-search probe reports wrapAfterCharUnavailable:true and withholds wrapAfterChar for every wrap boundary — never a corrupted exact offset (fails pre-fix)', async () => {
    if (!client) throw new Error('client not ready');
    await client.send('Page.navigate', { url: RC_WRAP_OFFSETS_URL });
    await rcWaitForReady(client, `document.readyState === 'complete' && window.__wrapFixtureReady === true`);

    const store: Record<string, unknown> = {};
    await collectText(buildRealContext(client, RC_WRAP_OFFSETS_URL, store));

    const failures = (await client.send('Runtime.evaluate', {
      expression: 'window.__setStartFailures',
      returnByValue: true,
    })) as { result?: { value?: number } };
    assert.ok((failures.result?.value ?? 0) > 0, 'the fixture\'s Range.setStart override must actually have fired — otherwise this test proves nothing');

    const text = store['text.json'] as {
      elements: Array<{ id: string; lineCount: number; lines: Array<{ index: number; wrapAfterChar?: number; wrapAfterCharUnavailable?: true }> }>;
    };
    const p1 = text.elements.find((e) => e.id === 'txt-0');
    assert.ok(p1, 'the wrapped <p> text element must be present');
    assert.ok(p1!.lineCount > 1, 'the fixture must actually wrap onto multiple lines, or there is no wrap boundary to test');

    // Every boundary EXCEPT the last line (which has no "next line" to wrap
    // into, and so legitimately carries neither key) must be marked
    // unavailable rather than emitting a plausible-looking wrong offset.
    const nonLastLines = p1!.lines.slice(0, p1!.lines.length - 1);
    assert.ok(nonLastLines.length > 0, 'there must be at least one wrap boundary to assert on');
    for (const line of nonLastLines) {
      assert.equal(line.wrapAfterChar, undefined, `line ${line.index}: a corrupted binary search must never emit an exact-looking wrapAfterChar`);
      assert.equal(line.wrapAfterCharUnavailable, true, `line ${line.index}: a Range-op failure mid-search must be flagged unavailable`);
    }

    const lastLine = p1!.lines[p1!.lines.length - 1];
    assert.equal(lastLine.wrapAfterChar, undefined, 'the last line has no following line to wrap into');
    assert.ok(!('wrapAfterCharUnavailable' in lastLine), 'the last line is N/A (no such boundary), not a failed read — it must carry no unavailable marker at all');
  });

  test('control: with no Range failures injected, the same wrapped fixture resolves real numeric wrapAfterChar offsets and carries no unavailable markers', async () => {
    if (!client) throw new Error('client not ready');
    const html = `<!DOCTYPE html><html><body style="margin:0;font:16px monospace;">
<p id="p1" style="width:120px;">Some measurable wrapped text content for the search</p>
</body></html>`;
    const url = `data:text/html,${encodeURIComponent(html)}`;
    await client.send('Page.navigate', { url });
    await rcWaitForReady(client, `document.readyState === 'complete'`);

    const store: Record<string, unknown> = {};
    await collectText(buildRealContext(client, url, store));

    const text = store['text.json'] as {
      elements: Array<{ id: string; lineCount: number; lines: Array<{ index: number; wrapAfterChar?: number; wrapAfterCharUnavailable?: true }> }>;
    };
    const p1 = text.elements.find((e) => e.id === 'txt-0');
    assert.ok(p1);
    assert.ok(p1!.lineCount > 1, 'the fixture must actually wrap onto multiple lines, or there is no wrap boundary to test');

    const nonLastLines = p1!.lines.slice(0, p1!.lines.length - 1);
    for (const line of nonLastLines) {
      assert.equal(typeof line.wrapAfterChar, 'number', `line ${line.index}: a healthy Range read must resolve a real numeric wrap offset`);
      assert.ok(!('wrapAfterCharUnavailable' in line), `line ${line.index}: a healthy read must carry no unavailable marker`);
    }
  });
});
