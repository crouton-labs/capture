/**
 * U06 — strict `session har --filter-status` grammar (M9/A4).
 *
 * Three layers:
 *  - the pure parser: a valid boundary table (exact 100..599, one-digit class
 *    prefixes 1..5, ordered exact-code ranges) plus an undocumented-token
 *    table (empty/nonsense/partial/extra-hyphen/out-of-range/reversed and —
 *    per A4 — EVERY two-digit prefix including `40`) that must each throw one
 *    typed `invalid_filter` CaptureError;
 *  - in-process command behavior: valid filters select exactly on a live
 *    seeded session, and an invalid filter wins over an unknown session, a
 *    corrupt `.session.json`, and a healthy session alike — proving the parse
 *    runs before any session/HAR lookup, in prose and --json;
 *  - a real-entrypoint probe (temporary source bundle, never the frozen
 *    bin/capture) with a seeded stale active pointer proving the invalid
 *    filter is rejected with the pointer byte-identical (never resolved,
 *    never cleaned) and zero artifacts created under an isolated CAPTURE_ROOT.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { parseStatusFilter } from '../src/session/har-filter.js';
import { CaptureError } from '../src/errors.js';
import type { HAREntry } from '../src/har-manager.js';
import type { ParsedArgs } from '../src/cdp/types.js';

// Process-scope this file's active-session pointer AND isolate the
// in-process layer under a private CAPTURE_ROOT. Static imports hoist above
// these env assignments under tsx-CJS, so every module that reads
// CAPTURE_ROOT at load time (src/session/artifacts.ts and its importers) is
// imported lazily through `src` below. har-filter.js and errors.js never
// read CAPTURE_ROOT, so their static imports are safe.
process.env.CRTR_NODE_ID = `u06-filter-${process.pid}-${Date.now()}`;
const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'u06-filter-inproc-'));
process.env.CAPTURE_ROOT = isolatedRoot;

const src = (async () => ({
  ...(await import('../src/session/commands.js')),
  ...(await import('../src/har-manager.js')),
  ...(await import('../src/session-context.js')),
}))();

after(() => fs.rmSync(isolatedRoot, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// Layer 1 — the pure parser
// ---------------------------------------------------------------------------

test('parseStatusFilter: valid boundary table selects exactly', () => {
  const table: Array<{ spec: string; matches: number[]; rejects: number[] }> = [
    { spec: '100', matches: [100], rejects: [101, 199, 200] },
    { spec: '404', matches: [404], rejects: [403, 405, 500, 40, 4] },
    { spec: '599', matches: [599], rejects: [598, 600, 500] },
    { spec: '1', matches: [100, 150, 199], rejects: [99, 200, 1, 0] },
    { spec: '3', matches: [300, 301, 399], rejects: [299, 400] },
    { spec: '5', matches: [500, 599], rejects: [499, 600] },
    { spec: '100-100', matches: [100], rejects: [101, 99] },
    { spec: '400-499', matches: [400, 451, 499], rejects: [399, 500] },
    { spec: '100-599', matches: [100, 350, 599], rejects: [99, 600] },
    { spec: '404-404', matches: [404], rejects: [403, 405] },
  ];
  for (const { spec, matches, rejects } of table) {
    const predicate = parseStatusFilter(spec);
    for (const status of matches) assert.equal(predicate(status), true, `${spec} must match ${status}`);
    for (const status of rejects) assert.equal(predicate(status), false, `${spec} must not match ${status}`);
  }
});

test('parseStatusFilter: every undocumented token throws one typed invalid_filter', () => {
  const invalid = [
    // empty / whitespace / non-numeric
    '', ' ', '  ', 'abc', 'x', '4x', '*', 'all', 'NaN',
    // whitespace-bearing and signed/decimal/exponent shapes
    ' 404', '404 ', '404\n', '400 - 499', '+404', '-404', '4.0', '1e2',
    // out-of-range exact codes and leading zeros
    '0', '6', '9', '99', '600', '999', '000', '044', '099', '0400', '1000',
    // two-digit prefixes — ALL rejected per A4, including 40
    '10', '40', '44', '59',
    // partial / extra-hyphen / prefix ranges
    '400-', '-499', '400--499', '400-499-', '4-5', '40-49', '4-499', '400-49',
    // out-of-range and reversed ranges
    '600-699', '100-600', '099-199', '000-599', '499-400', '599-100',
  ];
  for (const spec of invalid) {
    assert.throws(
      () => parseStatusFilter(spec),
      (error: unknown) => {
        assert.ok(error instanceof CaptureError, `${JSON.stringify(spec)}: expected CaptureError, got ${String(error)}`);
        assert.equal(error.descriptor.code, 'invalid_filter', JSON.stringify(spec));
        assert.equal(error.descriptor.kind, 'invocation', JSON.stringify(spec));
        return true;
      },
      `token ${JSON.stringify(spec)} must be rejected`,
    );
  }
});

// ---------------------------------------------------------------------------
// Layer 2 — in-process command behavior
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

let FIXTURE_SEED = 0;

function entry(over: { method?: string; url: string; status: number; body?: string }): HAREntry {
  const i = FIXTURE_SEED;
  FIXTURE_SEED += 1;
  const requestWallTime = 1783814400 + i;
  const requestMonotonic = i * 10 + 10;
  const responseMonotonic = requestMonotonic + 12;
  const terminalMonotonic = responseMonotonic + 18;
  const captured = over.body !== undefined;
  const bodyText = over.body ?? '';
  const capturedBytes = Buffer.byteLength(bodyText, 'utf-8');
  return {
    startedDateTime: new Date(requestWallTime * 1000).toISOString(),
    time: (terminalMonotonic - requestMonotonic) * 1000,
    request: {
      method: over.method ?? 'GET',
      url: over.url,
      headers: [{ name: 'accept', value: 'application/json' }],
    },
    response: {
      status: over.status,
      headers: [{ name: 'content-type', value: 'application/json' }],
      content: captured ? { text: bodyText } : {},
    },
    _capture: {
      schemaVersion: 1,
      requestId: `req-${i}`,
      generation: 1,
      clocks: { requestWallTime, requestMonotonic, responseMonotonic, terminalMonotonic },
      terminal: { kind: 'finished', encodedDataLength: capturedBytes },
      response: { state: 'received' },
      body: captured
        ? { state: 'captured', sourceEncoding: 'text', decodedByteLength: capturedBytes, capturedByteLength: capturedBytes, truncated: false }
        : { state: 'fetch_failed', error: 'not captured' },
    },
  };
}

const FIXTURE_ENTRIES: HAREntry[] = [
  entry({ url: 'https://api.example.com/ok', status: 200, body: '{"ok":true}' }),
  entry({ url: 'https://api.example.com/moved', status: 301 }),
  entry({ url: 'https://cdn.example.com/gone', status: 404 }),
  entry({ method: 'POST', url: 'https://api.example.com/boom', status: 500, body: 'boom' }),
];

/** Starts a session (no url — no CDP touched) and seeds its live HAR. */
async function startSeededSession(): Promise<{ id: string; dir: string }> {
  const m = await src;
  process.exitCode = 0;
  await runSession(['start']);
  const active = m.getActiveSession();
  assert.ok(active, 'session should be active after start');
  assert.ok(active!.harId, 'session should carry a live HAR recording id');
  await m.appendToHarRecording(active!.harId!, { entries: FIXTURE_ENTRIES, incompleteLifecycles: [] });
  return { id: active!.sessionId, dir: active!.dir };
}

