import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test } from 'node:test';

import { cmdMeasureDiff } from '../src/cdp/commands/measure/diff.js';
import { diffSnapshots } from '../src/cdp/measure/diff.js';
import { CAPTURE_ROOT, ensurePrivateDir, writeJsonPrivate } from '../src/session/artifacts.js';
import type { SnapRef } from '../src/output/artifact.js';

const FIXTURES = path.join(__dirname, 'fixtures', 'pixels');

interface SnapOptions {
  changed?: boolean;
  backendNodeId?: number;
  rectShape?: 'wh' | 'widthHeight';
  includeStates?: boolean;
  winningSelector?: string;
  sourceStyleSheetId?: string;
  duplicateSelector?: boolean;
  unstable?: boolean;
  geometrySelector?: string;
  unstableSelector?: string;
  unstableElementIds?: readonly string[];
  geometryExtras?: readonly { readonly id: string; readonly backendNodeId: number; readonly selector: string; readonly rect: Record<string, number> }[];
  stateRows?: readonly string[];
}

function rectFor(changed: boolean, shape: 'wh' | 'widthHeight'): Record<string, number> {
  const rect = changed ? { x: 12, y: 20, w: 120, h: 40 } : { x: 10, y: 20, w: 100, h: 40 };
  return shape === 'widthHeight' ? { x: rect.x, y: rect.y, width: rect.w, height: rect.h } : rect;
}

function snap(id: string, options: SnapOptions = {}): SnapRef {
  const changed = Boolean(options.changed);
  const backendNodeId = options.backendNodeId ?? 42;
  const rectShape = options.rectShape ?? 'wh';
  const includeStates = options.includeStates ?? true;
  const dir = path.join(CAPTURE_ROOT, `measure-diff-${process.pid}`, 'measure', 'snaps', id);
  ensurePrivateDir(dir);
  const rect = rectFor(changed, rectShape);
  const color = changed ? 'rgb(255, 0, 0)' : 'rgb(0, 0, 0)';
  writeJsonPrivate(path.join(dir, 'meta.json'), { id, url: 'http://example.test', viewport: '390x844', settled: !changed, capturedAt: '2026-07-10T00:00:00Z' });
  const extra = options.duplicateSelector ? [{ id: 'g-2', backendNodeId: backendNodeId + 1, selector: '.card', rect: { x: 200, y: 20, w: 100, h: 40 } }] : [];
  const geometrySelector = options.geometrySelector ?? '.card';
  writeJsonPrivate(path.join(dir, 'geometry.json'), { elements: [{ id: 'g-1', backendNodeId, selector: geometrySelector, rect }, ...extra, ...(options.geometryExtras ?? [])], ...(changed || options.unstable ? { unstableRegions: [{ id: 'unstable-card', selector: options.unstableSelector ?? '.card', reason: 'resize evidence', ...(options.unstableElementIds === undefined ? { elementIds: [String(backendNodeId)] } : options.unstableElementIds.length ? { elementIds: options.unstableElementIds } : {}) }] } : {}) });
  const style = (id: string, nodeId: number) => ({ id, backendNodeId: nodeId, selector: '.card', computed: { color, padding: changed ? '20px' : '12px', margin: '4px' }, winningDeclarations: [{ property: 'color', value: color, declaredValue: color, selector: options.winningSelector ?? '.card', specificity: '0-1-0', sourceStyleSheetId: options.sourceStyleSheetId ?? 'sheet-before', sourceStyleSheetUrl: 'http://example.test/styles.css', generated: { sourceURL: 'http://example.test/styles.css', line: 4, column: 0 } }, { property: 'margin', value: '4px', declaredValue: '4px', selector: '.card', specificity: '0-1-0', sourceStyleSheetId: options.sourceStyleSheetId ?? 'sheet-before', sourceStyleSheetUrl: 'http://example.test/styles.css', generated: { sourceURL: 'http://example.test/styles.css', line: 8, column: 0 } }] });
  writeJsonPrivate(path.join(dir, 'styles.json'), { elements: [style('s-1', backendNodeId), ...(options.duplicateSelector ? [style('s-2', backendNodeId + 1)] : [])] });
  const text = (id: string, nodeId: number, value: string) => ({ id, backendNodeId: nodeId, selector: '.card', text: value });
  writeJsonPrivate(path.join(dir, 'text.json'), { elements: [text('t-1', backendNodeId, changed ? 'after' : 'before'), ...(options.duplicateSelector ? [text('t-2', backendNodeId + 1, changed ? 'after-two' : 'before-two')] : [])] });
  writeJsonPrivate(path.join(dir, 'forms.json'), { controls: [{ id: 'f-1', backendNodeId, selector: '.card', valid: !changed }] });
  writeJsonPrivate(path.join(dir, 'media.json'), { elements: [{ id: 'm-1', backendNodeId, selector: '.card', currentSrc: changed ? 'after.png' : 'before.png' }] });
  if (includeStates) writeJsonPrivate(path.join(dir, 'states.json'), { elements: (options.stateRows ?? ['hover']).map((state) => ({ id: `state-${state}`, backendNodeId, state, selector: '.card', style: { changed: changed ? ['color'] : [] } })) });
  writeJsonPrivate(path.join(dir, 'pixels.json'), { elements: [] });
  fs.copyFileSync(path.join(FIXTURES, changed ? 'after.png' : 'before.png'), path.join(dir, 'screenshot.png'));
  return { kind: 'snap', id, dir };
}

