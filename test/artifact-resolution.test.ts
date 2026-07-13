import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CAPTURE_ROOT, writeJsonPrivate, ensurePrivateDir } from '../src/session/artifacts.js';

function scopedNodeId(label: string): string {
  return `test-artifact-resolution-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function withActiveSession<T>(
  sessionId: string,
  dir: string,
  fn: () => Promise<T> | T,
): Promise<T> {
  const { setActiveSession, clearActiveSession } = await import('../src/session-context.js');
  const prevNodeId = process.env.CRTR_NODE_ID;
  const nodeId = scopedNodeId(sessionId);
  process.env.CRTR_NODE_ID = nodeId;
  clearActiveSession();
  await setActiveSession({ sessionId, dir, harId: null, targetId: null, stepCount: 0 });
  try {
    return await fn();
  } finally {
    clearActiveSession();
    if (prevNodeId === undefined) delete process.env.CRTR_NODE_ID;
    else process.env.CRTR_NODE_ID = prevNodeId;
  }
}

/** Writes a minimal snap dir with just meta.json (matches what any snap
 * capture — settled or evidence-only — always writes). */
function makeSnapDir(sessionDir: string, snapId: string): string {
  const dir = path.join(sessionDir, 'measure', 'snaps', snapId);
  ensurePrivateDir(dir);
  writeJsonPrivate(path.join(dir, 'meta.json'), {
    id: snapId,
    url: 'http://example.test',
    viewport: '390x844',
    settled: true,
    capturedAt: new Date().toISOString(),
  });
  return dir;
}

function makeRecDir(sessionDir: string, recId: string): string {
  const dir = path.join(sessionDir, 'motion', 'recs', recId);
  ensurePrivateDir(dir);
  writeJsonPrivate(path.join(dir, 'meta.json'), {
    id: recId,
    action: 'click:button.send-btn',
    frames: 10,
    durationMs: 500,
    state: 'finalized',
  });
  return dir;
}

function freshSessionDir(label: string): string {
  const dir = path.join(CAPTURE_ROOT, `test-session-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  return dir;
}

// ============================================================================
// resolveSnapRef — id resolution
// ============================================================================

