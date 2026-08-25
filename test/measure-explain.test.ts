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
const RAW_VALUE = 'RAW-FORM-VALUE-EVIDENCE';
const RAW_VISIBLE = 'RAW-VISIBLE-SUBSTRING-EVIDENCE';
const RAW_VALIDITY = 'RAW-VALIDITY-MESSAGE-EVIDENCE';

function write(name: string, value: unknown): void {
  writeJsonPrivate(path.join(snapDir, name), value);
}

before(async () => {
  process.env.CRTR_NODE_ID = scope;
  ensurePrivateDir(snapDir);
  await setActiveSession({ sessionId: scope, dir: sessionDir, harId: null, targetId: null, stepCount: 0 });

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
        boxModel: {
          width: 180, height: 80,
          content: [12, 22, 188, 22, 188, 98, 12, 98],
          padding: [10, 20, 190, 20, 190, 100, 10, 100],
          border: [9, 19, 191, 19, 191, 101, 9, 101],
          margin: [9, 19, 191, 19, 191, 101, 9, 101],
        },
        paint: { 'box-shadow': 'none', 'outline-width': '0px', 'outline-style': 'none', 'outline-offset': '0px', filter: 'none', transform: 'none', 'clip-path': 'none', 'border-radius': '8px' },
        visibility: { visible: true, opacity: 1 },
        layout: { overflowX: 'hidden', overflowY: 'clip', display: 'block', position: 'relative' },
      },
      {
        id: 'geo-target', backendNodeId: 42, selector: '.card', tag: 'input', text: 'Target copy',
        attributes: { class: 'card', 'aria-label': 'Account token field' },
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
        paint: { 'box-shadow': 'none', 'outline-width': '0px', 'outline-style': 'none', 'outline-offset': '0px', filter: 'none', transform: 'none', 'clip-path': 'none', 'border-radius': '0px' },
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
    requested: ['hover:#other'],
    elements: [{
      id: 'state-id', backendNodeId: 77, selector: '#other', state: 'hover', supported: true,
      style: { changed: ['background-color'] }, geometry: { changed: false }, hittest: { changed: true },
      affected: { elements: [{
        relation: 'descendant', backendNodeId: 42, selector: '.card',
        geometry: { after: { x: 20, y: 40, width: 220, height: 72 } },
        style: { after: { 'box-shadow': 'rgba(229,229,229,0.2) 0px 0px 0px 2px', 'outline-width': '0px', 'outline-style': 'none', 'outline-offset': '0px', filter: 'none', transform: 'none' } },
      }] },
    }],
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
      valueLength: 31,
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

test('explainSnapshot derives border and ink clipping facts directly from artifacts', () => {
  const report = explainSnapshot(ref, '.card');
  assert.equal(report.kind, 'explanation');
  if (report.kind !== 'explanation') return;
  const clipping = report.sections.find((section) => section.kind === 'stacking-clipping');
  assert.ok(clipping);
  const renderedFacts = clipping.facts.flatMap(({ fact: item }) => item.line.map((node) => node.value)).join('');
  assert.match(renderedFacts, /Border box \(base-state geometry record\): x=19…241 y=39…109/);
  assert.match(renderedFacts, /rectangular padding clip \(base-state geometry record\) x=10…190 y=20…100/);
  assert.match(renderedFacts, /border-box-overflow=right=51px bottom=9px/);
  assert.match(renderedFacts, /ink-box-overflow=right=51px bottom=9px/);
});

test('compact explain command reports provenance, clipping, context, per-record caveats, and unsettled attestation', () => {
  const result = run('snap-test', '--selector', '.card');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /<explain path="[^"]+" snap="snap-test" selector="\.card"/);
  assert.match(result.stdout, /rect x=20 y=40 w=220 h=72/);
  assert.match(result.stdout, /Style winner padding-top=12px: selector \.chat \.card; specificity 0-2-0; source src\/card\.css:41:3 \(authored\)/);
  assert.match(result.stdout, /Style winner z-index=50: selector \.card; specificity 0-1-0; source https:\/\/example\.test\/assets\/app\.css:9:2 \(generated\)/);
  assert.match(result.stdout, /Stacking ancestor main\.app/);
  assert.match(result.stdout, /Border box \(base-state geometry record\): x=19…241 y=39…109 \(w=222 h=70\)\. Ink box \(base-state geometry record\): x=19…241 y=39…109 \(w=222 h=70\); contributors: none/);
  assert.match(result.stdout, /Clipping ancestor \.clip: overflow-x=hidden; overflow-y=clip; rectangular padding clip \(base-state geometry record\) x=10…190 y=20…100 \(w=180 h=80\); border-radius=8px \(rounded clip shape not resolved\); target border\/ink source=base-state geometry record; border-box-overflows-padding-clip=true; border-box-overflow=right=51px bottom=9px; ink-box-overflows-padding-clip=true; ink-box-overflow=right=51px bottom=9px/);
  assert.match(result.stdout, /Focus context: step=2/);
  assert.match(result.stdout, /Scroll context: container=\.clip/);
  assert.match(result.stdout, /Active media query \(max-width: 640px\)/);
  assert.match(result.stdout, /State matrix context: requested=hover:#other; records forcing this element=0; records where it is an affected descendant or peer=1/);
  assert.match(result.stdout, /State hover: recorded as descendant of forced target #other; style changes=none recorded; geometry-changed=false; hittest-changed=false/);
  assert.match(result.stdout, /nondeterminism caveat: region-card \(\.card\): resize observations during settle window/);
  assert.match(result.stdout, /Snapshot was captured unsettled/);
  assert.doesNotMatch(result.stdout, /Box model:|Text metrics:|Form control:/);
});

test('explain derives an affected descendant ink box and clipping comparisons from its forced-state post-force values', () => {
  const result = run('snap-test', '--selector', '.card', '--state', 'hover');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Border box \(forced state "hover" \(states\.json record state-id, descendant row, post-force values\)\): x=20…240 y=40…112 \(w=220 h=72\)/);
  assert.match(result.stdout, /Ink box \(forced state "hover" \(states\.json record state-id, descendant row, post-force values\)\): x=18…242 y=38…114 \(w=224 h=76\); contributors: box-shadow 1 \(top=2px right=2px bottom=2px left=2px\)/);
  assert.match(result.stdout, /target border\/ink source=forced state "hover" \(states\.json record state-id, descendant row, post-force values\); border-box-overflows-padding-clip=true; border-box-overflow=right=50px bottom=12px; ink-box-overflows-padding-clip=true; ink-box-overflow=right=52px bottom=14px/);
});

test('explain reports a missing requested state row and retains the base-state answer', () => {
  const result = run('snap-test', '--selector', '.card', '--state', 'active');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Requested state "active" supplied no post-force ink source: this snapshot recorded no "active" state; it recorded hover; border\/ink and clipping comparisons use the base-state geometry record/);
  assert.match(result.stdout, /Border box \(base-state geometry record\): x=19…241 y=39…109/);
});

test('explain rejects more than one requested state at the leaf boundary', () => {
  const result = run('snap-test', '--selector', '.card', '--state', 'hover', '--state', 'focus');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /<error command="measure explain" status="invalid_input">/);
  assert.match(result.stdout, /Expected at most one --state value; received 2/);
});

