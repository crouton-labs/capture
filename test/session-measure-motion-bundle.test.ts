import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CAPTURE_ROOT, writeJsonPrivate } from '../src/session/artifacts.js';

function makeSessionId(label: string): string {
  return `test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Writes a minimal on-disk `.session.json` fixture that `readSession` accepts. */
function writeSessionFixture(id: string): string {
  const dir = path.join(CAPTURE_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  writeJsonPrivate(path.join(dir, '.session.json'), {
    id,
    dir,
    harId: null,
    startedAt: new Date().toISOString(),
    url: 'http://example.test',
    targetId: null,
    stepCount: 0,
    logPids: [],
    bridgeSocket: null,
    bridgePid: null,
  });
  return dir;
}

function captureStdout(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map((a) => String(a)).join(' '));
  };
  return { logs, restore: () => { console.log = originalLog; } };
}

test('session stop collects measure/snaps and motion/recs meta.json into bundle.snaps/recs', async () => {
  const { sessionMain } = await import('../src/session/commands.js');
  const id = makeSessionId('bundle');
  const dir = writeSessionFixture(id);

  const snapDir = path.join(dir, 'measure', 'snaps', 'snap-a1');
  fs.mkdirSync(snapDir, { recursive: true });
  writeJsonPrivate(path.join(snapDir, 'meta.json'), {
    id: 'snap-a1',
    url: 'http://example.test/page',
    viewport: '1280x800',
    settled: true,
    capturedAt: '2026-01-01T00:00:00.000Z',
  });

  const recDir = path.join(dir, 'motion', 'recs', 'rec-b1');
  fs.mkdirSync(recDir, { recursive: true });
  writeJsonPrivate(path.join(recDir, 'meta.json'), {
    id: 'rec-b1',
    action: 'click Send',
    frames: 42,
    durationMs: 1234,
    state: 'finalized',
  });

  try {
    const out = captureStdout();
    try {
      await sessionMain(['stop', id]);
    } finally {
      out.restore();
    }

    const bundlePath = path.join(dir, 'bundle.json');
    const manifest = JSON.parse(fs.readFileSync(bundlePath, 'utf-8'));

    assert.equal(manifest.snaps.length, 1);
    assert.deepEqual(manifest.snaps[0], {
      id: 'snap-a1',
      path: snapDir,
      url: 'http://example.test/page',
      viewport: '1280x800',
      settled: true,
      capturedAt: '2026-01-01T00:00:00.000Z',
    });

    assert.equal(manifest.recs.length, 1);
    assert.deepEqual(manifest.recs[0], {
      id: 'rec-b1',
      path: recDir,
      action: 'click Send',
      frames: 42,
      durationMs: 1234,
      state: 'finalized',
    });

    // measure/ and motion/ subtrees must not spill into the `other` bucket.
    assert.deepEqual(manifest.other, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('session stop tolerates a session with no measure/motion artifacts (empty arrays)', async () => {
  const { sessionMain } = await import('../src/session/commands.js');
  const id = makeSessionId('empty');
  const dir = writeSessionFixture(id);

  try {
    const out = captureStdout();
    try {
      await sessionMain(['stop', id]);
    } finally {
      out.restore();
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'bundle.json'), 'utf-8'));
    assert.deepEqual(manifest.snaps, []);
    assert.deepEqual(manifest.recs, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('session view --filter measure|motion map to manifest.snaps/manifest.recs; existing filters unchanged', async () => {
  const { sessionMain } = await import('../src/session/commands.js');
  const id = makeSessionId('view');
  const dir = writeSessionFixture(id);

  const snapDir = path.join(dir, 'measure', 'snaps', 'snap-x');
  fs.mkdirSync(snapDir, { recursive: true });
  writeJsonPrivate(path.join(snapDir, 'meta.json'), {
    id: 'snap-x', url: null, viewport: null, settled: false, capturedAt: '2026-01-01T00:00:00.000Z',
  });

  try {
    const out1 = captureStdout();
    try { await sessionMain(['stop', id]); } finally { out1.restore(); }

    const outMeasure = captureStdout();
    try { await sessionMain(['view', id, '--filter', 'measure']); } finally { outMeasure.restore(); }
    const measureSection = JSON.parse(outMeasure.logs.join(''));
    assert.equal(measureSection.length, 1);
    assert.equal(measureSection[0].id, 'snap-x');

    const outMotion = captureStdout();
    try { await sessionMain(['view', id, '--filter', 'motion']); } finally { outMotion.restore(); }
    assert.deepEqual(JSON.parse(outMotion.logs.join('')), []);

    // Existing filter-by-manifest-key sections still map directly.
    for (const section of ['screenshots', 'har', 'a11y', 'logs', 'other']) {
      const out = captureStdout();
      try { await sessionMain(['view', id, '--filter', section]); } finally { out.restore(); }
      assert.doesNotThrow(() => JSON.parse(out.logs.join('')));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('session --help documents the measure|motion view filters', async () => {
  const { sessionMain } = await import('../src/session/commands.js');
  const out = captureStdout();
  try {
    await sessionMain(['view', '--help']);
  } finally {
    out.restore();
  }
  const text = out.logs.join('\n');
  assert.ok(text.includes('measure'), 'help text should mention the measure filter');
  assert.ok(text.includes('motion'), 'help text should mention the motion filter');
});

test("createOneshotSession('measure') creates a private oneshot-{id}/measure/snaps dir, not registered active", async () => {
  const { createOneshotSession } = await import('../src/session/commands.js');
  const { getActiveSession } = await import('../src/session-context.js');

  const oneshot = createOneshotSession('measure');
  try {
    assert.match(oneshot.id, /^oneshot-/);
    assert.equal(oneshot.dir, path.join(CAPTURE_ROOT, oneshot.id));
    assert.equal(oneshot.artifactsDir, path.join(oneshot.dir, 'measure', 'snaps'));
    assert.ok(fs.statSync(oneshot.artifactsDir).isDirectory());
    assert.equal(fs.statSync(oneshot.artifactsDir).mode & 0o777, 0o700);
    // A oneshot must never become the active session.
    const active = getActiveSession();
    assert.notEqual(active?.sessionId, oneshot.id);
  } finally {
    fs.rmSync(oneshot.dir, { recursive: true, force: true });
  }
});

test("createOneshotSession('motion') creates a private oneshot-{id}/motion/recs dir", async () => {
  const { createOneshotSession } = await import('../src/session/commands.js');

  const oneshot = createOneshotSession('motion');
  try {
    assert.equal(oneshot.artifactsDir, path.join(oneshot.dir, 'motion', 'recs'));
    assert.ok(fs.statSync(oneshot.artifactsDir).isDirectory());
    assert.equal(fs.statSync(oneshot.artifactsDir).mode & 0o777, 0o700);
  } finally {
    fs.rmSync(oneshot.dir, { recursive: true, force: true });
  }
});

test('session context persists activeRecId with set/clear/read helpers, scoped like the active-session pointer', async () => {
  const {
    setActiveSession,
    clearActiveSession,
    setActiveRecId,
    clearActiveRecId,
    getActiveRecId,
  } = await import('../src/session-context.js');

  const prevNodeId = process.env.CRTR_NODE_ID;
  const dir = fs.mkdtempSync(path.join(CAPTURE_ROOT, 'active-rec-test-'));
  try {
    process.env.CRTR_NODE_ID = 'test-node-active-rec-id';
    clearActiveSession();
    setActiveSession({ sessionId: 'sess-rec', dir, harId: null, targetId: null, stepCount: 0 });

    assert.equal(getActiveRecId(), null, 'no recording armed yet');

    setActiveRecId('rec-live-1');
    assert.equal(getActiveRecId(), 'rec-live-1');

    clearActiveRecId();
    assert.equal(getActiveRecId(), null);
  } finally {
    clearActiveSession();
    if (prevNodeId === undefined) delete process.env.CRTR_NODE_ID;
    else process.env.CRTR_NODE_ID = prevNodeId;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
