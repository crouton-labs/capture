import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn } from 'node:child_process';
import { sessionMain } from '../src/session/commands.js';
import { cdpMain } from '../src/cdp/dispatch.js';
import {
  clearActiveSession,
  getActiveSession,
  setActiveSession,
} from '../src/session-context.js';
import {
  ARTIFACT_TEST_HOOKS_SYMBOL,
  CAPTURE_ROOT,
  __setArtifactTestFaults,
  __setArtifactTestHooks,
  writeJsonPrivate,
} from '../src/session/artifacts.js';
import { readHarRecording } from '../src/har-manager.js';
import { admitSessionOperation, beginSessionStop } from '../src/session/coordinator.js';
import type { ParsedArgs } from '../src/cdp/types.js';

process.env.CRTR_NODE_ID = `u03-lifecycle-${process.pid}-${Date.now()}`;

function args(positional: string[], extra: Partial<ParsedArgs> = {}): ParsedArgs {
  return { command: 'session', positional, json: true, ...extra } as ParsedArgs;
}

async function silently(positional: string[]): Promise<void> {
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = (() => true) as typeof process.stdout.write;
  try { await sessionMain(args(positional), []); }
  finally { process.stdout.write = original; }
}

async function started(): Promise<NonNullable<ReturnType<typeof getActiveSession>>> {
  process.exitCode = 0;
  await silently(['start']);
  const active = getActiveSession();
  assert.ok(active);
  return active!;
}

function cleanup(...dirs: string[]): void {
  __setArtifactTestHooks(undefined);
  __setArtifactTestFaults(undefined);
  clearActiveSession();
  process.exitCode = 0;
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
}

test('concurrent and repeated stop reuse the immutable bundle without rewriting it', async () => {
  const active = await started();
  try {
    const original = process.stdout.write.bind(process.stdout);
    process.stdout.write = (() => true) as typeof process.stdout.write;
    try {
      await Promise.all([
        sessionMain(args(['stop', active.sessionId]), []),
        sessionMain(args(['stop', active.sessionId]), []),
      ]);
    } finally {
      process.stdout.write = original;
    }
    const bundlePath = path.join(active.dir, 'bundle.json');
    const first = fs.readFileSync(bundlePath);
    const firstMtime = fs.statSync(bundlePath).mtimeNs;
    await new Promise(resolve => setTimeout(resolve, 15));
    await silently(['stop', active.sessionId]);
    assert.deepEqual(fs.readFileSync(bundlePath), first);
    assert.equal(fs.statSync(bundlePath).mtimeNs, firstMtime);
  } finally { cleanup(active.dir); }
});

test('repeat stop repairs post-commit metadata and pointer cleanup without rewriting bundle', async () => {
  const active = await started();
  try {
    await silently(['stop', active.sessionId]);
    const bundlePath = path.join(active.dir, 'bundle.json');
    const bytes = fs.readFileSync(bundlePath);
    const mtime = fs.statSync(bundlePath).mtimeNs;
    const metadata = JSON.parse(fs.readFileSync(path.join(active.dir, '.session.json'), 'utf-8'));
    await setActiveSession({ ...metadata, stoppedAt: null, stopping: true });
    assert.equal(getActiveSession(), null, 'bundle truth must hide a crash-window active index');
    // Replant the crash-window index to exercise stop's idempotent repair path.
    writeJsonPrivate(path.join(CAPTURE_ROOT, `.active-${process.env.CRTR_NODE_ID}`), { sessionId: active.sessionId, dir: active.dir });
    await silently(['stop', active.sessionId]);
    const repaired = JSON.parse(fs.readFileSync(path.join(active.dir, '.session.json'), 'utf-8'));
    assert.equal(repaired.stoppedAt, JSON.parse(bytes.toString('utf-8')).stoppedAt);
    assert.equal(repaired.stopping, false);
    assert.deepEqual(fs.readFileSync(bundlePath), bytes);
    assert.equal(fs.statSync(bundlePath).mtimeNs, mtime);
  } finally { cleanup(active.dir); }
});

test('stopping A compare-clears only A and leaves an indexed B byte-identical', async () => {
  const a = await started();
  const bDir = fs.mkdtempSync(path.join(CAPTURE_ROOT, 'cap-b-'));
  await setActiveSession({ sessionId: 'cap-b', dir: bDir, harId: null, targetId: 'target-b', stepCount: 0 });
  const indexPath = path.join(CAPTURE_ROOT, `.active-${process.env.CRTR_NODE_ID}`);
  const before = fs.readFileSync(indexPath);
  try {
    await silently(['stop', a.sessionId]);
    assert.deepEqual(fs.readFileSync(indexPath), before);
    assert.equal(getActiveSession()?.sessionId, 'cap-b');
  } finally { cleanup(a.dir, bDir); }
});

