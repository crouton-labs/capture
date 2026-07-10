import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CAPTURE_ROOT, ensurePrivateDir, removeArtifactTree, writeJsonPrivate } from '../src/session/artifacts.js';
import { renderSweepArtifact, runMeasureSweep } from '../src/cdp/commands/measure/sweep.js';
import {
  analyzeSweepSamples,
  applySweepEmulation,
  fingerprintSnapshotDir,
  numericSweepValues,
  readSweepEnvironment,
  readSweepSnapshot,
  refineNumericSweep,
  restoreSweepEnvironment,
  writeSweepArtifact,
  type SweepSample,
} from '../src/cdp/measure/sweep.js';

const root = path.join(CAPTURE_ROOT, `measure-sweep-test-${process.pid}-${Date.now()}`);
after(() => removeArtifactTree(root));

function fixtureSnap(id: string, width: number, columns: string, source: string): SweepSample {
  const dir = ensurePrivateDir(path.join(root, 'measure', 'snaps', id));
  writeJsonPrivate(path.join(dir, 'meta.json'), { id, url: 'http://fixture.test/', viewport: `${width}x900`, settled: true, capturedAt: '2026-01-01T00:00:00.000Z' });
  writeJsonPrivate(path.join(dir, 'geometry.json'), { elements: [{ id: 'grid', selector: '.card-grid', visible: true, display: 'grid', rect: { x: 0, y: 0, w: width, h: 200 } }] });
  writeJsonPrivate(path.join(dir, 'text.json'), { elements: [{ id: 'hero', backendNodeId: 1, lines: [{ x: 0, y: 0, width, height: 20 }], wrapOffsets: [] }] });
  writeJsonPrivate(path.join(dir, 'styles.json'), { elements: [{ id: 'grid', selector: '.card-grid', computed: { display: 'grid', 'grid-template-columns': columns, width: `${width}px` }, winningDeclarations: [{ property: 'grid-template-columns', selector: '.card-grid', specificity: '0-1-0', authored: { file: source, line: 22, column: 3 } }] }] });
  return readSweepSnapshot(id, dir, width);
}

test('measure sweep fingerprints responsive track-count transitions and records bracketed declaration provenance', () => {
  const narrow = fixtureSnap('snap-599', 599, '1fr', 'src/styles/grid.css');
  const wide = fixtureSnap('snap-600', 600, 'repeat(2, 1fr)', 'src/styles/grid.css');
  const wider = fixtureSnap('snap-768', 768, 'repeat(2, 1fr)', 'src/styles/grid.css');
  assert.notEqual(fingerprintSnapshotDir(narrow.snapDir), fingerprintSnapshotDir(wide.snapDir));
  const analysis = analyzeSweepSamples('width', 320, 768, [narrow, wide, wider]);
  assert.equal(analysis.transitions.length, 1);
  assert.deepEqual(analysis.transitions[0]?.bracket, { from: 599, to: 600 });
  assert.equal(analysis.transitions[0]?.changes[0]?.provenance?.source, 'src/styles/grid.css:22:3');
  assert.deepEqual(analysis.ranges.map((range) => [range.from, range.to]), [[600, 768]]);
  const artifactPath = writeSweepArtifact(path.join(root, 'measure', 'sweeps', 'sweep-responsive'), { axis: 'width', from: 320, to: 768, capturedAt: '2026-01-01T00:00:00.000Z', samples: [narrow, wide, wider], ...analysis, uncertainties: [] });
  assert.equal(fs.statSync(artifactPath).mode & 0o777, 0o600);
});

test('fluid auto-width and centered geometry retain one discrete state without CSS provenance identity', () => {
  const first = fixtureSnap('snap-fluid-400', 400, '1fr', 'src/styles/auto.css');
  const second = fixtureSnap('snap-fluid-800', 800, '1fr', 'src/styles/alternate-auto.css');
  assert.equal(first.fingerprint, second.fingerprint, 'fluid rects, computed widths, line coordinates, and redundant winning-rule provenance are not state facts');
});

