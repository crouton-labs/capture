import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CAPTURE_ROOT, ensurePrivateDir, writeJsonPrivate, writeNdjsonPrivate } from '../src/session/artifacts.js';
import { analyzeMotionJank, readMotionJank } from '../src/cdp/motion/jank.js';
import { cmdMotionJank } from '../src/cdp/commands/motion/jank.js';
import { resolveRecRef } from '../src/output/artifact.js';
import { setActiveSession, clearActiveSession } from '../src/session-context.js';

process.env.CRTR_NODE_ID = `u27-motion-jank-${process.pid}-${Date.now()}`;

const markers = {
  performanceNowMs: 500,
  wallClockMs: 1_700_000_000_500,
  firstScreencastTimestampSec: 1_700_000_000.5,
  firstTraceEventTsUs: 10_000,
  baselinesPending: false,
};

const rects = [
  { frame: 0, screencastTimestamp: 1_700_000_000.5, elements: [{ backendNodeId: 7, x: 0, y: 0, width: 20, height: 20 }] },
  { frame: 1, screencastTimestamp: 1_700_000_000.516, elements: [{ backendNodeId: 7, x: 0, y: 0, width: 20, height: 20 }] },
  // 48ms is three frame intervals at the observed 16ms cadence: two are absent.
  { frame: 2, screencastTimestamp: 1_700_000_000.564, elements: [{ backendNodeId: 7, x: 12, y: 4, width: 20, height: 20 }] },
  { frame: 3, screencastTimestamp: 1_700_000_000.58, elements: [{ backendNodeId: 7, x: 12, y: 4, width: 20, height: 20 }] },
];

const events = [
  { kind: 'performance', entryType: 'longtask', performanceNowMs: 520, duration: 60 },
  { kind: 'trace', events: [{ name: 'RunTask', ts: 20_000, dur: 60_000 }] },
  { kind: 'performance', entryType: 'layout-shift', performanceNowMs: 550, value: 0.125, hadRecentInput: false },
];

async function captureStdout(run: () => Promise<void>): Promise<string> {
  const originalWrite = process.stdout.write.bind(process.stdout);
  const output: string[] = [];
  process.stdout.write = ((chunk: unknown) => {
    output.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
    return true;
  }) as typeof process.stdout.write;
  try {
    await run();
  } finally {
    process.stdout.write = originalWrite;
  }
  return output.join('');
}

test('motion jank labels frame-diff layout-shift attribution with its bracketing frames and keeps unaligned trace time separate', () => {
  const analysis = analyzeMotionJank({ rects, events, markers });

  assert.equal(analysis.frameCount, 4);
  assert.equal(analysis.cadenceMs, 16);
  assert.equal(analysis.droppedFrameCount, 2);
  assert.deepEqual(analysis.droppedFrames.map((item) => item.estimatedDroppedFrames), [2]);
  assert.equal(analysis.droppedFrames[0].beforeFrame, 1);
  assert.equal(analysis.droppedFrames[0].afterFrame, 2);

  assert.equal(analysis.longTasks.length, 2);
  const observer = analysis.longTasks.find((task) => task.source === 'observer')!;
  const trace = analysis.longTasks.find((task) => task.source === 'trace')!;
  assert.deepEqual(observer.overlapsDroppedFrames, [2]);
  assert.equal(trace.timingDomain, 'trace-relative-first-event');
  assert.equal(trace.startMs, 10);
  assert.equal(trace.overlapsDroppedFrames, null, 'trace-relative time cannot be compared to recorder-relative frame intervals');
  assert.match(analysis.timingNote, /relative to the first trace event/);

  assert.equal(analysis.layoutShifts.length, 1);
  assert.equal(analysis.layoutShifts[0].value, 0.125);
  assert.equal(analysis.layoutShifts[0].attribution, 'frame-diff-inferred');
  assert.equal(analysis.layoutShifts[0].beforeFrameMs, 16);
  assert.equal(analysis.layoutShifts[0].afterFrameMs, 64);
  assert.deepEqual(analysis.layoutShifts[0].rects[0], {
    elementId: '7',
    previousRect: { x: 0, y: 0, w: 20, h: 20 },
    rect: { x: 12, y: 4, w: 20, h: 20 },
    delta: { x: 12, y: 4, w: 0, h: 0 },
  });
  assert.equal(analysis.frameTimestampUncertainty, '±frame');
});

