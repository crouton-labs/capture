/**
 * U10 — tab branch (`list`, `open`, `reset`, `network`).
 *
 * Two layers, matching the repo's established patterns:
 *  - pure result-builder tests (renderResult over the exported builders)
 *    prove the block shapes and that page/endpoint-derived strings are
 *    escaped (I-9) and per-endpoint failures surface as facts (I-5);
 *  - bin-level tests against the built `bin/capture` prove routing, the
 *    unreachable-endpoint fact end-to-end, structured argument errors, and
 *    example-free leaf help.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { renderResult } from '../src/output/render.js';
import { buildTabsResult } from '../src/cdp/commands/tab/list.js';
import { buildTabOpenedResult } from '../src/cdp/commands/tab/open.js';
import { buildTabResetResult } from '../src/cdp/commands/tab/reset.js';
import { buildNetworkResult } from '../src/cdp/commands/tab/network.js';
import { closeTarget, listTargets } from '../src/cdp/targets.js';
import { liveChromeOpts } from './fixtures/live-chrome.js';
import { spawnHeadlessChrome } from './fixtures/chrome.js';

const BIN = fileURLToPath(new URL('../bin/capture', import.meta.url));

const HOSTILE_TITLE = '</tabs><script>alert(1)</script>';
const HOSTILE_URL = 'https://evil.test/<img src=x onerror=alert(1)>';

// ---------------------------------------------------------------------------
// tab list — <tabs> builder
// ---------------------------------------------------------------------------

test('tab list: page-derived titles/URLs/app names render escaped, never as live markup', () => {
  const out = renderResult(
    buildTabsResult(
      [
        {
          port: 9222,
          app: '<b>Chrome</b>',
          preferred: true,
          pages: [{ id: 'ABCD1234EF567890', title: HOSTILE_TITLE, url: HOSTILE_URL }],
        },
      ],
      [],
    ),
  );
  assert.ok(out.startsWith('<tabs '), out);
  assert.ok(!out.includes('<script>'), out);
  assert.ok(!out.includes('</tabs><script'), out);
  assert.ok(out.includes('&lt;script'), out);
  assert.ok(out.includes('&lt;img src=x onerror=alert(1)'), out);
  assert.ok(out.includes('&lt;b'), out);
  // Selection discriminators survive: the 8-char target id prefix and port.
  assert.ok(out.includes('ABCD1234'), out);
  assert.ok(!out.includes('ABCD1234EF567890'), 'full id should not appear in a row, only the prefix');
  assert.ok(out.includes('port 9222'), out);
  assert.ok(out.includes('[preferred]'), out);
  assert.ok(out.includes('endpoints="1"'), out);
  assert.ok(out.includes('tabs="1"'), out);
});

test('tab list: a failed endpoint is an endpoints-unreachable fact carrying port and reason (I-5), not a silent omission', () => {
  const out = renderResult(
    buildTabsResult(
      [{ port: 9222, app: 'Chrome', preferred: true, pages: [] }],
      [{ port: 61023, app: 'Slack', reason: 'fetch failed: connect ECONNREFUSED 127.0.0.1:61023' }],
    ),
  );
  assert.ok(out.includes('endpoints-unreachable: port 61023'), out);
  assert.ok(out.includes('ECONNREFUSED'), out);
  assert.ok(out.includes('(Slack)'), out);
  assert.ok(out.includes('unreachable="1"'), out);
  assert.ok(out.includes('1 endpoint(s) unreachable'), out);
});

test('tab list: zero endpoints is a completed measurement, not an error shape', () => {
  const out = renderResult(buildTabsResult([], []));
  assert.ok(out.startsWith('<tabs '), out);
  assert.ok(out.includes('endpoints="0"'), out);
  assert.ok(out.includes('0 CDP endpoints found listening on localhost.'), out);
  assert.ok(!out.includes('<error'), out);
});

// ---------------------------------------------------------------------------
// tab open / tab reset / tab network — block builders
// ---------------------------------------------------------------------------

test('tab open: emits a <tab-opened> block with port/target attrs, escaped title, and a single follow_up', () => {
  const out = renderResult(
    buildTabOpenedResult(
      { id: 'FEED0123456789AB', title: HOSTILE_TITLE, url: 'https://app.test/', type: 'page' },
      9222,
    ),
  );
  assert.ok(out.startsWith('<tab-opened '), out);
  assert.ok(out.includes('port="9222"'), out);
  assert.ok(out.includes('target="FEED0123456789AB"'), out);
  assert.ok(out.includes('&lt;script'), out);
  assert.ok(!out.includes('<script>'), out);
  const followUps = out.match(/follow_up:/g) ?? [];
  assert.equal(followUps.length, 1, out);
  assert.ok(out.includes('follow_up: capture page shot --port 9222 --target FEED0123'), out);
});

test('tab reset: emits a <tab-reset> block and states the session-target outcome as a fact both ways', () => {
  const tab = { id: 'CAFE0123456789AB', title: '', url: HOSTILE_URL, type: 'page' };
  const updated = renderResult(buildTabResetResult(tab, 9333, true));
  assert.ok(updated.startsWith('<tab-reset '), updated);
  assert.ok(updated.includes('port="9333"'), updated);
  assert.ok(updated.includes('target="CAFE0123456789AB"'), updated);
  assert.ok(updated.includes('&lt;img'), updated);
  assert.ok(updated.includes('active session target updated'), updated);

  const noSession = renderResult(buildTabResetResult(tab, 9333, false));
  assert.ok(noSession.includes('no active session; no session target to update.'), noSession);
});

test('tab network: <network mode=…> blocks; offline names the restore call as follow_up, online has none', () => {
  const offline = renderResult(buildNetworkResult('offline'));
  assert.ok(offline.startsWith('<network '), offline);
  assert.ok(offline.includes('mode="offline"'), offline);
  assert.ok(offline.includes('follow_up: capture tab network online'), offline);

  const online = renderResult(buildNetworkResult('online'));
  assert.ok(online.includes('mode="online"'), online);
  assert.ok(!online.includes('follow_up:'), online);
});

// ---------------------------------------------------------------------------
// bin-level: routing, unreachable fact end-to-end, structured errors, help
// ---------------------------------------------------------------------------

function run(args: string[], tempRoot: string) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CAPTURE_ROOT: path.join(tempRoot, 'capture-sessions'),
      TMPDIR: tempRoot,
      TMP: tempRoot,
      TEMP: tempRoot,
      CDP_PORT: '',
      CDP_TARGET: '',
    },
  });
}

function withTempRoot(fn: (tempRoot: string) => void): void {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'capture-tab-branch-'));
  try {
    fn(tempRoot);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function runAsync(args: string[], tempRoot: string, timeoutMs: number): Promise<{ status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; elapsedMs: number }> {
  const startedAt = Date.now();
  const child = spawn(process.execPath, [BIN, ...args], {
    env: {
      ...process.env,
      CAPTURE_ROOT: path.join(tempRoot, 'capture-sessions'),
      TMPDIR: tempRoot,
      TMP: tempRoot,
      TEMP: tempRoot,
      CDP_PORT: '',
      CDP_TARGET: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr, elapsedMs: Date.now() - startedAt });
    });
  });
}

/** A localhost port that was just free — closed again before use, so a
 * connection to it refuses. */