test('measure diff records style/geometry changes, state deltas, caveats, provenance, and a private raster diff', () => {
  const before = snap('snap-before', { changed: false, backendNodeId: 10 });
  const after = snap('snap-after', { changed: true, backendNodeId: 99 });

  const report = diffSnapshots(before, after, { full: true, pixels: true });
  assert.equal(report.changed, true);
  assert.equal(report.changes.length, 1, 'same selector is cross-snapshot identity even when backendNodeId changes');
  assert.equal(report.changes[0].geometryChanged, true);
  assert.equal(report.changes[0].styleDeltas.some((delta) => delta.property === 'color'), true);
  assert.equal(report.changes[0].provenance.some((entry) => entry.property === 'margin' && !entry.changed), true, 'full report carries unchanged material provenance');
  assert.equal(report.changes[0].caveats[0].regionId, 'unstable-card');
  assert.equal(report.changes[0].caveats[0].snapshot, 'after');
  assert.equal(report.stateDeltas.length, 1);
  assert.equal(report.stateDeltas[0].changed, true);
  assert.ok(report.raster?.outcome.ok);
  if (!report.raster?.outcome.ok) return;
  assert.equal(report.raster.outcome.diffPixelCount, 9);
  assert.equal(report.raster.regions.length, 1);
  assert.equal(report.raster.regions[0].changedPixels, 9);
  assert.equal(report.raster.unexplainedRegions, 1, 'raster-only region is not attributed to non-overlapping geometry delta');
  assert.equal(fs.existsSync(report.raster.path), true);
  assert.equal(fs.statSync(report.raster.path).mode & 0o777, 0o600);
});

test('--full requires state matrices instead of treating missing states as empty', () => {
  const before = snap('snap-missing-states-before', { includeStates: false });
  const after = snap('snap-missing-states-after', { changed: true });
  assert.throws(() => diffSnapshots(before, after, { full: true }), /could not read states\.json|states\.json/);
});

test('real snapshot width/height rects participate in reflow and caveat overlap', () => {
  const before = snap('snap-width-height-before', { rectShape: 'widthHeight' });
  const after = snap('snap-width-height-after', { changed: true, rectShape: 'widthHeight' });
  const report = diffSnapshots(before, after, { full: true });
  assert.equal(report.changes[0].geometryChanged, true);
  assert.equal(report.changes[0].reflow, true);
  assert.equal(report.changes[0].caveats[0].regionId, 'unstable-card');
  assert.equal(report.changes[0].caveats[0].snapshot, 'after');
});

test('selector-only unstable regions attach producer-shaped targets for both snapshots', () => {
  const before = snap('snap-caveat-before', { changed: true, backendNodeId: 10, unstable: true, geometrySelector: '#card', unstableSelector: 'div#card.card' });
  const after = snap('snap-caveat-after', { changed: true, backendNodeId: 99, unstable: true, geometrySelector: '#card', unstableSelector: 'div#card.card' });
  const report = diffSnapshots(before, after, { full: true });
  assert.deepEqual(new Set(report.changes[0].caveats.map((caveat) => caveat.snapshot)), new Set(['before', 'after']));
  assert.equal(report.changes[0].caveats.every((caveat) => caveat.selector === 'div#card.card'), true);
});

test('identity-bearing unstable regions do not use matching raw selectors when backend identities differ', () => {
  const options = {
    changed: true,
    unstable: true,
    geometrySelector: '.card',
    unstableSelector: '.card',
    unstableElementIds: ['not-the-geometry-node'],
  } as const;
  const report = diffSnapshots(snap('snap-caveat-identity-mismatch-before', { ...options, backendNodeId: 10 }), snap('snap-caveat-identity-mismatch-after', { ...options, backendNodeId: 99 }), { full: true });
  assert.equal(report.changes[0].caveats.length, 0, 'an identity-bearing region does not attach by equal raw selector when its backend identity differs');
});

