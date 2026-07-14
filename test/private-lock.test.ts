import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as childProcess from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

// This file deliberately imports artifacts only after assigning a process-unique explicit root.
const savedCaptureRoot = process.env.CAPTURE_ROOT;
const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-private-lock-'));
process.env.CAPTURE_ROOT = suiteRoot;
const moduleUrl = pathToFileURL(path.resolve('src/session/artifacts.ts')).href;
let CAPTURE_ROOT: string; let DIR_MODE: number; let FILE_MODE: number; let acquirePrivateLock: any; let ensurePrivateDir: any; let processPidBirthProvider: any; let parseLinuxProcStat: any; let parseDarwinKernProc: any; let __setArtifactTestFaults: any; let __setArtifactTestHooks: any; let __setArtifactTestTokens: any; let __setArtifactTestExecFileSync: any; let __setArtifactTestLinuxProviderRead: any;
const ready = import('../src/session/artifacts.ts').then(artifacts => {
  ({ CAPTURE_ROOT, DIR_MODE, FILE_MODE, acquirePrivateLock, ensurePrivateDir, processPidBirthProvider, parseLinuxProcStat, parseDarwinKernProc, __setArtifactTestFaults, __setArtifactTestHooks, __setArtifactTestTokens, __setArtifactTestExecFileSync, __setArtifactTestLinuxProviderRead } = artifacts);
});
type PidBirth = any;
type PidBirthProvider = any;

// tsx cold-start plus a fresh artifacts.ts compile in a spawned child can exceed a trivial bound under
// concurrent test-file load; give children a generous-but-bounded window so proofs never trip on startup
// jitter while still guarding a true hang.
const TSX_CHILD_TIMEOUT_MS = 30_000;

// ---- exact snapshot helpers ---------------------------------------------------------------------
function mode(p: string): number { return fs.lstatSync(p).mode & 0o777; }
function id(p: string) { const s = fs.lstatSync(p); return { dev: s.dev, ino: s.ino, mode: s.mode & 0o777, type: s.isDirectory() ? 'dir' : s.isFile() ? 'file' : s.isSymbolicLink() ? 'link' : 'other' }; }
function regular(p: string) { const s = fs.lstatSync(p); return { dev: s.dev, ino: s.ino, mode: s.mode & 0o777, type: s.isFile() ? 'file' : 'other', bytes: fs.readFileSync(p) }; }
function link(p: string) { const s = fs.lstatSync(p); return { dev: s.dev, ino: s.ino, type: s.isSymbolicLink() ? 'link' : 'other', target: fs.readlinkSync(p) }; }
function listing(p: string) { return fs.readdirSync(p).sort(); }
function lockSnapshot(lock: string) { return { directory: id(lock), owner: regular(path.join(lock, 'owner')), listing: listing(lock) }; }
function outsideSnapshot(parent: string, target: string) { return { parent: listing(parent), target: regular(target) }; }
function parsedOwner(lock: string) { return JSON.parse(fs.readFileSync(path.join(lock, 'owner'), 'utf8')); }
function pendings(parent: string) { return listing(parent).filter(n => n.includes('.pending')); }

// ---- fixture identities / providers -------------------------------------------------------------
const birth = (process.platform === 'darwin'
  ? { provider: 'darwin-kern-proc-v1', startSec: '1', startUsec: 1 }
  : { provider: 'linux-proc-v1', bootId: '00000000-0000-0000-0000-000000000000', startTicks: '1' }) as PidBirth;
const altBirth = (process.platform === 'darwin'
  ? { provider: 'darwin-kern-proc-v1', startSec: '2', startUsec: 2 }
  : { provider: 'linux-proc-v1', bootId: '00000000-0000-0000-0000-000000000000', startTicks: '2' }) as PidBirth;
function provider(state: 'live' | 'dead' | 'unknown' = 'live', identity: PidBirth = birth): PidBirthProvider {
  return { read: () => state === 'live' ? { status: 'found', identity } : state === 'dead' ? { status: 'absent' } : { status: 'unknown', reason: 'fixture unavailable' } } as PidBirthProvider;
}

// ---- lock scaffolding -----------------------------------------------------------------------------
function rand() { return Math.random().toString(16).slice(2); }
function freshLock(label = 'lock'): string {
  const dir = path.join(CAPTURE_ROOT, `${label}-${process.pid}-${rand()}`);
  ensurePrivateDir(dir);
  return path.join(dir, '.lock');
}
function nestedLock(label: string, ...segs: string[]): string {
  const dir = path.join(CAPTURE_ROOT, `${label}-${process.pid}-${rand()}`, ...segs);
  ensurePrivateDir(dir);
  return path.join(dir, '.lock');
}
function writeOwner(lock: string, ownerValue: unknown): void {
  fs.mkdirSync(lock, { mode: DIR_MODE });
  fs.writeFileSync(path.join(lock, 'owner'), typeof ownerValue === 'string' ? ownerValue : JSON.stringify(ownerValue), { mode: FILE_MODE });
  fs.chmodSync(lock, DIR_MODE); fs.chmodSync(path.join(lock, 'owner'), FILE_MODE);
}
function owner(overrides: Record<string, unknown> = {}) {
  return { version: 1, token: 'a'.repeat(32), pid: process.pid, birth, leaseDeadlineNs: '0', ...overrides };
}
function resetSeams() { __setArtifactTestFaults(); __setArtifactTestHooks(); __setArtifactTestTokens(); __setArtifactTestExecFileSync(); __setArtifactTestLinuxProviderRead(); }
async function withHrtimeClockAsync<T>(next: () => bigint, action: () => Promise<T>): Promise<T> {
  const prior = process.hrtime.bigint;
  process.hrtime.bigint = next;
  try { return await action(); } finally { process.hrtime.bigint = prior; }
}
function cleanup(lock: string) { resetSeams(); fs.rmSync(path.dirname(lock), { recursive: true, force: true }); }
async function rejectsUnchanged(lock: string, action: () => Promise<unknown>, matcher: RegExp): Promise<void> {
  const before = lockSnapshot(lock);
  await assert.rejects(action(), matcher);
  assert.deepEqual(lockSnapshot(lock), before);
}
function outsideDir(): string { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-lock-outside-')); fs.writeFileSync(path.join(d, 'secret'), 'secret', { mode: 0o644 }); return d; }

// ---- orphan-proof child teardown ------------------------------------------------------------------
// Every helper below spawns a real OS child. If THIS process (the test runner) dies abnormally —
// crash, SIGKILL, a CI timeout, an exception thrown before a test's try even starts — a bare
// per-test `finally { child.kill() }` never runs, and any live child (blocked in busyGate's or
// L-V4's Atomics.wait loop) reparents to pid 1 and spins forever. Track every spawned child here so
// a runner-exit path can SIGKILL whatever is still alive, and .unref() every child so a stray
// registration can never keep this process's event loop alive by itself.
const liveChildren = new Set<childProcess.ChildProcess>();
function trackChild<T extends childProcess.ChildProcess>(child: T): T {
  liveChildren.add(child);
  child.unref();
  child.once('exit', () => { liveChildren.delete(child); });
  return child;
}
function killLiveChildren(): void {
  for (const child of liveChildren) { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
  liveChildren.clear();
}
// Installed once at module load (this file runs as its own `node --test` process, so these handlers
// are scoped to this suite). `exit` handlers run synchronously, and `child.kill('SIGKILL')` is a
// synchronous signal send, so it is safe there. SIGINT/SIGTERM/uncaughtException/unhandledRejection
// cover every other way this process can go down before a test's `finally` gets to run.
process.on('exit', killLiveChildren);
process.on('SIGINT', () => { killLiveChildren(); process.exit(130); });
process.on('SIGTERM', () => { killLiveChildren(); process.exit(143); });
process.on('uncaughtException', (err) => { killLiveChildren(); console.error(err); process.exit(1); });
process.on('unhandledRejection', (reason) => { killLiveChildren(); console.error(reason); process.exit(1); });

// Self-defense embedded into every spawned child script (via string interpolation — these run in a
// separate `-e` process, not in this module). EMPIRICALLY VERIFIED on this box (Node v26.5.0, darwin
// arm64; see the orchestrator's validation evidence): `process.ppid` updates LIVE the instant the
// spawning process dies and the child reparents (observed flipping from the real parent pid to `1`
// within one 100ms poll interval, no caching lag) — so a captured-at-start comparison is sufficient
// on its own. A `process.kill(parentPid, 0)` liveness probe is layered on anyway as a second, ~free
// signal, since ppid-live-update is not a behavior every future Node/platform combination this suite
// runs under is guaranteed to preserve, and the probe covers that without adding real cost.
const ORPHAN_GUARD = `const __parentPid = process.ppid; function __orphaned(){ if (process.ppid !== __parentPid) return true; try { process.kill(__parentPid, 0); } catch { return true; } return false; }`;

// ---- subprocess coordination ---------------------------------------------------------------------
// `proc` (when given) threads a child's lifecycle into the poll: if the file never appears because
// the child that was supposed to write it died first (crash during tsx compile, an exception before
// it publishes), failing after the full timeoutMs bound gives a bare "timed out" with no evidence.
// Once the child has exited, re-check the file ONCE more (a child may legitimately write-then-exit
// between one poll iteration and the next) before treating the exit as failure evidence, then throw
// with the child's exit code/signal attached — exactly the race `exitCode()` below already closes.
async function waitFor(file: string, opts: { proc?: childProcess.ChildProcess; label?: string; timeoutMs?: number } = {}): Promise<void> {
  const { proc, label = 'child', timeoutMs = TSX_CHILD_TIMEOUT_MS } = opts;
  const end = Date.now() + timeoutMs;
  while (!fs.existsSync(file)) {
    if (proc && (proc.exitCode !== null || proc.signalCode !== null)) {
      if (fs.existsSync(file)) return;
      throw new Error(`${label} exited (code=${proc.exitCode} signal=${proc.signalCode}) before writing ${file}`);
    }
    if (Date.now() >= end) throw new Error(`timed out waiting for ${file}`);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
async function exitCode(proc: childProcess.ChildProcess, label: string, timeoutMs = TSX_CHILD_TIMEOUT_MS): Promise<number | null> {
  // A child that already exited before this call will never re-emit 'exit' to a freshly attached
  // listener, so a plain once('exit') race would hang until timeoutMs. node sets exitCode (normal
  // exit) or signalCode (terminated by signal) once the process is gone, so short-circuit on either
  // and report the settled result immediately. This closes a cross-process coordination race where a
  // fast-exiting child — e.g. the bounded loser in a two-publisher proof, which writes its result and
  // exits while the parent is still reading the winner's result — can exit before the parent reaches
  // its exitCode() call, which otherwise stalled the whole test to the timeout bound.
  if (proc.exitCode !== null || proc.signalCode !== null) return proc.exitCode;
  let timer: NodeJS.Timeout | undefined;
  try { return await Promise.race([new Promise<number | null>(resolve => proc.once('exit', resolve)), new Promise<never>((_, reject) => { timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error(`timed out waiting for ${label}`)); }, timeoutMs); })]); }
  finally { if (timer) clearTimeout(timer); }
}
function coordinator(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'capture-lock-coord-')); }
function openGate(gate: string): void { fs.writeFileSync(gate, 'go'); }
function readResult(file: string) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