test('motion jank derives cadence from stable low intervals rather than normalizing frequent drops into its median', () => {
  const analysis = analyzeMotionJank({
    rects: [
      { frame: 0, screencastTimestamp: 10 },
      { frame: 1, screencastTimestamp: 10.016 },
      { frame: 2, screencastTimestamp: 10.064 },
      { frame: 3, screencastTimestamp: 10.112 },
    ],
    events: [],
    markers: { wallClockMs: 10_000 },
  });

  assert.equal(analysis.cadenceMs, 16);
  assert.equal(analysis.droppedFrameCount, 4, 'two 48ms intervals each retain two estimated missing frames');
});

test('motion jank marks dropped-frame counts incomplete when retained timestamps cannot establish a cadence', () => {
  const analysis = analyzeMotionJank({
    rects: [{ frame: 0, screencastTimestamp: 10 }],
    events: [],
    markers: { wallClockMs: 10_000 },
  });

  assert.equal(analysis.droppedFrameCount, 0);
  assert.equal(analysis.cadenceMs, null);
  assert.equal(analysis.droppedFramesIncomplete, true);
});

test('motion jank uses explicit PerformanceObserver sources and explicit trace/performance markers when available', () => {
  const analysis = analyzeMotionJank({
    rects,
    events: [
      { kind: 'trace', events: [{ name: 'RunTask', ts: 20_000, dur: 60_000 }] },
      {
        kind: 'performance', entryType: 'layout-shift', performanceNowMs: 550, value: 0.125,
        sources: [{ backendNodeId: 9, previousRect: { x: 1, y: 2, width: 3, height: 4 }, currentRect: { x: 5, y: 6, width: 3, height: 4 } }],
      },
    ],
    markers: { ...markers, traceTimestampUs: 10_000, tracePerformanceNowMs: 500 },
  });

  assert.equal(analysis.longTasks[0].timingDomain, 'recorder-performance');
  assert.equal(analysis.longTasks[0].startMs, 10);
  assert.equal(analysis.layoutShifts[0].attribution, 'observer-sources');
  assert.equal(analysis.layoutShifts[0].beforeFrameMs, undefined);
  assert.equal(analysis.layoutShifts[0].rects[0].elementId, '9');
});

test('motion jank surfaces recorder artifact loss and marks only affected count families incomplete', () => {
  const analysis = analyzeMotionJank({
    rects: [
      { frame: 0, screencastTimestamp: 10 },
      { frame: 2, screencastTimestamp: 10.016 },
    ],
    events: [
      { kind: 'trace-dropped', reason: 'event-cap', count: 3 },
      { kind: 'rect-sample-dropped', reason: 'element-cap', count: 5 },
      { kind: 'binding-dropped', reason: 'rate-limited', count: 2 },
      { kind: 'error', message: 'rect sample failed for frame 1: disconnected' },
    ],
    markers: { wallClockMs: 10_000 },
  });

  assert.equal(analysis.missingFrameSampleCount, 1);
  assert.equal(analysis.droppedFramesIncomplete, true);
  assert.equal(analysis.longTasksIncomplete, true);
  assert.equal(analysis.layoutShiftsIncomplete, true);
  assert.deepEqual(analysis.artifactLoss.map((loss) => loss.kind), ['trace-dropped', 'rect-sample-dropped', 'binding-dropped', 'error']);
  assert.deepEqual(analysis.artifactLoss[0].affectedCounts, ['long-task-records']);
  assert.deepEqual(analysis.artifactLoss[1].affectedCounts, [], 'truncated element facts do not imply missing frame timestamps');
});