test('resolveSnapRef resolves a bare id against the active session', async () => {
  const { resolveSnapRef } = await import('../src/output/artifact.js');
  const sessionDir = freshSessionDir('snap-id');
  const snapDir = makeSnapDir(sessionDir, 'snap-a1');
  try {
    await withActiveSession('sess-1', sessionDir, async () => {
      const ref = await resolveSnapRef('snap-a1');
      assert.equal(ref.kind, 'snap');
      assert.equal(ref.id, 'snap-a1');
      assert.equal(ref.dir, snapDir);
    });
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('resolveSnapRef throws with no active session for a bare id, naming the ref and a recovery command', async () => {
  const { resolveSnapRef, ArtifactResolutionError } = await import('../src/output/artifact.js');
  const prevNodeId = process.env.CRTR_NODE_ID;
  process.env.CRTR_NODE_ID = scopedNodeId('no-session');
  try {
    const { clearActiveSession } = await import('../src/session-context.js');
    clearActiveSession();
    await assert.rejects(
      () => resolveSnapRef('snap-ghost'),
      (err: unknown) => {
        assert.ok(err instanceof ArtifactResolutionError);
        assert.equal(err.ref, 'snap-ghost');
        assert.match(err.message, /snap-ghost/);
        assert.match(err.message, /no active capture session/);
        assert.ok(err.creatingCommand?.includes('capture measure snap'));
        return true;
      },
    );
  } finally {
    if (prevNodeId === undefined) delete process.env.CRTR_NODE_ID;
    else process.env.CRTR_NODE_ID = prevNodeId;
  }
});

test('resolveSnapRef throws not-found for an id missing from the active session, naming where it looked and the creating command', async () => {
  const { resolveSnapRef, ArtifactResolutionError } = await import('../src/output/artifact.js');
  const sessionDir = freshSessionDir('snap-missing');
  ensurePrivateDir(sessionDir);
  try {
    await withActiveSession('sess-2', sessionDir, async () => {
      await assert.rejects(
        () => resolveSnapRef('snap-does-not-exist'),
        (err: unknown) => {
          assert.ok(err instanceof ArtifactResolutionError);
          assert.equal(err.ref, 'snap-does-not-exist');
          assert.ok(err.searched.some((s) => s.includes('snap-does-not-exist')));
          assert.equal(err.creatingCommand, 'capture measure snap');
          return true;
        },
      );
    });
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

// ============================================================================
// resolveSnapRef — absolute path resolution
// ============================================================================

test('resolveSnapRef resolves an absolute path directly, no active session required', async () => {
  const { resolveSnapRef } = await import('../src/output/artifact.js');
  const sessionDir = freshSessionDir('snap-path');
  const snapDir = makeSnapDir(sessionDir, 'snap-p1');
  try {
    const ref = await resolveSnapRef(snapDir);
    assert.equal(ref.kind, 'snap');
    assert.equal(ref.id, 'snap-p1');
    assert.equal(ref.dir, snapDir);
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('resolveSnapRef tolerates a trailing slash on an absolute path', async () => {
  const { resolveSnapRef } = await import('../src/output/artifact.js');
  const sessionDir = freshSessionDir('snap-path-slash');
  const snapDir = makeSnapDir(sessionDir, 'snap-p2');
  try {
    const ref = await resolveSnapRef(`${snapDir}/`);
    assert.equal(ref.id, 'snap-p2');
    assert.equal(ref.dir, snapDir);
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('resolveSnapRef rejects an absolute path outside the capture root', async () => {
  const { resolveSnapRef, ArtifactResolutionError } = await import('../src/output/artifact.js');
  await assert.rejects(
    () => resolveSnapRef('/tmp/not-a-capture-dir/snap-x'),
    (err: unknown) => {
      assert.ok(err instanceof ArtifactResolutionError || err instanceof Error);
      return true;
    },
  );
});

test('resolveSnapRef rejects a relative path (contains a slash but is not absolute)', async () => {
  const { resolveSnapRef, ArtifactResolutionError } = await import('../src/output/artifact.js');
  await assert.rejects(
    () => resolveSnapRef('measure/snaps/snap-a1'),
    (err: unknown) => {
      assert.ok(err instanceof ArtifactResolutionError);
      assert.match(err.message, /relative paths are not accepted/);
      return true;
    },
  );
});

test('resolveSnapRef rejects an absolute path with no meta.json (not a real snapshot dir)', async () => {
  const { resolveSnapRef, ArtifactResolutionError } = await import('../src/output/artifact.js');
  const sessionDir = freshSessionDir('snap-no-meta');
  const bogusDir = path.join(sessionDir, 'measure', 'snaps', 'snap-empty');
  ensurePrivateDir(bogusDir);
  try {
    await assert.rejects(
      () => resolveSnapRef(bogusDir),
      (err: unknown) => {
        assert.ok(err instanceof ArtifactResolutionError);
        assert.match(err.message, /missing meta\.json/);
        assert.equal(err.creatingCommand, 'capture measure snap');
        return true;
      },
    );
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

// ============================================================================
// resolveSnapRef — URL resolution via pluggable callback
// ============================================================================

test('resolveSnapRef calls the pluggable onUrl callback for a URL ref and returns its result', async () => {
  const { resolveSnapRef } = await import('../src/output/artifact.js');
  const sessionDir = freshSessionDir('snap-url');
  const snapDir = makeSnapDir(sessionDir, 'snap-u1');
  try {
    let calledWith: string | null = null;
    const ref = await resolveSnapRef('http://localhost:5173/chat', {
      onUrl: async (url) => {
        calledWith = url;
        return { id: 'snap-u1', dir: snapDir };
      },
    });
    assert.equal(calledWith, 'http://localhost:5173/chat');
    assert.equal(ref.id, 'snap-u1');
    assert.equal(ref.dir, snapDir);
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('resolveSnapRef throws for a URL ref when no onUrl callback is supplied', async () => {
  const { resolveSnapRef, ArtifactResolutionError } = await import('../src/output/artifact.js');
  await assert.rejects(
    () => resolveSnapRef('http://localhost:5173/chat'),
    (err: unknown) => {
      assert.ok(err instanceof ArtifactResolutionError);
      assert.match(err.message, /does not accept a URL target/);
      return true;
    },
  );
});

// ============================================================================
// resolveRecRef
// ============================================================================

test('resolveRecRef resolves a bare id against the active session', async () => {
  const { resolveRecRef } = await import('../src/output/artifact.js');
  const sessionDir = freshSessionDir('rec-id');
  const recDir = makeRecDir(sessionDir, 'rec-a1');
  try {
    await withActiveSession('sess-3', sessionDir, async () => {
      const ref = resolveRecRef('rec-a1');
      assert.equal(ref.kind, 'rec');
      assert.equal(ref.id, 'rec-a1');
      assert.equal(ref.dir, recDir);
    });
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('resolveRecRef resolves an absolute path directly', async () => {
  const { resolveRecRef } = await import('../src/output/artifact.js');
  const sessionDir = freshSessionDir('rec-path');
  const recDir = makeRecDir(sessionDir, 'rec-p1');
  try {
    const ref = resolveRecRef(recDir);
    assert.equal(ref.id, 'rec-p1');
    assert.equal(ref.dir, recDir);
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('resolveRecRef throws for a URL ref — recordings are never resolved from a URL', async () => {
  const { resolveRecRef, ArtifactResolutionError } = await import('../src/output/artifact.js');
  assert.throws(
    () => resolveRecRef('http://localhost:5173/chat'),
    (err: unknown) => {
      assert.ok(err instanceof ArtifactResolutionError);
      assert.match(err.message, /cannot be a URL/);
      return true;
    },
  );
});

test('resolveRecRef throws not-found naming where it looked and the creating command', async () => {
  const { resolveRecRef, ArtifactResolutionError } = await import('../src/output/artifact.js');
  const sessionDir = freshSessionDir('rec-missing');
  ensurePrivateDir(sessionDir);
  try {
    await withActiveSession('sess-4', sessionDir, () => {
      assert.throws(
        () => resolveRecRef('rec-ghost'),
        (err: unknown) => {
          assert.ok(err instanceof ArtifactResolutionError);
          assert.equal(err.ref, 'rec-ghost');
          assert.ok(err.searched.some((s) => s.includes('rec-ghost')));
          assert.equal(err.creatingCommand, 'capture motion rec');
          return true;
        },
      );
    });
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Readers — success + failure
// ============================================================================

test('readGeometry reads and parses geometry.json for a resolved snap ref', async () => {
  const { resolveSnapRef, readGeometry } = await import('../src/output/artifact.js');
  const sessionDir = freshSessionDir('read-geometry');
  const snapDir = makeSnapDir(sessionDir, 'snap-g1');
  writeJsonPrivate(path.join(snapDir, 'geometry.json'), { elements: [{ id: 'el-1', selector: 'button.send-btn' }] });
  try {
    const ref = await resolveSnapRef(snapDir);
    const geometry = readGeometry<{ elements: Array<{ id: string; selector: string }> }>(ref);
    assert.equal(geometry.elements.length, 1);
    assert.equal(geometry.elements[0].selector, 'button.send-btn');
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('readMedia reads and parses media.json through the shared snap reader', async () => {
  const { resolveSnapRef, readMedia } = await import('../src/output/artifact.js');
  const sessionDir = freshSessionDir('read-media');
  const snapDir = makeSnapDir(sessionDir, 'snap-media1');
  writeJsonPrivate(path.join(snapDir, 'media.json'), { elements: [{ id: 'img-1', tag: 'img', naturalWidth: 320 }] });
  try {
    const ref = await resolveSnapRef(snapDir);
    const media = readMedia<{ elements: Array<{ id: string; tag: string; naturalWidth: number }> }>(ref);
    assert.equal(media.elements[0].id, 'img-1');
    assert.equal(media.elements[0].tag, 'img');
    assert.equal(media.elements[0].naturalWidth, 320);
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('readGeometry throws a structured error naming the missing file and the creating command', async () => {
  const { resolveSnapRef, readGeometry, ArtifactResolutionError } = await import('../src/output/artifact.js');
  const sessionDir = freshSessionDir('read-geometry-missing');
  const snapDir = makeSnapDir(sessionDir, 'snap-g2'); // meta.json only, no geometry.json
  try {
    const ref = await resolveSnapRef(snapDir);
    assert.throws(
      () => readGeometry(ref),
      (err: unknown) => {
        assert.ok(err instanceof ArtifactResolutionError);
        assert.equal(err.ref, 'snap-g2');
        assert.ok(err.searched.some((s) => s.endsWith('geometry.json')));
        assert.equal(err.creatingCommand, 'capture measure snap');
        assert.match(err.message, /geometry\.json/);
        return true;
      },
    );
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('readGeometry throws a structured error on invalid JSON content', async () => {
  const { resolveSnapRef, readGeometry, ArtifactResolutionError } = await import('../src/output/artifact.js');
  const sessionDir = freshSessionDir('read-geometry-bad-json');
  const snapDir = makeSnapDir(sessionDir, 'snap-g3');
  fs.writeFileSync(path.join(snapDir, 'geometry.json'), '{not valid json', { mode: 0o600 });
  try {
    const ref = await resolveSnapRef(snapDir);
    assert.throws(
      () => readGeometry(ref),
      (err: unknown) => {
        assert.ok(err instanceof ArtifactResolutionError);
        assert.match(err.message, /not valid JSON/);
        return true;
      },
    );
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('readGeometry refuses a rec ref at runtime (wrong-kind guard)', async () => {
  const { resolveRecRef, readGeometry } = await import('../src/output/artifact.js');
  const sessionDir = freshSessionDir('read-geometry-wrong-kind');
  const recDir = makeRecDir(sessionDir, 'rec-wk1');
  try {
    const ref = resolveRecRef(recDir);
    assert.throws(() => readGeometry(ref as never), /expects a snap ref/);
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('readRects and readEvents parse NDJSON files line-by-line for a rec ref', async () => {
  const { resolveRecRef, readRects, readEvents } = await import('../src/output/artifact.js');
  const sessionDir = freshSessionDir('read-ndjson');
  const recDir = makeRecDir(sessionDir, 'rec-nd1');
  fs.writeFileSync(path.join(recDir, 'rects.jsonl'), '{"frame":0,"x":1}\n{"frame":1,"x":2}\n', { mode: 0o600 });
  fs.writeFileSync(path.join(recDir, 'events.jsonl'), '{"t":0,"type":"input"}\n', { mode: 0o600 });
  try {
    const ref = resolveRecRef(recDir);
    const rects = readRects<{ frame: number; x: number }>(ref);
    assert.deepEqual(rects, [{ frame: 0, x: 1 }, { frame: 1, x: 2 }]);
    const events = readEvents<{ t: number; type: string }>(ref);
    assert.deepEqual(events, [{ t: 0, type: 'input' }]);
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('readEvents throws a structured per-line error on malformed NDJSON', async () => {
  const { resolveRecRef, readEvents, ArtifactResolutionError } = await import('../src/output/artifact.js');
  const sessionDir = freshSessionDir('read-ndjson-bad');
  const recDir = makeRecDir(sessionDir, 'rec-nd2');
  fs.writeFileSync(path.join(recDir, 'events.jsonl'), '{"ok":true}\nnot json\n', { mode: 0o600 });
  try {
    const ref = resolveRecRef(recDir);
    assert.throws(
      () => readEvents(ref),
      (err: unknown) => {
        assert.ok(err instanceof ArtifactResolutionError);
        assert.match(err.message, /line 2/);
        return true;
      },
    );
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('readMeta works for both a snap ref and a rec ref', async () => {
  const { resolveSnapRef, resolveRecRef, readMeta } = await import('../src/output/artifact.js');
  const sessionDir = freshSessionDir('read-meta');
  const snapDir = makeSnapDir(sessionDir, 'snap-m1');
  const recDir = makeRecDir(sessionDir, 'rec-m1');
  try {
    const snapRef = await resolveSnapRef(snapDir);
    const recRef = resolveRecRef(recDir);
    const snapMeta = readMeta<{ id: string; settled: boolean }>(snapRef);
    const recMeta = readMeta<{ id: string; state: string }>(recRef);
    assert.equal(snapMeta.id, 'snap-m1');
    assert.equal(snapMeta.settled, true);
    assert.equal(recMeta.id, 'rec-m1');
    assert.equal(recMeta.state, 'finalized');
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('artifactExists reports presence without throwing; artifactPath validates and returns the absolute path', async () => {
  const { resolveSnapRef, artifactExists, artifactPath, ArtifactResolutionError } = await import('../src/output/artifact.js');
  const sessionDir = freshSessionDir('artifact-exists');
  const snapDir = makeSnapDir(sessionDir, 'snap-e1');
  writeJsonPrivate(path.join(snapDir, 'styles.json'), {});
  try {
    const ref = await resolveSnapRef(snapDir);
    assert.equal(artifactExists(ref, 'styles.json'), true);
    assert.equal(artifactExists(ref, 'forms.json'), false);
    assert.equal(artifactPath(ref, 'styles.json'), path.join(snapDir, 'styles.json'));
    assert.throws(() => artifactPath(ref, 'forms.json'), ArtifactResolutionError);
    assert.equal(artifactPath(ref, 'forms.json', { mustExist: false }), path.join(snapDir, 'forms.json'));
  } finally {
    fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

// ============================================================================
// Selector helpers (src/output/selector.ts)
// ============================================================================

test('selector helpers resolve CSS/backend/axid/ax/text forms', async () => {
  const { resolveSelectorInput, parseSelectorInput } = await import('../src/output/selector.js');
  const elements = [
    { id: 'el-1', selector: 'button.send-btn', backendNodeId: 42, axId: 'ax-9', axName: 'Send', text: undefined },
    { id: 'el-2', selector: 'input.search', backendNodeId: 43, axId: 'ax-10', axName: 'Search box', text: 'Search conversations' },
  ];

  assert.deepEqual(parseSelectorInput('backend:42'), { kind: 'backend', value: '42' });
  assert.deepEqual(parseSelectorInput('axid:ax-9'), { kind: 'axid', value: 'ax-9' });
  assert.deepEqual(parseSelectorInput('ax:search'), { kind: 'ax', value: 'search' });
  assert.deepEqual(parseSelectorInput('text:conversations'), { kind: 'text', value: 'conversations' });
  assert.deepEqual(parseSelectorInput('.toast-container'), { kind: 'css', value: '.toast-container' });

  assert.equal(resolveSelectorInput(elements, 'button.send-btn')[0]?.id, 'el-1');
  assert.equal(resolveSelectorInput(elements, 'backend:43')[0]?.id, 'el-2');
  assert.equal(resolveSelectorInput(elements, 'axid:ax-9')[0]?.id, 'el-1');
  assert.equal(resolveSelectorInput(elements, 'ax:search box')[0]?.id, 'el-2');
  assert.equal(resolveSelectorInput(elements, 'text:conversations')[0]?.id, 'el-2');
  assert.deepEqual(resolveSelectorInput(elements, '.does-not-exist'), []);
});

test('selectorHints truncates unique example values for a recovery error', async () => {
  const { selectorHints } = await import('../src/output/selector.js');
  const elements = Array.from({ length: 20 }, (_, i) => ({
    id: `el-${i}`,
    selector: `.item-${i}`,
    axName: 'Item',
    text: `text-${i}`,
  }));
  const hints = selectorHints(elements, 5);
  assert.equal(hints.selectors.length, 5);
  assert.equal(hints.axNames.length, 1); // all elements share the same axName
  assert.equal(hints.texts.length, 5);
});