// A configurable child: it acquires a lock, optionally pausing at a named hook (or during release at
// afterOwnerRemoved) on a cross-process marker/gate barrier, reports its result, and holds its handle
// until told to release. Orchestration files live in a sibling coordinator dir, never under the root.
const LOCK_CHILD = `
import * as fs from 'node:fs';
const cfg = JSON.parse(process.env.CHILD_CONFIG);
const a = await import(${JSON.stringify(moduleUrl)});
const guards = {};
// Publish atomically: write to a same-directory temp name, then rename into place, so a reader
// that polls existsSync(final) and immediately parses the bytes can never observe a truncated file.
function publish(file, data){ const tmp = file + '.' + process.pid + '.' + Math.random().toString(16).slice(2) + '.tmp'; fs.writeFileSync(tmp, data); fs.renameSync(tmp, file); }
${ORPHAN_GUARD}
function busyGate(gate){ const cell = new Int32Array(new SharedArrayBuffer(4)); while(!fs.existsSync(gate)){ if (__orphaned()) process.exit(1); Atomics.wait(cell,0,0,20); } }
function pause(key, marker, gate){ if(!guards[key]){ guards[key]=true; try { publish(marker, 'ready'); } catch {} } busyGate(gate); }
function makeProvider(p){ if(p==='production') return a.processPidBirthProvider; return { read(pid){ return (p.ownerPid && pid === p.ownerPid) ? { status: p.ownerStatus || 'absent', reason: 'fixture' } : { status: 'found', identity: p.self }; } }; }
const opts = { acquireTimeoutMs: cfg.acquireTimeoutMs, leaseMs: cfg.leaseMs, pidBirthProvider: makeProvider(cfg.provider) };
if (cfg.afterOwnerRemovedPause) opts.afterOwnerRemoved = () => pause('aor', cfg.afterOwnerRemovedPause.marker, cfg.afterOwnerRemovedPause.gate);
if (cfg.pause) { const h = {}; h[cfg.pause.phase] = () => pause('hook', cfg.pause.marker, cfg.pause.gate); a.__setArtifactTestHooks(h); }
try {
  const handle = await a.acquirePrivateLock(cfg.lock, opts);
  let owner = null; try { owner = JSON.parse(fs.readFileSync(cfg.lock + '/owner', 'utf8')); } catch {}
  const st = fs.lstatSync(cfg.lock);
  publish(cfg.result, JSON.stringify({ status: 'acquired', pid: process.pid, token: handle.token, owner, generation: { dev: st.dev, ino: st.ino, mode: st.mode & 0o777 } }));
  if (cfg.releaseAfterAcquire) handle.release();
  if (cfg.hold) { busyGate(cfg.hold.gate); if (cfg.hold.release) handle.release(); }
} catch (err) {
  publish(cfg.result, JSON.stringify({ status: 'error', pid: process.pid, message: String((err && err.message) || err) }));
}
`;
function spawnLockChild(cfg: Record<string, unknown>): childProcess.ChildProcess {
  return trackChild(childProcess.spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', LOCK_CHILD], { env: { ...process.env, CAPTURE_ROOT, CHILD_CONFIG: JSON.stringify(cfg) }, stdio: 'ignore' }));
}

// =================================================================================================
// Root freezing is a process-start contract, so it is proved in fresh node processes.
// =================================================================================================
test('explicit CAPTURE_ROOT is frozen per process and never writes the default root', async () => {
  await ready;
  const rootA = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-lock-a-'));
  const rootB = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-lock-b-'));
  const coord = coordinator();
  const defaultSentinel = path.join(os.tmpdir(), 'capture-sessions', `private-lock-default-${process.pid}`);
  const resultA = path.join(coord, 'a.json'); const resultB = path.join(coord, 'b.json');
  const script = `import * as fs from 'node:fs'; import * as path from 'node:path'; const a=await import(${JSON.stringify(moduleUrl)}); const root=a.CAPTURE_ROOT; a.writePrivateFile(path.join(root,'one'),'one'); process.env.CAPTURE_ROOT='/tmp/attacker'; a.writePrivateFile(path.join(root,'two'),'two'); fs.writeFileSync(process.env.RESULT,JSON.stringify({root,entries:fs.readdirSync(root).sort()}));`;
  const spawn = (root: string, result: string) => trackChild(childProcess.spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { env: { ...process.env, CAPTURE_ROOT: root, RESULT: result }, stdio: 'ignore' }));
  try {
    assert.equal(fs.existsSync(defaultSentinel), false);
    const a = spawn(rootA, resultA); assert.equal(await exitCode(a, 'root A child'), 0);
    const b = spawn(rootB, resultB); assert.equal(await exitCode(b, 'root B child'), 0);
    assert.deepEqual(readResult(resultA), { root: path.resolve(rootA), entries: ['one', 'two'] });
    assert.deepEqual(readResult(resultB), { root: path.resolve(rootB), entries: ['one', 'two'] });
    assert.equal(fs.existsSync(defaultSentinel), false);
  } finally { fs.rmSync(rootA, { recursive: true, force: true }); fs.rmSync(rootB, { recursive: true, force: true }); fs.rmSync(coord, { recursive: true, force: true }); }
});

// =================================================================================================
// L-S1 — strict owner schema rejects every malformed class
// =================================================================================================
test('L-S1 strict owner schema rejects every malformed class without touching its generation', async () => {
  await ready;
  const linuxBirth = { provider: 'linux-proc-v1', bootId: '00000000-0000-0000-0000-000000000000', startTicks: '1' };
  const malformed: unknown[] = [
    null, 42, [], {},
    { ...owner(), extra: true },                                   // unknown extra top-level key
    { version: 1, token: 'a'.repeat(32), pid: process.pid, birth },// missing leaseDeadlineNs
    { ...owner(), version: '1' },                                  // wrong version type
    { ...owner(), version: 2 },                                    // bad version value
    { ...owner(), token: 12345 },                                  // wrong token type
    { ...owner(), pid: '1' },                                      // wrong pid type
    { ...owner(), leaseDeadlineNs: 0 },                            // wrong deadline type
    { ...owner(), birth: 7 },                                      // wrong birth type
    { ...owner(), pid: Number.MAX_SAFE_INTEGER + 1 },              // unsafe pid
    { ...owner(), pid: 0 }, { ...owner(), pid: -1 },               // nonpositive pid
    { ...owner(), token: 'a'.repeat(31) },                         // short token
    { ...owner(), token: 'A'.repeat(32) },                         // uppercase token
    { ...owner(), token: 'g'.repeat(32) },                         // nonhex token
    { ...owner(), leaseDeadlineNs: '01' },                         // noncanonical decimal
    { ...owner(), leaseDeadlineNs: '1.0' },                        // nondecimal
    { ...owner(), leaseDeadlineNs: '-1' },                         // negative deadline
    { ...owner(), birth: { provider: 'unknown' } },               // unknown provider
    { ...owner(), birth: { provider: 'linux-proc-v1', bootId: '00000000-0000-0000-0000-000000000000' } }, // missing birth key
    { ...owner(), birth: { ...linuxBirth, extra: true } },         // extra birth key
    { ...owner(), birth: { provider: 'linux-proc-v1', bootId: 'not-a-uuid', startTicks: '1' } },                 // malformed UUID shape
    { ...owner(), birth: { provider: 'linux-proc-v1', bootId: '00000000-0000-0000-0000-00000000000G', startTicks: '1' } }, // malformed UUID char
    { ...owner(), birth: { provider: 'linux-proc-v1', bootId: '00000000000000000000000000000000', startTicks: '1' } },     // malformed UUID placement (no dashes)
    { ...owner(), birth: { provider: 'linux-proc-v1', bootId: '00000000-0000-0000-0000-000000000000', startTicks: '01' } },// noncanonical linux start decimal
    { ...owner(), birth: { provider: 'darwin-kern-proc-v1', startSec: '01', startUsec: 1 } },  // noncanonical darwin start decimal
    { ...owner(), birth: { provider: 'darwin-kern-proc-v1', startSec: '1', startUsec: 1000000 } }, // useconds too large
    { ...owner(), birth: { provider: 'darwin-kern-proc-v1', startSec: '1', startUsec: -1 } },      // negative useconds
    { ...owner(), birth: { provider: 'darwin-kern-proc-v1', startSec: '1', startUsec: 1.5 } },     // non-integer useconds
  ];
  for (const value of malformed) {
    const lock = freshLock('schema');
    try { writeOwner(lock, value); await rejectsUnchanged(lock, () => acquirePrivateLock(lock, { acquireTimeoutMs: 0, leaseMs: 1, pidBirthProvider: provider() }), /malformed/); }
    finally { cleanup(lock); }
  }
});

// =================================================================================================
// L-S2 — reordered exact keys compare semantically; extras do not
// =================================================================================================
test('L-S2 reordered exact owner keys compare semantically while extras and malformed stay closed', async () => {
  await ready;
  const lock = freshLock('reorder'); let now = 2_000_000n;
  const reorderedBirth = process.platform === 'darwin'
    ? { startUsec: 1, startSec: '1', provider: 'darwin-kern-proc-v1' }
    : { startTicks: '1', bootId: '00000000-0000-0000-0000-000000000000', provider: 'linux-proc-v1' };
  try {
    // Reordered top-level + birth keys, expired lease, provider reports the same live identity.
    writeOwner(lock, { leaseDeadlineNs: '0', birth: reorderedBirth, pid: process.pid, token: 'a'.repeat(32), version: 1 });
    const before = lockSnapshot(lock);
    await assert.rejects(acquirePrivateLock(lock, { acquireTimeoutMs: 2, leaseMs: 1, pidBirthProvider: provider('live'), nowNs: () => now, sleep: async () => { now += 1_000_000n; } }), /timed out/);
    assert.deepEqual(lockSnapshot(lock), before);
    // Extra key never compares as "different birth" — it is fail-closed malformed.
    fs.writeFileSync(path.join(lock, 'owner'), JSON.stringify({ ...owner(), birth: { ...reorderedBirth, extra: 1 } }), { mode: FILE_MODE });
    const beforeExtra = lockSnapshot(lock);
    await assert.rejects(acquirePrivateLock(lock, { acquireTimeoutMs: 0, leaseMs: 1, pidBirthProvider: provider('live') }), /malformed/);
    assert.deepEqual(lockSnapshot(lock), beforeExtra);
  } finally { cleanup(lock); }
});

