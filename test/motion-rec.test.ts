import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { CAPTURE_ROOT, ensurePrivateDir, writeJsonPrivate, writeNdjsonPrivate } from '../src/session/artifacts.js';
import { finalizeOneShotRecording } from '../src/cdp/commands/motion/rec.js';

function privateMode(file: string): number {
  return fs.statSync(file).mode & 0o777;
}

test('motion rec one-shot finalizer writes the same finalized inventory and metadata shape as a composed recording', () => {
  const root = path.join(CAPTURE_ROOT, `u24-motion-rec-${process.pid}-${Date.now()}`);
  const oneShotDir = path.join(root, 'oneshot', 'motion', 'recs', 'rec-one-shot');
  const composedDir = path.join(root, 'session', 'motion', 'recs', 'rec-composed');

  try {
    ensurePrivateDir(path.join(oneShotDir, 'frames'));
    ensurePrivateDir(path.join(composedDir, 'frames'));
    // A fixture action's recorder streams these files during capture; use a
    // minimal representative frame/event/rect payload rather than a browser.
    writeNdjsonPrivate(path.join(oneShotDir, 'events.jsonl'), [{ kind: 'input', mark: 'click:button.send-btn' }]);
    writeNdjsonPrivate(path.join(oneShotDir, 'rects.jsonl'), [{ frame: 1, elements: [] }]);
    writeNdjsonPrivate(path.join(composedDir, 'events.jsonl'), [{ kind: 'input', mark: 'click:button.send-btn' }]);
    writeNdjsonPrivate(path.join(composedDir, 'rects.jsonl'), [{ frame: 1, elements: [] }]);

    const stopped = {
      frameCount: 1,
      eventCount: 1,
      durationMs: 100,
      markers: {
        performanceNowMs: 10,
        wallClockMs: 1_700_000_000_000,
        firstScreencastTimestampSec: 1,
        firstTraceEventTsUs: 2,
        baselinesPending: false,
      },
    };
    const finalized = finalizeOneShotRecording(oneShotDir, 'rec-one-shot', 'https://example.test/chat', 'click:button.send-btn', stopped);

    // This mirrors U14's composed finalizer metadata contract, with the same
    // only intentional difference: a one-shot has its single action.
    writeJsonPrivate(path.join(composedDir, 'markers.json'), stopped.markers);
    writeJsonPrivate(path.join(composedDir, 'meta.json'), {
      id: 'rec-composed', action: null, frames: 1, durationMs: 100,
      state: 'finalized', url: 'https://example.test/chat', fps: 10, eventCount: 1,
    });

    assert.equal(finalized.state, 'finalized');
    assert.equal(finalized.frames, 1);
    assert.equal(finalized.fps, 10);
    for (const dir of [oneShotDir, composedDir]) {
      for (const artifact of ['frames', 'rects.jsonl', 'events.jsonl', 'markers.json', 'meta.json']) {
        assert.ok(fs.existsSync(path.join(dir, artifact)), `${artifact} exists in ${dir}`);
      }
      assert.equal(fs.existsSync(path.join(dir, 'recorder.json')), false, 'live recorder state is never finalized');
    }

    const oneShotMeta = JSON.parse(fs.readFileSync(path.join(oneShotDir, 'meta.json'), 'utf8'));
    const composedMeta = JSON.parse(fs.readFileSync(path.join(composedDir, 'meta.json'), 'utf8'));
    assert.deepEqual(Object.keys(oneShotMeta).sort(), Object.keys(composedMeta).sort());
    assert.equal(oneShotMeta.action, 'click:button.send-btn');
    assert.equal(composedMeta.action, null);
    assert.equal(privateMode(path.join(oneShotDir, 'meta.json')), 0o600);
    assert.equal(privateMode(path.join(oneShotDir, 'events.jsonl')), 0o600);
    assert.equal(privateMode(path.join(oneShotDir, 'frames')), 0o700);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
