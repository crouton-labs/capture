import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { after, before, test } from 'node:test';

import { explainSnapshot } from '../src/cdp/measure/explain.js';
import type { SnapRef } from '../src/output/artifact.js';
import { CAPTURE_ROOT, ensurePrivateDir, removeArtifactTree, writeJsonPrivate } from '../src/session/artifacts.js';
import { clearActiveSession, setActiveSession } from '../src/session-context.js';

const scope = `measure-explain-${process.pid}-${Date.now()}`;
const sessionDir = path.join(CAPTURE_ROOT, scope);
const snapDir = path.join(sessionDir, 'measure', 'snaps', 'snap-test');
const ref: SnapRef = { kind: 'snap', id: 'snap-test', dir: snapDir };
const oldNodeId = process.env.CRTR_NODE_ID;
const RAW_VALUE = 'RAW-FORM-VALUE-MUST-NOT-PRINT';
const RAW_VISIBLE = 'RAW-VISIBLE-SUBSTRING-MUST-NOT-PRINT';
const RAW_VALIDITY = 'RAW-VALIDITY-MESSAGE-MUST-NOT-PRINT';

function write(name: string, value: unknown): void {
  writeJsonPrivate(path.join(snapDir, name), value);
}

before(() => {
  process.env.CRTR_NODE_ID = scope;
  ensurePrivateDir(snapDir);
  setActiveSession({ sessionId: scope, dir: sessionDir, harId: null, targetId: null, stepCount: 0 });

  write('meta.json', {
    id: 'snap-test',
    url: 'http://example.test/explain',
    viewport: '390x844',
    settled: false,
    settleMs: 5000,
    capturedAt: new Date().toISOString(),
  });
  write('geometry.json', {
    elements: [
      {
        id: 'geo-html', backendNodeId: 1, selector: 'html', tag: 'html', domPath: 'html[0]',
        rect: { x: 0, y: 0, width: 390, height: 844 }, zIndex: 'auto',
        stackingContext: { creates: false, reasons: [] }, clipping: null,
        visibility: { visible: true, opacity: 1 },
        layout: { overflowX: 'visible', overflowY: 'visible', display: 'block', position: 'static' },
      },
      {
        id: 'geo-main', backendNodeId: 2, selector: 'main.app', tag: 'main', domPath: 'html[0]/body[0]/main[0]',
        rect: { x: 0, y: 0, width: 390, height: 844 }, zIndex: 'auto',
        stackingContext: { creates: true, reasons: ['transform'] }, clipping: null,
        visibility: { visible: true, opacity: 1 },
        layout: { overflowX: 'visible', overflowY: 'visible', display: 'block', position: 'relative' },
      },
      {
        id: 'geo-clip', backendNodeId: 3, selector: '.clip', tag: 'div', domPath: 'html[0]/body[0]/main[0]/div[0]',
        rect: { x: 10, y: 20, width: 180, height: 80 }, zIndex: 'auto',
        stackingContext: { creates: false, reasons: [] }, clipping: null,
        visibility: { visible: true, opacity: 1 },
        layout: { overflowX: 'hidden', overflowY: 'clip', display: 'block', position: 'relative' },
      },
      {
        id: 'geo-target', backendNodeId: 42, selector: '.card', tag: 'input', text: 'Target copy',
        domPath: 'html[0]/body[0]/main[0]/div[0]/input[0]',
        rect: { x: 20, y: 40, width: 220, height: 72 },
        boxModel: {
          width: 220, height: 72,
          content: [24, 44, 236, 44, 236, 104, 24, 104],
          padding: [20, 40, 240, 40, 240, 108, 20, 108],
          border: [19, 39, 241, 39, 241, 109, 19, 109],
          margin: [15, 35, 245, 35, 245, 113, 15, 113],
        },
        zIndex: '50', stackingContext: { creates: true, reasons: ['position+z-index'] },
        clipping: { clippedBy: '.clip', clippedFraction: 0.6 },
        visibility: { visible: true, opacity: 1 },
        layout: {
          boxSizing: 'border-box', position: 'relative', display: 'block', overflowX: 'visible', overflowY: 'visible',
          scrollWidth: 240, scrollHeight: 72, clientWidth: 220, clientHeight: 72,
          contributesOverflowX: true, contributesOverflowY: false,
          minWidth: '120px', maxWidth: '320px', minHeight: '40px', maxHeight: 'none', aspectRatio: '3 / 1',
          flex: { grow: 1, shrink: 1, basis: 'auto', alignSelf: 'stretch', order: 0, container: { direction: 'row', wrap: 'nowrap', justifyContent: 'start', alignItems: 'stretch', gap: '8px' } },
          grid: { columnStart: '1', columnEnd: '3', rowStart: '2', rowEnd: '3', container: { templateColumns: ['100px', '1fr'], templateRows: ['auto', '72px'], columnGap: '8px', rowGap: '4px' } },
        },
      },
      {
        id: 'geo-other', backendNodeId: 77, selector: '#other', tag: 'button', text: 'Other action',
        domPath: 'html[0]/body[0]/button[1]', rect: { x: 0, y: 200, width: 80, height: 40 },
        zIndex: 'auto', stackingContext: { creates: false, reasons: [] }, clipping: null,
        visibility: { visible: true, opacity: 1 }, layout: { overflowX: 'visible', overflowY: 'visible' },
      },
      ...Array.from({ length: 12 }, (_, index) => ({
        id: `geo-unrelated-${index}`, backendNodeId: 100 + index, selector: `.unrelated-${index}`, tag: 'div',
        domPath: `html[0]/body[0]/div[${index + 2}]`, rect: { x: 0, y: 300 + index * 10, width: 10, height: 10 },
        zIndex: 'auto', stackingContext: { creates: false, reasons: [] }, clipping: null,
        visibility: { visible: true, opacity: 1 }, layout: { overflowX: 'visible', overflowY: 'visible' },
      })),
    ],
    unstableRegions: [{
      id: 'region-card', selector: '.card', rect: { x: 15, y: 35, w: 230, h: 80 },
      elementIds: ['geo-target'], reason: 'resize observations during settle window',
    }],
  });
  write('styles.json', {
    elements: [{
      id: 'style-local-id', backendNodeId: 42, selector: '.card',
      computed: { 'padding-top': '12px', 'z-index': '50' },
      winningDeclarations: [
        { property: 'padding-top', value: '12px', declaredValue: '12px', selector: '.chat .card', specificity: '0-2-0', authored: { file: 'src/card.css', line: 41, column: 3 }, mediaQuery: '(max-width: 640px)' },
        { property: 'z-index', value: '50', declaredValue: '50', selector: '.card', specificity: '0-1-0', generated: { sourceURL: 'https://example.test/assets/app.css', line: 9, column: 2 } },
      ],
    }],
  });
  write('ax.json', {
    nodes: [
      { id: 'ax-record-target', axId: 'AX-42', backendNodeId: 42, axName: 'Account token field', role: 'textbox' },
      { id: 'ax-record-other', axId: 'AX-77', backendNodeId: 77, axName: 'Other action', role: 'button' },
    ],
  });
  write('focus.json', {
    available: true, candidateCount: 2,
    forward: [{ step: 2, id: 'focus-id', backendNodeId: 42, selector: '.card', scrollJump: true, focusVisibleStyle: { outline: '2px solid blue' } }],
    reverse: [],
  });
  write('scroll.json', {
    available: true,
    containers: [{
      backendNodeId: 3, selector: '.clip', scrollLeft: 0, scrollTop: 12, maxScrollLeft: 60, maxScrollTop: 100,
      nestedAncestry: ['html'], snapDescendants: [],
      stickyFixedDescendants: [{ backendNodeId: 42, selector: '.card' }], samples: [],
    }],
  });
  write('queries.json', {
    available: true,
    environment: { width: 390, height: 844, dpr: 2, colorScheme: 'light', pointer: 'coarse', hover: 'none', reducedMotion: 'reduce', forcedColors: 'none' },
    mediaQueries: [{ query: '(max-width: 640px)', matched: true, affectedSelectors: ['.card'] }],
    containerQueries: [{ query: '(min-width: 180px)', matched: true, affectedSelectors: ['.card'], containerSelector: '.clip', containerSize: { width: 180, height: 80 } }],
  });
  write('states.json', {
    requested: ['hover:.card'],
    elements: [{ id: 'state-id', backendNodeId: 42, selector: '.card', state: 'hover', supported: true, style: { changed: ['background-color'] }, geometry: { changed: false }, hittest: { changed: true } }],
  });
  write('text.json', {
    available: true,
    elements: [{
      id: 'text-local-id', backendNodeId: 42, selector: '.card', text: 'Target copy', textLength: 11,
      lineCount: 2, truncated: false, truncationStyle: 'none', scrollWidth: 190, clientWidth: 200,
      writingMode: 'horizontal-tb', direction: 'ltr', fallbackUsed: false,
      font: { family: 'Inter', size: '16px', weight: '600', lineHeight: '20px' },
      platformFontsAvailable: true, platformFonts: [{ familyName: 'Inter' }],
      lines: [
        { index: 0, rect: { x: 24, y: 44, width: 170, height: 20 }, baseline: 59, baselineApproximate: false, wrapAfterChar: 7 },
        { index: 1, rect: { x: 24, y: 64, width: 80, height: 20 }, baseline: 79, baselineApproximate: true },
      ],
    }],
  });
  write('forms.json', {
    available: true,
    controls: [{
      id: 'form-local-id', backendNodeId: 42, selector: '.card', type: 'password',
      rect: { x: 20, y: 40, width: 220, height: 72 },
      dimensions: { clientWidth: 220, clientHeight: 72, scrollWidth: 240, scrollHeight: 72 },
      valueLength: 31, redacted: true, redactionReason: 'password-field',
      value: RAW_VALUE, text: RAW_VALUE,
      visibleSubstring: { start: 2, end: 12, text: RAW_VISIBLE },
      selectionStart: 3, selectionEnd: 5, caretRect: { x: 60, y: 48, width: 1, height: 18 },
      selectionRects: [{ x: 60, y: 48, width: 20, height: 18 }], scroll: { left: 4, top: 0 },
      autofill: { isAutofilled: true }, nativePartDimensions: { clearButton: { width: 16, height: 16 } },
      validity: { valid: false, valueMissing: false, typeMismatch: false, patternMismatch: true, customError: false, message: RAW_VALIDITY },
    }],
  });
});