// =================================================================================================
// L-S3 — unknown recorded-owner liveness cannot authorize takeover
// =================================================================================================
test('L-S3 unknown recorded-owner liveness cannot authorize takeover', async () => {
  await ready;
  const lock = freshLock('unknown'); const ownerPid = process.pid + 1000; let now = 0n;
  const p = { read: (pid: number) => pid === ownerPid ? { status: 'unknown', reason: 'record unavailable' } : { status: 'found', identity: birth } } as PidBirthProvider;
  try {
    writeOwner(lock, owner({ pid: ownerPid, leaseDeadlineNs: '0' }));
    const before = lockSnapshot(lock);
    await assert.rejects(acquirePrivateLock(lock, { acquireTimeoutMs: 2, leaseMs: 1, pidBirthProvider: p, nowNs: () => now, sleep: async () => { now += 1_000_000n; } }), /timed out/);
    assert.deepEqual(lockSnapshot(lock), before);
  } finally { cleanup(lock); }
});

// =================================================================================================
// L-S4 — PID/birth/expiry takeover rules are exact
// =================================================================================================
test('L-S4 same pid+birth never takes over; same pid+different birth takes over only after expiry', async () => {
  await ready;
  // Same pid + same birth, expired: no takeover.
  const same = freshLock('s4-same'); let n1 = 0n;
  try {
    writeOwner(same, owner({ leaseDeadlineNs: '0' }));
    const before = lockSnapshot(same);
    await assert.rejects(acquirePrivateLock(same, { acquireTimeoutMs: 2, leaseMs: 1, pidBirthProvider: provider('live', birth), nowNs: () => n1, sleep: async () => { n1 += 1_000_000n; } }), /timed out/);
    assert.deepEqual(lockSnapshot(same), before);
  } finally { cleanup(same); }
  // Same pid + different canonical birth: no takeover before expiry, takeover after.
  const diff = freshLock('s4-diff');
  try {
    writeOwner(diff, owner({ leaseDeadlineNs: '1000000000' }));   // deadline = 1s (ns)
    const before = lockSnapshot(diff);
    let nBefore = 0n;
    await assert.rejects(acquirePrivateLock(diff, { acquireTimeoutMs: 2, leaseMs: 1, pidBirthProvider: provider('live', altBirth), nowNs: () => nBefore, sleep: async () => { nBefore += 1_000_000n; } }), /timed out/);
    assert.deepEqual(lockSnapshot(diff), before);
    let nAfter = 2_000_000_000n;                                  // past the 1s deadline
    const successor = await acquirePrivateLock(diff, { acquireTimeoutMs: 5, leaseMs: 10, pidBirthProvider: provider('live', altBirth), nowNs: () => nAfter, sleep: async () => { nAfter += 1_000_000n; } });
    const after = lockSnapshot(diff);
    // Directory-inode identity is not a portable observable here: the successor dir is
    // produced by production's own retire+publish (rmdir the old lock dir, rename a fresh
    // staging dir onto the path), and on Linux ext4 the freed inode is routinely reused for
    // the successor — so a raw {dev,ino} comparison can spuriously match even though the
    // takeover minted a genuinely new lease generation. The portable proxy for "this is a
    // fresh generation, not the predecessor's" is the owner token: it's a per-acquire random
    // 32-hex, so a fresh token is the true security-relevant signal the inode check stood in for.
    const predToken = JSON.parse(before.owner.bytes.toString('utf8')).token;
    const su = parsedOwner(diff);
    assert.notEqual(su.token, predToken); // takeover minted a fresh lease generation (new random token), not the predecessor's
    assert.notDeepEqual(after.owner.bytes, before.owner.bytes);
    assert.deepEqual(Object.keys(su).sort(), ['birth', 'leaseDeadlineNs', 'pid', 'token', 'version']);
    assert.equal(su.pid, process.pid); assert.deepEqual(su.birth, altBirth); assert.equal(su.version, 1);
    assert.equal(after.directory.mode, DIR_MODE); assert.equal(after.owner.mode, FILE_MODE); assert.deepEqual(after.listing, ['owner']);
    successor.release();
  } finally { cleanup(diff); }
});

// =================================================================================================
// L-S5 — release owner matching is complete
// =================================================================================================
test('L-S5 release matches the entire owner and refuses a byte-identical successor inode', async () => {
  await ready;
  const lock = freshLock('s5');
  try {
    const handle = await acquirePrivateLock(lock, { acquireTimeoutMs: 1_000, leaseMs: 10, pidBirthProvider: provider() });
    const mutations = [{ token: 'b'.repeat(32) }, { pid: process.pid + 1 }, { leaseDeadlineNs: '99' }, { birth: altBirth }, { version: 2 }];
    for (const change of mutations) {
      const original = parsedOwner(lock);
      fs.writeFileSync(path.join(lock, 'owner'), JSON.stringify({ ...original, ...change }), { mode: FILE_MODE });
      const before = lockSnapshot(lock); handle.release(); assert.deepEqual(lockSnapshot(lock), before);
      fs.writeFileSync(path.join(lock, 'owner'), JSON.stringify(original), { mode: FILE_MODE });
    }
    // Replace canonical with a *different inode* holding byte-identical owner bytes; the old handle must refuse it.
    // Constructing "different inode, same path" via rm-then-mkdir at that path is not portable:
    // on Linux ext4 the freed inode is routinely reused by the very next allocation, so the
    // recreated dir would silently share the predecessor's inode and this test's premise would
    // never hold. Instead build the replacement at a *sibling* path FIRST — while the original
    // still exists so its inode stays allocated and cannot be reused — then remove the original
    // and rename the sibling into place; rename preserves the sibling's inode, so it's
    // guaranteed to differ from the original's on every filesystem.
    const ownerBytes = fs.readFileSync(path.join(lock, 'owner'));
    const successor = `${lock}.successor`;                 // sibling; allocated while `lock` inode is still live → distinct inode
    fs.mkdirSync(successor, { mode: DIR_MODE });
    fs.writeFileSync(path.join(successor, 'owner'), ownerBytes, { mode: FILE_MODE });
    fs.chmodSync(successor, DIR_MODE); fs.chmodSync(path.join(successor, 'owner'), FILE_MODE);
    fs.rmSync(lock, { recursive: true, force: true });     // frees the old inode AFTER the successor inode is taken
    fs.renameSync(successor, lock);                        // lock now holds the distinct-inode dir, byte-identical owner
    const replacement = lockSnapshot(lock);
    handle.release();
    assert.deepEqual(lockSnapshot(lock), replacement);
  } finally { cleanup(lock); }
});

// =================================================================================================
// L-P1 — publication is atomic and complete (cross-process publisher pauses at beforePublishRename)
// =================================================================================================
test('L-P1 publication is atomic and complete under a cross-process pause at the publish rename', async () => {
  await ready;
  const coord = coordinator(); const lock = freshLock('p1'); const parent = path.dirname(lock);
  const marker = path.join(coord, 'm'); const gate = path.join(coord, 'g'); const hold = path.join(coord, 'h'); const result = path.join(coord, 'r.json');
  const child = spawnLockChild({ lock, acquireTimeoutMs: 60_000, leaseMs: 60_000, provider: 'production', pause: { phase: 'beforePublishRename', marker, gate }, result, hold: { gate: hold, release: true } });
  try {
    await waitFor(marker, { proc: child, label: 'p1 child' });
    // Canonical absent; exactly one 0700 pending dir with a fully-parseable 0600 owner.
    assert.equal(fs.existsSync(lock), false);
    const pend = pendings(parent); assert.equal(pend.length, 1);
    const stage = path.join(parent, pend[0]!);
    assert.equal(mode(stage), DIR_MODE); assert.deepEqual(listing(stage), ['owner']); assert.equal(mode(path.join(stage, 'owner')), FILE_MODE);
    const staged = JSON.parse(fs.readFileSync(path.join(stage, 'owner'), 'utf8'));
    assert.deepEqual(Object.keys(staged).sort(), ['birth', 'leaseDeadlineNs', 'pid', 'token', 'version']);
    assert.match(staged.token, /^[0-9a-f]{32,}$/);
    // Resume; complete generation becomes canonical, pending disappears, data matches publication.
    openGate(gate);
    await waitFor(result, { proc: child, label: 'p1 child' });
    const res = readResult(result); assert.equal(res.status, 'acquired');
    const pub = lockSnapshot(lock);
    assert.equal(pub.directory.mode, DIR_MODE); assert.equal(pub.owner.mode, FILE_MODE); assert.deepEqual(pub.listing, ['owner']);
    assert.deepEqual(pendings(parent), []);
    assert.deepEqual(parsedOwner(lock), staged); assert.equal(parsedOwner(lock).token, res.token);
    openGate(hold);
    assert.equal(await exitCode(child, 'p1 child'), 0);
  } finally { child.kill('SIGKILL'); fs.rmSync(coord, { recursive: true, force: true }); cleanup(lock); }
});