test('explain rejects an empty requested state at the leaf boundary', () => {
  const result = run('snap-test', '--selector', '.card', '--state', '');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /<error command="measure explain" status="invalid_input">/);
  assert.match(result.stdout, /The --state value must be a nonempty recorded state name/);
});

test('detail flags render raw form value, visible substring, and validity message', () => {
  const result = run('snap-test', '--selector', 'backend:42', '--size', '--text', '--form');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Box model: measured width=220; height=72/);
  assert.match(result.stdout, /Constraints: min-width=120px; max-width=320px; min-height=40px; max-height=none; aspect-ratio=3 \/ 1/);
  assert.match(result.stdout, /Flex allocation: grow=1; shrink=1; basis=auto/);
  assert.match(result.stdout, /Grid allocation: column=1 \/ 3; row=2 \/ 3/);
  assert.match(result.stdout, /Text line 0: rect x=24 y=44 w=170 h=20; baseline=59; baseline-approximate=false; wrap-after-char=7/);
  assert.match(result.stdout, /Font metrics: family=Inter; size=16px; weight=600; line-height=20px/);
  assert.match(result.stdout, /Form control: type=password; rect=x=20 y=40 w=220 h=72/);
  assert.match(result.stdout, /Form value: length=31; value=/);
  assert.match(result.stdout, /visible-substring=.*\[2,12\)/);
  assert.match(result.stdout, /Selection\/caret: start=3; end=5; caret=/);
  assert.match(result.stdout, /autofilled=true; native-part-dimensions=/);
  assert.match(result.stdout, /custom-error=false; message=/);
  assert.ok(result.stdout.includes(RAW_VALUE), 'raw form value must be rendered');
  assert.ok(result.stdout.includes(RAW_VISIBLE), 'raw visible substring must be rendered');
  assert.ok(result.stdout.includes(RAW_VALIDITY), 'raw validity message must be rendered');
  assert.ok(!/withheld|redact/i.test(result.stdout), 'no withheld-evidence or redaction claim may render');
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

test('missing attribute selector recovers recognizable AX/text inputs before generated CSS paths', () => {
  const typed = explainSnapshot(ref, 'input[aria-label="Account token feld"]');
  assert.equal(typed.kind, 'missing-selector');
  if (typed.kind !== 'missing-selector') return;
  assert.equal(typed.available.interpretedValue, 'Account token feld');
  assert.equal(typed.available.candidates[0], 'ax:Account token field');

  const result = run('snap-test', '--selector', 'input[aria-label="Account token feld"]');
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /Recovery candidates: 8 shown from 17 geometry record\(s\); AX-name\/text inputs for attribute or quoted value Account token feld rank before generated CSS paths/);
  assert.match(result.stdout, /1\. ax:Account token field/);
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