after(() => {
  process.env.CRTR_NODE_ID = scope;
  clearActiveSession();
  removeArtifactTree(sessionDir);
  if (oldNodeId === undefined) delete process.env.CRTR_NODE_ID;
  else process.env.CRTR_NODE_ID = oldNodeId;
});

function run(...args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/capture.ts', 'measure', 'explain', ...args], {
    cwd: path.resolve('.'),
    env: { ...process.env, CRTR_NODE_ID: scope },
    encoding: 'utf8',
  });
}

test('compact explain command reports provenance, clipping, context, per-record caveats, and unsettled attestation', () => {
  const result = run('snap-test', '--selector', '.card');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /<explain path="[^"]+" snap="snap-test" selector="\.card"/);
  assert.match(result.stdout, /rect x=20 y=40 w=220 h=72/);
  assert.match(result.stdout, /Style winner padding-top=12px: selector \.chat \.card; specificity 0-2-0; source src\/card\.css:41:3 \(authored\)/);
  assert.match(result.stdout, /Style winner z-index=50: selector \.card; specificity 0-1-0; source https:\/\/example\.test\/assets\/app\.css:9:2 \(generated\)/);
  assert.match(result.stdout, /Stacking ancestor main\.app/);
  assert.match(result.stdout, /Clipping ancestor \.clip: overflow-x=hidden; overflow-y=clip; clips-target=true; visible-fraction=0\.6/);
  assert.match(result.stdout, /Focus context: step=2/);
  assert.match(result.stdout, /Scroll context: container=\.clip/);
  assert.match(result.stdout, /Active media query \(max-width: 640px\)/);
  assert.match(result.stdout, /State hover: supported=true; style changes=background-color/);
  assert.match(result.stdout, /nondeterminism caveat: region-card \(\.card\): resize observations during settle window/);
  assert.match(result.stdout, /Snapshot was captured unsettled/);
  assert.doesNotMatch(result.stdout, /Box model:|Text metrics:|Form control:/);
});