// =================================================================================================
// L-P2 — publication failures remove only owned staging
// =================================================================================================
test('L-P2 publication faults remove only owned staging and preserve outside state', async () => {
  await ready;
  const faultCases: Array<{ label: string; faults: any }> = [
    { label: 'lock-owner-write', faults: { before: (r: string) => { if (r === 'lock-owner-write') throw new Error('fault write'); } } },
    { label: 'lock-owner-fsync', faults: { before: (r: string) => { if (r === 'lock-owner-fsync') throw new Error('fault fsync'); } } },
    { label: 'lock-owner-close-after-real', faults: { after: (r: string) => { if (r === 'lock-owner-close') throw new Error('fault close after real'); } } },
    { label: 'lock-stage-dir-fsync', faults: { before: (r: string) => { if (r === 'lock-stage-dir-fsync') throw new Error('fault stage fsync'); } } },
    { label: 'lock-publish-rename', faults: { before: (r: string) => { if (r === 'lock-publish-rename') throw new Error('fault publish'); } } },
  ];
  for (const { label, faults } of faultCases) {
    const lock = freshLock(`p2-${label}`); const parent = path.dirname(lock); const outside = path.join(parent, 'outside'); fs.writeFileSync(outside, 'outside', { mode: 0o644 });
    try {
      const before = outsideSnapshot(parent, outside); __setArtifactTestFaults(faults);
      await assert.rejects(acquirePrivateLock(lock, { acquireTimeoutMs: 500, leaseMs: 1, pidBirthProvider: provider() }), /fault/);
      assert.equal(fs.existsSync(lock), false);
      assert.deepEqual(pendings(parent), []);
      assert.deepEqual(outsideSnapshot(parent, outside), before);
    } finally { cleanup(lock); }
  }
  // Persistent pre-unlink cleanup failure: primary publish fault + cleanup fault surface together and the
  // exact owned 0700 stage (with its 0600 owner) is retained; no unowned name is changed.
  const lock = freshLock('p2-persist'); const parent = path.dirname(lock); const outside = path.join(parent, 'outside'); fs.writeFileSync(outside, 'outside', { mode: 0o644 });
  try {
    const before = outsideSnapshot(parent, outside);
    __setArtifactTestFaults({ before(role: string) { if (role === 'lock-publish-rename') throw new Error('publish primary'); if (role === 'artifact-cleanup-unlink') throw new Error('cleanup persistent'); } });
    await assert.rejects(acquirePrivateLock(lock, { acquireTimeoutMs: 500, leaseMs: 1, pidBirthProvider: provider() }), (err: unknown) => {
      assert.ok(err instanceof AggregateError, 'expected AggregateError');
      const messages = (err as AggregateError).errors.map(e => String((e as Error).message));
      assert.ok(messages.some(m => /publish primary/.test(m)) && messages.some(m => /cleanup persistent/.test(m)));
      return true;
    });
    assert.equal(fs.existsSync(lock), false);
    const pend = pendings(parent); assert.equal(pend.length, 1);
    const stage = path.join(parent, pend[0]!);
    const after = outsideSnapshot(parent, outside);
    assert.equal(mode(stage), DIR_MODE); assert.deepEqual(listing(stage), ['owner']); assert.equal(mode(path.join(stage, 'owner')), FILE_MODE);
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(stage, 'owner'), 'utf8')));
    assert.deepEqual(after.target, before.target);
    const stableParent = listing(parent).filter(name => name !== pend[0]);
    assert.deepEqual(stableParent, before.parent);
    assert.deepEqual(listing(parent).sort(), [...before.parent, ...pend].sort());
  } finally { cleanup(lock); }
});

// =================================================================================================
// L-P3 — owner partial writes are exact; zero/negative fail
// =================================================================================================
test('L-P3 owner partial writes complete exactly once; zero/negative writes fail with no residue', async () => {
  await ready;
  const lock = freshLock('p3'); let calls = 0;
  try {
    __setArtifactTestFaults({ write(role: string, real: () => number) { if (role === 'lock-owner-write') { calls++; return calls === 1 ? 1 : calls === 2 ? 2 : real(); } return real(); } });
    const handle = await acquirePrivateLock(lock, { acquireTimeoutMs: 1_000, leaseMs: 10, pidBirthProvider: provider() });
    assert.equal(calls, 3);
    const parsed = parsedOwner(lock);
    assert.deepEqual(Object.keys(parsed).sort(), ['birth', 'leaseDeadlineNs', 'pid', 'token', 'version']);
    assert.match(parsed.token, /^[0-9a-f]{32,}$/); assert.match(parsed.leaseDeadlineNs, /^(0|[1-9][0-9]*)$/); assert.deepEqual(parsed.birth, birth);
    assert.equal(mode(path.join(lock, 'owner')), FILE_MODE); assert.deepEqual(pendings(path.dirname(lock)), []);
    handle.release();
  } finally { cleanup(lock); }
  for (const kind of ['zero', 'negative'] as const) {
    const l = freshLock(`p3-${kind}`); const parent = path.dirname(l);
    try {
      __setArtifactTestFaults({ write(role: string, real: () => number) { return role === 'lock-owner-write' ? (kind === 'zero' ? 0 : -1) : real(); } });
      await assert.rejects(acquirePrivateLock(l, { acquireTimeoutMs: 5, leaseMs: 10, pidBirthProvider: provider() }), /short private artifact write/);
      assert.equal(fs.existsSync(l), false); assert.deepEqual(pendings(parent), []);
    } finally { cleanup(l); }
  }
});

// =================================================================================================
// L-P4 — deterministic lock-token/stage collision is unowned
// =================================================================================================
test('L-P4 a fixed lock-token/stage collision fails EEXIST and never removes the unowned stage', async () => {
  await ready;
  const lock = freshLock('p4'); const parent = path.dirname(lock); const name = path.basename(lock);
  const token = 'abcdef01'.repeat(6);                                   // 48 hex chars
  const collision = path.join(parent, `.${name}.${process.pid}.${token}.pending`);
  const outside = path.join(parent, 'outside'); fs.writeFileSync(outside, 'outside', { mode: 0o644 });
  try {
    fs.mkdirSync(collision, { mode: DIR_MODE }); fs.writeFileSync(path.join(collision, 'protected'), 'do-not-touch', { mode: 0o600 });
    const collisionBefore = { dir: id(collision), listing: listing(collision), file: regular(path.join(collision, 'protected')) };
    const parentBefore = listing(parent); const outsideBefore = regular(outside);
    __setArtifactTestTokens({ lock: () => token });
    await assert.rejects(acquirePrivateLock(lock, { acquireTimeoutMs: 0, leaseMs: 1, pidBirthProvider: provider() }), /EEXIST/);
    assert.deepEqual({ dir: id(collision), listing: listing(collision), file: regular(path.join(collision, 'protected')) }, collisionBefore);
    assert.deepEqual(listing(parent), parentBefore);
    assert.deepEqual(regular(outside), outsideBefore);
    assert.equal(fs.existsSync(lock), false);
  } finally { cleanup(lock); }
});

// =================================================================================================
// L-P5 — stage pin and substitution cleanup are generation-safe
// =================================================================================================
test('L-P5 stage pin rejects pre-chdir substitution, cross-parent moves, and generation-safe cleanup', async () => {
  await ready;
  // (a) pre-chdir stage substitution → abort before chmod/owner creation.
  for (const kind of ['dir', 'link'] as const) {
    const lock = freshLock(`p5a-${kind}`); const parent = path.dirname(lock); const ext = outsideDir();
    try {
      __setArtifactTestHooks({ beforeStageChdir(detail) { fs.renameSync(detail.path, `${detail.path}.orig`); if (kind === 'link') fs.symlinkSync(ext, detail.path); else fs.mkdirSync(detail.path, { mode: DIR_MODE }); } });
      const outsideBefore = { listing: listing(ext), secret: regular(path.join(ext, 'secret')) };
      await assert.rejects(acquirePrivateLock(lock, { acquireTimeoutMs: 500, leaseMs: 1, pidBirthProvider: provider() }), /changed while pinning/);
      // Substitute never received an owner file, and outside content is untouched.
      const sub = pendings(parent).map(n => path.join(parent, n)).find(p => { try { return !p.endsWith('.orig'); } catch { return false; } });
      if (sub && fs.lstatSync(sub).isDirectory()) assert.equal(fs.existsSync(path.join(sub, 'owner')), false);
      assert.deepEqual({ listing: listing(ext), secret: regular(path.join(ext, 'secret')) }, outsideBefore);
    } finally { fs.rmSync(ext, { recursive: true, force: true }); cleanup(lock); }
  }
  // (b) post-chdir cross-parent move → parent-identity failure before mutation.
  {
    const lock = freshLock('p5b'); const parent = path.dirname(lock); const otherParent = path.join(parent, 'other'); fs.mkdirSync(otherParent, { mode: DIR_MODE });
    try {
      __setArtifactTestHooks({ afterStageChdirBeforeIdentityCheck(detail) { const base = path.basename(detail.path); fs.renameSync(detail.path, path.join(otherParent, base)); } });
      await assert.rejects(acquirePrivateLock(lock, { acquireTimeoutMs: 500, leaseMs: 1, pidBirthProvider: provider() }), /changed while pinning/);
      // The moved stage never became canonical and never received an owner via the substitute path.
      assert.equal(fs.existsSync(lock), false);
    } finally { cleanup(lock); }
  }
  // (c) publish failure + beforeStageCleanup substitution → cleanup does not touch substitute/target/symlink.
  {
    const lock = freshLock('p5c'); const parent = path.dirname(lock); const ext = outsideDir(); let substituted = false; let heldStage = '';
    try {
      __setArtifactTestHooks({ beforeStageCleanup(detail) { if (!substituted) { substituted = true; heldStage = `${detail.path}.held`; fs.renameSync(detail.path, heldStage); fs.mkdirSync(detail.path, { mode: DIR_MODE }); fs.writeFileSync(path.join(detail.path, 'owner'), 'substitute', { mode: FILE_MODE }); fs.symlinkSync(ext, `${detail.path}.link`); } } });
      __setArtifactTestFaults({ before(role: string) { if (role === 'lock-publish-rename') throw new Error('publish fault'); } });
      await assert.rejects(acquirePrivateLock(lock, { acquireTimeoutMs: 500, leaseMs: 1, pidBirthProvider: provider() }), /publish fault/);
      assert.ok(substituted);
      const substitute = pendings(parent).map(n => path.join(parent, n)).find(p => !p.endsWith('.held'))!;
      assert.equal(fs.readFileSync(path.join(substitute, 'owner'), 'utf8'), 'substitute');
      assert.equal(mode(substitute), DIR_MODE); assert.equal(mode(path.join(substitute, 'owner')), FILE_MODE);
      assert.equal(fs.readlinkSync(`${substitute}.link`), ext);
      // Held owned generation (renamed) remains complete/private; outside untouched.
      assert.equal(mode(heldStage), DIR_MODE); assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(heldStage, 'owner'), 'utf8')));
      assert.deepEqual(listing(ext), ['secret']); assert.deepEqual(regular(path.join(ext, 'secret')).bytes, Buffer.from('secret'));
    } finally { fs.rmSync(ext, { recursive: true, force: true }); cleanup(lock); }
  }
});

