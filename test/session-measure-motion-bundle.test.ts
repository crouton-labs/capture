import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CAPTURE_ROOT, writeJsonPrivate } from '../src/session/artifacts.js';
import type { ParsedArgs } from '../src/cdp/types.js';

/** Builds a ParsedArgs for a `session` invocation the way dispatch does. */
function sessionArgs(positional: string[], extra: Partial<ParsedArgs> = {}): ParsedArgs {
  return { command: 'session', positional, json: false, ...extra } as ParsedArgs;
}

function makeSessionId(label: string): string {
  return `test-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Writes a minimal on-disk `.session.json` fixture that `readSession` accepts. */
function writeSessionFixture(id: string): string {
  const dir = path.join(CAPTURE_ROOT, id);
  fs.mkdirSync(dir, { recursive: true });
  writeJsonPrivate(path.join(dir, '.session.json'), {
    sessionId: id,
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
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    logs.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write;
  return { logs, restore: () => { process.stdout.write = originalWrite; } };
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
      await sessionMain(sessionArgs(['stop', id]), []);
    } finally {
      out.restore();
    }

    const bundlePath = path.join(dir, 'bundle.json');
    const manifest = JSON.parse(fs.readFileSync(bundlePath, 'utf-8'));

    assert.ok(!('a11y' in manifest));
    assert.deepEqual(manifest.shots, []);
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
    // A rec bundle entry always carries viewportRestored; the collector
    // defaults it to null when the recording's meta.json omits it (this
    // fixture does), so a null here is the collector filling the field, not
    // the fixture supplying it.
    assert.deepEqual(manifest.recs[0], {
      id: 'rec-b1',
      path: recDir,
      action: 'click Send',
      frames: 42,
      durationMs: 1234,
      state: 'finalized',
      viewportRestored: null,
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
      await sessionMain(sessionArgs(['stop', id]), []);
    } finally {
      out.restore();
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'bundle.json'), 'utf-8'));
    assert.ok(!('a11y' in manifest));
    assert.deepEqual(manifest.shots, []);
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
    try { await sessionMain(sessionArgs(['stop', id]), []); } finally { out1.restore(); }

    const outMeasure = captureStdout();
    try { await sessionMain(sessionArgs(['view', id], { filter: 'measure' }), []); } finally { outMeasure.restore(); }
    const measureText = outMeasure.logs.join('');
    assert.ok(measureText.startsWith('<session'), measureText);
    assert.ok(measureText.includes('filter="measure"'), measureText);
    assert.ok(measureText.includes('snap-x'), measureText);

    const outMotion = captureStdout();
    try { await sessionMain(sessionArgs(['view', id], { filter: 'motion' }), []); } finally { outMotion.restore(); }
    const motionText = outMotion.logs.join('');
    assert.ok(motionText.startsWith('<session'), motionText);
    assert.ok(motionText.includes('motion: 0 entries'), motionText);

    // Existing filter-by-manifest-key sections still render a <session> block.
    for (const section of ['shots', 'har', 'logs', 'other']) {
      const out = captureStdout();
      try { await sessionMain(sessionArgs(['view', id], { filter: section }), []); } finally { out.restore(); }
      assert.ok(out.logs.join('').startsWith('<session'), section);
    }

    // Retired/invalid filter names are a structured error listing all six valid.
    for (const bad of ['a11y', 'screenshots']) {
      const out = captureStdout();
      try { await sessionMain(sessionArgs(['view', id], { filter: bad }), []); } finally { out.restore(); }
      const badText = out.logs.join('');
      assert.ok(badText.includes('invalid_filter'), badText);
      assert.ok(badText.includes('shots, har, logs, measure, motion, other'), badText);
      process.exitCode = 0;
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('session --help documents the measure|motion view filters', async () => {
  const { sessionMain } = await import('../src/session/commands.js');
  const out = captureStdout();
  try {
    await sessionMain(sessionArgs(['view'], { help: true }), []);
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

test('sessionMain emits unknown_subcommand for an unrecognized leaf and sets exitCode 1', async () => {
  const { sessionMain } = await import('../src/session/commands.js');
  const out = captureStdout();
  try {
    await sessionMain(sessionArgs(['bogus']), []);
  } finally {
    out.restore();
  }
  const text = out.logs.join('');
  assert.ok(text.includes('<error'), text);
  assert.ok(text.includes('code="unknown_subcommand"'), text);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
});

test('session stop|view with no id emit missing_argument and set exitCode 1', async () => {
  const { sessionMain } = await import('../src/session/commands.js');
  for (const leaf of ['stop', 'view']) {
    const out = captureStdout();
    try {
      await sessionMain(sessionArgs([leaf]), []);
    } finally {
      out.restore();
    }
    const text = out.logs.join('');
    assert.ok(text.includes('<error'), `${leaf}: ${text}`);
    assert.ok(text.includes('code="missing_argument"'), `${leaf}: ${text}`);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  }
});

test('session stop|view with an unknown id emit unknown_session and set exitCode 1', async () => {
  const { sessionMain } = await import('../src/session/commands.js');
  const missing = makeSessionId('nonexistent');
  for (const leaf of ['stop', 'view']) {
    const out = captureStdout();
    try {
      await sessionMain(sessionArgs([leaf, missing]), []);
    } finally {
      out.restore();
    }
    const text = out.logs.join('');
    assert.ok(text.includes('<error'), `${leaf}: ${text}`);
    assert.ok(text.includes('code="unknown_session"'), `${leaf}: ${text}`);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  }
});

test('session view on a started-but-not-stopped session emits session_not_stopped and sets exitCode 1', async () => {
  const { sessionMain } = await import('../src/session/commands.js');
  const id = makeSessionId('notstopped');
  const dir = writeSessionFixture(id); // fixture has no bundle.json
  try {
    const out = captureStdout();
    try {
      await sessionMain(sessionArgs(['view', id]), []);
    } finally {
      out.restore();
    }
    const text = out.logs.join('');
    assert.ok(text.includes('<error'), text);
    assert.ok(text.includes('code="session_not_stopped"'), text);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
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
    await setActiveSession({ sessionId: 'sess-rec', dir, harId: null, targetId: null, stepCount: 0 });

    assert.equal(getActiveRecId(), null, 'no recording armed yet');

    await setActiveRecId('rec-live-1');
    assert.equal(getActiveRecId(), 'rec-live-1');

    await clearActiveRecId();
    assert.equal(getActiveRecId(), null);
  } finally {
    clearActiveSession();
    if (prevNodeId === undefined) delete process.env.CRTR_NODE_ID;
    else process.env.CRTR_NODE_ID = prevNodeId;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
