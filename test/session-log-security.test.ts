/**
 * U05 — shell-free, contained, identity-owned session log tailing (C2).
 *
 * These proofs drive the REAL worker process boundary: the log-tail world's
 * entry seam is pointed at `src/capture.ts` so `session log` self-spawns the
 * genuine `__log-tail-serve` route under tsx, exactly as the built bin does with
 * an empty execArgv. No faked child_process for the core proofs; no real Chrome
 * (a no-url `session start` opens the live HAR without touching CDP).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as net from 'node:net';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { sessionMain } from '../src/session/commands.js';
import { __setLogTailWorld } from '../src/session/log-tailer.js';
import { getActiveSession, clearActiveSession, updateSessionState } from '../src/session-context.js';
import {
  CAPTURE_ROOT,
  __setArtifactTestHooks,
  processPidBirthProvider,
  type PidBirth,
} from '../src/session/artifacts.js';
import type { ParsedArgs } from '../src/cdp/types.js';

process.env.CRTR_NODE_ID = `u05-logsec-${process.pid}-${Date.now()}`;

const CAPTURE_SRC = path.resolve('src/capture.ts');
const baseEntry = (): string[] => [...process.execArgv, CAPTURE_SRC];

function useProductionWorker(extra: Partial<Parameters<typeof __setLogTailWorld>[0]> = {}): void {
  __setLogTailWorld({ entryArgv: baseEntry, ...extra });
}

function sessionArgs(positional: string[], extra: Partial<ParsedArgs> = {}): ParsedArgs {
  return { command: 'session', positional, json: false, ...extra } as ParsedArgs;
}

async function runSession(positional: string[], extra: Partial<ParsedArgs> = {}): Promise<string> {
  // Capture the command's rendered output while leaving the node:test runner's
  // own stdout channel intact. Under `node --test`, the child process reports
  // test events by writing V8-serialized Buffers to fd 1; swallowing those
  // starves the parent of every test's events. Command output, in contrast,
  // always arrives as a string (emitResult writes a template literal). So we
  // capture string writes and forward every Buffer write untouched — the
  // captured buffer is exactly the command's output, nothing else.
  const logs: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (typeof chunk === 'string') {
      logs.push(chunk);
      const cb = rest.find((a) => typeof a === 'function') as ((err?: Error) => void) | undefined;
      if (cb) cb();
      return true;
    }
    return (original as (c: unknown, ...r: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  try { await sessionMain(sessionArgs(positional, extra), []); }
  finally { process.stdout.write = original; }
  return logs.join('');
}

async function startSession(): Promise<{ id: string; dir: string }> {
  process.exitCode = 0;
  await runSession(['start']);
  const active = getActiveSession();
  assert.ok(active, 'session should be active after start');
  return { id: active!.sessionId, dir: active!.dir };
}

function readMeta(dir: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, '.session.json'), 'utf-8'));
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function pollUntil(fn: () => boolean, timeoutMs = 5_000, stepMs = 25): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (fn()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise((r) => setTimeout(r, stepMs));
  }
}

async function waitForBirthAbsent(pid: number, timeoutMs = 5_000): Promise<boolean> {
  return pollUntil(() => processPidBirthProvider.read(pid).status === 'absent', timeoutMs);
}

function mismatchedBirth(pid: number): PidBirth {
  const read = processPidBirthProvider.read(pid);
  assert.equal(read.status, 'found', 'decoy must be alive to read its birth');
  const b = (read as { identity: PidBirth }).identity;
  return b.provider === 'linux-proc-v1'
    ? { ...b, startTicks: String(Number(b.startTicks) + 7) }
    : { ...b, startSec: String(Number(b.startSec) + 7) };
}

function tmpDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `u05-${label}-`));
}

test('1 — literal command-substitution filenames are argv data and each worker owns a distinct socket', async () => {
  useProductionWorker();
  const { id, dir } = await startSession();
  const work = tmpDir('meta');
  const marker = path.join(work, 'MARKER_A');
  const backtickMarker = path.join(work, 'MARKER_B');
  process.env.U05_MARKER_A = marker;
  process.env.U05_MARKER_B = backtickMarker;
  const src = path.join(work, '$(touch${IFS}${U05_MARKER_A})');
  const backtickSrc = path.join(work, '`touch${IFS}${U05_MARKER_B}`');
  fs.writeFileSync(src, 'alpha line\n');
  fs.writeFileSync(backtickSrc, 'beta line\n');
  try {
    const out1 = await runSession(['log', src], { name: 'meta' });
    assert.ok(out1.startsWith('<log-tail '), out1);
    const out2 = await runSession(['log', backtickSrc], { name: 'meta' });
    assert.ok(out2.startsWith('<log-tail '), out2);

    const dest = path.join(dir, 'logs', 'meta.log');
    fs.appendFileSync(src, 'alpha two\n');
    fs.appendFileSync(backtickSrc, 'beta two\n');
    assert.ok(await pollUntil(() => {
      const content = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf-8') : '';
      return content.includes('alpha two') && content.includes('beta two');
    }), 'both metacharacter filenames must tail into the shared append destination');

    assert.ok(!fs.existsSync(marker), 'dollar command substitution must remain filename data');
    assert.ok(!fs.existsSync(backtickMarker), 'backtick command substitution must remain filename data');
    const entries = readMeta(dir).logPids as Array<Record<string, unknown>>;
    assert.equal(entries.length, 2);
    assert.notEqual(entries[0].socketPath, entries[1].socketPath, 'each worker must own a unique control socket');
    assert.match(fs.readFileSync(dest, 'utf-8'), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z alpha/m, 'timestamped');
  } finally {
    delete process.env.U05_MARKER_A;
    delete process.env.U05_MARKER_B;
    await runSession(['stop', id], { json: true });
    fs.rmSync(marker, { force: true });
    fs.rmSync(backtickMarker, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
    clearActiveSession();
  }
});

test('2 — invalid labels are rejected before any effect; .session.json stays byte-identical', async () => {
  useProductionWorker();
  const { id, dir } = await startSession();
  const work = tmpDir('labels');
  const src = path.join(work, 'valid-source.log');
  fs.writeFileSync(src, 'x\n');
  const before = fs.readFileSync(path.join(dir, '.session.json'));
  const bad: Array<[string, string]> = [
    ['empty', ''],
    ['slash separator', 'a/b'],
    ['backslash separator', 'a\\b'],
    ['dotdot', '..'],
    ['nul', 'a\0b'],
    ['overlong', 'x'.repeat(65)],
  ];
  try {
    for (const [why, label] of bad) {
      process.exitCode = 0;
      const out = await runSession(['log', src], { name: label });
      assert.ok(out.includes('code="invalid_label"'), `${why}: ${out}`);
      assert.equal(process.exitCode, 1, why);
      // Byte-identical metadata: no logPids entry, no mutation.
      assert.deepEqual(fs.readFileSync(path.join(dir, '.session.json')), before, `${why}: metadata changed`);
    }
    // No destination file was ever created for any rejected label.
    const logsDir = path.join(dir, 'logs');
    const logs = fs.existsSync(logsDir) ? fs.readdirSync(logsDir) : [];
    assert.equal(logs.length, 0, `no dest should exist: ${logs.join(',')}`);
    // Literal shell metacharacters ARE legal — the same session accepts them.
    process.exitCode = 0;
    const ok = await runSession(['log', src], { name: '$(touch x); rm -rf ~' });
    assert.ok(ok.startsWith('<log-tail '), ok);
  } finally {
    await runSession(['stop', id], { json: true });
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
    clearActiveSession();
  }
});

test('3 — a planted destination symlink fails the open; the target is untouched', async () => {
  useProductionWorker();
  const { id, dir } = await startSession();
  const work = tmpDir('symlink');
  const src = path.join(work, 'src.log');
  fs.writeFileSync(src, 'x\n');
  const outside = path.join(work, 'outside.txt');
  fs.writeFileSync(outside, 'ORIGINAL BYTES');
  const outsideModeBefore = fs.statSync(outside).mode;
  const logsDir = path.join(dir, 'logs');
  fs.mkdirSync(logsDir, { recursive: true, mode: 0o700 });
  fs.symlinkSync(outside, path.join(logsDir, 'planted.log'));
  try {
    process.exitCode = 0;
    const out = await runSession(['log', src], { name: 'planted' });
    assert.ok(out.includes('<error'), `command must fail: ${out}`);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
    // The symlink target's bytes and mode are unchanged.
    assert.equal(fs.readFileSync(outside, 'utf-8'), 'ORIGINAL BYTES');
    assert.equal(fs.statSync(outside).mode, outsideModeBefore);
    // Nothing was registered.
    assert.deepEqual(readMeta(dir).logPids, []);
  } finally {
    await runSession(['stop', id], { json: true });
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
    clearActiveSession();
  }
});

test('4 — a finalized session is rejected; its metadata stays byte-stable', async () => {
  useProductionWorker();
  const { id, dir } = await startSession();
  const work = tmpDir('finalized');
  const src = path.join(work, 'src.log');
  fs.writeFileSync(src, 'x\n');
  try {
    await runSession(['stop', id], { json: true });
    assert.ok(fs.existsSync(path.join(dir, 'bundle.json')), 'stop must bundle');
    const before = fs.readFileSync(path.join(dir, '.session.json'));
    const operationsPath = path.join(dir, '.operations.json');
    const operationsBefore = fs.readFileSync(operationsPath);
    process.exitCode = 0;
    const out = await runSession(['log', src], { session: id, name: 'late' });
    assert.ok(out.includes('code="session_stopped"'), out);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
    assert.deepEqual(fs.readFileSync(path.join(dir, '.session.json')), before, 'metadata changed');
    assert.deepEqual(fs.readFileSync(operationsPath), operationsBefore, 'operation admission changed');
    assert.ok(!fs.existsSync(path.join(dir, 'logs', 'late.log')), 'no dest created');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
    clearActiveSession();
  }
});

test('5 — metadata registration failure rolls back the ready worker group', async () => {
  const { id, dir } = await startSession();
  const work = tmpDir('regfail');
  const src = path.join(work, 'src.log');
  fs.writeFileSync(src, 'x\n');
  let workerPid = 0;
  const trackingProvider = {
    read(pid: number) {
      if (pid !== process.pid) workerPid = pid;
      return processPidBirthProvider.read(pid);
    },
  };
  useProductionWorker({ pidBirthProvider: trackingProvider });
  let injected = false;
  __setArtifactTestHooks({
    beforeRename(detail) {
      if (!injected && detail.path.endsWith(`${path.sep}.session.json`)) {
        injected = true;
        throw new Error('injected session metadata registration failure');
      }
    },
  });
  try {
    process.exitCode = 0;
    const out = await runSession(['log', src], { name: 'regfail' });
    assert.ok(out.includes('<error'), `must be structured error: ${out}`);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
    assert.ok(injected, 'registration write must reach the injected failure');
    assert.ok(workerPid > 0, 'the ready worker identity must have been read');
    assert.deepEqual(readMeta(dir).logPids, []);
    assert.ok(await waitForBirthAbsent(workerPid), 'registration rollback must reap the worker group');
  } finally {
    __setArtifactTestHooks();
    useProductionWorker();
    await runSession(['stop', id], { json: true });
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
    clearActiveSession();
  }
});

test('6 — weak registrations fail closed, while a mismatched birth is gone and never signalled', async () => {
  useProductionWorker();
  const { id, dir } = await startSession();
  const decoy = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
  decoy.unref();
  const decoyPid = decoy.pid!;
  assert.ok(await pollUntil(() => isAlive(decoyPid)), 'decoy must start');
  try {
    await updateSessionState(dir, {
      logPids: [{ pid: decoyPid, name: 'weak', sourcePath: '/x' }] as unknown as never,
    });
    process.exitCode = 0;
    const weak = await runSession(['stop', id], { json: true });
    assert.ok(weak.includes('stop_failed'), `identity-free registration must fail stop: ${weak}`);
    assert.ok(!fs.existsSync(path.join(dir, 'bundle.json')), 'a weak writer record cannot be bundled as immutable truth');
    assert.ok(isAlive(decoyPid), 'weak registration must never authorize a signal');

    await updateSessionState(dir, {
      logPids: [{
        pid: decoyPid, name: 'decoy', sourcePath: '/x',
        socketPath: path.join(CAPTURE_ROOT, 'sock', '0000000000000000.sock'),
        socketDev: '0', socketIno: '0', nonce: 'd'.repeat(48),
        birth: mismatchedBirth(decoyPid),
      }] as unknown as never,
    });
    process.exitCode = 0;
    const stopped = await runSession(['stop', id], { json: true });
    assert.ok(stopped.includes('session-stopped'), `mismatched birth is already gone: ${stopped}`);
    assert.ok(isAlive(decoyPid), 'different birth identity must survive stop');
  } finally {
    try { process.kill(decoyPid, 'SIGKILL'); } catch { /* already gone */ }
    fs.rmSync(dir, { recursive: true, force: true });
    clearActiveSession();
  }
});