test('detail flags add size, text, and redacted form facts without rendering any value, visible substring, or validity message', () => {
  const result = run('snap-test', '--selector', 'backend:42', '--size', '--text', '--form');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Box model: measured width=220; height=72/);
  assert.match(result.stdout, /Constraints: min-width=120px; max-width=320px; min-height=40px; max-height=none; aspect-ratio=3 \/ 1/);
  assert.match(result.stdout, /Flex allocation: grow=1; shrink=1; basis=auto/);
  assert.match(result.stdout, /Grid allocation: column=1 \/ 3; row=2 \/ 3/);
  assert.match(result.stdout, /Text line 0: rect x=24 y=44 w=170 h=20; baseline=59; baseline-approximate=false; wrap-after-char=7/);
  assert.match(result.stdout, /Font metrics: family=Inter; size=16px; weight=600; line-height=20px/);
  assert.match(result.stdout, /Form control: type=password; rect=x=20 y=40 w=220 h=72/);
  assert.match(result.stdout, /Form value measurement: length=31; redacted=true; redaction-reason=password-field; value and visible substring withheld/);
  assert.match(result.stdout, /Selection\/caret: start=3; end=5; caret=/);
  assert.match(result.stdout, /autofilled=true; native-part-dimensions=/);
  assert.match(result.stdout, /message withheld/);
  assert.ok(!result.stdout.includes(RAW_VALUE));
  assert.ok(!result.stdout.includes(RAW_VISIBLE));
  assert.ok(!result.stdout.includes(RAW_VALIDITY));
});