// =================================================================================================
// L-P6 — lock-owner descriptor remains inode-bound
// =================================================================================================
test('L-P6 lock-owner descriptor validation and faults stay bound to the opened inode', async () => {
  await ready;
  // The descriptor is bound to the opened owner inode; renaming the visible name post-open must not redirect it,
  // and because the stage no longer holds the exact owner layout, publication fails safely.
  {
    const lock = freshLock('p6-rename'); const parent = path.dirname(lock);
    try {
      __setArtifactTestHooks({ afterFinalOpen(detail) { if (detail.operation === 'lock' && detail.component === 'owner') { const dir = path.dirname(detail.path); fs.renameSync(detail.path, path.join(dir, 'owner.trusted')); fs.symlinkSync('/etc/hosts', detail.path); } } });
      await assert.rejects(acquirePrivateLock(lock, { acquireTimeoutMs: 1, leaseMs: 1, pidBirthProvider: provider() }), /./);
      assert.equal(fs.existsSync(lock), false);
    } finally { cleanup(lock); }
  }
  // fstat / fchmod faults on the lock owner descriptor: close-proof, owned-stage cleanup, no canonical.
  for (const role of ['artifact-fstat', 'artifact-fchmod'] as const) {
    const lock = freshLock(`p6-${role}`); const parent = path.dirname(lock); const outside = path.join(parent, 'outside'); fs.writeFileSync(outside, 'outside', { mode: 0o644 });
    let closes = 0;
    try {
      const before = outsideSnapshot(parent, outside);
      __setArtifactTestFaults({ before(r: string) { if (r === role) throw new Error(`fault ${role}`); }, after(r: string) { if (r === 'lock-owner-close') closes++; } });
      await assert.rejects(acquirePrivateLock(lock, { acquireTimeoutMs: 1, leaseMs: 1, pidBirthProvider: provider() }), new RegExp(role));
      assert.equal(fs.existsSync(lock), false); assert.deepEqual(pendings(parent), []);
      assert.deepEqual(outsideSnapshot(parent, outside), before);
    } finally { cleanup(lock); }
  }
});

// =================================================================================================
// L-C1 — two fresh publishers have exactly one winner (cross-process)
// =================================================================================================
test('L-C1 two fresh cross-process publishers yield exactly one winner and no pending residue', async () => {
  await ready;
  const coord = coordinator(); const lock = freshLock('c1'); const parent = path.dirname(lock);
  const gate = path.join(coord, 'gate'); const hold = path.join(coord, 'hold');
  const mA = path.join(coord, 'mA'); const mB = path.join(coord, 'mB'); const rA = path.join(coord, 'rA.json'); const rB = path.join(coord, 'rB.json');
  const cfg = (marker: string, result: string) => ({ lock, acquireTimeoutMs: 4_000, leaseMs: 60_000, provider: { self: birth }, pause: { phase: 'beforePublishAttempt', marker, gate }, result, hold: { gate: hold, release: true } });
  const childA = spawnLockChild(cfg(mA, rA)); const childB = spawnLockChild(cfg(mB, rB));
  try {
    await waitFor(mA, { proc: childA, label: 'c1 childA' }); await waitFor(mB, { proc: childB, label: 'c1 childB' });
    openGate(gate);                                              // release both barriers together
    await waitFor(rA, { proc: childA, label: 'c1 childA' }); await waitFor(rB, { proc: childB, label: 'c1 childB' });
    const a = readResult(rA); const b = readResult(rB);
    const acquired = [a, b].filter(r => r.status === 'acquired'); const timedOut = [a, b].filter(r => r.status === 'error');
    assert.equal(acquired.length, 1); assert.equal(timedOut.length, 1);
    assert.match(timedOut[0].message, /timed out/);
    const winner = acquired[0];
    const pub = lockSnapshot(lock);
    assert.equal(pub.directory.mode, DIR_MODE); assert.equal(pub.owner.mode, FILE_MODE); assert.deepEqual(pub.listing, ['owner']);
    const canon = parsedOwner(lock);
    assert.equal(canon.pid, winner.pid); assert.equal(canon.token, winner.token); assert.deepEqual(canon.birth, birth); assert.match(canon.leaseDeadlineNs, /^[1-9][0-9]*$/);
    assert.deepEqual(pendings(parent), []);
    const loserProcess = a.status === 'error' ? childA : childB;
    const winnerProcess = a.status === 'acquired' ? childA : childB;
    assert.equal(await exitCode(loserProcess, 'c1 loser'), 0); // bounded loser settles before winner release
    openGate(hold);                                             // successor was held through the full snapshot
    assert.equal(await exitCode(winnerProcess, 'c1 winner'), 0);
    assert.equal(fs.existsSync(lock), false);
  } finally { childA.kill('SIGKILL'); childB.kill('SIGKILL'); fs.rmSync(coord, { recursive: true, force: true }); cleanup(lock); }
});

// =================================================================================================
// L-T1 — positive and zero timeout ordering is exact
// =================================================================================================
test('L-T1 positive/zero timeout ordering, deadline crossings, and rollback are exact', async () => {
  await ready;
  // Expired live owner under positive timeout: time-zero attempt, attempts strictly before deadline, exact sleeps.
  {
    const lock = freshLock('t1-live'); let now = 0n; const sleeps: number[] = []; let attempts = 0;
    try {
      writeOwner(lock, owner({ leaseDeadlineNs: '0' })); const before = lockSnapshot(lock);
      __setArtifactTestHooks({ beforePublishAttempt() { attempts++; } });
      await assert.rejects(acquirePrivateLock(lock, { acquireTimeoutMs: 3, leaseMs: 1, pidBirthProvider: provider('live'), nowNs: () => now, sleep: async (ms: number) => { sleeps.push(ms); now += 1_000_000n; } }), /timed out/);
      assert.equal(attempts, 3); assert.deepEqual(sleeps, [3, 2, 1]); assert.deepEqual(lockSnapshot(lock), before);
    } finally { cleanup(lock); }
  }
  // Absent canonical, clock crosses deadline before the rename → owned-stage cleanup, no canonical.
  {
    const lock = freshLock('t1-before'); const parent = path.dirname(lock); let now = 0n;
    try {
      __setArtifactTestHooks({ afterOwnerWrite() { now = 10_000_000n; } });
      await assert.rejects(acquirePrivateLock(lock, { acquireTimeoutMs: 5, leaseMs: 5, pidBirthProvider: provider(), nowNs: () => now, sleep: async () => { } }), /timed out/);
      assert.equal(fs.existsSync(lock), false); assert.deepEqual(pendings(parent), []);
    } finally { cleanup(lock); }
  }
  // Absent canonical, clock crosses deadline in the rename seam → exact-generation rollback of the just-published canonical.
  {
    const lock = freshLock('t1-rename'); const parent = path.dirname(lock); let now = 0n;
    try {
      __setArtifactTestFaults({ before(role: string) { if (role === 'lock-publish-rename') now = 10_000_000n; } });
      await assert.rejects(acquirePrivateLock(lock, { acquireTimeoutMs: 5, leaseMs: 5, pidBirthProvider: provider(), nowNs: () => now, sleep: async () => { } }), /timed out/);
      assert.equal(fs.existsSync(lock), false); assert.deepEqual(pendings(parent), []);
    } finally { cleanup(lock); }
  }
  // Production clock path uses the same timeout checks even without a nowNs seam.
  {
    const lock = freshLock('t1-production'); const parent = path.dirname(lock); let now = 0n;
    try {
      await assert.rejects(
        withHrtimeClockAsync(
          () => now,
          () => {
            __setArtifactTestFaults({ before(role: string) { if (role === 'lock-publish-rename') now = 10_000_000n; } });
            return acquirePrivateLock(lock, { acquireTimeoutMs: 5, leaseMs: 5, pidBirthProvider: provider() });
          },
        ),
        /timed out/,
      );
      assert.equal(fs.existsSync(lock), false);
      assert.deepEqual(pendings(parent), []);
    } finally { cleanup(lock); }
  }
  // Zero timeout: exactly one immediate attempt, no sleep, acquires a free lock.
  {
    const lock = freshLock('t1-zero-free'); let attempts = 0; let slept = false;
    try {
      __setArtifactTestHooks({ beforePublishAttempt() { attempts++; } });
      const handle = await acquirePrivateLock(lock, { acquireTimeoutMs: 0, leaseMs: 10, pidBirthProvider: provider(), sleep: async () => { slept = true; } });
      assert.equal(attempts, 1); assert.equal(slept, false);
      handle.release();
    } finally { cleanup(lock); }
  }
  // Zero timeout: contended → exactly one immediate attempt, times out, owner unchanged.
  {
    const lock = freshLock('t1-zero-busy'); let attempts = 0; let slept = false;
    try {
      writeOwner(lock, owner({ leaseDeadlineNs: '99999999999999' })); const before = lockSnapshot(lock);
      __setArtifactTestHooks({ beforePublishAttempt() { attempts++; } });
      await assert.rejects(acquirePrivateLock(lock, { acquireTimeoutMs: 0, leaseMs: 10, pidBirthProvider: provider('live'), sleep: async () => { slept = true; } }), /timed out/);
      assert.equal(attempts, 1); assert.equal(slept, false); assert.deepEqual(lockSnapshot(lock), before);
    } finally { cleanup(lock); }
  }
});

// =================================================================================================
// L-T2 — timing input validation precedes mutation
// =================================================================================================
test('L-T2 timing input validation rejects before any provider or filesystem mutation', async () => {
  await ready;
  const cases: Array<{ acquireTimeoutMs: number; leaseMs: number }> = [
    { acquireTimeoutMs: -1, leaseMs: 1 }, { acquireTimeoutMs: NaN, leaseMs: 1 }, { acquireTimeoutMs: Infinity, leaseMs: 1 },
    { acquireTimeoutMs: 1, leaseMs: 0 }, { acquireTimeoutMs: 1, leaseMs: -1 }, { acquireTimeoutMs: 1, leaseMs: NaN }, { acquireTimeoutMs: 1, leaseMs: Infinity },
    { acquireTimeoutMs: 86_400_001, leaseMs: 1 }, { acquireTimeoutMs: 1, leaseMs: 86_400_001 },
  ];
  for (const c of cases) {
    const lock = freshLock('t2'); const parent = path.dirname(lock);
    try {
      const parentBefore = listing(parent);
      let providerTouched = false;
      const p = { read: () => { providerTouched = true; return { status: 'found', identity: birth }; } } as PidBirthProvider;
      await assert.rejects(acquirePrivateLock(lock, { ...c, pidBirthProvider: p }), /invalid private lock timing/);
      assert.equal(providerTouched, false);
      assert.equal(fs.existsSync(lock), false); assert.deepEqual(listing(parent), parentBefore); assert.deepEqual(pendings(parent), []);
    } finally { cleanup(lock); }
  }
});