test('fingerprint retains document-order association while excluding collector identities and continuous opacity', () => {
  const first = fixtureSnap('snap-color-light', 600, '1fr', 'src/styles/light.css');
  const second = fixtureSnap('snap-color-dark', 600, '1fr', 'src/styles/dark.css');
  const stylesPath = path.join(second.snapDir, 'styles.json');
  const styles = JSON.parse(fs.readFileSync(stylesPath, 'utf8')) as { elements: Array<{ id?: string; selector?: string; computed: Record<string, string>; winningDeclarations: unknown[] }> };
  styles.elements[0]!.id = 'replacement-grid';
  styles.elements[0]!.selector = '.replacement-grid';
  styles.elements[0]!.computed.color = 'rgb(255, 255, 255)';
  writeJsonPrivate(stylesPath, styles);
  assert.notEqual(first.fingerprint, readSweepSnapshot(second.snapId, second.snapDir, second.value).fingerprint, 'a visible computed color is a discrete rendered-state fact');

  const ordered = [{ computed: { display: 'grid', color: 'rgb(255, 0, 0)', 'grid-template-columns': '1fr', opacity: '0.25' } }, { computed: { display: 'block', color: 'rgb(0, 0, 255)', 'grid-template-columns': 'repeat(2, 1fr)', opacity: '0.25' } }];
  const swapped = [{ computed: { display: 'block', color: 'rgb(0, 0, 255)', 'grid-template-columns': 'repeat(2, 1fr)', opacity: '0.75' } }, { computed: { display: 'grid', color: 'rgb(255, 0, 0)', 'grid-template-columns': '1fr', opacity: '0.75' } }];
  writeJsonPrivate(path.join(first.snapDir, 'styles.json'), { elements: ordered });
  writeJsonPrivate(path.join(second.snapDir, 'styles.json'), { elements: swapped });
  assert.notEqual(fingerprintSnapshotDir(first.snapDir), fingerprintSnapshotDir(second.snapDir), 'anonymous records preserve their document-order color/display/grid association');
  writeJsonPrivate(path.join(second.snapDir, 'styles.json'), { elements: ordered.map((element) => ({ computed: { ...element.computed, opacity: '0.75', 'background-image': 'linear-gradient(90deg, red 10vw, blue)', order: '99', 'z-index': '999' } })) });
  assert.equal(fingerprintSnapshotDir(first.snapDir), fingerprintSnapshotDir(second.snapDir), 'continuous opacity and raw numeric/gradient values do not create a sweep state');
});

test('captured unsettled samples retain capture-result settledness and per-region evidence', () => {
  const sample = fixtureSnap('snap-unsettled', 640, '1fr', 'src/styles/auto.css');
  const recovered = readSweepSnapshot(sample.snapId, sample.snapDir, sample.value, [{ id: 'hero', selector: '.hero', reason: 'resize' }], false);
  assert.equal(recovered.settled, false);
  assert.deepEqual(recovered.unstableRegions, [{ id: 'hero', selector: '.hero', reason: 'resize' }]);
});

test('recursive refinement observes A→B→A and records unresolved sampling limits', async () => {
  const captures = new Map<number, SweepSample>();
  const capture = async (value: number): Promise<SweepSample> => {
    const prior = captures.get(value);
    if (prior) return prior;
    const state = value >= 40 && value <= 60 ? 'repeat(2, 1fr)' : '1fr';
    const sample = fixtureSnap(`snap-${value}`, value, state, 'src/styles/grid.css');
    captures.set(value, sample);
    return sample;
  };
  const refined = await refineNumericSweep([await capture(0), await capture(100)], 1, capture, 15);
  const analysis = analyzeSweepSamples('width', 0, 100, refined.samples);
  assert.ok(refined.samples.some((sample) => Number(sample.value) === 50), 'recursive midpoint capture observes the interior state');
  assert.ok(analysis.transitions.length >= 2, 'both observed state changes are bracketed');
  assert.ok(refined.uncertainties.some((interval) => interval.reason === 'sampling_limit'), 'unexamined intervals remain explicit uncertainty');
});

