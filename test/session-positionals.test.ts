/**
 * U06 — exact session-leaf positional cardinality before effects (m7).
 *
 * Two layers, mirroring test/positional-cardinality.test.ts:
 *  - real-entrypoint probes (a temporary source bundle, never the frozen
 *    bin/capture) prove every surplus session invocation emits exactly one
 *    structured <error code="invalid_input"> (prose and --json), exits 1, and
 *    produces ZERO effects: a seeded stale active pointer stays byte-identical
 *    (never resolved, never cleaned) and no artifacts are created under an
 *    isolated CAPTURE_ROOT;
 *  - direct-call seam: calling sessionMain directly (bypassing the CLI
 *    validator in src/cdp/args.ts) hits the same leaf-boundary wall — surplus
 *    positionals reject with `command="session <leaf>"` before the start
 *    world is touched, before any session lookup (never unknown_session /
 *    log_file_not_found / invalid_filter), and before the scope's active
 *    pointer or lifecycle lock is touched. The exact boundary (start/list=0,
 *    log/stop/view=1, har=0..1) is pinned on both sides: max accepted, max+1
 *    rejected, and the missing side keeps its existing missing_argument code.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ParsedArgs } from '../src/cdp/types.js';

// Process-scope this file's active pointer and lifecycle lock, AND isolate
// the in-process layer under a private CAPTURE_ROOT. Static imports hoist
// above these env assignments under tsx-CJS, so every module that reads
// CAPTURE_ROOT at load time (src/session/artifacts.ts and its importers) is
// imported lazily through `src` below instead.
process.env.CRTR_NODE_ID = `u06-pos-${process.pid}-${Date.now()}`;
const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u06-pos-inproc-'));
process.env.CAPTURE_ROOT = isolatedRoot;

// commands.js and session-context.js transitively load artifacts.ts, which
// resolves CAPTURE_ROOT at module load — they must load only after the
// isolated root is in the environment.
const src = (async () => ({
  ...(await import('../src/session/commands.js')),
  ...(await import('../src/session-context.js')),
}))();

after(() => fs.rmSync(isolatedRoot, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// Layer 1 — real entrypoint probes with an isolated CAPTURE_ROOT
// ---------------------------------------------------------------------------

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'u06-positionals-probe-'));
const probeEntry = path.join(tempDir, 'capture.cjs');

// Executes the current TypeScript source, never the frozen bin/capture.
execFileSync(path.join(process.cwd(), 'node_modules/.bin/esbuild'), [
  'src/capture.ts', '--bundle', '--platform=node', '--format=cjs', `--outfile=${probeEntry}`,
], { stdio: 'pipe' });

after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

interface ProbeResult {
  status: number | null;
  stdout: string;
  stderr: string;
  stalePreserved: boolean;
  rootEntries: string[];
}

/** Runs the source entrypoint with a seeded stale active pointer and an
 * isolated CAPTURE_ROOT; a rejected invocation must leave both untouched. */