test('session har: documented filter forms select exactly on a live session', async () => {
  const { id, dir } = await startSeededSession();
  try {
    const exact = await runSession(['har'], { filterStatus: '404' });
    assert.ok(exact.includes('entries="1"') && exact.includes('total="4"'), exact);
    assert.ok(exact.includes('cdn.example.com/gone'), exact);

    const prefix = await runSession(['har'], { filterStatus: '3' });
    assert.ok(prefix.includes('entries="1"'), prefix);
    assert.ok(prefix.includes('api.example.com/moved'), prefix);

    const range = await runSession(['har'], { filterStatus: '300-499' });
    assert.ok(range.includes('entries="2"'), range);

    const fullSpan = await runSession(['har'], { filterStatus: '100-599' });
    assert.ok(fullSpan.includes('entries="4"'), fullSpan);
  } finally {
    await runSession(['stop', id], { json: true });
    fs.rmSync(dir, { recursive: true, force: true });
    (await src).clearActiveSession();
    process.exitCode = 0;
  }
});

test('session har: an invalid filter is rejected on a HEALTHY session — never match-all', async () => {
  const { id, dir } = await startSeededSession();
  try {
    for (const bad of ['40', '', '600', '499-400', 'abc']) {
      const out = await runSession(['har'], { filterStatus: bad });
      assert.ok(out.includes('code="invalid_filter"'), `${JSON.stringify(bad)}: ${out}`);
      assert.ok(!out.includes('<session-har'), `${JSON.stringify(bad)}: no entries may render: ${out}`);
      assert.equal(process.exitCode, 1, JSON.stringify(bad));
      process.exitCode = 0;
    }

    const json = await runSession(['har'], { filterStatus: '40', json: true });
    const parsed = JSON.parse(json) as { tag: string; attrs: { command: string; code: string } };
    assert.equal(parsed.tag, 'error');
    assert.equal(parsed.attrs.code, 'invalid_filter');
    assert.equal(parsed.attrs.command, 'session har');
    assert.equal(process.exitCode, 1);
    process.exitCode = 0;
  } finally {
    await runSession(['stop', id], { json: true });
    fs.rmSync(dir, { recursive: true, force: true });
    (await src).clearActiveSession();
    process.exitCode = 0;
  }
});