test('emulation preserves observable speech media and does not invent an unknown media type', async () => {
  assert.deepEqual(numericSweepValues(320, 328, 'width'), [320, 321, 322, 323, 324, 325, 326, 327, 328]);
  const calls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const client = { send: async (method: string, params?: Record<string, unknown>) => {
    calls.push({ method, params });
    if (method === 'Runtime.evaluate') return { result: { value: { width: 390, height: 900, dpr: 2, pageScale: 1.25, media: 'speech', colorScheme: 'dark', reducedMotion: 'reduce' } } };
    return {};
  } };
  const baseline = await readSweepEnvironment(client as never);
  assert.equal(baseline.media, 'speech');
  await applySweepEmulation(client as never, 'color-scheme', 'light', baseline);
  await restoreSweepEnvironment(client as never, baseline);
  assert.deepEqual(calls.slice(1), [
    { method: 'Emulation.setEmulatedMedia', params: { media: 'speech', features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] } },
    { method: 'Emulation.setDeviceMetricsOverride', params: { width: 390, height: 900, deviceScaleFactor: 2, mobile: false } },
    { method: 'Emulation.setPageScaleFactor', params: { pageScaleFactor: 1.25 } },
    { method: 'Emulation.setEmulatedMedia', params: { media: 'speech', features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }] } },
  ]);
  const unknownCalls: Array<{ method: string; params?: Record<string, unknown> }> = [];
  const unknownClient = { send: async (method: string, params?: Record<string, unknown>) => {
    unknownCalls.push({ method, params });
    return method === 'Runtime.evaluate' ? { result: { value: { width: 390, height: 900, dpr: 2, pageScale: 1, media: null, colorScheme: 'light', reducedMotion: 'no-preference' } } } : {};
  } };
  const unknownBaseline = await readSweepEnvironment(unknownClient as never);
  assert.equal(unknownBaseline.media, undefined);
  await applySweepEmulation(unknownClient as never, 'reduced-motion', 'reduce', unknownBaseline);
  await restoreSweepEnvironment(unknownClient as never, unknownBaseline);
  assert.deepEqual(unknownCalls[1]?.params, { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.deepEqual(unknownCalls[4]?.params, { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
});

test('sweep renderer reports absolute paths and bracket uncertainty without an unobserved stability claim', () => {
  const before = fixtureSnap('snap-render-before', 400, '1fr', 'src/styles/grid.css');
  const after = fixtureSnap('snap-render-after', 500, 'repeat(2, 1fr)', 'src/styles/grid.css');
  const analysis = analyzeSweepSamples('width', 400, 500, [before, after]);
  const output = renderSweepArtifact({ axis: 'width', from: 400, to: 500, capturedAt: '2026-01-01T00:00:00.000Z', samples: [before, after], ...analysis, sampleLimit: 96, uncertainties: [{ from: 400, to: 500, reason: 'sampling_limit' }], environmentRestoration: { observed: ['viewport width'], unobservable: ['arbitrary media feature overrides'] } });
  assert.match(output, new RegExp(before.snapDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(output, new RegExp(after.snapDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(output, /bracketed between 400 and 500/);
  assert.doesNotMatch(output, /stable geometry|exact transition/);
  assert.match(output, /CDP does not expose prior override configuration/);
});

test('command orchestration records an absolute failed snapshot recovery entry after a partial artifact write', async () => {
  const sessionDir = ensurePrivateDir(path.join(root, 'command-recovery'));
  const emitted: Array<{ attrs?: Record<string, unknown> }> = [];
  const client = { send: async (method: string) => method === 'Runtime.evaluate' ? { result: { value: { width: 390, height: 900, dpr: 2, pageScale: 1, media: 'screen', colorScheme: 'light', reducedMotion: 'no-preference' } } } : {} };
  const previousExitCode = process.exitCode;
  try {
    await runMeasureSweep({ command: 'measure', positional: [], axis: 'color-scheme', from: 'light', to: 'dark' }, [], {
      getActiveSession: () => ({ dir: sessionDir }),
      withConnection: async (_args, callback) => callback(client as never, { id: 'tab', url: 'http://fixture.test/' } as never),
      captureSnapshotSubstrate: async (options) => {
        writeJsonPrivate(path.join(options.path, 'partial.json'), { written: true });
        throw new Error('collector failed after partial write');
      },
      emitResult: (result) => { emitted.push(result as typeof emitted[number]); },
    } as never);
  } finally {
    process.exitCode = previousExitCode;
  }
  const recoveryPath = emitted[0]?.attrs?.path;
  assert.equal(typeof recoveryPath, 'string');
  const recovery = JSON.parse(fs.readFileSync(recoveryPath as string, 'utf8')) as { environmentRestoration: string; samples: Array<{ snapDir: string; status: string; failure?: string; artifacts: string[] }> };
  assert.equal(recovery.environmentRestoration, 'restored');
  assert.equal(recovery.samples.length, 1);
  assert.equal(path.isAbsolute(recovery.samples[0]!.snapDir), true);
  assert.equal(recovery.samples[0]!.status, 'failed');
  assert.equal(recovery.samples[0]!.failure, 'capture_threw');
  assert.deepEqual(recovery.samples[0]!.artifacts, ['partial.json']);
  assert.equal(fs.existsSync(path.join(recovery.samples[0]!.snapDir, 'partial.json')), true);
  assert.equal(fs.statSync(recoveryPath as string).mode & 0o777, 0o600);
});