async function closedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

test('live bin: `tab open about:blank --new` exits promptly, reports one tab, and does not leak its target', { ...liveChromeOpts, timeout: 15_000 }, async () => {
  const fixture = await spawnHeadlessChrome();
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'capture-tab-open-live-'));
  const before = await listTargets(fixture.port);
  const beforeIds = new Set(before.map((target) => target.id));
  try {
    const result = await runAsync(['tab', 'open', 'about:blank', '--new', '--port', String(fixture.port)], tempRoot, 3_000);
    assert.equal(result.status, 0, `capture exited with status ${String(result.status)} signal ${String(result.signal)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.equal(result.signal, null, result.stderr);
    assert.ok(result.elapsedMs < 3_000, `capture did not exit promptly: ${result.elapsedMs}ms`);
    assert.equal((result.stdout.match(/<tab-opened\b/g) ?? []).length, 1, result.stdout);

    const after = await listTargets(fixture.port);
    const created = after.filter((target) => !beforeIds.has(target.id));
    assert.equal(created.length, 1, `expected one created target, got ${created.map((target) => target.id).join(', ')}`);
    const outputTarget = /<tab-opened\b[^>]*\btarget="([^"]+)"/.exec(result.stdout)?.[1];
    assert.equal(outputTarget, created[0]!.id, result.stdout);
  } finally {
    const current = await listTargets(fixture.port);
    const created = current.filter((target) => !beforeIds.has(target.id));
    await Promise.all(created.map((target) => closeTarget(fixture.port, target.id)));
    assert.deepEqual((await listTargets(fixture.port)).filter((target) => !beforeIds.has(target.id)), []);
    rmSync(tempRoot, { recursive: true, force: true });
    await fixture.close();
  }
});

test('bin: `tab list --port <unreachable>` exits 0 with an endpoints-unreachable fact in the <tabs> block', async () => {
  const port = await closedPort();
  withTempRoot((tempRoot) => {
    const result = run(['tab', 'list', '--port', String(port)], tempRoot);
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(result.stdout.includes('<tabs '), result.stdout);
    assert.ok(result.stdout.includes(`endpoints-unreachable: port ${port}`), result.stdout);
    assert.ok(result.stdout.includes('unreachable="1"'), result.stdout);
    // The private artifact substrate ensures its (empty) capture root while
    // resolving the active-session index; tab list must create nothing else —
    // no session directory, pointer, or artifact.
    const entries = readdirSync(tempRoot).filter((name) => name !== 'capture-sessions');
    assert.deepEqual(entries, [], 'tab list must create no artifacts');
    const rootDir = path.join(tempRoot, 'capture-sessions');
    if (readdirSync(tempRoot).includes('capture-sessions')) {
      assert.deepEqual(readdirSync(rootDir), [], 'tab list must leave the capture root empty');
    }
  });
});

// Cardinality (U16): missing/surplus positionals are rejected by the pure
// invocation validator as one <error code="invalid_input"> before any effect.
test('bin: `tab open` with no URL is a structured <error code="invalid_input">, exit 1', () => {
  withTempRoot((tempRoot) => {
    const result = run(['tab', 'open'], tempRoot);
    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes('<error code="invalid_input"'), result.stdout);
    assert.ok(result.stdout.includes('tab open received 0 positional argument(s); expected exactly 1'), result.stdout);
  });
});

test('bin: `tab reset` with no URL is a structured <error code="invalid_input">, exit 1', () => {
  withTempRoot((tempRoot) => {
    const result = run(['tab', 'reset'], tempRoot);
    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes('<error code="invalid_input"'), result.stdout);
    assert.ok(result.stdout.includes('tab reset received 0 positional argument(s); expected exactly 1'), result.stdout);
  });
});

test('bin: `tab network bogus` is a structured <error> naming the accepted values, exit 1', () => {
  withTempRoot((tempRoot) => {
    const result = run(['tab', 'network', 'bogus'], tempRoot);
    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes('<error code="invalid_input"'), result.stdout);
    assert.ok(result.stdout.includes('offline or online'), result.stdout);
  });
});

test('bin: each tab leaf -h is the D6 leaf shape — summary/input/output/effects, no examples, no "Next:" coaching', () => {
  withTempRoot((tempRoot) => {
    for (const leaf of ['list', 'open', 'reset', 'network']) {
      const result = run(['tab', leaf, '-h'], tempRoot);
      assert.equal(result.status, 0, `tab ${leaf} -h: ${result.stderr}`);
      assert.equal(result.stderr, '', `tab ${leaf} -h must not write to stderr`);
      assert.ok(result.stdout.startsWith(`capture tab ${leaf} — `), result.stdout);
      for (const section of ['input:', 'output:', 'effects:']) {
        assert.ok(result.stdout.includes(section), `tab ${leaf} -h missing "${section}"`);
      }
      assert.ok(!result.stdout.includes('Example'), `tab ${leaf} -h must be example-free`);
      assert.ok(!result.stdout.includes('Next:'), `tab ${leaf} -h must not coach`);
    }
  });
});