test('motion jank retains post-navigation observer entries without assigning the original document baseline', () => {
  const analysis = analyzeMotionJank({
    rects,
    events: [
      { kind: 'performance', entryType: 'longtask', performanceNowMs: 520, duration: 60 },
      { kind: 'navigation-gap' },
      { kind: 'performance', entryType: 'longtask', startTime: 5, duration: 60 },
      { kind: 'performance', entryType: 'layout-shift', startTime: 6, value: 0.2, sources: [{ backendNodeId: 9 }] },
    ],
    markers,
  });

  assert.equal(analysis.longTasks.length, 2);
  assert.equal(analysis.longTasks[1].timingDomain, 'unavailable');
  assert.equal(analysis.longTasks[1].startMs, null);
  assert.equal(analysis.longTasks[1].endMs, null);
  assert.equal(analysis.longTasks[1].overlapsDroppedFrames, null);
  assert.equal(analysis.layoutShifts.length, 1);
  assert.equal(analysis.layoutShifts[0].tMs, null);
  assert.equal(analysis.layoutShifts[0].attribution, 'unavailable');
  assert.deepEqual(analysis.layoutShifts[0].rects, []);
  assert.equal(analysis.longTasksIncomplete, true);
  assert.equal(analysis.layoutShiftsIncomplete, true);
  assert.match(analysis.timingNote, /after a navigation gap with no synchronized recorder-relative baseline/);
  // No pre-arm buffered entry is present, so the note must not attribute one.
  assert.doesNotMatch(analysis.timingNote, /buffered from before the recorder arm baseline/);
});

test('motion jank routes a pre-arm buffered observer entry to unavailable rather than a negative recorder-relative time', () => {
  const analysis = analyzeMotionJank({
    rects,
    events: [
      // startTime predates markers.performanceNowMs (500): the buffered entry's document
      // time origin precedes the recorder arm baseline, so its recorder-relative time is negative.
      { kind: 'performance', entryType: 'layout-shift', startTime: 12, value: 0.2, sources: [{ backendNodeId: 9 }] },
      { kind: 'performance', entryType: 'longtask', startTime: 20, duration: 60 },
    ],
    markers,
  });

  assert.equal(analysis.layoutShifts.length, 1);
  assert.equal(analysis.layoutShifts[0].tMs, null, 'a pre-arm layout shift is never assigned a negative recorder-relative time');
  assert.equal(analysis.layoutShifts[0].attribution, 'unavailable');
  assert.deepEqual(analysis.layoutShifts[0].rects, []);
  assert.equal(analysis.longTasks.length, 1);
  assert.equal(analysis.longTasks[0].timingDomain, 'unavailable');
  assert.equal(analysis.longTasks[0].startMs, null);
  assert.equal(analysis.longTasks[0].endMs, null);

  // Every retained observer timestamp is nonnegative or explicitly null.
  for (const shift of analysis.layoutShifts) assert.ok(shift.tMs === null || shift.tMs >= 0);
  for (const task of analysis.longTasks) assert.ok(task.startMs === null || task.startMs >= 0);

  // No navigation occurred: the unavailable-timing note must attribute the pre-arm buffered
  // cause and must NOT falsely claim these entries occurred after a navigation gap.
  assert.doesNotMatch(analysis.timingNote, /navigation gap/, 'a pre-arm buffered entry must not be attributed to a navigation gap');
  assert.match(analysis.timingNote, /buffered from before the recorder arm baseline, with a document timestamp that predates it/);
});

test('motion jank preserves rect-sample loss without marking retained frame timestamp counts incomplete', () => {
  const analysis = analyzeMotionJank({
    rects: [
      { frame: 0, screencastTimestamp: 10 },
      { frame: 1, screencastTimestamp: 10.016 },
      { frame: 2, screencastTimestamp: 10.032 },
    ],
    events: [{ kind: 'rect-sample-dropped', reason: 'element-cap', count: 5 }],
    markers: { wallClockMs: 10_000 },
  });

  assert.equal(analysis.missingFrameSampleCount, 0);
  assert.equal(analysis.droppedFramesIncomplete, false);
  assert.deepEqual(analysis.artifactLoss, [{ kind: 'rect-sample-dropped', count: 5, reason: 'element-cap', affectedCounts: [] }]);
});