test('bundle commit failure preserves active metadata and live HAR for retry', async () => {
  const active = await started();
  assert.ok(active.harId);
  try {
    __setArtifactTestHooks({
      beforeTempCreate(detail) {
        if (detail.path.endsWith(`${path.sep}.bundle.json.`) || detail.path.includes('.bundle.json.')) {
          __setArtifactTestFaults({
            before(role) {
              if (role === 'artifact-data-write') {
                __setArtifactTestFaults(undefined);
                throw new Error('injected bundle commit failure');
              }
            },
          });
        }
      },
    });
    await silently(['stop', active.sessionId]);
    __setArtifactTestHooks(undefined);

    assert.equal(process.exitCode, 1);
    assert.equal(fs.existsSync(path.join(active.dir, 'bundle.json')), false);
    assert.equal(getActiveSession()?.sessionId, active.sessionId);
    assert.equal(getActiveSession()?.stopping, false);
    await readHarRecording(active.harId!);
  } finally { cleanup(active.dir); }
});

test('an admitted operation drains before stop and later admissions are rejected', async () => {
  const dir = fs.mkdtempSync(path.join(CAPTURE_ROOT, 'coordinator-'));
  try {
    const operation = await admitSessionOperation(dir);
    let resolved = false;
    const stopping = beginSessionStop(dir).then(value => { resolved = true; return value; });
    for (let attempt = 0; attempt < 100; attempt++) {
      const statePath = path.join(dir, '.operations.json');
      if (fs.existsSync(statePath) && JSON.parse(fs.readFileSync(statePath, 'utf-8')).stopping) break;
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    await assert.rejects(admitSessionOperation(dir), /stopping/);
    assert.equal(resolved, false);
    await operation.release();
    const admission = await stopping;
    assert.equal(resolved, true);
    await admission.finish(true);
  } finally { cleanup(dir); }
});

test('a real session-bound page invocation admits through the lifecycle coordinator', async () => {
  const dir = fs.mkdtempSync(path.join(CAPTURE_ROOT, 'coordinator-dispatch-'));
  const originalArgv = process.argv;
  try {
    await setActiveSession({ sessionId: 'coordinator-dispatch', dir, harId: null, targetId: null, stepCount: 0, port: 1 });
    const stopping = await beginSessionStop(dir);
    process.argv = [process.execPath, 'capture', 'page', 'elements'];
    await assert.rejects(cdpMain(), (error: unknown) => {
      assert.equal((error as { descriptor?: { code?: string } }).descriptor?.code, 'session_stopping');
      return true;
    });
    await stopping.finish(false);
  } finally {
    process.argv = originalArgv;
    cleanup(dir);
  }
});

test('stop reclaims an admitted token whose owning process died', async () => {
  const dir = fs.mkdtempSync(path.join(CAPTURE_ROOT, 'coordinator-dead-'));
  const child = spawn(process.execPath, ['--import', 'tsx', '-e', `import('./src/session/coordinator.js').then(async m => { await m.admitSessionOperation(${JSON.stringify(dir)}); setInterval(() => {}, 1000); })`], {
    cwd: process.cwd(),
    env: { ...process.env, CAPTURE_ROOT },
    stdio: 'ignore',
  });
  try {
    const statePath = path.join(dir, '.operations.json');
    for (let attempt = 0; attempt < 200 && !fs.existsSync(statePath); attempt++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(fs.existsSync(statePath), true);
    child.kill('SIGKILL');
    await new Promise<void>(resolve => child.once('exit', () => resolve()));
    const admission = await beginSessionStop(dir);
    await admission.finish(true);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    cleanup(dir);
  }
});

test('missing, bundled, and symlinked active indexes self-clean without following targets', async () => {
  const indexPath = path.join(CAPTURE_ROOT, `.active-${process.env.CRTR_NODE_ID}`);
  const missingDir = fs.mkdtempSync(path.join(CAPTURE_ROOT, 'missing-index-'));
  const bundledDir = fs.mkdtempSync(path.join(CAPTURE_ROOT, 'bundled-index-'));
  const outside = path.join(CAPTURE_ROOT, `outside-${process.pid}.json`);
  try {
    writeJsonPrivate(indexPath, { sessionId: 'missing', dir: missingDir });
    assert.equal(getActiveSession(), null);
    assert.equal(fs.existsSync(indexPath), false);

    await setActiveSession({ sessionId: 'bundled', dir: bundledDir, harId: null, targetId: null, stepCount: 0 });
    writeJsonPrivate(path.join(bundledDir, 'bundle.json'), { committed: true });
    assert.equal(getActiveSession(), null);
    assert.equal(fs.existsSync(indexPath), false);

    fs.writeFileSync(outside, 'outside-bytes');
    fs.symlinkSync(outside, indexPath);
    assert.equal(getActiveSession(), null);
    assert.equal(fs.existsSync(indexPath), false);
    assert.equal(fs.readFileSync(outside, 'utf-8'), 'outside-bytes');
  } finally {
    cleanup(missingDir, bundledDir);
    fs.rmSync(outside, { force: true });
    delete (globalThis as Record<symbol, unknown>)[ARTIFACT_TEST_HOOKS_SYMBOL];
  }
});