// =================================================================================================
// L-V1 — Linux parser and provider I/O classification
// =================================================================================================
test('L-V1 Linux parser fixtures are exhaustive and provider I/O is classified (linux only)', async () => {
  await ready;
  const uuid = '00000000-0000-0000-0000-000000000000';
  // comm containing spaces and multiple ')' — field 22 is extracted after the *last* ') '.
  const good = `123 (weird ) name)) R 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 4242`;
  const r = parseLinuxProcStat(good, 123, uuid); assert.equal(r.status, 'found'); assert.equal(r.identity.startTicks, '4242'); assert.equal(r.identity.bootId, uuid);
  assert.equal(parseLinuxProcStat(good, 999, uuid).status, 'unknown');                   // pid mismatch
  assert.equal(parseLinuxProcStat(good, 123, 'not-a-uuid').status, 'unknown');            // strict boot UUID
  assert.equal(parseLinuxProcStat(`123 (x) R 1 2`, 123, uuid).status, 'unknown');          // truncated fields
  assert.equal(parseLinuxProcStat(`123 (x) R ${'a '.repeat(19)}0`, 123, uuid).status, 'unknown'); // malformed start field ('0')
  // Provider I/O classification is only exercised on Linux, where the seam is used.
  if (process.platform === 'linux') {
    const enoent = (code: string) => { const e: any = new Error(code); e.code = code; throw e; };
    const scenarios: Array<{ label: string; read: (f: string) => string; expect: string }> = [
      { label: 'stat ENOENT → absent', read: f => f.endsWith('/stat') ? enoent('ENOENT') : uuid, expect: 'absent' },
      { label: 'stat EACCES → unknown', read: f => f.endsWith('/stat') ? enoent('EACCES') : uuid, expect: 'unknown' },
      { label: 'stat EIO → unknown', read: f => f.endsWith('/stat') ? enoent('EIO') : uuid, expect: 'unknown' },
      { label: 'boot read throws → unknown', read: f => f.endsWith('boot_id') ? enoent('EIO') : good, expect: 'unknown' },
      { label: 'malformed boot → unknown', read: f => f.endsWith('boot_id') ? 'garbage' : good, expect: 'unknown' },
    ];
    for (const s of scenarios) {
      const requested: string[] = [];
      __setArtifactTestLinuxProviderRead((f: string) => { requested.push(f); return s.read(f); });
      const res = processPidBirthProvider.read(123);
      assert.equal(res.status, s.expect, s.label);
      assert.ok(requested.includes('/proc/sys/kernel/random/boot_id'));
      if (s.expect !== 'unknown' || !s.label.startsWith('boot')) assert.ok(requested.some(p => p === '/proc/123/stat'), s.label);
    }
    __setArtifactTestLinuxProviderRead();
  }
});

// =================================================================================================
// L-V2 — Darwin parser validates the whole snapshot
// =================================================================================================
test('L-V2 Darwin parser validates the entire kern.proc snapshot on any platform', async () => {
  await ready;
  const nowS = Math.floor(Date.now() / 1000); const selfPid = 4242; const selfStart = nowS - 10;
  const rec = (entries: Array<{ pid: number; sec: number; usec?: number }>) => { const buf = Buffer.alloc(648 * entries.length); entries.forEach((e, i) => { const o = i * 648; buf.writeInt32LE(e.pid, o + 40); buf.writeBigInt64LE(BigInt(e.sec), o); buf.writeBigInt64LE(BigInt(e.usec ?? 0), o + 8); }); return buf; };
  const ctx = { arch: 'arm64', selfPid, selfStartSeconds: selfStart, nowSeconds: nowS };
  const base = [{ pid: 1, sec: nowS - 5 }, { pid: selfPid, sec: selfStart }];
  const target = { pid: 900, sec: nowS - 3, usec: 2 };
  assert.equal(parseDarwinKernProc(rec([...base, target]), 900, ctx).status, 'found');
  assert.deepEqual(parseDarwinKernProc(rec([...base, target]), 900, ctx).identity, { provider: 'darwin-kern-proc-v1', startSec: String(nowS - 3), startUsec: 2 });
  assert.equal(parseDarwinKernProc(rec(base), 900, ctx).status, 'absent');
  const unknowns: Array<{ label: string; buf: Buffer; pid: number; ctx: any }> = [
    { label: 'duplicate pid', buf: rec([...base, target, { pid: 900, sec: nowS - 2 }]), pid: 900, ctx },
    { label: 'missing pid 1', buf: rec([{ pid: selfPid, sec: selfStart }, target]), pid: 900, ctx },
    { label: 'missing self', buf: rec([{ pid: 1, sec: nowS - 5 }, target]), pid: 900, ctx },
    { label: 'bad target timeval', buf: rec([...base, { pid: 900, sec: 0 }]), pid: 900, ctx },
    { label: 'bad unrelated timeval', buf: rec([...base, target, { pid: 901, sec: -1 }]), pid: 900, ctx },
    { label: 'bad self timeval', buf: rec([{ pid: 1, sec: nowS - 5 }, { pid: selfPid, sec: 0 }, target]), pid: 900, ctx },
    { label: 'implausible self start', buf: rec([{ pid: 1, sec: nowS - 5 }, { pid: selfPid, sec: nowS - 100000 }, target]), pid: 900, ctx },
    { label: 'bad length', buf: Buffer.alloc(100), pid: 900, ctx },
    { label: 'unsupported arch', buf: rec([...base, target]), pid: 900, ctx: { ...ctx, arch: 'mips' } },
  ];
  for (const u of unknowns) assert.equal(parseDarwinKernProc(u.buf, u.pid, u.ctx).status, 'unknown', u.label);
});

// =================================================================================================
// L-V3 — Darwin provider command is bounded and exact (darwin only)
// =================================================================================================
test('L-V3 Darwin provider invokes a bounded, exact sysctl command (darwin only)', async () => {
  await ready;
  if (process.platform !== 'darwin') return;
  const nowS = Math.floor(Date.now() / 1000); const selfStart = Math.floor(Date.now() / 1000 - process.uptime());
  const rec = (entries: Array<{ pid: number; sec: number; usec?: number }>) => { const buf = Buffer.alloc(648 * entries.length); entries.forEach((e, i) => { const o = i * 648; buf.writeInt32LE(e.pid, o + 40); buf.writeBigInt64LE(BigInt(e.sec), o); buf.writeBigInt64LE(BigInt(e.usec ?? 0), o + 8); }); return buf; };
  const base = [{ pid: 1, sec: nowS - 5 }, { pid: process.pid, sec: selfStart }];
  const calls: any[] = [];
  const install = (buf: Buffer) => __setArtifactTestExecFileSync((file: string, args: string[], opts: any) => { calls.push({ file, args, opts }); return buf; });
  try {
    install(rec([...base, { pid: 900, sec: nowS - 3, usec: 2 }]));
    assert.equal(processPidBirthProvider.read(900).status, 'found');
    install(rec(base));
    assert.equal(processPidBirthProvider.read(900).status, 'absent');
    assert.ok(calls.length >= 2);
    for (const c of calls) {
      assert.equal(c.file, '/usr/sbin/sysctl'); assert.deepEqual(c.args, ['-b', 'kern.proc']); assert.equal(c.opts.encoding, null);
      assert.ok(Number.isFinite(c.opts.timeout) && c.opts.timeout > 0); assert.ok(Number.isFinite(c.opts.maxBuffer) && c.opts.maxBuffer > 0);
    }
  } finally { __setArtifactTestExecFileSync(); }
});

// =================================================================================================
// L-V4 — real provider observes identity and death (cross-process)
// =================================================================================================
test('L-V4 real provider observes a live child identity and its death', async () => {
  await ready;
  const coord = coordinator(); const result = path.join(coord, 'self.json');
  const script = `import * as fs from 'node:fs'; const a=await import(${JSON.stringify(moduleUrl)}); const data=JSON.stringify(a.processPidBirthProvider.read(process.pid)); const tmp=process.env.RESULT+'.'+process.pid+'.tmp'; fs.writeFileSync(tmp, data); fs.renameSync(tmp, process.env.RESULT); ${ORPHAN_GUARD} const cell=new Int32Array(new SharedArrayBuffer(4)); for(;;){ if (__orphaned()) process.exit(1); Atomics.wait(cell,0,0,1000); }`;
  const childProc = trackChild(childProcess.spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { env: { ...process.env, CAPTURE_ROOT, RESULT: result }, stdio: 'ignore' }));
  try {
    await waitFor(result, { proc: childProc, label: 'v4 self-report child' });
    const childSelf = readResult(result); assert.equal(childSelf.status, 'found');
    const observed = processPidBirthProvider.read(childProc.pid!); assert.equal(observed.status, 'found');
    assert.deepEqual(observed.identity, childSelf.identity);
    const selfA = processPidBirthProvider.read(process.pid); const selfB = processPidBirthProvider.read(process.pid);
    assert.equal(selfA.status, 'found'); assert.deepEqual(selfA.identity, selfB.identity);
    childProc.kill('SIGKILL'); await exitCode(childProc, 'v4 child');
    assert.equal(processPidBirthProvider.read(childProc.pid!).status, 'absent');
  } finally { if (!childProc.killed) { childProc.kill('SIGKILL'); await exitCode(childProc, 'v4 cleanup').catch(() => { }); } fs.rmSync(coord, { recursive: true, force: true }); }
});

// =================================================================================================
// L-R1 — real killed holder recovers only after death and expiry (cross-process)
// =================================================================================================
test('L-R1 a real killed holder is recovered only after death and lease expiry', async () => {
  await ready;
  const coord = coordinator(); const lock = freshLock('r1'); const result = path.join(coord, 'r.json'); const never = path.join(coord, 'never');
  const holder = spawnLockChild({ lock, acquireTimeoutMs: 60_000, leaseMs: 300, provider: 'production', result, hold: { gate: never, release: false } });
  try {
    await waitFor(result, { proc: holder, label: 'r1 holder' });
    const pred = readResult(result); assert.equal(pred.status, 'acquired');
    holder.kill('SIGKILL'); await exitCode(holder, 'r1 holder');
    const successor = await acquirePrivateLock(lock, { acquireTimeoutMs: 5_000, leaseMs: 1_000, pidBirthProvider: processPidBirthProvider });
    const snap = lockSnapshot(lock);
    assert.notDeepEqual({ dev: snap.directory.dev, ino: snap.directory.ino }, pred.generation);
    const succOwner = parsedOwner(lock);
    assert.notDeepEqual(succOwner, pred.owner); assert.equal(succOwner.pid, process.pid);
    assert.equal(snap.directory.mode, DIR_MODE); assert.equal(snap.owner.mode, FILE_MODE); assert.deepEqual(snap.listing, ['owner']);
    successor.release();
  } finally { holder.kill('SIGKILL'); fs.rmSync(coord, { recursive: true, force: true }); cleanup(lock); }
});