test('motion jank marks every count family incomplete for orphaned-finalized artifacts', () => {
  const analysis = analyzeMotionJank({ rects: [], events: [], markers, state: 'orphaned-finalized' });

  assert.equal(analysis.droppedFrameCount, 0);
  assert.equal(analysis.droppedFramesIncomplete, true);
  assert.equal(analysis.longTasksIncomplete, true);
  assert.equal(analysis.layoutShiftsIncomplete, true);
  assert.deepEqual(analysis.artifactLoss, [{
    kind: 'orphaned-finalized',
    message: 'recorder was finalized best-effort from artifacts already flushed to disk',
    affectedCounts: ['dropped-frames', 'long-task-records', 'layout-shift-records'],
  }]);
});

test('motion jank reads finalized recording artifacts through the resolver and rejects a live recording', async () => {
  const sessionDir = path.join(CAPTURE_ROOT, `u27-session-${process.pid}-${Date.now()}`);
  const recDir = path.join(sessionDir, 'motion', 'recs', 'rec-fixture');
  ensurePrivateDir(recDir);
  writeNdjsonPrivate(path.join(recDir, 'rects.jsonl'), rects);
  writeNdjsonPrivate(path.join(recDir, 'events.jsonl'), events);
  writeJsonPrivate(path.join(recDir, 'markers.json'), markers);
  writeJsonPrivate(path.join(recDir, 'meta.json'), { id: 'rec-fixture', state: 'finalized', frames: 4, durationMs: 80, action: null });
  await setActiveSession({ sessionId: 'u27-session', dir: sessionDir, harId: null, targetId: null, stepCount: 0 });

  try {
    const result = readMotionJank(resolveRecRef('rec-fixture'));
    assert.equal(result.analysis.droppedFrameCount, 2);

    const output = await captureStdout(() => cmdMotionJank({ command: 'motion', positional: ['rec-fixture'] }, []));
    assert.match(output, /Trace timestamps are relative to the first trace event/);
    assert.match(output, /long-task-records="2"/);
    assert.match(output, /attribution inferred from rect samples bracketing/);

    for (const frameTotal of [0, 1, 2]) {
      writeNdjsonPrivate(path.join(recDir, 'rects.jsonl'), rects.slice(0, frameTotal));
      const rendered = JSON.parse(await captureStdout(() => cmdMotionJank({ command: 'motion', positional: ['rec-fixture'], json: true }, [])));
      assert.equal(rendered.attrs.frames, frameTotal);
      assert.equal(rendered.attrs['dropped-frames'], 0);
      assert.equal(rendered.attrs['dropped-frames-incomplete'], true, `${frameTotal} timestamped frames cannot establish cadence`);
      assert.match(rendered.summary, /0 estimated dropped frame\(s\) \(incomplete\)/);
      assert.match(rendered.sections.join('\n'), /nominal cadence is unavailable and the dropped-frame count is incomplete/);
    }

    writeNdjsonPrivate(path.join(recDir, 'rects.jsonl'), rects);
    writeJsonPrivate(path.join(recDir, 'meta.json'), { id: 'rec-fixture', state: 'orphaned-finalized', frames: 4, durationMs: 80, action: null });
    const orphaned = readMotionJank(resolveRecRef('rec-fixture'));
    assert.equal(orphaned.analysis.droppedFramesIncomplete, true);
    assert.equal(orphaned.analysis.longTasksIncomplete, true);
    assert.equal(orphaned.analysis.layoutShiftsIncomplete, true);
    assert.ok(orphaned.analysis.artifactLoss.some((loss) => loss.kind === 'orphaned-finalized'));

    writeJsonPrivate(path.join(recDir, 'meta.json'), { id: 'rec-fixture', state: 'recording', frames: 4, durationMs: 80, action: null });
    assert.throws(() => readMotionJank(resolveRecRef('rec-fixture')), /not finalized.*capture motion rec --stop/);
  } finally {
    clearActiveSession();
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});