test('selector-only raw-ID caveats use exact producer strings without punctuation collisions', () => {
  const options = {
    changed: true,
    unstable: true,
    geometrySelector: '#card:one',
    unstableSelector: '#card:one',
    unstableElementIds: [],
    geometryExtras: [
      { id: 'g-2', backendNodeId: 11, selector: '#card:two', rect: { x: 200, y: 20, w: 100, h: 40 } },
      { id: 'g-3', backendNodeId: 12, selector: '#card.two', rect: { x: 320, y: 20, w: 100, h: 40 } },
      { id: 'g-4', backendNodeId: 13, selector: ' #card:one', rect: { x: 440, y: 20, w: 100, h: 40 } },
    ],
  } as const;
  const report = diffSnapshots(snap('snap-caveat-raw-id-before', { ...options, backendNodeId: 10 }), snap('snap-caveat-raw-id-after', { ...options, backendNodeId: 99 }), { full: true });
  const one = report.changes.find((record) => record.selector === '#card:one');
  const two = report.changes.find((record) => record.selector === '#card:two');
  const dot = report.changes.find((record) => record.selector === '#card.two');
  const whitespace = report.changes.find((record) => record.selector === ' #card:one');
  assert.deepEqual(new Set(one?.caveats.map((caveat) => caveat.snapshot)), new Set(['before', 'after']), 'the exact raw ID receives its selector-only caveat');
  assert.equal(two?.caveats.length, 0, 'a distinct raw ID sharing the CSS-like prefix never receives the caveat');
  assert.equal(dot?.caveats.length, 0, 'a raw dot-bearing ID is not reinterpreted as a class-bearing selector');
  assert.equal(whitespace?.caveats.length, 0, 'a whitespace-different raw selector never receives the caveat');
});

test('selector-only unstable regions match capped geometry classes in ancestor paths', () => {
  const geometrySelector = 'main#app > button.card.primary.large:nth-of-type(2)';
  const unstableSelector = 'button.card.primary.large.enabled';
  const before = snap('snap-caveat-ancestor-before', { changed: true, backendNodeId: 10, unstable: true, geometrySelector, unstableSelector });
  const after = snap('snap-caveat-ancestor-after', { changed: true, backendNodeId: 99, unstable: true, geometrySelector, unstableSelector });
  const report = diffSnapshots(before, after, { full: true });
  assert.deepEqual(new Set(report.changes[0].caveats.map((caveat) => caveat.snapshot)), new Set(['before', 'after']));
  assert.equal(report.changes[0].caveats.every((caveat) => caveat.selector === unstableSelector), true);
});

test('--full preserves every state-matrix row for one backend node', () => {
  const states = ['hover', 'focus', 'active'];
  const before = snap('snap-multi-state-before', { backendNodeId: 10, stateRows: states });
  const after = snap('snap-multi-state-after', { changed: true, backendNodeId: 99, stateRows: states });
  const report = diffSnapshots(before, after, { full: true });
  assert.equal(report.stateDeltas.length, 3);
  assert.deepEqual(new Set(report.stateDeltas.map((delta) => delta.key.split(':', 1)[0])), new Set(states));
  assert.equal(report.stateDeltas.every((delta) => delta.changed), true);
});

test('snapshot-local ids do not create deltas and duplicate stable selectors remain distinct', () => {
  const before = snap('snap-identity-before', { backendNodeId: 10, duplicateSelector: true });
  const after = snap('snap-identity-after', { backendNodeId: 99, duplicateSelector: true });
  const unchanged = diffSnapshots(before, after);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.changes.length, 0, 'different backend ids and collector-local ids are not measurements');

  const changed = diffSnapshots(before, snap('snap-identity-changed', { changed: true, backendNodeId: 99, duplicateSelector: true }));
  assert.equal(changed.changes.length, 2, 'duplicate selectors are represented by collision-safe occurrence identities');
  assert.equal(new Set(changed.changes.map((record) => record.key)).size, 2);
  assert.equal(changed.changes.every((record) => record.textChanged && record.styleDeltas.length > 0), true);
  assert.equal(changed.changes.some((record) => record.formChanged && record.mediaChanged), true);
});

test('default diff ignores opaque stylesheet IDs but renders a changed producer-shaped winning declaration', async () => {
  const opaqueBefore = snap('snap-opaque-before', { backendNodeId: 10, sourceStyleSheetId: 'cdp-sheet-10' });
  const opaqueAfter = snap('snap-opaque-after', { backendNodeId: 99, sourceStyleSheetId: 'cdp-sheet-99' });
  assert.equal(diffSnapshots(opaqueBefore, opaqueAfter).changes.length, 0, 'CDP stylesheet ids are not cascade measurements');

  const before = snap('snap-provenance-before', { backendNodeId: 10, sourceStyleSheetId: 'cdp-sheet-10', winningSelector: '.card' });
  const after = snap('snap-provenance-after', { backendNodeId: 99, sourceStyleSheetId: 'cdp-sheet-99', winningSelector: '.card.theme' });
  const report = diffSnapshots(before, after);
  assert.equal(report.changed, false);
  assert.equal(report.changes.length, 1);
  assert.equal(report.changes[0].provenance[0].declarationChanged, true);

  let stdout = '';
  const originalWrite = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    await cmdMeasureDiff({ command: 'measure', positional: [], before: before.dir, after: after.dir }, []);
  } finally {
    process.stdout.write = originalWrite;
    process.exitCode = undefined;
  }
  assert.match(stdout, /unchanged computed value; winning declaration changed/);
  assert.match(stdout, /selector":"\.card"/);
  assert.match(stdout, /selector":"\.card\.theme"/);
  assert.doesNotMatch(stdout, /\.card —\s*(?:\n|$)/, 'provenance-only records are omitted from default element delta facts');
});