// =================================================================================================
// L-R2 — two stale takers are successor-safe (cross-process)
// =================================================================================================
test('L-R2 two cross-process stale takers produce a single safe successor', async () => {
  await ready;
  const coord = coordinator(); const lock = freshLock('r2'); const ownerPid = 987654;
  const gate1 = path.join(coord, 'g1'); const gate2 = path.join(coord, 'g2'); const hold = path.join(coord, 'hold');
  const m1 = path.join(coord, 'm1'); const m2 = path.join(coord, 'm2'); const r1 = path.join(coord, 'r1.json'); const r2 = path.join(coord, 'r2.json');
  const cfg = (marker: string, gate: string, result: string, holdGate?: string) => ({ lock, acquireTimeoutMs: 4_000, leaseMs: 60_000, provider: { self: birth, ownerPid, ownerStatus: 'absent' }, pause: { phase: 'afterCanonicalOwnerValidation', marker, gate }, result, ...(holdGate ? { hold: { gate: holdGate, release: true } } : {}) });
  let taker1: childProcess.ChildProcess | undefined; let taker2: childProcess.ChildProcess | undefined;
  try {
    writeOwner(lock, owner({ pid: ownerPid, leaseDeadlineNs: '0' }));   // expired, decisively dead per fixture
    taker1 = spawnLockChild(cfg(m1, gate1, r1, hold));
    taker2 = spawnLockChild(cfg(m2, gate2, r2));
    await waitFor(m1, { proc: taker1, label: 'r2 taker1' }); await waitFor(m2, { proc: taker2, label: 'r2 taker2' }); // both validated exact A, paused
    openGate(gate1);                                                    // taker1 removes A, publishes B, holds
    await waitFor(r1, { proc: taker1, label: 'r2 taker1' });
    const t1 = readResult(r1); assert.equal(t1.status, 'acquired');
    const snapB = lockSnapshot(lock);
    assert.equal(snapB.directory.mode, DIR_MODE); assert.equal(snapB.owner.mode, FILE_MODE); assert.deepEqual(snapB.listing, ['owner']);
    assert.equal(parsedOwner(lock).pid, t1.pid);
    openGate(gate2);                                                    // taker2 resumes; A is gone, B is live → times out
    assert.equal(await exitCode(taker2, 'r2 taker2'), 0);
    const t2 = readResult(r2); assert.equal(t2.status, 'error'); assert.match(t2.message, /timed out/);
    assert.deepEqual(lockSnapshot(lock), snapB);                        // B unchanged by taker2
    assert.deepEqual(pendings(path.dirname(lock)), []);
    openGate(hold);
    assert.equal(await exitCode(taker1, 'r2 taker1'), 0);
  } finally { taker1?.kill('SIGKILL'); taker2?.kill('SIGKILL'); fs.rmSync(coord, { recursive: true, force: true }); cleanup(lock); }
});

// =================================================================================================
// L-R3 — release retries owner-unlink and rmdir phases
// =================================================================================================
test('L-R3 release retries the post-owner-unlink and canonical-rmdir phases idempotently', async () => {
  await ready;
  // Failure after owner unlink (via afterOwnerRemoved), then retry completes, then idempotent.
  {
    const lock = freshLock('r3-owner'); let fail = true;
    try {
      const handle = await acquirePrivateLock(lock, { acquireTimeoutMs: 1_000, leaseMs: 10, pidBirthProvider: provider(), afterOwnerRemoved: () => { if (fail) { fail = false; throw new Error('after owner unlink fault'); } } });
      assert.throws(() => handle.release(), /after owner unlink fault/);
      assert.deepEqual(listing(lock), []);                            // owner already removed
      handle.release();                                               // completes the same empty generation
      assert.equal(fs.existsSync(lock), false);
      handle.release();                                               // idempotent
      assert.equal(fs.existsSync(lock), false);
    } finally { cleanup(lock); }
  }
  // Failure at canonical rmdir, then retry completes, then idempotent.
  {
    const lock = freshLock('r3-rmdir'); let once = true;
    try {
      const handle = await acquirePrivateLock(lock, { acquireTimeoutMs: 1_000, leaseMs: 10, pidBirthProvider: provider() });
      __setArtifactTestFaults({ before(role: string) { if (role === 'lock-canonical-rmdir' && once) { once = false; throw new Error('rmdir fault'); } } });
      assert.throws(() => handle.release(), /rmdir fault/);
      assert.deepEqual(listing(lock), []);
      __setArtifactTestFaults();
      handle.release(); assert.equal(fs.existsSync(lock), false);
      handle.release(); assert.equal(fs.existsSync(lock), false);
    } finally { cleanup(lock); }
  }
});

// =================================================================================================
// L-R4 — partial-release successor is protected
// =================================================================================================
test('L-R4 a partial release never removes a successor generation', async () => {
  await ready;
  const lock = freshLock('r4'); let now = 0n;
  try {
    let fail = true;
    const first = await acquirePrivateLock(lock, { acquireTimeoutMs: 1_000, leaseMs: 10, pidBirthProvider: provider(), nowNs: () => now, afterOwnerRemoved: () => { if (fail) { fail = false; throw new Error('release fault'); } } });
    assert.throws(() => first.release(), /release fault/);            // leaves A empty (owner removed, not rmdir'd)
    assert.deepEqual(listing(lock), []);
    now = 2_000_000n;
    // B reaps the empty canonical name and publishes a new generation.
    const second = await acquirePrivateLock(lock, { acquireTimeoutMs: 1_000, leaseMs: 10, pidBirthProvider: provider('live', altBirth), nowNs: () => now, sleep: async () => { now += 1_000_000n; } });
    const snapB = lockSnapshot(lock);
    first.release();                                                  // retry old handle: must not touch B
    assert.deepEqual(lockSnapshot(lock), snapB);
    second.release();
  } finally { cleanup(lock); }
});

// =================================================================================================
// L-R5 — exact old-releaser ABA is cross-process and overlapping
// =================================================================================================
test('L-R5 a cross-process ABA old releaser cannot remove an overlapping successor', async () => {
  await ready;
  const coord = coordinator(); const lock = freshLock('r5');
  const aMarker = path.join(coord, 'aMarker'); const aGate = path.join(coord, 'aGate'); const aResult = path.join(coord, 'a.json');
  const childA = spawnLockChild({ lock, acquireTimeoutMs: 60_000, leaseMs: 60_000, provider: 'production', result: aResult, afterOwnerRemovedPause: { marker: aMarker, gate: aGate }, releaseAfterAcquire: true });
  let handleB: any;
  try {
    await waitFor(aResult, { proc: childA, label: 'r5 childA' });                                           // A acquired
    const pred = readResult(aResult); assert.equal(pred.status, 'acquired');
    await waitFor(aMarker, { proc: childA, label: 'r5 childA' });                                           // A is paused mid-release, owner removed, cwd inside A
    handleB = await acquirePrivateLock(lock, { acquireTimeoutMs: 5_000, leaseMs: 60_000, pidBirthProvider: processPidBirthProvider });
    const snapB = lockSnapshot(lock);
    assert.notDeepEqual({ dev: snapB.directory.dev, ino: snapB.directory.ino }, pred.generation);
    openGate(aGate);                                                  // A resumes: delayed rmdir must not alter B
    assert.equal(await exitCode(childA, 'r5 childA'), 0);
    assert.deepEqual(lockSnapshot(lock), snapB);                      // B intact
    handleB.release();
  } finally { childA.kill('SIGKILL'); fs.rmSync(coord, { recursive: true, force: true }); cleanup(lock); }
});

// =================================================================================================
// L-R6 — empty debris recovers; malformed nonempty stays closed
// =================================================================================================
test('L-R6 empty canonical debris recovers while malformed nonempty publication stays closed', async () => {
  await ready;
  // Empty debris (a bare canonical directory with no owner) is recovered and the lock is acquired.
  {
    const lock = freshLock('r6-empty');
    try {
      fs.mkdirSync(lock, { mode: DIR_MODE });
      const handle = await acquirePrivateLock(lock, { acquireTimeoutMs: 200, leaseMs: 10, pidBirthProvider: provider() });
      assert.deepEqual(lockSnapshot(lock).listing, ['owner']); assert.equal(lockSnapshot(lock).directory.mode, DIR_MODE);
      handle.release(); assert.equal(fs.existsSync(lock), false);
    } finally { cleanup(lock); }
  }
  // A malformed nonempty publication stays closed and exactly preserved.
  {
    const lock = freshLock('r6-malformed');
    try {
      fs.mkdirSync(lock, { mode: DIR_MODE }); fs.writeFileSync(path.join(lock, 'owner'), 'not json', { mode: FILE_MODE });
      const before = lockSnapshot(lock);
      await assert.rejects(acquirePrivateLock(lock, { acquireTimeoutMs: 50, leaseMs: 10, pidBirthProvider: provider() }), /malformed/);
      assert.deepEqual(lockSnapshot(lock), before);
    } finally { cleanup(lock); }
  }
});

// =================================================================================================
// L-H1 — lock publication inherits root/component/parent containment
// =================================================================================================
test('L-H1 lock publication aborts on pre-pin swaps and acts only on the pinned generation', async () => {
  await ready;
  // Pre-pin component swap at afterComponentLstat → publication aborts before pinning.
  for (const kind of ['dir', 'link'] as const) {
    const lock = nestedLock(`h1a-${kind}`, 'a', 'b'); const ext = outsideDir();
    try {
      const outsideBefore = { listing: listing(ext), secret: regular(path.join(ext, 'secret')) };
      __setArtifactTestHooks({ afterComponentLstat(detail) { if (detail.operation === 'lock' && detail.component === 'b') { fs.renameSync(detail.component, `${detail.component}.orig`); if (kind === 'link') fs.symlinkSync(ext, detail.component); else fs.mkdirSync(detail.component, { mode: DIR_MODE }); } } });
      await assert.rejects(acquirePrivateLock(lock, { acquireTimeoutMs: 1, leaseMs: 1, pidBirthProvider: provider() }), kind === 'link' ? /symlinked artifact directory component|changed while pinning/ : /changed while pinning/);
      assert.equal(fs.existsSync(lock), false);
      assert.deepEqual({ listing: listing(ext), secret: regular(path.join(ext, 'secret')) }, outsideBefore);
    } finally { fs.rmSync(ext, { recursive: true, force: true }); cleanup(lock); }
  }
  // Post-pin parent replacement at afterParentPinned → publication lands only in the pinned generation.
  {
    const lock = nestedLock('h1b', 'a', 'b'); const parentDir = path.dirname(lock); let swapped = false;
    try {
      __setArtifactTestHooks({ afterParentPinned(detail) { if (detail.operation === 'lock' && !swapped) { swapped = true; fs.renameSync(parentDir, `${parentDir}.trusted`); fs.mkdirSync(parentDir, { mode: DIR_MODE }); } } });
      const handle = await acquirePrivateLock(lock, { acquireTimeoutMs: 1_000, leaseMs: 60_000, pidBirthProvider: provider() });
      // The lock published into the trusted (moved) generation; the planted replacement stays empty.
      const trustedLock = path.join(`${parentDir}.trusted`, '.lock');
      assert.equal(fs.existsSync(trustedLock), true); assert.deepEqual(listing(trustedLock), ['owner']);
      assert.deepEqual(listing(parentDir), []);
      // Release against the trusted generation directly.
      fs.rmSync(trustedLock, { recursive: true, force: true });
      void handle;
    } finally { cleanup(lock); }
  }
});