test('7 — a wrong control nonce is refused; the tailer keeps running and nothing is killed', async () => {
  useProductionWorker();
  const { id, dir } = await startSession();
  const work = tmpDir('auth');
  const src = path.join(work, 'src.log');
  fs.writeFileSync(src, 'first\n');
  try {
    await runSession(['log', src], { name: 'auth' });
    const entry = (readMeta(dir).logPids as Array<Record<string, unknown>>)[0];
    const socketPath = entry.socketPath as string;
    const workerPid = entry.pid as number;
    assert.ok(isAlive(workerPid), 'worker must be alive');

    // Connect with a wrong nonce; expect {ok:false} and no teardown.
    const reply = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const conn = net.createConnection(socketPath);
      let buf = '';
      let settled = false;
      const finish = (action: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        conn.destroy();
        action();
      };
      const timer = setTimeout(() => finish(() => reject(new Error('no reply'))), 4_000);
      conn.on('connect', () => conn.write(JSON.stringify({ nonce: 'not-the-nonce', op: 'drain' }) + '\n'));
      conn.on('data', (data) => {
        buf += data.toString();
        const newline = buf.indexOf('\n');
        if (newline >= 0) finish(() => resolve(JSON.parse(buf.slice(0, newline))));
      });
      conn.on('error', error => finish(() => reject(error)));
    });
    assert.equal(reply.ok, false, 'wrong nonce must be refused');

    // The worker is untouched and tail still flows.
    assert.ok(isAlive(workerPid), 'worker must survive a wrong-nonce attempt');
    fs.appendFileSync(src, 'after auth\n');
    const dest = path.join(dir, 'logs', 'auth.log');
    assert.ok(await pollUntil(() => fs.existsSync(dest) && fs.readFileSync(dest, 'utf-8').includes('after auth')), 'tail must keep running');
  } finally {
    await runSession(['stop', id], { json: true });
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
    clearActiveSession();
  }
});

