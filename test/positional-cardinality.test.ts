/**
 * U16 — exact page/tab/CDP positional cardinality before effects.
 *
 * Two layers:
 *  - real-entrypoint probes (a temporary source bundle, never the frozen
 *    bin/capture) prove every surplus/missing-positional invocation emits
 *    exactly one structured <error code="invalid_input"> (prose and --json),
 *    exits 1, and produces ZERO effects: a live sentinel CDP endpoint sees no
 *    connection, a malformed CDP_PORT is never consulted (rejection precedes
 *    env resolution), a seeded stale active-session pointer stays
 *    byte-identical (no stale-index cleanup), and no session artifacts are
 *    created under an isolated CAPTURE_ROOT;
 *  - in-process checks prove the two-stage parse itself (validateCliInvocation
 *    over parseCliSyntax) enforces the exact cardinalities, that wait-only raw
 *    CDP (`cdp --wait-event <ev>`) remains accepted, and that the touched
 *    leaves' direct-call guards throw typed CaptureErrors instead of
 *    rendering/exiting locally (A4).
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, test } from 'node:test';

import { parseCliSyntax, validateCliInvocation } from '../src/cdp/args.js';
import { CaptureError } from '../src/errors.js';
import { cmdCdp } from '../src/cdp/commands/cdp.js';
import { cmdPageElements } from '../src/cdp/commands/page/elements.js';
import { cmdPageNavigate } from '../src/cdp/commands/page/navigate.js';
import { cmdTabOpen } from '../src/cdp/commands/tab/open.js';
import { type ParsedArgs } from '../src/cdp/types.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-cardinality-'));
const entry = path.join(tempDir, 'capture.cjs');

// Executes the current TypeScript source, never the frozen bin/capture.
execFileSync(path.join(process.cwd(), 'node_modules/.bin/esbuild'), [
  'src/capture.ts', '--bundle', '--platform=node', '--format=cjs', `--outfile=${entry}`,
], { stdio: 'pipe' });

after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

/** A localhost TCP listener that counts connections — the "zero opens/sends"
 * sentinel: a cardinality-rejected command must never dial it. */
function withConnectionSpy<T>(fn: (port: number, count: () => number) => T): T {
  let connections = 0;
  const server = net.createServer((socket) => { connections++; socket.destroy(); });
  return new Promise<T>((resolve, reject) => {
    server.listen(0, '127.0.0.1', async () => {
      const { port } = server.address() as net.AddressInfo;
      try {
        resolve(await fn(port, () => connections));
      } catch (err) {
        reject(err);
      } finally {
        server.close();
      }
    });
  }) as T;
}

interface ProbeResult {
  status: number | null;
  stdout: string;
  stderr: string;
  stalePreserved: boolean;
  rootEntries: string[];
}

/** Runs the source entrypoint with a seeded stale active pointer, a malformed
 * CDP_PORT sentinel, and an isolated CAPTURE_ROOT. */
