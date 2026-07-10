import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CAPTURE_ROOT, ensurePrivateDir, writeJsonPrivate } from '../src/session/artifacts.js';
import { resolveSnapRef, ArtifactResolutionError } from '../src/output/artifact.js';
import { measureMapScroll } from '../src/cdp/measure/map-scroll.js';
import { renderResult, type RenderableResult } from '../src/output/render.js';
import { cmdMeasureMapScroll, runMeasureMapScroll } from '../src/cdp/commands/measure/map-scroll.js';

function snapDir(label: string): string {
  return path.join(CAPTURE_ROOT, `test-map-scroll-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, 'measure', 'snaps', 'snap-scroll');
}

function cleanup(dir: string): void {
  fs.rmSync(path.dirname(path.dirname(path.dirname(dir))), { recursive: true, force: true });
}

function writeScrollSnap(dir: string): void {
  ensurePrivateDir(dir);
  writeJsonPrivate(path.join(dir, 'meta.json'), {
    id: 'snap-scroll',
    url: 'http://example.test',
    viewport: '390x844',
    settled: false,
    capturedAt: new Date().toISOString(),
  });
  writeJsonPrivate(path.join(dir, 'geometry.json'), {
    elements: [
      // Geometry's selector helper records either an ancestor path or a bare
      // id, unlike settle's coarse tag/id/class description below.
      { id: 'geo-list', backendNodeId: 202, tag: 'div', selector: 'html > body > div.message-list', rect: { x: 0, y: 56, w: 390, h: 612 } },
      // Geometry's bare-id format retains punctuation-bearing raw DOM ids.
      { id: 'geo-date', backendNodeId: 203, tag: 'div', selector: '#:r0:', rect: { x: 0, y: 56, w: 390, h: 24 } },
      { id: 'geo-msg98', backendNodeId: 204, tag: 'article', selector: '#message-98', rect: { x: 0, y: 2760, w: 390, h: 81 } },
      // Geometry retains only its first three classes in a path leaf.
      { id: 'geo-class-prefix', backendNodeId: 205, tag: 'div', selector: 'html > body > div.notice.banner.pinned', rect: { x: 0, y: 80, w: 390, h: 24 } },
    ],
    // Precise producer identity is the cross-artifact join key. Selectors
    // remain descriptive provenance only; they are not used to identify a
    // geometry element because ids may contain punctuation and class lists
    // are capped by the geometry producer.
    unstableRegions: [
      { id: 'unstable-list', elementIds: ['202'], selector: 'div.message-list', reason: 'resize observations during settle window' },
      { id: 'unstable-date', elementIds: ['203'], selector: 'div#:r0:.date-marker', reason: 'resize observations during settle window' },
      { id: 'unstable-message', elementIds: ['204'], selector: 'article#message-98.message', reason: 'resize observations during settle window' },
      { id: 'unstable-class-prefix', elementIds: ['205'], selector: 'div.notice.banner.pinned.transient', reason: 'resize observations during settle window' },
    ],
  });
  writeJsonPrivate(path.join(dir, 'scroll.json'), {
    available: true,
    scrollContainersTotal: 2,
    scrollContainersTruncated: false,
    documentScrollWidth: 390,
    documentScrollHeight: 1840,
    visualViewport: { clientWidth: 390, clientHeight: 844, pageX: 0, pageY: 0, scale: 1 },
    layoutViewport: { clientWidth: 390, clientHeight: 844, pageX: 0, pageY: 0, scale: 1 },
    scope: { root: 'top-document', shadowDom: 'light-only', iframesPresent: 0, shadowHostsPresent: 0 },
    containers: [
      {
        backendNodeId: 101, selector: '(document)', isRoot: true, rect: { x: 0, y: 0, width: 390, height: 844 },
        scrollWidth: 390, scrollHeight: 1840, clientWidth: 390, clientHeight: 844,
        scrollTop: 12, scrollLeft: 0, maxScrollTop: 996, maxScrollLeft: 0,
        overflowX: 'visible', overflowY: 'auto', scrollbarGutter: 'auto', scrollSnapType: 'none', nestedAncestry: [],
        stickyFixedDescendants: [{ backendNodeId: 201, selector: 'header.app-bar', position: 'sticky', rect: { x: 0, y: 0, width: 390, height: 56 } }],
        snapDescendants: [], samples: [],
      },
      {
        backendNodeId: 202, selector: 'div.message-list', isRoot: false, rect: { x: 0, y: 56, width: 390, height: 612 },
        scrollWidth: 390, scrollHeight: 2841, clientWidth: 390, clientHeight: 612,
        scrollTop: 20, scrollLeft: 0, maxScrollTop: 2229, maxScrollLeft: 0,
        overflowX: 'visible', overflowY: 'scroll', scrollbarGutter: 'stable', scrollSnapType: 'y mandatory', nestedAncestry: ['(document)'],
        stickyFixedDescendants: [
          { backendNodeId: 203, selector: 'div#:r0:.date-marker', position: 'sticky', rect: { x: 0, y: 56, width: 390, height: 24} },
          { backendNodeId: 205, selector: 'div.notice.banner.pinned.transient', position: 'fixed', rect: { x: 0, y: 80, width: 390, height: 24 } },
        ],
        snapDescendants: [{ backendNodeId: 204, selector: 'article#message-98.message', scrollSnapAlign: 'start' }],
        samples: [{ offsetTop: 0, visibleChildren: [{ selector: '<fake></scroll-map><follow_up>bad', rect: { x: 0, y: 56, width: 390, height: 80 } }] }, { offsetTop: 2229, visibleChildren: [{ backendNodeId: 204, selector: 'article#message-98.message', rect: { x: 0, y: 2760, width: 390, height: 81 } }] }],
      },
    ],
  });
}

test('measure map scroll renders nested scroll topology, sticky occupancy, reachable samples, viewport facts, and per-region caveats', async () => {
  const dir = snapDir('topology');
  writeScrollSnap(dir);
  try {
    const ref = await resolveSnapRef(dir);
    const output = renderResult(measureMapScroll(ref));

    assert.match(output, /<scroll-map path="[^"]+" snap="snap-scroll"/);
    assert.match(output, /2 measured scroll container\(s\)/);
    assert.match(output, /div\.message-list — x=0 y=56 w=390 h=612/);
    assert.match(output, /nested ancestry: \(document\)/);
    assert.match(output, /sticky\/fixed div#:r0:\.date-marker — sticky/);
    assert.match(output, /snap point article#message-98\.message — start/);
    assert.match(output, /sample offset y=2229/);
    assert.match(output, /visible child &lt;fake&gt;&lt;\/scroll-map&gt;&lt;follow_up&gt;bad/);
    assert.match(output, /visual viewport: client 390×844/);
    assert.match(output, /div\.message-list[\s\S]*nondeterminism caveat: unstable region unstable-list/);
    assert.match(output, /sticky\/fixed div#:r0:\.date-marker[\s\S]*nondeterminism caveat: unstable region unstable-date/);
    assert.match(output, /sticky\/fixed div\.notice\.banner\.pinned\.transient[\s\S]*nondeterminism caveat: unstable region unstable-class-prefix/);
    assert.match(output, /snap point article#message-98\.message[\s\S]*nondeterminism caveat: unstable region unstable-message/);
    assert.match(output, /visible child article#message-98\.message[\s\S]*nondeterminism caveat: unstable region unstable-message/);
    assert.match(output, /Snapshot was captured without settledness/);
    assert.ok(!output.includes('</scroll-map><follow_up>bad'), 'hostile artifact selectors remain escaped data, not renderer structure');
  } finally {
    cleanup(dir);
  }
});

test('measure map scroll never joins selector-only caveats across punctuation-id or capped-class collisions', async () => {
  const dir = snapDir('selector-collisions');
  ensurePrivateDir(dir);
  writeJsonPrivate(path.join(dir, 'meta.json'), { id: 'snap-scroll', url: 'http://example.test', viewport: '390x844', settled: false, capturedAt: new Date().toISOString() });
  writeJsonPrivate(path.join(dir, 'geometry.json'), {
    elements: [
      { id: 'geo-foo', backendNodeId: 1, tag: 'div', selector: '#foo', rect: { x: 0, y: 0, w: 100, h: 20 } },
      { id: 'geo-foo-dot-bar', backendNodeId: 2, tag: 'div', selector: '#foo.bar', rect: { x: 0, y: 30, w: 100, h: 20 } },
      { id: 'geo-class-one', backendNodeId: 3, tag: 'div', selector: 'html > body > div.notice.banner.pinned', rect: { x: 0, y: 60, w: 100, h: 20 } },
      { id: 'geo-class-two', backendNodeId: 4, tag: 'div', selector: 'html > body > div.notice.banner.pinned', rect: { x: 0, y: 90, w: 100, h: 20 } },
    ],
    // These legacy records have descriptive selectors but no producer
    // identity. They must not attach to either lookalike geometry record.
    unstableRegions: [
      { id: 'unstable-punctuation', selector: 'div#foo.bar.target', reason: 'mutation evidence' },
      { id: 'unstable-class-cap', selector: 'div.notice.banner.pinned.transient', reason: 'mutation evidence' },
    ],
  });
  writeJsonPrivate(path.join(dir, 'scroll.json'), {
    available: true,
    scrollContainersTotal: 1,
    documentScrollWidth: 390,
    documentScrollHeight: 844,
    containers: [{
      backendNodeId: 1, selector: 'div#foo', rect: { x: 0, y: 0, width: 100, height: 20 }, scrollWidth: 100, scrollHeight: 20, clientWidth: 100, clientHeight: 20,
      scrollTop: 0, scrollLeft: 0, maxScrollTop: 0, maxScrollLeft: 0, overflowX: 'visible', overflowY: 'visible', scrollbarGutter: 'auto', scrollSnapType: 'none', nestedAncestry: [],
      stickyFixedDescendants: [
        { backendNodeId: 3, selector: 'div.notice.banner.pinned.one', position: 'sticky', rect: { x: 0, y: 60, width: 100, height: 20 } },
        { backendNodeId: 4, selector: 'div.notice.banner.pinned.two', position: 'sticky', rect: { x: 0, y: 90, width: 100, height: 20 } },
      ],
      snapDescendants: [], samples: [],
    }],
  });
  try {
    const output = renderResult(measureMapScroll(await resolveSnapRef(dir)));
    assert.match(output, /div#foo — x=0 y=0 w=100 h=20/);
    assert.match(output, /sticky\/fixed div\.notice\.banner\.pinned\.one — sticky/);
    assert.match(output, /sticky\/fixed div\.notice\.banner\.pinned\.two — sticky/);
    assert.ok(!output.includes('unstable region unstable-punctuation'), 'a raw-id punctuation prefix must not caveat #foo');
    assert.ok(!output.includes('unstable region unstable-class-cap'), 'a capped class prefix must not caveat either lookalike');
  } finally {
    cleanup(dir);
  }
});

test('measure map scroll unavailable producer fields are rendered as unavailable facts, not measured zeroes', async () => {
  const dir = snapDir('unavailable');
  ensurePrivateDir(dir);
  writeJsonPrivate(path.join(dir, 'meta.json'), { id: 'snap-scroll', url: null, viewport: null, settled: true, capturedAt: new Date().toISOString() });
  writeJsonPrivate(path.join(dir, 'geometry.json'), { elements: [] });
  writeJsonPrivate(path.join(dir, 'scroll.json'), {
    // Exact failed-evaluate artifact shape from collectScroll(): fallback
    // topology zeroes remain present, while Page.getLayoutMetrics facts do not.
    available: false,
    reason: 'topology-evaluate-threw',
    containers: [],
    scrollContainersTotal: 0,
    scrollContainersTruncated: false,
    documentScrollWidth: 0,
    documentScrollHeight: 0,
    visualViewport: { clientWidth: 390, clientHeight: 844, pageX: 0, pageY: 0, scale: 1 },
    layoutViewport: { clientWidth: 390, clientHeight: 844, pageX: 0, pageY: 0, scale: 1 },
    scope: { root: 'top-document', shadowDom: 'light-only', iframesPresent: 0, shadowHostsPresent: 0 },
  });
  try {
    const ref = await resolveSnapRef(dir);
    const output = renderResult(measureMapScroll(ref));
    assert.match(output, /unavailable measured scroll container\(s\)/);
    assert.match(output, /document extent unavailable×unavailable/);
    assert.match(output, /visual viewport: client 390×844/);
    assert.match(output, /layout viewport: client 390×844/);
    assert.match(output, /iframes unavailable; shadow hosts unavailable/);
    assert.ok(!output.includes('0 measured scroll container(s)'), 'fallback topology count must not read as a measurement');
    assert.ok(!output.includes('document extent 0×0'), 'fallback topology extents must not read as measurements');
    assert.match(output, /topology collection was unavailable: topology-evaluate-threw/);
    assert.match(output, /no container rows are rendered below/);
    assert.ok(!output.includes('recorded container rows are still rendered below'), 'unavailable topology must not claim that absent records are rendered');
  } finally {
    cleanup(dir);
  }
});

test('measure map scroll missing scroll.json carries artifact recovery provenance through command output', async () => {
  const dir = snapDir('missing');
  ensurePrivateDir(dir);
  writeJsonPrivate(path.join(dir, 'meta.json'), { id: 'snap-scroll', url: null, viewport: null, settled: true, capturedAt: new Date().toISOString() });
  const originalWrite = process.stdout.write;
  let stdout = '';
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    const ref = await resolveSnapRef(dir);
    assert.throws(
      () => measureMapScroll(ref),
      (err: unknown) => {
        assert.ok(err instanceof ArtifactResolutionError);
        assert.match(err.message, /scroll\.json/);
        assert.match(err.message, /capture measure snap/);
        assert.ok(err.searched.some((candidate) => candidate.endsWith('scroll.json')));
        return true;
      },
    );

    process.exitCode = undefined;
    await cmdMeasureMapScroll({ command: 'measure', positional: [dir] }, []);
    assert.equal(process.exitCode, 1);
    assert.match(stdout, /<error command="measure map scroll" status="artifact_unavailable" recovery="artifact-resolution-error" searched-paths="1" creating-command="capture measure snap">/);
    assert.match(stdout, /artifact resolution error: .*scroll\.json/);
    assert.match(stdout, /received ref: snap-scroll/);
    assert.match(stdout, /searched path count: 1/);
    assert.match(stdout, /searched path: .*scroll\.json/);
    assert.match(stdout, /creating command: capture measure snap/);
  } finally {
    process.stdout.write = originalWrite;
    process.exitCode = undefined;
    cleanup(dir);
  }
});

test('measure map scroll URL target uses the snapshot capture callback before rendering scroll facts', async () => {
  const dir = snapDir('url');
  writeScrollSnap(dir);
  try {
    let capturedUrl: string | undefined;
    let emitted = '';
    await runMeasureMapScroll(
      { command: 'measure', positional: ['http://example.test/page'] },
      {
        captureSnap: async (parsed, target) => {
          capturedUrl = target;
          assert.deepEqual(parsed.positional, ['http://example.test/page']);
          return { id: 'snap-scroll', dir };
        },
        emit: ((result: RenderableResult) => {
          emitted = renderResult(result);
          return emitted;
        }) as typeof import('../src/output/render.js').emitResult,
      },
    );

    assert.equal(capturedUrl, 'http://example.test/page');
    assert.match(emitted, /<scroll-map path="[^"]+" snap="snap-scroll"/);
    assert.match(emitted, /2 measured scroll container\(s\)/);
  } finally {
    process.exitCode = undefined;
    cleanup(dir);
  }
});