test('8 — normal lifecycle: prompt timestamped output; stop drains before the bundle; worker + socket gone', async () => {
  useProductionWorker();
  const { id, dir } = await startSession();
  const work = tmpDir('normal');
  const src = path.join(work, 'app.log');
  fs.writeFileSync(src, 'boot\n');
  try {
    await runSession(['log', src], { name: 'app' });
    const entry = (readMeta(dir).logPids as Array<Record<string, unknown>>)[0];
    const socketPath = entry.socketPath as string;
    const workerPid = entry.pid as number;
    const dest = path.join(dir, 'logs', 'app.log');

    // Autoflush: an appended line shows up promptly, timestamped.
    fs.appendFileSync(src, 'line-one\n');
    assert.ok(await pollUntil(() => fs.existsSync(dest) && fs.readFileSync(dest, 'utf-8').includes('line-one'), 3000), 'prompt output');
    // Append a burst just before stop; the drain must capture all of it.
    fs.appendFileSync(src, 'line-two\nline-three\n');

    const stop = JSON.parse(await runSession(['stop', id], { json: true }));
    assert.equal(stop.tag, 'session-stopped');

    const destContent = fs.readFileSync(dest, 'utf-8');
    for (const l of ['line-one', 'line-two', 'line-three']) assert.ok(destContent.includes(l), `drain missed ${l}: ${destContent}`);
    assert.match(destContent, /^\d{4}-\d{2}-\d{2}T[\d:.]+Z line-one$/m, 'timestamped');

    const bundle = JSON.parse(fs.readFileSync(path.join(dir, 'bundle.json'), 'utf-8'));
    assert.ok(bundle.logs.some((l: { name: string }) => l.name === 'app.log'), 'bundle lists the log');

    assert.ok(await waitForBirthAbsent(workerPid), 'worker must be gone after stop');
    assert.ok(!fs.existsSync(socketPath), 'worker must unlink its control socket');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
    clearActiveSession();
  }
});