function probe(args: string[], envOverrides: NodeJS.ProcessEnv = {}): ProbeResult {
  const nodeId = `cardinality-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-cardinality-root-'));
  const active = path.join(root, `.active-${nodeId}`);
  const stale = '{"sessionId":"stale","dir":"/does/not/exist"}\n';
  fs.writeFileSync(active, stale);
  try {
    const result = spawnSync(process.execPath, [entry, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CRTR_NODE_ID: nodeId,
        CAPTURE_ROOT: root,
        CDP_PORT: '9222junk', // consulted only AFTER validation — must never surface
        CDP_TARGET: 'stale-env-target',
        ...envOverrides,
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
  assert.match(result.stdout, /^<error code="invalid_input"[\s\S]*<\/error>\n$/, `${label}: one invalid_input block`);
  assert.equal((result.stdout.match(/<error\b/g) ?? []).length, 1, `${label}: exactly one error block`);
  assert.ok(result.stdout.includes(expectedFragment), `${label}: names the cardinality: ${result.stdout}`);
  assert.ok(!result.stdout.includes('CDP_PORT'), `${label}: env resolution never ran`);
  assert.ok(result.stalePreserved, `${label}: stale active pointer untouched (no cleanup/resolution)`);
  assert.deepEqual(result.rootEntries, [], `${label}: no session artifacts created`);
}

test('every surplus/missing page/tab positional is one invalid_input before any effect (prose)', () => {
  assertRejectedBeforeEffects(['page', 'elements', 'surplus'], 'page elements received 1 positional argument(s); expected exactly 0');
  assertRejectedBeforeEffects(['tab', 'list', 'surplus'], 'tab list received 1 positional argument(s); expected exactly 0');
  assertRejectedBeforeEffects(['page', 'navigate'], 'page navigate received 0 positional argument(s); expected exactly 1');
  assertRejectedBeforeEffects(['page', 'navigate', 'https://a.example/', 'https://b.example/'], 'page navigate received 2 positional argument(s); expected exactly 1');
  assertRejectedBeforeEffects(['tab', 'open'], 'tab open received 0 positional argument(s); expected exactly 1');
  assertRejectedBeforeEffects(['tab', 'open', 'https://a.example/', 'https://b.example/'], 'tab open received 2 positional argument(s); expected exactly 1');
  assertRejectedBeforeEffects(['tab', 'reset'], 'tab reset received 0 positional argument(s); expected exactly 1');
  assertRejectedBeforeEffects(['tab', 'reset', 'https://a.example/', 'extra'], 'tab reset received 2 positional argument(s); expected exactly 1');
  assertRejectedBeforeEffects(['tab', 'network'], 'tab network received 0 positional argument(s); expected exactly 1');
  assertRejectedBeforeEffects(['tab', 'network', 'offline', 'online'], 'tab network received 2 positional argument(s); expected exactly 1');
});

test('cdp cardinality: two positionals and zero-without---wait-event are invalid_input; wait-only passes the gate', () => {
  assertRejectedBeforeEffects(['cdp', 'Browser.getVersion', 'Page.enable'], 'cdp received 2 positional argument(s); expected 0..1');
  assertRejectedBeforeEffects(['cdp'], 'cdp requires a method or --wait-event');

  // Wait-only raw CDP remains a valid invocation shape: the two-stage parse
  // accepts it (its later failure, if any, is a world/connection error).
  const parsed = parseCliSyntax(['cdp', '--wait-event', 'Page.loadEventFired']);
  validateCliInvocation(parsed);
  const single = parseCliSyntax(['cdp', 'Browser.getVersion']);
  validateCliInvocation(single);
});

test('--json mirrors the same single invalid_input error object', () => {
  const result = probe(['tab', 'open', 'a', 'b', '--json']);
  assert.equal(result.status, 1);
  const parsed = JSON.parse(result.stdout) as { tag: string; attrs: { code: string } };
  assert.equal(parsed.tag, 'error');
  assert.equal(parsed.attrs.code, 'invalid_input');
  assert.ok(result.stalePreserved);
  assert.deepEqual(result.rootEntries, []);
});

test('a cardinality-rejected invocation never dials an explicitly flagged endpoint', async () => {
  await withConnectionSpy(async (port, count) => {
    const openResult = probe(['tab', 'open', 'https://a.example/', 'surplus', '--port', String(port)]);
    assert.equal(openResult.status, 1);
    assert.match(openResult.stdout, /invalid_input/);
    const navResult = probe(['page', 'navigate', '--port', String(port)]);
    assert.equal(navResult.status, 1);
    assert.match(navResult.stdout, /invalid_input/);
    const elementsResult = probe(['page', 'elements', 'surplus', '--port', String(port)]);
    assert.equal(elementsResult.status, 1);
    assert.match(elementsResult.stdout, /invalid_input/);
    // Give any stray async dial a beat to land before asserting zero.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(count(), 0, 'no CDP connection may be opened for a rejected invocation');
  });
});

// ---------------------------------------------------------------------------
// A4 direct-call guards: the touched leaves throw typed CaptureErrors and
// never render or exit locally.
// ---------------------------------------------------------------------------

function leafArgs(command: string, overrides: Partial<ParsedArgs> = {}): ParsedArgs {
  return { command, positional: [], ...overrides } as ParsedArgs;
}

async function assertTypedRejection(run: () => Promise<void>, code: string): Promise<void> {
  await assert.rejects(run, (error: unknown) => {
    assert.ok(error instanceof CaptureError, `expected CaptureError, got ${String(error)}`);
    assert.equal(error.descriptor.code, code);
    assert.equal(error.descriptor.kind, 'invocation');
    return true;
  });
}

test('touched leaves throw typed invocation errors on direct-call misuse instead of rendering/exiting', async () => {
  await assertTypedRejection(() => cmdCdp(leafArgs('cdp'), []), 'missing_method_and_event');
  await assertTypedRejection(
    () => cmdCdp(leafArgs('cdp', { positional: ['Browser.getVersion'], params: '{not-json' }), []),
    'invalid_params_json',
  );
  await assertTypedRejection(() => cmdPageNavigate(leafArgs('page', { positional: [] }), []), 'missing_url');
  await assertTypedRejection(() => cmdTabOpen(leafArgs('tab', { positional: [] }), []), 'missing_argument');
  await assertTypedRejection(
    () => cmdPageElements(leafArgs('page', { limit: 0 as unknown as number }), []),
    'invalid_flag',
  );
});