function probe(args: string[]): ProbeResult {
  const nodeId = `u06-pos-probe-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'u06-positionals-root-'));
  const active = path.join(root, `.active-${nodeId}`);
  const stale = '{"sessionId":"stale","dir":"/does/not/exist"}\n';
  fs.writeFileSync(active, stale, { mode: 0o600 });
  try {
    const result = spawnSync(process.execPath, [probeEntry, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CRTR_NODE_ID: nodeId,
        CAPTURE_ROOT: root,
        CDP_PORT: '9222junk', // consulted only AFTER validation — must never surface
      },
    });
    const stalePreserved = fs.existsSync(active) && fs.readFileSync(active, 'utf8') === stale;
    const rootEntries = fs.readdirSync(root).filter((name) => name !== `.active-${nodeId}`);
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, stalePreserved, rootEntries };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function assertRejectedBeforeEffects(args: string[], expectedFragment: string): void {
  const label = args.join(' ');
  const result = probe(args);
  assert.equal(result.status, 1, `${label}: exit 1`);
  assert.equal(result.stderr, '', `${label}: diagnostics-free stderr`);
  assert.match(result.stdout, /^<error [^>]*code="invalid_input"[\s\S]*<\/error>\n$/, `${label}: one invalid_input block: ${result.stdout}`);
  assert.equal((result.stdout.match(/<error\b/g) ?? []).length, 1, `${label}: exactly one error block`);
  assert.ok(result.stdout.includes(expectedFragment), `${label}: names the cardinality: ${result.stdout}`);
  assert.ok(!result.stdout.includes('CDP_PORT'), `${label}: env resolution never ran`);
  assert.ok(result.stalePreserved, `${label}: stale active pointer byte-identical (never resolved, never cleaned)`);
  assert.deepEqual(result.rootEntries, [], `${label}: no session artifacts created`);
}

test('every surplus session positional is one invalid_input before any effect (prose)', () => {
  assertRejectedBeforeEffects(['session', 'start', 'surplus'], 'session start received 1 positional argument(s); expected exactly 0');
  assertRejectedBeforeEffects(['session', 'list', 'surplus'], 'session list received 1 positional argument(s); expected exactly 0');
  assertRejectedBeforeEffects(['session', 'log', '/tmp/a.log', 'surplus'], 'session log received 2 positional argument(s); expected exactly 1');
  assertRejectedBeforeEffects(['session', 'har', 'some-id', 'surplus'], 'session har received 2 positional argument(s); expected 0..1');
  assertRejectedBeforeEffects(['session', 'stop', 'some-id', 'surplus'], 'session stop received 2 positional argument(s); expected exactly 1');
  assertRejectedBeforeEffects(['session', 'view', 'some-id', 'surplus'], 'session view received 2 positional argument(s); expected exactly 1');
});

test('--json mirrors the same single invalid_input error object with zero effects', () => {
  for (const args of [
    ['session', 'start', 'surplus', '--json'],
    ['session', 'har', 'some-id', 'surplus', '--json'],
    ['session', 'stop', 'some-id', 'surplus', '--json'],
  ]) {
    const result = probe(args);
    assert.equal(result.status, 1, args.join(' '));
    const parsed = JSON.parse(result.stdout) as { tag: string; attrs: { code: string } };
    assert.equal(parsed.tag, 'error', args.join(' '));
    assert.equal(parsed.attrs.code, 'invalid_input', args.join(' '));
    assert.ok(result.stalePreserved, `${args.join(' ')}: stale pointer untouched`);
    assert.deepEqual(result.rootEntries, [], `${args.join(' ')}: no artifacts created`);
  }
});

// ---------------------------------------------------------------------------
// Layer 2 — the direct-call seam (bypasses src/cdp/args.ts validation)
// ---------------------------------------------------------------------------

function sessionArgs(positional: string[], extra: Partial<ParsedArgs> = {}): ParsedArgs {
  return { command: 'session', positional, json: false, ...extra } as ParsedArgs;
}

async function runSession(positional: string[], extra: Partial<ParsedArgs> = {}): Promise<string> {
  // Capture the command's string output, but forward every Buffer write: under
  // `node --test`, the child reports test events as V8-serialized Buffers on
  // fd 1, and swallowing those starves the parent of other tests' events.
  const logs: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (typeof chunk === 'string') {
      logs.push(chunk);
      const cb = rest.find((a) => typeof a === 'function') as ((err?: Error) => void) | undefined;
      if (cb) cb();
      return true;
    }
    return (originalWrite as (c: unknown, ...r: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  try {
    await (await src).sessionMain(sessionArgs(positional, extra), []);
  } finally {
    process.stdout.write = originalWrite;
  }
  return logs.join('');
}

const activePointerPath = async (): Promise<string> => path.join(isolatedRoot, `.active-${(await src).activeSessionScopeKey()}`);
const lifecycleLockPath = async (): Promise<string> => path.join(isolatedRoot, `.session-lifecycle-${(await src).activeSessionScopeKey()}`);

/** Seeds this scope's active pointer with known bytes; returns a byte-identity check. */
async function seedScopedStalePointer(): Promise<{ bytes: string; intact: () => boolean; remove: () => void }> {
  const pointer = await activePointerPath();
  const bytes = `{"sessionId":"stale-${process.pid}","dir":"/does/not/exist"}\n`;
  fs.writeFileSync(pointer, bytes, { mode: 0o600 });
  return {
    bytes,
    intact: () => fs.existsSync(pointer) && fs.readFileSync(pointer, 'utf8') === bytes,
    remove: () => fs.rmSync(pointer, { force: true }),
  };
}

test('direct-call surplus positionals reject at the leaf boundary before any effect', async (t) => {
  const m = await src;
  const lockPath = await lifecycleLockPath();
  // Any world call from a rejected `start` is an effect leak.
  const worldCalls: string[] = [];
  const record = (name: string) => () => { worldCalls.push(name); throw new Error(`world.${name} must not run`); };
  m.__setSessionStartWorld({
    createHar: record('createHar') as never,
    detectCdpPort: record('detectCdpPort') as never,
    openTab: record('openTab') as never,
    startBridge: record('startBridge') as never,
    publishActiveSession: record('publishActiveSession') as never,
  });
  t.after(() => m.__setSessionStartWorld());

  const stale = await seedScopedStalePointer();
  t.after(() => stale.remove());

  const cases: Array<{ positional: string[]; leaf: string; mustNotInclude: string[] }> = [
    { positional: ['start', 'surplus'], leaf: 'start', mustNotInclude: ['start_failed'] },
    { positional: ['start', 'a', 'b'], leaf: 'start', mustNotInclude: ['start_failed'] },
    { positional: ['list', 'surplus'], leaf: 'list', mustNotInclude: ['<sessions'] },
    // Cardinality precedes the source-existence check: never log_file_not_found.
    { positional: ['log', '/u06/does-not-exist.log', 'surplus'], leaf: 'log', mustNotInclude: ['log_file_not_found', 'no_active_session'] },
    // Cardinality precedes session lookup: never unknown_session.
    { positional: ['har', 'some-id', 'surplus'], leaf: 'har', mustNotInclude: ['unknown_session'] },
    { positional: ['stop', 'some-id', 'surplus'], leaf: 'stop', mustNotInclude: ['unknown_session'] },
    { positional: ['view', 'some-id', 'surplus'], leaf: 'view', mustNotInclude: ['unknown_session'] },
  ];

  for (const { positional, leaf, mustNotInclude } of cases) {
    const label = positional.join(' ');
    const out = await runSession(positional);
    assert.ok(out.includes('code="invalid_input"'), `${label}: ${out}`);
    assert.ok(out.includes(`command="session ${leaf}"`), `${label}: ${out}`);
    for (const forbidden of mustNotInclude) assert.ok(!out.includes(forbidden), `${label}: rejected before effects, got ${forbidden}: ${out}`);
    assert.equal(process.exitCode, 1, label);
    process.exitCode = 0;
    assert.ok(stale.intact(), `${label}: scoped active pointer byte-identical`);
    assert.ok(!fs.existsSync(lockPath), `${label}: lifecycle lock never taken`);

    // --json mirrors the same rejection.
    const json = await runSession(positional, { json: true });
    const parsed = JSON.parse(json) as { tag: string; attrs: { command: string; code: string } };
    assert.equal(parsed.tag, 'error', label);
    assert.equal(parsed.attrs.code, 'invalid_input', label);
    assert.equal(parsed.attrs.command, `session ${leaf}`, label);
    assert.equal(process.exitCode, 1, label);
    process.exitCode = 0;
    assert.ok(stale.intact(), `${label} (json): scoped active pointer byte-identical`);
  }

  assert.deepEqual(worldCalls, [], 'a rejected session start must never touch the start world');
});

test('cardinality precedes leaf-local filter grammar on session har', async () => {
  const stale = await seedScopedStalePointer();
  try {
    const out = await runSession(['har', 'a', 'b'], { filterStatus: '40' });
    assert.ok(out.includes('code="invalid_input"'), out);
    assert.ok(!out.includes('invalid_filter'), out);
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
    assert.ok(stale.intact(), 'active pointer untouched');
  } finally {
    stale.remove();
  }
});

test('the exact boundary is accepted: max positionals proceed past the cardinality wall', async () => {
  (await src).clearActiveSession();

  // stop/view/har with exactly one (unknown) id reach the session lookup.
  for (const leaf of ['stop', 'view', 'har'] as const) {
    const out = await runSession([leaf, 'u06-no-such-session']);
    assert.ok(out.includes('code="unknown_session"'), `${leaf}: ${out}`);
    assert.equal(process.exitCode, 1, leaf);
    process.exitCode = 0;
  }

  // log with exactly one (missing) path reaches the source-existence check.
  const logOut = await runSession(['log', '/u06/does-not-exist.log']);
  assert.ok(logOut.includes('code="log_file_not_found"'), logOut);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;

  // list with zero positionals renders the sessions block. Probed against an
  // isolated CAPTURE_ROOT: the ambient root may hold legacy-schema session
  // dirs that break list rendering (a pre-existing defect outside U06).
  const listResult = probe(['session', 'list']);
  assert.equal(listResult.status, 0, `list must succeed: ${listResult.stdout}`);
  assert.ok(listResult.stdout.includes('<sessions'), listResult.stdout);
});

test('the missing side keeps its existing missing_argument code', async () => {
  for (const leaf of ['stop', 'view', 'log'] as const) {
    const out = await runSession([leaf]);
    assert.ok(out.includes('code="missing_argument"'), `${leaf}: ${out}`);
    assert.equal(process.exitCode, 1, leaf);
    process.exitCode = 0;
  }
});
