import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Explicit process-start suite root, assigned before the module is imported.
// The raw environment is restored only in the final cleanup. Orchestration
// files (markers, gates, child result files) live in a coordinator directory
// OUTSIDE every tested capture root so they never contaminate exact listings.
// ---------------------------------------------------------------------------
const rawCaptureRoot = process.env.CAPTURE_ROOT;
const suiteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-artifact-proof-'));
const coordinator = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-artifact-coord-'));
process.env.CAPTURE_ROOT = suiteRoot;
const moduleUrl = pathToFileURL(path.resolve('src/session/artifacts.ts')).href;

let CAPTURE_ROOT: string; let DIR_MODE: number; let FILE_MODE: number;
let ensurePrivateDir: (dir: string) => string;
let writePrivateFile: (file: string, data: string | Buffer) => void;
let writeJsonPrivate: (file: string, value: unknown) => void;
let writeNdjsonPrivate: (file: string, records: unknown[]) => void;
let appendNdjsonPrivate: (file: string, record: unknown) => void;
let writeBinaryPrivate: (file: string, data: Buffer) => void;
let removeArtifactTree: (target: string) => void;
let assertUnderCaptureRoot: (target: string) => string;
let createPrivateFile: (file: string, data?: string | Buffer) => void;
let readPrivateFile: (file: string) => Buffer;
let appendPrivateFile: (file: string, data: string | Buffer) => void;
let unlinkPrivateFile: (file: string) => void;
let __setArtifactTestHooks: (hooks?: unknown) => void;
let __setArtifactTestFaults: (faults?: unknown) => void;
let __setArtifactTestTokens: (tokens?: unknown) => void;

before(async () => {
  const artifacts = await import('../src/session/artifacts.js');
  ({ CAPTURE_ROOT, DIR_MODE, FILE_MODE, ensurePrivateDir, writePrivateFile, writeJsonPrivate, writeNdjsonPrivate, appendNdjsonPrivate, writeBinaryPrivate, removeArtifactTree, assertUnderCaptureRoot, createPrivateFile, readPrivateFile, appendPrivateFile, unlinkPrivateFile, __setArtifactTestHooks, __setArtifactTestFaults, __setArtifactTestTokens } = artifacts);
});

after(() => {
  if (rawCaptureRoot === undefined) delete process.env.CAPTURE_ROOT; else process.env.CAPTURE_ROOT = rawCaptureRoot;
  fs.rmSync(suiteRoot, { recursive: true, force: true });
  fs.rmSync(coordinator, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Exact snapshots: type, dev, ino, permission bits, file bytes or symlink
// target, and sorted directory listings — nothing content-only or mode-only.
// ---------------------------------------------------------------------------
type NodeSnapshot =
  | { type: 'file'; dev: number; ino: number; mode: number; bytes: string }
  | { type: 'link'; dev: number; ino: number; mode: number; target: string }
  | { type: 'dir'; dev: number; ino: number; mode: number; entries: Record<string, NodeSnapshot> };

function mode(file: string): number { return fs.statSync(file).mode & 0o777; }
function lmode(file: string): number { return fs.lstatSync(file).mode & 0o777; }
function snapshot(file: string): NodeSnapshot {
  const stat = fs.lstatSync(file); const base = { dev: stat.dev, ino: stat.ino, mode: stat.mode & 0o777 };
  if (stat.isSymbolicLink()) return { type: 'link', ...base, target: fs.readlinkSync(file) };
  if (stat.isFile()) return { type: 'file', ...base, bytes: fs.readFileSync(file).toString('base64') };
  assert.ok(stat.isDirectory(), `unexpected fixture entry ${file}`);
  return { type: 'dir', ...base, entries: Object.fromEntries(fs.readdirSync(file).sort().map(name => [name, snapshot(path.join(file, name))])) };
}
function assertUnchanged(dir: string, before: NodeSnapshot): void { assert.deepEqual(snapshot(dir), before); }

function privateBase(label = 'case'): string {
  const dir = path.join(CAPTURE_ROOT, `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  ensurePrivateDir(dir);
  return dir;
}
function outsideFixture(base: string): { outside: string; protectedFile: string; before: NodeSnapshot } {
  const outside = path.join(base, 'outside'); fs.mkdirSync(outside, { mode: 0o755 }); fs.chmodSync(outside, 0o755);
  const protectedFile = path.join(outside, 'sentinel'); fs.writeFileSync(protectedFile, 'outside-bytes', { mode: 0o644 }); fs.chmodSync(protectedFile, 0o644);
  return { outside, protectedFile, before: snapshot(outside) };
}
function reset(): void { __setArtifactTestHooks(); __setArtifactTestFaults(); __setArtifactTestTokens(); }
function cleanup(dir: string): void { reset(); fs.rmSync(dir, { recursive: true, force: true }); }
function tmpDir(label: string): string { return fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`)); }
function tempEntries(dir: string): string[] { return fs.readdirSync(dir).filter(n => n.endsWith('.tmp')); }
// Traversal hooks retain the configured lexical spelling, while final-file hooks
// resolve from the cwd after chdir (Darwin reports /private/var for /var).
function finalHookPath(dir: string, name: string): string { return path.join(fs.realpathSync(dir), name); }

// A synchronous in-process race seam that fires exactly once, at the first hook
// matching the full {operation, phase, path, component} tuple. Undefined fields
// in `expected` are wildcards so a caller can pin on the discriminating subset.
function swapAt(expected: Record<string, unknown>, action: (detail: any) => void): unknown {
  let fired = false;
  const matches = (d: any) => (expected.operation === undefined || d.operation === expected.operation)
    && (expected.phase === undefined || d.phase === expected.phase)
    && (expected.path === undefined || d.path === expected.path)
    && (expected.component === undefined || d.component === expected.component);
  return { onHook(d: any) { if (!fired && matches(d)) { fired = true; action(d); } } };
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Subprocess helpers. Every child has a bounded timeout and an explicit error
// result; nothing may hang unbounded.
// ---------------------------------------------------------------------------
function child(root: string, source: string, extraEnv: Record<string, string> = {}): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], { env: { ...process.env, ...extraEnv, CAPTURE_ROOT: root, ARTIFACT_MODULE: moduleUrl }, encoding: 'utf8', timeout: 30000 });
}
function childAsync(root: string, source: string): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const proc = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', source], { env: { ...process.env, CAPTURE_ROOT: root, ARTIFACT_MODULE: moduleUrl } });
    let stdout = ''; let stderr = ''; proc.stdout.on('data', d => { stdout += d; }); proc.stderr.on('data', d => { stderr += d; });
    const timer = setTimeout(() => proc.kill('SIGKILL'), 30000);
    proc.on('exit', code => { clearTimeout(timer); resolve({ status: code, stdout, stderr }); });
  });
}
// A cross-process barrier: the child pauses in a bootstrap or operation hook that
// matches the full expected tuple exactly once, writes an exclusive marker, and
// spins on a gate the parent creates once it has performed the adversarial swap.
async function gatedChild(root: string, expected: Record<string, unknown>, program: string, tag: string, extraEnv: Record<string, string> = {}): Promise<{ done: Promise<{ code: number | null; stderr: string }>; release: () => void }> {
  const marker = path.join(coordinator, `marker-${tag}`); const gate = path.join(coordinator, `gate-${tag}`);
  const E = JSON.stringify(expected);
  const preload = `import fs from 'node:fs'; let fired=false; const E=${E}; const marker=${JSON.stringify(marker)}, gate=${JSON.stringify(gate)}; function m(d){return (E.operation===undefined||d.operation===E.operation)&&(E.phase===undefined||d.phase===E.phase)&&(E.path===undefined||d.path===E.path)&&(E.component===undefined||d.component===E.component);} globalThis[Symbol.for('capture.artifacts.test-hooks')]={onHook(d){ if(!fired&&m(d)){ fired=true; fs.writeFileSync(marker,'ready',{flag:'wx'}); while(!fs.existsSync(gate)) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);} }};`;
  const proc = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', `${preload}\n${program}`], { env: { ...process.env, ...extraEnv, CAPTURE_ROOT: root, ARTIFACT_MODULE: moduleUrl }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; proc.stderr.on('data', d => { stderr += d; });
  let exited = false; proc.on('exit', () => { exited = true; });
  const done = new Promise<{ code: number | null; stderr: string }>(resolve => { const timer = setTimeout(() => proc.kill('SIGKILL'), 30000); proc.on('exit', code => { clearTimeout(timer); resolve({ code, stderr }); }); });
  const start = Date.now();
  while (!fs.existsSync(marker)) {
    if (exited) throw new Error(`gated child ${tag} exited before barrier: ${stderr}`);
    if (Date.now() - start > 20000) { proc.kill('SIGKILL'); throw new Error(`gated child ${tag} barrier timeout: ${stderr}`); }
    await sleep(10);
  }
  return { done, release: () => fs.writeFileSync(gate, 'go') };
}