test('session har: invalid filter wins over an unknown session and a corrupt artifact', async () => {
  (await src).clearActiveSession();

  // Unknown session id + valid filter → the lookup failure surfaces.
  const missingValid = await runSession(['har', 'u06-no-such-session'], { filterStatus: '404' });
  assert.ok(missingValid.includes('code="unknown_session"'), missingValid);
  process.exitCode = 0;

  // Unknown session id + invalid filter → invalid_filter wins (parse precedes lookup).
  const missingInvalid = await runSession(['har', 'u06-no-such-session'], { filterStatus: '40' });
  assert.ok(missingInvalid.includes('code="invalid_filter"'), missingInvalid);
  assert.ok(!missingInvalid.includes('unknown_session'), missingInvalid);
  process.exitCode = 0;

  // No active session + invalid filter → invalid_filter wins over no_active_session.
  const noActive = await runSession(['har'], { filterStatus: '40' });
  assert.ok(noActive.includes('code="invalid_filter"'), noActive);
  assert.ok(!noActive.includes('no_active_session'), noActive);
  process.exitCode = 0;

  // Corrupt .session.json + invalid filter → invalid_filter wins over the corrupt read.
  const corruptId = `u06-corrupt-${process.pid}`;
  const corruptDir = path.join(isolatedRoot, corruptId);
  fs.mkdirSync(corruptDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(corruptDir, '.session.json'), '{not json', { mode: 0o600 });
  try {
    const corruptValid = await runSession(['har', corruptId], { filterStatus: '404' });
    assert.ok(corruptValid.includes('code="unknown_session"'), corruptValid);
    process.exitCode = 0;

    const corruptInvalid = await runSession(['har', corruptId], { filterStatus: '40' });
    assert.ok(corruptInvalid.includes('code="invalid_filter"'), corruptInvalid);
    assert.ok(!corruptInvalid.includes('unknown_session'), corruptInvalid);
    process.exitCode = 0;
  } finally {
    fs.rmSync(corruptDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Layer 3 — real entrypoint: rejected before the active pointer is resolved
// ---------------------------------------------------------------------------

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'u06-filter-probe-'));
const probeEntry = path.join(tempDir, 'capture.cjs');

// Executes the current TypeScript source, never the frozen bin/capture.
execFileSync(path.join(process.cwd(), 'node_modules/.bin/esbuild'), [
  'src/capture.ts', '--bundle', '--platform=node', '--format=cjs', `--outfile=${probeEntry}`,
], { stdio: 'pipe' });

after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

test('real entrypoint: invalid --filter-status rejects with the stale pointer byte-identical and zero artifacts', () => {
  const nodeId = `u06-filter-probe-${process.pid}`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'u06-filter-root-'));
  const active = path.join(root, `.active-${nodeId}`);
  const stale = '{"sessionId":"stale","dir":"/does/not/exist"}\n';
  fs.writeFileSync(active, stale, { mode: 0o600 });
  try {
    for (const args of [
      ['session', 'har', '--filter-status', '40'],
      ['session', 'har', '--filter-status', ''],
      ['session', 'har', '--filter-status', '499-400'],
    ]) {
      const result = spawnSync(process.execPath, [probeEntry, ...args], {
        encoding: 'utf8',
        env: { ...process.env, CRTR_NODE_ID: nodeId, CAPTURE_ROOT: root },
      });
      const label = args.join(' ');
      assert.equal(result.status, 1, `${label}: exit 1`);
      assert.match(result.stdout, /^<error command="session har" code="invalid_filter"[\s\S]*<\/error>\n$/, `${label}: one invalid_filter block: ${result.stdout}`);
      assert.equal((result.stdout.match(/<error\b/g) ?? []).length, 1, `${label}: exactly one error block`);
      assert.ok(fs.existsSync(active) && fs.readFileSync(active, 'utf8') === stale, `${label}: stale pointer byte-identical (never resolved, never cleaned)`);
      assert.deepEqual(fs.readdirSync(root).filter((name) => name !== `.active-${nodeId}`), [], `${label}: no artifacts created`);
    }

    const json = spawnSync(process.execPath, [probeEntry, 'session', 'har', '--filter-status', '40', '--json'], {
      encoding: 'utf8',
      env: { ...process.env, CRTR_NODE_ID: nodeId, CAPTURE_ROOT: root },
    });
    assert.equal(json.status, 1);
    const parsed = JSON.parse(json.stdout) as { tag: string; attrs: { code: string } };
    assert.equal(parsed.tag, 'error');
    assert.equal(parsed.attrs.code, 'invalid_filter');
    assert.ok(fs.readFileSync(active, 'utf8') === stale, 'json: stale pointer byte-identical');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