test('missing selector returns bounded nearest CSS recovery candidates while full identity facts remain in snapshot artifacts', () => {
  const typed = explainSnapshot(ref, '.missing');
  assert.equal(typed.kind, 'missing-selector');
  if (typed.kind !== 'missing-selector') return;
  assert.equal(typed.available.recordCount, 17);
  assert.ok(typed.available.candidates.includes('.card'));
  assert.equal(typed.available.candidates.length, 8);

  const result = run('snap-test', '--selector', '.missing');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /status="missing_selector"/);
  assert.match(result.stdout, /Nearest recorded CSS selectors: 8 shown from 17 geometry record\(s\), ranked by identifier similarity then string distance/);
  assert.match(result.stdout, /\d+\. \.card/);
  assert.match(result.stdout, /geometry\.json, ax\.json, and text\.json artifacts/);
  assert.doesNotMatch(result.stdout, /backend: backend:42/);
});

test('missing identity input ranks and renders candidates in the requested selector form', () => {
  const typed = explainSnapshot(ref, 'axid:AX-4x');
  assert.equal(typed.kind, 'missing-selector');
  if (typed.kind !== 'missing-selector') return;
  assert.equal(typed.available.kind, 'axid');
  assert.equal(typed.available.candidates[0], 'axid:AX-42');

  const result = run('snap-test', '--selector', 'axid:AX-4x');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /Nearest recorded axid: selector inputs/);
  assert.match(result.stdout, /1\. axid:AX-42/);
});