test('9 — unknown PID identity fails stop without authorizing a signal', async () => {
  useProductionWorker();
  const { id, dir } = await startSession();
  const decoy = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
  decoy.unref();
  const decoyPid = decoy.pid!;
  assert.ok(await pollUntil(() => isAlive(decoyPid)), 'decoy must start');
  const birth = processPidBirthProvider.read(decoyPid);
  assert.equal(birth.status, 'found');
  useProductionWorker({
    pidBirthProvider: {
      read(pid) {
        return pid === decoyPid
          ? { status: 'unknown', reason: 'injected identity read failure' }
          : processPidBirthProvider.read(pid);
      },
    },
  });
  try {
    await updateSessionState(dir, {
      logPids: [{
        pid: decoyPid, name: 'unknown', sourcePath: '/x',
        socketPath: path.join(CAPTURE_ROOT, 'sock', '1111111111111111.sock'),
        socketDev: '0', socketIno: '0', nonce: 'd'.repeat(48),
        birth: (birth as { identity: PidBirth }).identity,
      }] as unknown as never,
    });
    process.exitCode = 0;
    const out = await runSession(['stop', id], { json: true });
    assert.ok(out.includes('stop_failed'), `unknown identity must fail stop: ${out}`);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
    assert.ok(!fs.existsSync(path.join(dir, 'bundle.json')));
    assert.ok(isAlive(decoyPid), 'unknown identity must never authorize a signal');
  } finally {
    try { process.kill(decoyPid, 'SIGKILL'); } catch { /* gone */ }
    useProductionWorker();
    await updateSessionState(dir, { logPids: [] });
    await runSession(['stop', id], { json: true });
    fs.rmSync(dir, { recursive: true, force: true });
    clearActiveSession();
  }
});