// =================================================================================================
// L-H2 — owner read / stale retirement inherits containment
// =================================================================================================
test('L-H2 stale retirement aborts on pre-pin swaps and stays on the pinned generation', async () => {
  await ready;
  // Pre-pin component swap during retirement of an expired dead owner → abort without outside mutation.
  {
    const lock = nestedLock('h2a', 'a', 'b'); const ext = outsideDir();
    try {
      writeOwner(lock, owner({ leaseDeadlineNs: '0' }));
      const outsideBefore = { listing: listing(ext), secret: regular(path.join(ext, 'secret')) };
      let swapped = false;
      __setArtifactTestHooks({ afterComponentLstat(detail) { if (detail.operation === 'lock' && detail.component === 'b' && !swapped) { swapped = true; fs.renameSync(detail.component, `${detail.component}.orig`); fs.mkdirSync(detail.component, { mode: DIR_MODE }); } } });
      await assert.rejects(acquirePrivateLock(lock, { acquireTimeoutMs: 1_000, leaseMs: 1, pidBirthProvider: { read: (pid: number) => pid === process.pid ? { status: 'found', identity: birth } : { status: 'absent' } } }), /changed while pinning/);
      assert.deepEqual({ listing: listing(ext), secret: regular(path.join(ext, 'secret')) }, outsideBefore);
    } finally { fs.rmSync(ext, { recursive: true, force: true }); cleanup(lock); }
  }
});

// =================================================================================================
// L-H3 — release inherits containment
// =================================================================================================
test('L-H3 release finishes only its acquired generation across a parent replacement', async () => {
  await ready;
  const lock = nestedLock('h3', 'a', 'b'); const parentDir = path.dirname(lock);
  try {
    const handle = await acquirePrivateLock(lock, { acquireTimeoutMs: 1_000, leaseMs: 60_000, pidBirthProvider: provider() });
    const acquired = lockSnapshot(lock);
    let swapped = false;
    __setArtifactTestHooks({ afterParentPinned(detail) { if (detail.operation === 'lock' && !swapped) { swapped = true; fs.renameSync(parentDir, `${parentDir}.trusted`); fs.mkdirSync(parentDir, { mode: DIR_MODE }); fs.mkdirSync(path.join(parentDir, '.lock'), { mode: DIR_MODE }); fs.writeFileSync(path.join(parentDir, '.lock', 'owner'), 'replacement', { mode: FILE_MODE }); } } });
    handle.release();
    // Only the pinned (trusted, moved) generation is removed; the planted replacement is untouched.
    assert.equal(fs.existsSync(path.join(`${parentDir}.trusted`, '.lock')), false);
    assert.equal(fs.readFileSync(path.join(parentDir, '.lock', 'owner'), 'utf8'), 'replacement');
    void acquired;
  } finally { cleanup(lock); }
});

// =================================================================================================
// L-H4 — static and dynamic final traps are safe
// =================================================================================================
test('L-H4 static and dynamic final canonical traps preserve protected state', async () => {
  await ready;
  // Static traps: canonical is a symlink or a non-directory.
  for (const kind of ['link', 'file'] as const) {
    const lock = freshLock(`h4-${kind}`); const parent = path.dirname(lock); const outside = path.join(parent, 'outside'); fs.writeFileSync(outside, 'outside', { mode: 0o644 });
    try {
      if (kind === 'link') fs.symlinkSync(outside, lock); else fs.writeFileSync(lock, 'not directory', { mode: FILE_MODE });
      const before = outsideSnapshot(parent, outside); const trapBefore = kind === 'link' ? link(lock) : regular(lock);
      await assert.rejects(acquirePrivateLock(lock, { acquireTimeoutMs: 0, leaseMs: 1, pidBirthProvider: provider() }), /malformed/);
      assert.deepEqual(outsideSnapshot(parent, outside), before);
      assert.deepEqual(kind === 'link' ? link(lock) : regular(lock), trapBefore);
    } finally { cleanup(lock); }
  }
  // Dynamic trap: at beforeCanonicalRmdir an old releaser encounters an empty successor directory and must not remove it.
  {
    const lock = freshLock('h4-successor');
    try {
      const handle = await acquirePrivateLock(lock, { acquireTimeoutMs: 1_000, leaseMs: 60_000, pidBirthProvider: provider() });
      let swapped = false;
      // Same portability concern as L-S5: rm-then-mkdir at the same path reuses the freed
      // inode on Linux ext4, so the recreated dir would never actually be a different
      // generation. Build the empty successor at a sibling path while `lock` still exists
      // (its inode stays allocated and cannot be reused), then remove `lock` and rename the
      // sibling into place — guaranteeing a distinct inode on every filesystem.
      __setArtifactTestHooks({ beforeCanonicalRmdir(detail) { if (!swapped) { swapped = true; const succ = `${lock}.succ`; fs.mkdirSync(succ, { mode: DIR_MODE }); fs.rmSync(lock, { recursive: true, force: true }); fs.renameSync(succ, lock); } } });
      handle.release();                                               // owner removed, but the empty successor must survive
      assert.equal(fs.existsSync(lock), true); assert.equal(id(lock).type, 'dir');
      assert.deepEqual(listing(lock), []);
    } finally { cleanup(lock); }
  }
});

// =================================================================================================
// Harness regression — an orphaned busyGate child self-exits (Issue 1)
// =================================================================================================
// Simulates "the test runner died before its finally ran" via one level of indirection: an
// intermediary stand-in process plays the role of the runner (this actual node:test process cannot
// safely kill itself), spawns a grandchild that blocks in busyGate exactly as spawnLockChild's
// children do, then is SIGKILLed. The grandchild must notice its parent died and self-exit well
// inside a tight bound — never linger reparented to pid 1 forever.
const BUSY_GATE_PROOF_CHILD = `
import * as fs from 'node:fs';
${ORPHAN_GUARD}
const cell = new Int32Array(new SharedArrayBuffer(4));
fs.writeFileSync(process.env.ALIVE_MARKER, String(process.pid));
while (!fs.existsSync(process.env.GATE)) {
  if (__orphaned()) { fs.writeFileSync(process.env.EXIT_MARKER, 'self-exited'); process.exit(1); }
  Atomics.wait(cell, 0, 0, 20);
}
fs.writeFileSync(process.env.EXIT_MARKER, 'gate-opened');
`;
const FAKE_PARENT = `
import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['--input-type=module', '-e', process.env.GRANDCHILD_SCRIPT], { env: process.env, stdio: 'ignore' });
child.unref();
setInterval(() => {}, 1000); // keep this stand-in "runner" alive until the test SIGKILLs it
`;
test('orphaned busyGate child self-exits once its spawning process dies', async () => {
  const coord = coordinator();
  const aliveMarker = path.join(coord, 'alive'); const exitMarker = path.join(coord, 'exit'); const gate = path.join(coord, 'gate');
  const fakeParent = trackChild(childProcess.spawn(process.execPath, ['--input-type=module', '-e', FAKE_PARENT], {
    env: { ...process.env, GRANDCHILD_SCRIPT: BUSY_GATE_PROOF_CHILD, ALIVE_MARKER: aliveMarker, EXIT_MARKER: exitMarker, GATE: gate },
    stdio: 'ignore',
  }));
  let grandchildPid = -1;
  try {
    await waitFor(aliveMarker, { proc: fakeParent, label: 'fake-parent stand-in' });
    grandchildPid = Number(fs.readFileSync(aliveMarker, 'utf8'));
    assert.ok(Number.isInteger(grandchildPid) && grandchildPid > 0);
    // Kill the stand-in "runner"; the grandchild must reparent and notice within a small bound —
    // never linger to the harness's full 30s child-startup timeout.
    fakeParent.kill('SIGKILL');
    const deadline = Date.now() + 3_000;
    while (!fs.existsSync(exitMarker)) {
      if (Date.now() >= deadline) assert.fail('orphaned busyGate child did not self-exit within 3s');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(fs.readFileSync(exitMarker, 'utf8'), 'self-exited');
    // The process itself is actually gone, not merely past its marker write.
    while (Date.now() < deadline) {
      try { process.kill(grandchildPid, 0); } catch { break; }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.throws(() => process.kill(grandchildPid, 0), /ESRCH/);
  } finally {
    if (grandchildPid > 0) { try { process.kill(grandchildPid, 'SIGKILL'); } catch { /* already gone */ } }
    fs.rmSync(coord, { recursive: true, force: true });
  }
});

// =================================================================================================
// Harness regression — waitFor() fails fast with exit evidence (Issue 2)
// =================================================================================================
test("waitFor fails fast with the dead child's exit evidence instead of the full timeout", async () => {
  const coord = coordinator();
  const marker = path.join(coord, 'never-written.json');
  // A child that exits immediately without ever reaching a marker write — the exact shape of a
  // crash during tsx compile or an exception thrown before publish().
  const crashChild = trackChild(childProcess.spawn(process.execPath, ['--input-type=module', '-e', 'process.exitCode = 7;'], { stdio: 'ignore' }));
  try {
    const start = Date.now();
    await assert.rejects(
      waitFor(marker, { proc: crashChild, label: 'crash-child', timeoutMs: TSX_CHILD_TIMEOUT_MS }),
      /crash-child exited \(code=7 signal=null\) before writing/,
    );
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 5_000, `expected a fast failure, took ${elapsed}ms`);
  } finally { crashChild.kill('SIGKILL'); fs.rmSync(coord, { recursive: true, force: true }); }
});

test.after(() => { if (savedCaptureRoot === undefined) delete process.env.CAPTURE_ROOT; else process.env.CAPTURE_ROOT = savedCaptureRoot; fs.rmSync(suiteRoot, { recursive: true, force: true }); });