// ===========================================================================
// F-R1 — Explicit roots are process-start frozen
// ===========================================================================
test('F-R1 explicit roots are process-start frozen, isolated, and leave the default-root sentinel untouched', async () => {
  const defaultRoot = path.join(os.tmpdir(), 'capture-sessions');
  const sentinel = path.join(defaultRoot, `fr1-absent-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const rootA = tmpDir('fr1-a'); const rootB = tmpDir('fr1-b');
  try {
    assert.equal(fs.existsSync(sentinel), false);
    // Each child imports after CAPTURE_ROOT is set, mutates the environment
    // afterward, and performs two writes; the result is printed (never written
    // into its own capture root).
    const program = `const a = await import(process.env.ARTIFACT_MODULE); const original = a.CAPTURE_ROOT; process.env.CAPTURE_ROOT = '/changed-after-import'; a.writePrivateFile(original + '/one', 'first'); a.writePrivateFile(original + '/two', 'second'); process.stdout.write(JSON.stringify({ root: a.CAPTURE_ROOT }));`;
    const [a, b] = await Promise.all([childAsync(rootA, program), childAsync(rootB, program)]);
    assert.equal(a.status, 0, a.stderr); assert.equal(b.status, 0, b.stderr);
    assert.equal(JSON.parse(a.stdout).root, path.resolve(rootA));
    assert.equal(JSON.parse(b.stdout).root, path.resolve(rootB));
    assert.deepEqual(fs.readdirSync(rootA).sort(), ['one', 'two']);
    assert.deepEqual(fs.readdirSync(rootB).sort(), ['one', 'two']);
    assert.equal(fs.existsSync(sentinel), false);
  } finally { fs.rmSync(rootA, { recursive: true, force: true }); fs.rmSync(rootB, { recursive: true, force: true }); }
});

// ===========================================================================
// F-R2 — Final configured root symlink is rejected
// ===========================================================================
test('F-R2 a final configured-root symlink is rejected without mutating target, link, or parent', () => {
  const base = tmpDir('fr2');
  try {
    const target = path.join(base, 'target'); fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'keep'), 'keep', { mode: 0o644 });
    const targetBefore = snapshot(target);
    const final = path.join(base, 'finalroot'); fs.symlinkSync(target, final); const linkBefore = snapshot(final); const parentContentsBefore = fs.readdirSync(base).sort();
    const result = path.join(coordinator, 'fr2-rec.json');
    const res = child(final, `import fs from 'node:fs'; const rec=[]; globalThis[Symbol.for('capture.artifacts.test-hooks')]={onHook(d){rec.push(d)}}; let threw=false; try{ await import(process.env.ARTIFACT_MODULE);}catch(e){threw=true;} fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify({threw, phases: rec.map(d=>d.phase)}));`);
    assert.equal(res.status, 0, res.stderr);
    const rec = JSON.parse(fs.readFileSync(result, 'utf8'));
    assert.equal(rec.threw, true);
    assert.equal(rec.phases.includes('afterRootPinned'), false, 'root must never be pinned through a symlink');
    assert.deepEqual(snapshot(target), targetBefore);
    assert.deepEqual(snapshot(final), linkBefore);
    assert.deepEqual(fs.readdirSync(base).sort(), parentContentsBefore);
    assert.deepEqual(fs.readdirSync(target).sort(), ['keep']);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// ===========================================================================
// F-R3 — Intermediate symlink rejected; sanctioned host spelling works;
//        Darwin /var alias is followed-target checked after chdir
// ===========================================================================
test('F-R3 intermediate symlink rejected, ordinary host spelling works, and the Darwin /var alias is followed-target checked', () => {
  const base = tmpDir('fr3');
  try {
    // Intermediate symlink → reject, no target/link/parent mutation.
    const target = path.join(base, 'target'); fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'keep'), 'keep', { mode: 0o644 });
    const targetBefore = snapshot(target); const middle = path.join(base, 'middle'); fs.symlinkSync(target, middle); const linkBefore = snapshot(middle);
    const configured = path.join(middle, 'configured');
    const inter = child(configured, `await import(process.env.ARTIFACT_MODULE)`);
    assert.notEqual(inter.status, 0);
    assert.deepEqual(snapshot(target), targetBefore);
    assert.deepEqual(snapshot(middle), linkBefore);

    // Ordinary explicit temp root via the host's normal spelling → success.
    const ordinary = tmpDir('fr3-ordinary');
    try {
      const ok = child(ordinary, `const a = await import(process.env.ARTIFACT_MODULE); a.writePrivateFile(a.CAPTURE_ROOT + '/w', 'hi');`);
      assert.equal(ok.status, 0, ok.stderr);
      assert.equal(fs.readFileSync(path.join(ordinary, 'w'), 'utf8'), 'hi');
      assert.equal(mode(ordinary), DIR_MODE);
    } finally { fs.rmSync(ordinary, { recursive: true, force: true }); }
  } finally { fs.rmSync(base, { recursive: true, force: true }); }

  // Darwin's /var is a kernel-owned alias for /private/var; ordinary success
  // must not mask a skipped followed-target check.
  if (process.platform === 'darwin' && os.tmpdir().startsWith('/var/')) {
    // (a) A bootstrap hook records the exact alias transition tuple.
    const aliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fr3-var-'));
    const result = path.join(coordinator, 'fr3-alias.json');
    try {
      const rec = child(aliasRoot, `import fs from 'node:fs'; const rec=[]; globalThis[Symbol.for('capture.artifacts.test-hooks')]={onHook(d){ if(d.path==='/var') rec.push(d); }}; await import(process.env.ARTIFACT_MODULE); fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify(rec));`);
      assert.equal(rec.status, 0, rec.stderr);
      const recorded = JSON.parse(fs.readFileSync(result, 'utf8'));
      assert.ok(recorded.some((d: any) => d.operation === 'root-bootstrap' && d.phase === 'afterComponentChdirBeforeIdentityCheck' && d.path === '/var' && d.component === 'var'), `expected exact /var alias tuple; recorded ${JSON.stringify(recorded)}`);
    } finally { fs.rmSync(aliasRoot, { recursive: true, force: true }); }

    // (b) Making the alias check throw proves the configured-root suffix is not
    // created until the followed-target check has run.
    const varBase = fs.mkdtempSync(path.join(os.tmpdir(), 'fr3-var2-'));
    const suffix = path.join(varBase, 'suffix');
    try {
      const guarded = child(suffix, `globalThis[Symbol.for('capture.artifacts.test-hooks')]={onHook(d){ if(d.path==='/var' && d.phase==='afterComponentChdirBeforeIdentityCheck'){ throw new Error('alias-guard'); } }}; await import(process.env.ARTIFACT_MODULE);`);
      assert.notEqual(guarded.status, 0);
      assert.equal(fs.existsSync(suffix), false, 'no configured-root suffix may be created before the followed-target check');
    } finally { fs.rmSync(varBase, { recursive: true, force: true }); }
  }
});

// ===========================================================================
// F-R4 — Multiple missing components are private
// ===========================================================================
test('F-R4 every created component from the first missing ancestor through the leaf is a real 0700 directory', () => {
  const base = tmpDir('fr4');
  try {
    const missingA = path.join(base, 'missing-a'); const missingB = path.join(missingA, 'missing-b'); const root = path.join(missingB, 'root');
    const res = child(root, `const a = await import(process.env.ARTIFACT_MODULE); a.ensurePrivateDir(a.CAPTURE_ROOT + '/leaf');`);
    assert.equal(res.status, 0, res.stderr);
    for (const dir of [missingA, missingB, root, path.join(root, 'leaf')]) {
      const stat = fs.lstatSync(dir);
      assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), `${dir} must be a real directory`);
      assert.equal(mode(dir), DIR_MODE);
    }
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// ===========================================================================
// F-R5 — Existing loose root is secured through the pin
// ===========================================================================
test('F-R5 an existing loose 0755 root is chmodded to 0700 in place (same inode)', () => {
  const base = tmpDir('fr5');
  try {
    const loose = path.join(base, 'loose'); fs.mkdirSync(loose, { mode: 0o755 }); fs.chmodSync(loose, 0o755);
    const inoBefore = fs.statSync(loose).ino;
    const res = child(loose, `await import(process.env.ARTIFACT_MODULE)`);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(fs.statSync(loose).ino, inoBefore);
    assert.equal(mode(loose), DIR_MODE);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

// ===========================================================================
// F-R6 — Bootstrap lstat→chdir swap cannot redirect
// ===========================================================================
for (const variant of ['real', 'symlink'] as const) {
  test(`F-R6 bootstrap root swap after lstat (${variant} replacement) fails identity verification before any chmod`, async () => {
    const base = tmpDir(`fr6-${variant}`);
    try {
      const root = path.join(base, 'root'); fs.mkdirSync(root, { mode: 0o755 }); fs.chmodSync(root, 0o755);
      const outside = path.join(base, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'sentinel'), 'outside', { mode: 0o644 });
      const outsideBefore = snapshot(outside); const originalBefore = snapshot(root); const held = path.join(base, 'held');
      const expected = { operation: 'root-bootstrap', phase: 'afterComponentLstat', path: path.resolve(root), component: 'root' };
      const g = await gatedChild(path.resolve(root), expected, `await import(process.env.ARTIFACT_MODULE);`, `fr6-${variant}`);
      fs.renameSync(root, held);
      if (variant === 'real') { fs.mkdirSync(root, { mode: 0o755 }); fs.chmodSync(root, 0o755); } else fs.symlinkSync(outside, root);
      const replacementBefore = snapshot(root);
      g.release();
      const result = await g.done;
      assert.notEqual(result.code, 0, result.stderr);
      assertUnchanged(outside, outsideBefore);
      assert.deepEqual(snapshot(root), replacementBefore, 'replacement must be untouched');
      assert.deepEqual(snapshot(held), originalBefore, 'original generation must survive unchmodded');
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
  });
}

// ===========================================================================
// F-R7 — Every entry point rejects post-import root generation replacement
// ===========================================================================
test('F-R7 every entry point rejects a post-import root generation replacement', async () => {
  const ops: Array<{ name: string; variant: 'real' | 'symlink'; seed: 'file' | 'tree' | 'none'; call: string }> = [
    { name: 'create', variant: 'real', seed: 'none', call: `a.createPrivateFile(root + '/record', 'new')` },
    { name: 'read', variant: 'symlink', seed: 'file', call: `a.readPrivateFile(root + '/record')` },
    { name: 'append', variant: 'real', seed: 'file', call: `a.appendPrivateFile(root + '/record', '+a')` },
    { name: 'replace', variant: 'symlink', seed: 'file', call: `a.writePrivateFile(root + '/record', 'new')` },
    { name: 'unlink', variant: 'real', seed: 'file', call: `a.unlinkPrivateFile(root + '/record')` },
    { name: 'remove', variant: 'symlink', seed: 'tree', call: `a.removeArtifactTree(root + '/tree')` },
  ];
  const bases = new Map<string, string>();
  try {
    await Promise.all(ops.map(async op => {
      const base = tmpDir(`fr7-${op.name}`); bases.set(op.name, base);
      const root = path.join(base, 'root'); fs.mkdirSync(root, { mode: 0o755 }); fs.chmodSync(root, 0o755);
      const outside = path.join(base, 'outside'); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'sentinel'), 'outside', { mode: 0o644 });
      if (op.seed === 'file') fs.writeFileSync(path.join(root, 'record'), 'old', { mode: 0o600 });
      if (op.seed === 'tree') { fs.mkdirSync(path.join(root, 'tree')); fs.writeFileSync(path.join(root, 'tree', 'child'), 'trusted'); }
      const result = path.join(coordinator, `fr7-${op.name}.json`);
      const plant = op.variant === 'real' ? `fs.mkdirSync(root);` : `fs.symlinkSync(path.join(base,'outside'), root);`;
      const res = await childAsync(root, `import fs from 'node:fs'; import path from 'node:path'; const a = await import(process.env.ARTIFACT_MODULE); const root = a.CAPTURE_ROOT; const base = path.dirname(root); const held = path.join(base,'held'); fs.renameSync(root, held); ${plant} let threw=false, msg=''; try{ ${op.call}; }catch(e){ threw=true; msg=String(e && e.message); } fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify({threw,msg}));`);
      assert.equal(res.status, 0, res.stderr);
      const outcome = JSON.parse(fs.readFileSync(result, 'utf8'));
      assert.equal(outcome.threw, true, `${op.name} must reject the replaced root: ${outcome.msg}`);
      const held = path.join(base, 'held');
      // Original generation exact.
      if (op.seed === 'file') { assert.equal(fs.readFileSync(path.join(held, 'record'), 'utf8'), 'old'); assert.equal(lmode(path.join(held, 'record')), FILE_MODE); }
      if (op.seed === 'tree') { assert.equal(fs.readFileSync(path.join(held, 'tree', 'child'), 'utf8'), 'trusted'); }
      if (op.seed === 'none') assert.equal(fs.existsSync(path.join(held, 'record')), false);
      // Replacement + outside exact.
      if (op.variant === 'real') { assert.equal(snapshot(root).type, 'dir'); assert.deepEqual(fs.readdirSync(root), []); }
      else assert.equal(snapshot(root).type, 'link');
      assert.equal(fs.readFileSync(path.join(outside, 'sentinel'), 'utf8'), 'outside');
    }));
  } finally { for (const base of bases.values()) fs.rmSync(base, { recursive: true, force: true }); }
});

// ===========================================================================
// F-R8 — Losing a component create to a concurrent honest bootstrap
// ===========================================================================
test('F-R8 a cold-root bootstrap that loses mkdir to a concurrent peer adopts the winner vnode', () => {
  const base = tmpDir('fr8-cold'); const root = path.join(base, 'root');
  const result = path.join(coordinator, 'fr8-cold.json');
  try {
    // The peer wins the create inside the exact ENOENT→mkdir window of the
    // module-load bootstrap; the loser must pin the winner's vnode and proceed.
    const res = child(root, `import fs from 'node:fs'; let winner; globalThis[Symbol.for('capture.artifacts.test-hooks')]={onHook(d){ if(d.operation==='root-bootstrap'&&d.phase==='beforeComponentCreate'&&d.component==='root'&&winner===undefined){ fs.mkdirSync(d.path,{mode:0o700}); winner=fs.lstatSync(d.path).ino; } }}; const a = await import(process.env.ARTIFACT_MODULE); a.writePrivateFile(a.CAPTURE_ROOT + '/w', 'hi'); fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify({ winner, pinned: fs.lstatSync(a.CAPTURE_ROOT).ino }));`);
    assert.equal(res.status, 0, res.stderr);
    const rec = JSON.parse(fs.readFileSync(result, 'utf8'));
    assert.equal(typeof rec.winner, 'number', 'the peer must have won the create inside the race window');
    assert.equal(rec.pinned, rec.winner, 'the loser must pin the winner vnode, never replace it');
    assert.equal(fs.readFileSync(path.join(root, 'w'), 'utf8'), 'hi');
    assert.equal(mode(root), DIR_MODE);
    const stat = fs.lstatSync(root);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('F-R8 losing a traversal component create re-validates the winner; symlink and file winners are refused', () => {
  // Honest peer directory wins → the operation succeeds on the winner vnode.
  {
    const base = privateBase('fr8-dir'); const target = path.join(base, 'raced');
    try {
      let winner: number | undefined;
      __setArtifactTestHooks(swapAt({ operation: 'traversal', phase: 'beforeComponentCreate', path: target, component: 'raced' }, () => { fs.mkdirSync(target, { mode: 0o700 }); winner = fs.lstatSync(target).ino; }));
      ensurePrivateDir(target);
      reset();
      assert.equal(typeof winner, 'number', 'the peer must have won the create inside the race window');
      assert.equal(fs.lstatSync(target).ino, winner, 'the loser must pin the winner vnode');
      assert.equal(mode(target), DIR_MODE);
    } finally { cleanup(base); }
  }
  // Symlink winner → refused; link and its target untouched.
  {
    const base = privateBase('fr8-link'); const { outside, before } = outsideFixture(base);
    const target = path.join(base, 'raced');
    try {
      __setArtifactTestHooks(swapAt({ operation: 'traversal', phase: 'beforeComponentCreate', path: target, component: 'raced' }, () => { fs.symlinkSync(outside, target); }));
      assert.throws(() => ensurePrivateDir(target), /refusing symlinked artifact directory component/);
      reset();
      assert.equal(snapshot(target).type, 'link');
      assertUnchanged(outside, before);
    } finally { cleanup(base); }
  }
  // Regular-file winner → refused; the file stays byte- and mode-exact.
  {
    const base = privateBase('fr8-file'); const target = path.join(base, 'raced');
    try {
      __setArtifactTestHooks(swapAt({ operation: 'traversal', phase: 'beforeComponentCreate', path: target, component: 'raced' }, () => { fs.writeFileSync(target, 'winner', { mode: 0o644 }); fs.chmodSync(target, 0o644); }));
      assert.throws(() => ensurePrivateDir(target), /refusing non-directory artifact component/);
      reset();
      const s = snapshot(target); assert.equal(s.type, 'file');
      assert.equal(fs.readFileSync(target, 'utf8'), 'winner');
      assert.equal(lmode(target), 0o644);
    } finally { cleanup(base); }
  }
});

// ===========================================================================
// F-C1 — Component pre-chdir swap is rejected for every API
// ===========================================================================
test('F-C1 a component pre-chdir swap is rejected for create/read/append/replace/unlink/remove', () => {
  const apis: Array<{ name: string; seed: 'file' | 'tree' | 'none'; call: (t: string) => unknown }> = [
    { name: 'create', seed: 'none', call: t => createPrivateFile(t, 'new') },
    { name: 'read', seed: 'file', call: t => readPrivateFile(t) },
    { name: 'append', seed: 'file', call: t => appendPrivateFile(t, '+a') },
    { name: 'replace', seed: 'file', call: t => writePrivateFile(t, 'new') },
    { name: 'unlink', seed: 'file', call: t => unlinkPrivateFile(t) },
    { name: 'remove', seed: 'tree', call: t => removeArtifactTree(t) },
  ];
  for (const api of apis) {
    const base = privateBase(`fc1-${api.name}`); const { outside, before } = outsideFixture(base);
    const trusted = path.join(base, 'trusted'); fs.mkdirSync(trusted); const held = `${trusted}.held`;
    const target = api.seed === 'tree' ? path.join(trusted, 'tree') : path.join(trusted, 'record');
    if (api.seed === 'file') fs.writeFileSync(target, 'old', { mode: 0o600 });
    if (api.seed === 'tree') { fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'child'), 'trusted'); }
    const trustedBefore = snapshot(trusted);
    try {
      __setArtifactTestHooks(swapAt({ operation: 'traversal', phase: 'afterComponentLstat', path: trusted, component: 'trusted' }, () => { fs.renameSync(trusted, held); fs.symlinkSync(outside, trusted); }));
      assert.throws(() => api.call(target));
      reset();
      assert.deepEqual(snapshot(held), trustedBefore, 'trusted generation must survive intact');
      assert.equal(snapshot(trusted).type, 'link');
      assertUnchanged(outside, before);
    } finally { cleanup(base); }
  }
});

// ===========================================================================
// F-C2 — Component post-chdir/pre-identity swap remains on the trusted vnode
// ===========================================================================
test('F-C2 a component post-chdir/pre-identity swap keeps every API on the trusted vnode', () => {
  const apis: Array<{ name: string; seed: 'file' | 'tree' | 'none'; call: (t: string) => unknown; expected: string; removes?: boolean }> = [
    { name: 'create', seed: 'none', call: t => createPrivateFile(t, 'new'), expected: 'new' },
    { name: 'read', seed: 'file', call: t => readPrivateFile(t).toString(), expected: 'old' },
    { name: 'append', seed: 'file', call: t => appendPrivateFile(t, '+a'), expected: 'old+a' },
    { name: 'replace', seed: 'file', call: t => writePrivateFile(t, 'new'), expected: 'new' },
    { name: 'unlink', seed: 'file', call: t => unlinkPrivateFile(t), expected: '', removes: true },
    { name: 'remove', seed: 'tree', call: t => removeArtifactTree(t), expected: '', removes: true },
  ];
  for (const api of apis) {
    const base = privateBase(`fc2-${api.name}`); const trusted = path.join(base, 'trusted'); fs.mkdirSync(trusted); const held = `${trusted}.held`;
    const target = api.seed === 'tree' ? path.join(trusted, 'tree') : path.join(trusted, 'record');
    if (api.seed === 'file') fs.writeFileSync(target, 'old', { mode: 0o600 });
    if (api.seed === 'tree') { fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'child'), 'trusted'); }
    try {
      __setArtifactTestHooks(swapAt({ operation: 'traversal', phase: 'afterComponentChdirBeforeIdentityCheck', path: trusted, component: 'trusted' }, () => { fs.renameSync(trusted, held); fs.mkdirSync(trusted); }));
      const value = api.call(target);
      reset();
      const heldTarget = path.join(held, path.basename(target));
      if (api.name === 'read') assert.equal(value, api.expected);
      if (api.removes) assert.equal(fs.existsSync(heldTarget), false);
      else assert.equal(fs.readFileSync(heldTarget, 'utf8'), api.expected);
      // The planted visible replacement remains an empty directory, untouched.
      assert.deepEqual(fs.readdirSync(trusted), []);
    } finally { cleanup(base); }
  }
});

// ===========================================================================
// F-C3 — Fully pinned parent survives visible-root/parent replacement
// ===========================================================================
for (const variant of ['real', 'symlink'] as const) {
  test(`F-C3 a fully pinned parent survives a visible ${variant} replacement for create/read/append/replace/unlink`, () => {
    const apis: Array<{ name: string; seed: boolean; call: (f: string) => unknown; expected: string; removes?: boolean }> = [
      { name: 'create', seed: false, call: f => createPrivateFile(f, 'new'), expected: 'new' },
      { name: 'read', seed: true, call: f => readPrivateFile(f).toString(), expected: 'old' },
      { name: 'append', seed: true, call: f => appendPrivateFile(f, '+a'), expected: 'old+a' },
      { name: 'replace', seed: true, call: f => writePrivateFile(f, 'new'), expected: 'new' },
      { name: 'unlink', seed: true, call: f => unlinkPrivateFile(f), expected: '', removes: true },
    ];
    for (const api of apis) {
      const base = privateBase(`fc3-${variant}-${api.name}`); const held = `${base}.held`;
      const file = path.join(base, 'record'); if (api.seed) fs.writeFileSync(file, 'old', { mode: 0o600 });
      const outside = variant === 'symlink' ? privateBase(`fc3-outside-${api.name}`) : '';
      const outsideBefore = variant === 'symlink' ? snapshot(outside) : undefined;
      try {
        __setArtifactTestHooks(swapAt({ operation: 'traversal', phase: 'afterParentPinned', path: base }, () => {
          fs.renameSync(base, held);
          if (variant === 'real') fs.mkdirSync(base); else fs.symlinkSync(outside, base);
        }));
        const value = api.call(file);
        reset();
        const heldFile = path.join(held, 'record');
        if (api.name === 'read') assert.equal(value, api.expected);
        if (api.removes) assert.equal(fs.existsSync(heldFile), false);
        else assert.equal(fs.readFileSync(heldFile, 'utf8'), api.expected);
        if (variant === 'real') { assert.equal(snapshot(base).type, 'dir'); assert.deepEqual(fs.readdirSync(base), []); }
        else { assert.equal(snapshot(base).type, 'link'); assertUnchanged(outside, outsideBefore!); }
      } finally {
        reset();
        fs.rmSync(held, { recursive: true, force: true });
        fs.rmSync(base, { recursive: true, force: true });
        if (outside) fs.rmSync(outside, { recursive: true, force: true });
      }
    }
  });
}

// ===========================================================================
// F-C4 — Recursive cleanup cannot cross descendant swaps or final-rmdir
//        substitution
// ===========================================================================
test('F-C4 recursive cleanup rejects descendant pre/post pin swaps and final-rmdir substitution', () => {
  // (1) descendant pre-pin swap → symlink to outside.
  {
    const base = privateBase('fc4-pre'); const tree = path.join(base, 'tree'); const held = `${tree}.held`; const { outside, before } = outsideFixture(base);
    fs.mkdirSync(path.join(tree, 'child'), { recursive: true }); fs.writeFileSync(path.join(tree, 'child', 'data'), 'trusted');
    const treeBefore = snapshot(tree);
    try {
      __setArtifactTestHooks(swapAt({ operation: 'recursive-removal', phase: 'afterChildLstat', component: 'tree' }, () => { fs.renameSync(tree, held); fs.symlinkSync(outside, tree); }));
      assert.throws(() => removeArtifactTree(tree));
      reset();
      assert.deepEqual(snapshot(held), treeBefore);
      assert.equal(snapshot(tree).type, 'link');
      assertUnchanged(outside, before);
    } finally { cleanup(base); }
  }
  // (2) descendant post-pin swap with a dynamically planted symlink inside the
  //     visible replacement. Cleanup removes the trusted content it pinned but
  //     never crosses into the planted link's target.
  {
    const base = privateBase('fc4-post'); const tree = path.join(base, 'tree'); const held = `${tree}.held`; const { outside, protectedFile, before } = outsideFixture(base);
    fs.mkdirSync(path.join(tree, 'child'), { recursive: true }); fs.writeFileSync(path.join(tree, 'child', 'data'), 'trusted');
    try {
      __setArtifactTestHooks(swapAt({ operation: 'recursive-removal', phase: 'afterChildChdirBeforeIdentityCheck', component: 'tree' }, () => { fs.renameSync(tree, held); fs.mkdirSync(tree); fs.symlinkSync(protectedFile, path.join(tree, 'planted')); }));
      assert.throws(() => removeArtifactTree(tree));
      reset();
      assert.equal(fs.existsSync(held), false, 'the pinned trusted generation is removed');
      assertUnchanged(outside, before);
      assert.deepEqual(fs.readdirSync(tree).sort(), ['planted']);
      assert.equal(snapshot(path.join(tree, 'planted')).type, 'link');
    } finally { cleanup(base); }
  }
  // (3) final-rmdir substitution: replace the emptied checked directory with an
  //     empty substitute at beforeDirectoryRmdir; the post-hook identity check
  //     rejects it and preserves the substitute.
  {
    const base = privateBase('fc4-rmdir'); const tree = path.join(base, 'tree'); fs.mkdirSync(path.join(tree, 'inner'), { recursive: true });
    const innerBefore = snapshot(path.join(tree, 'inner'));
    try {
      __setArtifactTestHooks(swapAt({ operation: 'recursive-removal', phase: 'beforeDirectoryRmdir', component: 'inner' }, () => {
        fs.renameSync(path.join(tree, 'inner'), path.join(tree, 'inner.held'));
        fs.mkdirSync(path.join(tree, 'inner'));
      }));
      assert.throws(() => removeArtifactTree(tree), /changed while removing/);
      reset();
      // The empty substitute is preserved; the retained original survives under its held name.
      assert.equal(snapshot(path.join(tree, 'inner')).type, 'dir');
      assert.deepEqual(fs.readdirSync(path.join(tree, 'inner')), []);
      assert.deepEqual(snapshot(path.join(tree, 'inner.held')), innerBefore);
    } finally { cleanup(base); }
  }
});

// ===========================================================================
// F-F1 — Static final symlinks obey the compatibility contract
// ===========================================================================
test('F-F1 every final-name API rejects a pre-existing final symlink with target/link/parent exact', () => {
  const apis: Array<[string, (p: string) => unknown]> = [
    ['create', p => createPrivateFile(p, 'changed')],
    ['read', p => readPrivateFile(p)],
    ['append', p => appendPrivateFile(p, 'changed')],
    ['replace', p => writePrivateFile(p, 'changed')],
    ['unlink', p => unlinkPrivateFile(p)],
  ];
  for (const [name, call] of apis) {
    const base = privateBase(`ff1-${name}`); const { outside, protectedFile, before } = outsideFixture(base);
    const link = path.join(base, 'trap'); fs.symlinkSync(protectedFile, link); const linkBefore = snapshot(link);
    try {
      assert.throws(() => call(link));
      assertUnchanged(outside, before);
      assert.deepEqual(snapshot(link), linkBefore);
      assert.deepEqual(fs.readdirSync(base).sort(), ['outside', 'trap']);
    } finally { cleanup(base); }
  }
});

// ===========================================================================
// F-F2 — Open artifact descriptor owns subsequent validation/chmod/data
// ===========================================================================
test('F-F2 an open descriptor keeps validation/chmod/data on the renamed trusted inode', () => {
  for (const [name, seed, expected] of [['read', true, 'old'], ['append', true, 'old+a'], ['create', false, 'new']] as const) {
    const base = privateBase(`ff2-${name}`); const { outside, protectedFile, before } = outsideFixture(base);
    const file = path.join(base, 'record'); if (seed) fs.writeFileSync(file, 'old', { mode: 0o600 }); const held = `${file}.held`;
    try {
      __setArtifactTestHooks(swapAt({ operation: 'final-file', phase: 'afterFinalOpen', path: finalHookPath(base, 'record'), component: 'record' }, () => { fs.renameSync(file, held); fs.symlinkSync(protectedFile, file); }));
      const value = name === 'read' ? readPrivateFile(file).toString() : name === 'append' ? (appendPrivateFile(file, '+a'), undefined) : (createPrivateFile(file, 'new'), undefined);
      reset();
      if (name === 'read') assert.equal(value, expected);
      assert.equal(fs.readFileSync(held, 'utf8'), expected);
      assert.equal(lmode(held), FILE_MODE);
      assert.equal(snapshot(file).type, 'link');
      assertUnchanged(outside, before);
    } finally { cleanup(base); }
  }
  // Atomic-replacement temp: the descriptor owns the renamed temp inode; the
  // fixed token lets the barrier pin the exact temp component.
  {
    const base = privateBase('ff2-replace'); const { outside, protectedFile, before } = outsideFixture(base);
    const dest = path.join(base, 'record'); fs.writeFileSync(dest, 'old', { mode: 0o600 }); const destBefore = snapshot(dest);
    const token = 'ff2replacetoken'; const temp = path.join(base, `.record.${process.pid}.${token}.tmp`); const held = `${temp}.held`;
    try {
      __setArtifactTestTokens({ artifactTemp: () => token });
      __setArtifactTestHooks(swapAt({ operation: 'final-file', phase: 'afterFinalOpen', path: finalHookPath(base, path.basename(temp)), component: path.basename(temp) }, () => { fs.renameSync(temp, held); fs.symlinkSync(protectedFile, temp); }));
      // The pathname publish can no longer find the trusted temp (moved to held);
      // the descriptor work must still have landed on the trusted inode.
      assert.throws(() => writePrivateFile(dest, 'new'));
      reset();
      assert.equal(fs.readFileSync(held, 'utf8'), 'new');
      assert.equal(lmode(held), FILE_MODE);
      assert.equal(snapshot(temp).type, 'link', 'planted link at the temp name is untouched');
      assert.deepEqual(snapshot(dest), destBefore, 'old destination is preserved');
      assertUnchanged(outside, before);
    } finally { cleanup(base); }
  }
});

// ===========================================================================
// F-F3 — Atomic rename replaces only a planted destination link
// ===========================================================================
test('F-F3 the atomic rename replaces only a planted destination link', () => {
  const base = privateBase('ff3'); const { outside, protectedFile, before } = outsideFixture(base);
  const dest = path.join(base, 'destination');
  try {
    __setArtifactTestHooks(swapAt({ operation: 'final-file', phase: 'beforeRename', path: finalHookPath(base, 'destination'), component: 'destination' }, () => { fs.symlinkSync(protectedFile, dest); }));
    writePrivateFile(dest, 'new');
    reset();
    assertUnchanged(outside, before);
    const s = snapshot(dest); assert.equal(s.type, 'file'); assert.equal(s.mode, FILE_MODE);
    assert.equal(fs.readFileSync(dest, 'utf8'), 'new');
    assert.deepEqual(fs.readdirSync(base).sort(), ['destination', 'outside']);
    assert.deepEqual(tempEntries(base), []);
  } finally { cleanup(base); }
});

// ===========================================================================
// F-F4 — Unlink removes only the substituted link entry
// ===========================================================================
test('F-F4 unlink removes only the substituted link entry and never its target', () => {
  const base = privateBase('ff4'); const { outside, protectedFile, before } = outsideFixture(base);
  const record = path.join(base, 'record'); fs.writeFileSync(record, 'old', { mode: 0o600 });
  try {
    __setArtifactTestHooks(swapAt({ operation: 'final-file', phase: 'beforeUnlink', path: finalHookPath(base, 'record'), component: 'record' }, () => { fs.unlinkSync(record); fs.symlinkSync(protectedFile, record); }));
    unlinkPrivateFile(record);
    reset();
    assert.equal(fs.existsSync(record), false);
    assertUnchanged(outside, before);
    assert.deepEqual(fs.readdirSync(base).sort(), ['outside']);
  } finally { cleanup(base); }
});

// ===========================================================================
// F-F5 — Exclusive create never alters an existing regular file
// ===========================================================================
test('F-F5 exclusive create leaves an existing regular file exact and fails EEXIST', () => {
  const base = privateBase('ff5'); const file = path.join(base, 'file'); fs.writeFileSync(file, 'original', { mode: 0o640 }); fs.chmodSync(file, 0o640);
  const fileBefore = snapshot(file); const listBefore = fs.readdirSync(base).sort();
  try {
    assert.throws(() => createPrivateFile(file, 'new'), (e: NodeJS.ErrnoException) => e.code === 'EEXIST');
    assert.deepEqual(snapshot(file), fileBefore);
    assert.deepEqual(fs.readdirSync(base).sort(), listBefore);
  } finally { cleanup(base); }
});

// ===========================================================================
// F-W1 — Artifact partial writes loop exactly
// ===========================================================================
test('F-W1 partial writes loop exactly (1,2,remaining) for exclusive create, append, and atomic replace', () => {
  // Exclusive create.
  {
    const base = privateBase('fw1-create'); const file = path.join(base, 'file');
    try {
      let calls = 0; __setArtifactTestFaults({ write: (_r: unknown, real: () => number) => { calls++; return calls === 1 ? 1 : calls === 2 ? 2 : real(); } });
      createPrivateFile(file, '0123456789');
      reset();
      assert.equal(fs.readFileSync(file, 'utf8'), '0123456789');
      assert.equal(lmode(file), FILE_MODE);
      assert.equal(calls, 3);
      assert.deepEqual(tempEntries(base), []);
    } finally { cleanup(base); }
  }
  // Strict append-to-existing.
  {
    const base = privateBase('fw1-append'); const file = path.join(base, 'file'); fs.writeFileSync(file, 'old', { mode: 0o600 });
    try {
      let calls = 0; __setArtifactTestFaults({ write: (_r: unknown, real: () => number) => { calls++; return calls === 1 ? 1 : calls === 2 ? 2 : real(); } });
      appendPrivateFile(file, 'ABCDEFG');
      reset();
      assert.equal(fs.readFileSync(file, 'utf8'), 'oldABCDEFG');
      assert.equal(lmode(file), FILE_MODE);
      assert.equal(calls, 3);
      assert.deepEqual(tempEntries(base), []);
    } finally { cleanup(base); }
  }
  // Atomic replacement.
  {
    const base = privateBase('fw1-replace'); const file = path.join(base, 'file'); fs.writeFileSync(file, 'old', { mode: 0o600 });
    try {
      let calls = 0; __setArtifactTestFaults({ write: (_r: unknown, real: () => number) => { calls++; return calls === 1 ? 1 : calls === 2 ? 2 : real(); } });
      writePrivateFile(file, '0123456789');
      reset();
      assert.equal(fs.readFileSync(file, 'utf8'), '0123456789');
      assert.equal(lmode(file), FILE_MODE);
      assert.equal(calls, 3);
      assert.deepEqual(tempEntries(base), []);
    } finally { cleanup(base); }
  }
});

// ===========================================================================
// F-W2 — Zero and negative write results fail and do not leak owned creation
// ===========================================================================
test('F-W2 zero and negative writes fail and leak no owned creation', () => {
  for (const bad of [0, -1] as const) {
    // Exclusive create: the acquired file must be cleaned, not left behind.
    {
      const base = privateBase(`fw2-create-${bad}`); const file = path.join(base, 'file');
      try {
        __setArtifactTestFaults({ write: () => bad });
        assert.throws(() => createPrivateFile(file, 'abc'), /short private artifact write/);
        reset();
        assert.equal(fs.existsSync(file), false, 'a failed exclusive create must not leak the created file');
        assert.deepEqual(fs.readdirSync(base), []);
      } finally { cleanup(base); }
    }
    // Append: existing file bytes unchanged, no duplicate bytes.
    {
      const base = privateBase(`fw2-append-${bad}`); const file = path.join(base, 'file'); fs.writeFileSync(file, 'old', { mode: 0o600 }); const fileBefore = snapshot(file);
      try {
        __setArtifactTestFaults({ write: () => bad });
        assert.throws(() => appendPrivateFile(file, 'abc'), /short private artifact write/);
        reset();
        assert.deepEqual(snapshot(file), fileBefore);
        assert.deepEqual(tempEntries(base), []);
      } finally { cleanup(base); }
    }
    // Atomic temp creation: destination preserved, no temp residue.
    {
      const base = privateBase(`fw2-replace-${bad}`); const file = path.join(base, 'file'); fs.writeFileSync(file, 'old', { mode: 0o600 }); const fileBefore = snapshot(file);
      try {
        __setArtifactTestFaults({ write: () => bad });
        assert.throws(() => writePrivateFile(file, 'abc'), /short private artifact write/);
        reset();
        assert.deepEqual(snapshot(file), fileBefore);
        assert.deepEqual(tempEntries(base), []);
      } finally { cleanup(base); }
    }
  }
});

// ===========================================================================
// F-X1 — Deterministic artifact temp collision preserves both names
// ===========================================================================
test('F-X1 a deterministic temp collision fails exclusive open and preserves both names', () => {
  const base = privateBase('fx1'); const file = path.join(base, 'file'); fs.writeFileSync(file, 'original', { mode: 0o640 }); fs.chmodSync(file, 0o640); const fileBefore = snapshot(file);
  const temp = path.join(base, `.file.${process.pid}.collision.tmp`); fs.writeFileSync(temp, 'collision', { mode: 0o640 }); fs.chmodSync(temp, 0o640); const tempBefore = snapshot(temp);
  const listBefore = fs.readdirSync(base).sort();
  try {
    __setArtifactTestTokens({ artifactTemp: () => 'collision' });
    assert.throws(() => writePrivateFile(file, 'new'), (e: NodeJS.ErrnoException) => e.code === 'EEXIST');
    reset();
    assert.deepEqual(snapshot(file), fileBefore);
    assert.deepEqual(snapshot(temp), tempBefore, 'the unacquired collision must not be cleaned');
    assert.deepEqual(fs.readdirSync(base).sort(), listBefore);
  } finally { cleanup(base); }
});

// ===========================================================================
// F-X2 — Atomic replace fault table preserves the old destination
// ===========================================================================
test('F-X2 the atomic-replace fault table preserves the old destination and surfaces cleanup failures', () => {
  // Faults that must clean the temp and preserve the old destination.
  for (const role of ['artifact-data-write', 'artifact-temp-fsync', 'artifact-rename'] as const) {
    const base = privateBase(`fx2-${role}`); const { outside, before } = outsideFixture(base);
    const file = path.join(base, 'file'); fs.writeFileSync(file, 'old', { mode: 0o600 }); const fileBefore = snapshot(file);
    try {
      __setArtifactTestFaults({ before: (actual: string) => { if (actual === role) throw new Error(role); } });
      assert.throws(() => writePrivateFile(file, 'new'), new RegExp(role));
      reset();
      assert.deepEqual(snapshot(file), fileBefore);
      assertUnchanged(outside, before);
      assert.deepEqual(tempEntries(base), []);
    } finally { cleanup(base); }
  }
  // Close-after-real-close: the fd is already closed, the temp is cleaned.
  {
    const base = privateBase('fx2-close'); const { outside, before } = outsideFixture(base);
    const file = path.join(base, 'file'); fs.writeFileSync(file, 'old', { mode: 0o600 }); const fileBefore = snapshot(file);
    try {
      __setArtifactTestFaults({ after: (role: string) => { if (role === 'artifact-temp-close') throw new Error('temp-close-after-real'); } });
      assert.throws(() => writePrivateFile(file, 'new'), /temp-close-after-real/);
      reset();
      assert.deepEqual(snapshot(file), fileBefore);
      assertUnchanged(outside, before);
      assert.deepEqual(tempEntries(base), []);
    } finally { cleanup(base); }
  }
  // One-shot cleanup fault: retries to no residue, surfaces the primary alone.
  {
    const base = privateBase('fx2-cleanup-oneshot'); const file = path.join(base, 'file'); fs.writeFileSync(file, 'old', { mode: 0o600 }); const fileBefore = snapshot(file);
    try {
      let cleanupCalls = 0; __setArtifactTestFaults({ before: (role: string) => { if (role === 'artifact-rename') throw new Error('rename'); if (role === 'artifact-cleanup-unlink' && ++cleanupCalls === 1) throw new Error('cleanup'); } });
      assert.throws(() => writePrivateFile(file, 'new'), /rename/);
      reset();
      assert.deepEqual(snapshot(file), fileBefore);
      assert.deepEqual(tempEntries(base), []);
    } finally { cleanup(base); }
  }
  // Persistent pre-unlink cleanup fault: surfaces primary + cleanup, may leave
  // only the exact 0600 owned temp generation.
  {
    const base = privateBase('fx2-cleanup-persistent'); const file = path.join(base, 'file'); fs.writeFileSync(file, 'old', { mode: 0o600 }); const fileBefore = snapshot(file);
    const token = 'fx2persisttoken'; const temp = path.join(base, `.file.${process.pid}.${token}.tmp`);
    try {
      __setArtifactTestTokens({ artifactTemp: () => token });
      __setArtifactTestFaults({ before: (role: string) => { if (role === 'artifact-rename') throw new Error('rename'); if (role === 'artifact-cleanup-unlink') throw new Error('cleanup'); } });
      const err = (() => { try { writePrivateFile(file, 'newbytes'); return undefined; } catch (e) { return e as any; } })();
      reset();
      assert.ok(err instanceof AggregateError, 'a persistent cleanup failure must surface with the primary');
      const messages = err.errors.map((e: any) => String(e.message));
      assert.ok(messages.some((m: string) => /rename/.test(m)) && messages.some((m: string) => /cleanup/.test(m)), `expected both errors, got ${JSON.stringify(messages)}`);
      assert.deepEqual(snapshot(file), fileBefore);
      // If anything survives it is the exact 0600 operation-owned temp only.
      assert.equal(lmode(temp), FILE_MODE);
      assert.equal(fs.readFileSync(temp, 'utf8'), 'newbytes');
      assert.deepEqual(fs.readdirSync(base).sort(), ['file', path.basename(temp)].sort());
    } finally { cleanup(base); }
  }
  // Cleanup pre-unlink substitution (exclusive create): revalidation refuses the substitute.
  {
    const base = privateBase('fx2-sub-create'); const file = path.join(base, 'file'); const held = `${file}.held`;
    try {
      __setArtifactTestFaults({ before: (role: string) => { if (role === 'artifact-temp-fsync') throw new Error('fsync'); } });
      __setArtifactTestHooks(swapAt({ operation: 'final-file', phase: 'beforeOwnedCleanupUnlink', path: finalHookPath(base, 'file'), component: 'file' }, () => { fs.renameSync(file, held); fs.writeFileSync(file, 'protected', { mode: 0o644 }); fs.chmodSync(file, 0o644); }));
      const sub = { pending: true } as any;
      assert.throws(() => createPrivateFile(file, 'abc'), /fsync/);
      reset();
      // The substitute is refused (never unlinked) and preserved exactly.
      assert.equal(fs.readFileSync(file, 'utf8'), 'protected');
      assert.equal(lmode(file), 0o644);
      assert.equal(fs.existsSync(held), true, 'the moved owned generation is left for its owner, not the substitute');
      void sub;
    } finally { cleanup(base); }
  }
  // Cleanup pre-unlink substitution (atomic temp): revalidation refuses the substitute.
  {
    const base = privateBase('fx2-sub-temp'); const file = path.join(base, 'file'); fs.writeFileSync(file, 'old', { mode: 0o600 }); const fileBefore = snapshot(file);
    const token = 'fx2subtoken'; const temp = path.join(base, `.file.${process.pid}.${token}.tmp`); const held = `${temp}.held`;
    try {
      __setArtifactTestTokens({ artifactTemp: () => token });
      __setArtifactTestFaults({ before: (role: string) => { if (role === 'artifact-rename') throw new Error('rename'); } });
      __setArtifactTestHooks(swapAt({ operation: 'final-file', phase: 'beforeOwnedCleanupUnlink', path: finalHookPath(base, path.basename(temp)), component: path.basename(temp) }, () => { fs.renameSync(temp, held); fs.writeFileSync(temp, 'protected', { mode: 0o644 }); fs.chmodSync(temp, 0o644); }));
      assert.throws(() => writePrivateFile(file, 'new'), /rename/);
      reset();
      assert.deepEqual(snapshot(file), fileBefore);
      assert.equal(fs.readFileSync(temp, 'utf8'), 'protected');
      assert.equal(lmode(temp), 0o644);
    } finally { cleanup(base); }
  }
});

// ===========================================================================
// F-X3 — Descriptor validation failures close and clean
// ===========================================================================
test('F-X3 fstat/fchmod faults close the descriptor and clean the created file or temp', () => {
  for (const role of ['artifact-fstat', 'artifact-fchmod'] as const) {
    // Exclusive destination create.
    {
      const base = privateBase(`fx3-create-${role}`); const { outside, before } = outsideFixture(base); const file = path.join(base, 'file');
      try {
        let closes = 0; __setArtifactTestFaults({ before: (r: string) => { if (r === role) throw new Error(role); }, after: (r: string) => { if (r === 'artifact-temp-close') closes++; } });
        assert.throws(() => createPrivateFile(file, 'abc'), new RegExp(role));
        reset();
        assert.ok(closes >= 1, 'the descriptor must be closed');
        assert.equal(fs.existsSync(file), false);
        assert.deepEqual(fs.readdirSync(base).sort(), ['outside']);
        assertUnchanged(outside, before);
      } finally { cleanup(base); }
    }
    // Atomic-replacement temp create.
    {
      const base = privateBase(`fx3-replace-${role}`); const { outside, before } = outsideFixture(base); const file = path.join(base, 'file'); fs.writeFileSync(file, 'old', { mode: 0o600 }); const fileBefore = snapshot(file);
      try {
        let closes = 0; __setArtifactTestFaults({ before: (r: string) => { if (r === role) throw new Error(role); }, after: (r: string) => { if (r === 'artifact-temp-close') closes++; } });
        assert.throws(() => writePrivateFile(file, 'new'), new RegExp(role));
        reset();
        assert.ok(closes >= 1, 'the descriptor must be closed');
        assert.deepEqual(snapshot(file), fileBefore);
        assert.deepEqual(tempEntries(base), []);
        assertUnchanged(outside, before);
      } finally { cleanup(base); }
    }
  }
});

// ===========================================================================
// F-X4 — Reentrancy fails without corrupting cwd
// ===========================================================================
test('F-X4 a reentrant artifact operation is rejected without corrupting cwd', () => {
  const base = privateBase('fx4'); const file = path.join(base, 'record'); const cwdBefore = snapshot(process.cwd());
  let nested = false; let caught: any;
  try {
    __setArtifactTestHooks(swapAt({ operation: 'traversal', phase: 'afterParentPinned', path: base }, () => { nested = true; try { writePrivateFile(path.join(base, 'other'), 'x'); } catch (e) { caught = e; } }));
    writePrivateFile(file, 'ok');
    reset();
    assert.ok(nested);
    assert.match(String(caught?.message), /nested private artifact cwd transaction/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'ok');
    assert.deepEqual(snapshot(process.cwd()), cwdBefore);
  } finally { cleanup(base); }
});

// ===========================================================================
// F-X5 — Pathname restoration cannot accept a replacement cwd
// ===========================================================================
test('F-X5 cwd restoration hard-fails when the original working directory is swapped', async () => {
  const disposable = tmpDir('fx5-cwd'); const held = `${disposable}.held`; const childRoot = tmpDir('fx5-root');
  try {
    const expected = { operation: 'final-file', phase: 'beforeRename', path: finalHookPath(childRoot, 'rec'), component: 'rec' };
    const program = `process.chdir(process.env.DISPOSABLE); const a = await import(process.env.ARTIFACT_MODULE); let ok=false; try{ a.writePrivateFile(a.CAPTURE_ROOT + '/rec', 'x'); ok=true; }catch(e){} process.exit(ok?0:7);`;
    const g = await gatedChild(path.resolve(childRoot), expected, program, 'fx5', { DISPOSABLE: disposable });
    fs.renameSync(disposable, held); fs.mkdirSync(disposable);
    g.release();
    const result = await g.done;
    assert.notEqual(result.code, 0, 'the child must never report success after cwd restoration is subverted');
    assert.notEqual(result.code, 7 - 7, ''); // documentation guard: 0 is the only success code and is excluded above
  } finally {
    fs.rmSync(disposable, { recursive: true, force: true });
    fs.rmSync(held, { recursive: true, force: true });
    fs.rmSync(childRoot, { recursive: true, force: true });
  }
});

// ===========================================================================
// F-K1 — Convenience and lexical compatibility remains
// ===========================================================================
test('F-K1 convenience wrappers, missing-tree no-op, and lexical refusals are preserved', () => {
  const base = privateBase('fk1');
  try {
    writeJsonPrivate(path.join(base, 'meta.json'), { id: 'x', settled: true });
    writeNdjsonPrivate(path.join(base, 'rows.ndjson'), [{ n: 1 }, { n: 2 }]);
    appendNdjsonPrivate(path.join(base, 'rows.ndjson'), { n: 3 });
    appendNdjsonPrivate(path.join(base, 'fresh.ndjson'), { first: true });
    writeBinaryPrivate(path.join(base, 'blob'), Buffer.from([0, 1, 255]));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(base, 'meta.json'), 'utf8')), { id: 'x', settled: true });
    assert.equal(fs.readFileSync(path.join(base, 'rows.ndjson'), 'utf8'), '{"n":1}\n{"n":2}\n{"n":3}\n');
    assert.equal(fs.readFileSync(path.join(base, 'fresh.ndjson'), 'utf8'), '{"first":true}\n');
    assert.deepEqual(fs.readFileSync(path.join(base, 'blob')), Buffer.from([0, 1, 255]));
    for (const name of fs.readdirSync(base)) assert.equal(lmode(path.join(base, name)), FILE_MODE);

    // removeArtifactTree(missing) is a no-op.
    assert.doesNotThrow(() => removeArtifactTree(path.join(base, 'missing')));

    // Capture root and lexical-outside paths are refused.
    assert.throws(() => removeArtifactTree(CAPTURE_ROOT), /escapes capture root/);
    assert.throws(() => assertUnderCaptureRoot(path.join(CAPTURE_ROOT, '..', 'escape')), /escapes capture root/);
    const external = tmpDir('fk1-external');
    try { assert.throws(() => removeArtifactTree(external), /escapes capture root/); } finally { fs.rmSync(external, { recursive: true, force: true }); }

    // Nested private directory modes.
    const nested = path.join(base, 'a', 'b', 'c'); ensurePrivateDir(nested);
    for (const dir of [path.join(base, 'a'), path.join(base, 'a', 'b'), nested]) assert.equal(mode(dir), DIR_MODE);
  } finally { cleanup(base); }
});