test('10 — session stop waits for a log operation admitted before its worker is ready', async () => {
  useProductionWorker();
  const { id, dir } = await startSession();
  const work = tmpDir('stop-race');
  const src = path.join(work, 'race.log');
  const delayedEntry = path.join(work, 'delayed-entry.mjs');
  fs.writeFileSync(src, 'race line\n');
  fs.writeFileSync(delayedEntry, `setTimeout(() => { import(${JSON.stringify(pathToFileURL(CAPTURE_SRC).href)}); }, 400);\n`);
  useProductionWorker({ entryArgv: () => [...process.execArgv, delayedEntry] });

  const rendered: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (typeof chunk === 'string') {
      rendered.push(chunk);
      const callback = rest.find(value => typeof value === 'function') as (() => void) | undefined;
      callback?.();
      return true;
    }
    return (original as (value: unknown, ...args: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;

  let logPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  try {
    process.exitCode = 0;
    logPromise = sessionMain(sessionArgs(['log', src], { name: 'race' }), []);
    const operationsPath = path.join(dir, '.operations.json');
    assert.ok(await pollUntil(() => {
      try {
        const state = JSON.parse(fs.readFileSync(operationsPath, 'utf-8')) as { tokens?: unknown[] };
        return state.tokens?.length === 1;
      } catch { return false; }
    }), 'log must publish its operation token before worker readiness');

    stopPromise = sessionMain(sessionArgs(['stop', id], { json: true }), []);
    assert.ok(await pollUntil(() => {
      try {
        const state = JSON.parse(fs.readFileSync(operationsPath, 'utf-8')) as { stopping?: unknown };
        return state.stopping === true;
      } catch { return false; }
    }), 'stop must mark admission closed while waiting for the admitted log');
    assert.ok(!fs.existsSync(path.join(dir, 'bundle.json')), 'stop cannot commit while the log token is live');

    await Promise.all([logPromise, stopPromise]);
    assert.ok(rendered.some(output => output.startsWith('<log-tail ')), 'admitted log succeeds');
    assert.ok(rendered.some(output => output.includes('session-stopped')), 'waiting stop succeeds afterward');
    assert.ok(fs.existsSync(path.join(dir, 'bundle.json')), 'stop commits only after log registration and teardown');
  } finally {
    await Promise.allSettled([logPromise, stopPromise].filter((value): value is Promise<void> => value !== undefined));
    process.stdout.write = original;
    useProductionWorker();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(work, { recursive: true, force: true });
    clearActiveSession();
  }
});

test('11 — a worker never confirmed after readiness self-terminates; a confirmed one outlives the same deadline', async () => {
  // Orphan half: drive the hidden route directly with a short confirm deadline
  // and never confirm — the exact shape a parent killed between spawn and
  // registration leaves behind. The worker must reap itself and its socket.
  const work = tmpDir('confirm');
  const src = path.join(work, 'src.log');
  fs.writeFileSync(src, 'x\n');
  const token = crypto.randomBytes(8).toString('hex');
  const socketPath = path.join(CAPTURE_ROOT, 'sock', `${token}.sock`);
  const destFd = fs.openSync(path.join(work, 'dest.log'), 'a');
  const child = spawn(
    process.execPath,
    [...baseEntry(), '__log-tail-serve', '--source', src, '--socket-token', token, '--confirm-timeout', '500'],
    { detached: true, stdio: ['ignore', destFd, 'ignore', 'pipe'], env: { ...process.env, CAPTURE_LOG_TAIL_NONCE: 'a'.repeat(48) } },
  );
  fs.closeSync(destFd);
  const orphanPid = child.pid!;
  try {
    const readiness = await new Promise<string>((resolve, reject) => {
      let buf = '';
      const pipe = child.stdio[3] as NodeJS.ReadableStream;
      const timer = setTimeout(() => reject(new Error('no readiness')), 10_000);
      pipe.on('data', (chunk: Buffer) => {
        buf += chunk.toString('utf-8');
        const newline = buf.indexOf('\n');
        if (newline >= 0) { clearTimeout(timer); resolve(buf.slice(0, newline).trim()); }
      });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('worker exited before readiness')); });
    });
    child.unref();
    assert.equal(readiness, 'ready');
    assert.ok(fs.existsSync(socketPath), 'the ready worker owns its control socket');
    assert.ok(await waitForBirthAbsent(orphanPid), 'an unconfirmed worker must self-terminate at its deadline');
    assert.ok(!fs.existsSync(socketPath), 'the self-terminated worker unlinks its socket');

    // Confirmed half: the full command route confirms the registration, so the
    // same short deadline must never fire — the worker keeps tailing past it.
    useProductionWorker({ confirmTimeoutMs: 500 });
    const { id, dir } = await startSession();
    try {
      await runSession(['log', src], { name: 'confirmed' });
      const entry = (readMeta(dir).logPids as Array<Record<string, unknown>>)[0];
      const workerPid = entry.pid as number;
      await new Promise(resolve => setTimeout(resolve, 900));
      assert.ok(isAlive(workerPid), 'a confirmed worker must outlive its confirm deadline');
      fs.appendFileSync(src, 'post-deadline\n');
      const dest = path.join(dir, 'logs', 'confirmed.log');
      assert.ok(await pollUntil(() => fs.existsSync(dest) && fs.readFileSync(dest, 'utf-8').includes('post-deadline')), 'the confirmed worker is still tailing');
      await runSession(['stop', id], { json: true });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      clearActiveSession();
    }
  } finally {
    try { process.kill(-orphanPid, 'SIGKILL'); } catch { /* already gone */ }
    useProductionWorker();
    fs.rmSync(work, { recursive: true, force: true });
  }
});
