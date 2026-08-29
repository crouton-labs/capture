import { EventEmitter, once } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { CDPClient } from '../src/cdp/client.js';
import { parseCliSyntax, resolveCliContext, validateCliInvocation } from '../src/cdp/args.js';
import { __setSessionStartWorld, sessionMain, waitForPageLoad } from '../src/session/commands.js';
import { getActiveSession, clearActiveSession } from '../src/session-context.js';
import { CAPTURE_ROOT } from '../src/session/artifacts.js';
import type { ParsedArgs } from '../src/cdp/types.js';
import { liveChromeOpts } from './fixtures/live-chrome.js';
import { closeChrome, spawnHeadlessChrome } from './fixtures/chrome.js';

// Process-scope this file's active-session pointer (node's test runner
// process-isolates each test file, so this only scopes THIS file).
process.env.CRTR_NODE_ID = `u04-start-test-${process.pid}-${Date.now()}`;

function sessionArgs(positional: string[], extra: Partial<ParsedArgs> = {}): ParsedArgs {
  return { command: 'session', positional, json: false, ...extra } as ParsedArgs;
}

function captureStdout(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  // TEE rather than swallow: the test reporter flushes its own events to stdout
  // asynchronously and can land inside this window; swallowing them makes node's
  // runner silently lose sibling tests from its stream. Assertions therefore
  // scan the captured buffer (which may also hold stray reporter bytes) with
  // includes()/extraction rather than startsWith()/whole-buffer JSON.parse().
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    logs.push(typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
    return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  return { logs, restore: () => { process.stdout.write = originalWrite; } };
}

/** Extract the single rendered JSON result object from a TEE'd buffer that may
 * also contain reporter bytes. The rendered result is the only `{`-led JSON in
 * a passing run. */
function extractJsonResult(buffer: string): { tag: string; attrs: Record<string, unknown> } {
  const start = buffer.indexOf('{');
  assert.ok(start >= 0, `no JSON result found in: ${buffer}`);
  return JSON.parse(buffer.slice(start)) as { tag: string; attrs: Record<string, unknown> };
}

/** Stop a session, swallowing its rendered block, so a test's own cleanup
 * finalizes the HAR recording the way real usage does. */
async function stopSilently(id: string): Promise<void> {
  const out = captureStdout();
  try {
    await sessionMain(sessionArgs(['stop', id], { json: true }), []);
  } finally {
    out.restore();
  }
}

class FakeLoadClient extends EventEmitter {
  async waitReady(): Promise<void> {}

  async send(): Promise<unknown> {
    return undefined;
  }

  fireLoad(): void {
    this.emit('Page.loadEventFired', {});
  }
}

test('waitForPageLoad returns false when the page load event fires in time', async () => {
  const client = new FakeLoadClient();
  setTimeout(() => client.fireLoad(), 5);

  const timedOut = await waitForPageLoad(client, 50);
  assert.equal(timedOut, false);
});

test('waitForPageLoad returns true when the page load does not fire before the deadline', async () => {
  const client = new FakeLoadClient();

  const timedOut = await waitForPageLoad(client, 10);
  assert.equal(timedOut, true);
});

test('waitForPageLoad bounds a fresh tab Page.enable acknowledgement instead of inheriting CDPClient’s 60-second request timeout', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const client = new CDPClient(`ws://127.0.0.1:${address.port}`);
  const startedAt = Date.now();
  try {
    await assert.rejects(
      () => waitForPageLoad(client, 1_000, 25),
      /CDP request timeout \(25ms\): Page.enable/,
    );
    assert.ok(Date.now() - startedAt < 500, 'Page.enable acknowledgement must fail promptly');
  } finally {
    client.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('session start (no url) emits a <session> block, creates shots/ and NOT a11y/', async () => {
  const out = captureStdout();
  let dir: string | undefined;
  let id: string | undefined;
  try {
    await sessionMain(sessionArgs(['start']), []);
    out.restore();
    const text = out.logs.join('');

    const active = getActiveSession();
    assert.ok(active, 'a session should be active after start');
    id = active!.sessionId;
    dir = active!.dir;

    assert.ok(text.includes('<session '), `expected a rendered <session> block, got: ${text}`);
    assert.ok(!text.includes('"tag": "session"'), 'default output must be rendered prose, not JSON');
    assert.ok(text.includes(id!), text);
    assert.ok(text.includes(dir!), text);
    assert.ok(fs.existsSync(path.join(dir!, 'shots')), 'shots/ must exist');
    assert.ok(!fs.existsSync(path.join(dir!, 'a11y')), 'a11y/ must NOT exist');
  } finally {
    out.restore();
    if (id) await stopSilently(id);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    clearActiveSession();
  }
});

test('session start --port pins its targetless session to the explicit browser endpoint', async () => {
  const out = captureStdout();
  let id: string | undefined;
  let dir: string | undefined;
  try {
    await sessionMain(sessionArgs(['start'], { port: 9444 }), []);
    const active = getActiveSession();
    assert.ok(active);
    id = active.sessionId;
    dir = active.dir;
    assert.equal(active.port, 9444);
    const text = out.logs.join('');
    assert.match(text, /port="9444"/);
    assert.match(text, /CDP endpoint on port 9444 selected by explicit --port/);
  } finally {
    out.restore();
    if (id) await stopSilently(id);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    clearActiveSession();
  }
});

test('session start --json mirrors the <session> result as JSON', async () => {
  const out = captureStdout();
  let dir: string | undefined;
  let id: string | undefined;
  try {
    await sessionMain(sessionArgs(['start'], { json: true }), []);
    out.restore();
    const parsed = extractJsonResult(out.logs.join(''));
    assert.equal(parsed.tag, 'session');

    const active = getActiveSession();
    assert.ok(active);
    id = active!.sessionId;
    dir = active!.dir;
    assert.equal(parsed.attrs.id, id);
  } finally {
    out.restore();
    if (id) await stopSilently(id);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    clearActiveSession();
  }
});

test('session start --target adopts the resolved tab and records its canonical id and endpoint', async () => {
  const out = captureStdout();
  let id: string | undefined;
  let dir: string | undefined;
  __setSessionStartWorld({
    async findTabById(port, targetId) {
      assert.equal(port, 9333);
      assert.equal(targetId, 'ABCD');
      return { id: 'ABCDEF012345', title: 'Existing tab', url: 'https://example.test/adopted', type: 'page' };
    },
  });
  try {
    await sessionMain(sessionArgs(['start'], { target: 'ABCD', port: 9333 }), []);
    const active = getActiveSession();
    assert.ok(active, 'an adopted session should be active');
    id = active.sessionId;
    dir = active.dir;
    assert.equal(active.targetId, 'ABCDEF012345');
    assert.equal(active.port, 9333);
    assert.equal(active.url, 'https://example.test/adopted');
    const text = out.logs.join('');
    assert.match(text, /target="ABCDEF012345"/);
    assert.match(text, /port="9333"/);
    assert.match(text, /tab ABCDEF012345 adopted at https:\/\/example\.test\/adopted/);
    assert.match(text, /CDP endpoint on port 9333 selected by explicit --port; --port overrides endpoint selection and --target overrides tab selection/);
  } finally {
    __setSessionStartWorld();
    out.restore();
    if (id) await stopSilently(id);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    clearActiveSession();
  }
});

test('session start reports an auto-selected browser endpoint, its preferred-selection reason, and the explicit overrides', async () => {
  const out = captureStdout();
  let id: string | undefined;
  let dir: string | undefined;
  __setSessionStartWorld({
    detectCdpPort: async () => ({ port: 9334, app: 'Capture Chrome', selectionReason: 'matched the configured default browser among endpoints with a live page target' }),
    findTabById: async () => ({ id: 'AUTO012345678', title: 'Auto tab', url: 'https://example.test/auto', type: 'page' }),
  });
  try {
    await sessionMain(sessionArgs(['start'], { target: 'AUTO' }), []);
    const active = getActiveSession();
    assert.ok(active);
    id = active.sessionId;
    dir = active.dir;
    const text = out.logs.join('');
    assert.match(text, /Capture Chrome on port 9334 auto-selected because it matched the configured default browser among endpoints with a live page target; capture-launched browser recency does not affect selection/);
    assert.match(text, /--port overrides endpoint selection and --target overrides tab selection/);
  } finally {
    __setSessionStartWorld();
    out.restore();
    if (id) await stopSilently(id);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    clearActiveSession();
  }
});

test('session start rejects an unresolved --target and rolls back its acquired session', async () => {
  const before = fs.existsSync(CAPTURE_ROOT) ? new Set(fs.readdirSync(CAPTURE_ROOT)) : new Set<string>();
  const out = captureStdout();
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  __setSessionStartWorld({ findTabById: async () => null });
  try {
    await sessionMain(sessionArgs(['start'], { target: 'MISSING', port: 9333 }), []);
    const text = out.logs.join('');
    assert.match(text, /code="start_failed"/);
    assert.match(text, /No tab found for target "MISSING" on port 9333/);
    assert.equal(process.exitCode, 1);
    assert.equal(getActiveSession(), null);
    const after = fs.existsSync(CAPTURE_ROOT) ? new Set(fs.readdirSync(CAPTURE_ROOT)) : new Set<string>();
    assert.deepEqual(after, before, 'an unresolved target must not leave a session directory or HAR');
  } finally {
    __setSessionStartWorld();
    out.restore();
    process.exitCode = originalExitCode;
    clearActiveSession();
  }
});

test('session start rejects a non-page target and rolls back its acquired session', async () => {
  const before = fs.existsSync(CAPTURE_ROOT) ? new Set(fs.readdirSync(CAPTURE_ROOT)) : new Set<string>();
  const out = captureStdout();
  const originalExitCode = process.exitCode;
  process.exitCode = undefined;
  __setSessionStartWorld({
    findTabById: async () => ({ id: 'WORKER', title: 'worker', url: 'https://example.test/worker', type: 'service_worker' }),
  });
  try {
    await sessionMain(sessionArgs(['start'], { target: 'WORKER', port: 9333 }), []);
    const text = out.logs.join('');
    assert.match(text, /Target "WORKER" on port 9333 is service_worker, not a page tab/);
    assert.equal(process.exitCode, 1);
    assert.equal(getActiveSession(), null);
    const after = fs.existsSync(CAPTURE_ROOT) ? new Set(fs.readdirSync(CAPTURE_ROOT)) : new Set<string>();
    assert.deepEqual(after, before, 'a non-page target must not leave a session directory or HAR');
  } finally {
    __setSessionStartWorld();
    out.restore();
    process.exitCode = originalExitCode;
    clearActiveSession();
  }
});

test('session start rejects --url with --target before endpoint resolution', () => {
  assert.throws(
    () => validateCliInvocation(parseCliSyntax(['session', 'start', '--url', 'https://example.test/', '--target', 'ABCD'])),
    /session start cannot combine --url and --target/,
  );
});

test('session start does not adopt CDP_TARGET without an explicit --target', () => {
  const previous = process.env.CDP_TARGET;
  process.env.CDP_TARGET = 'AMBIENT';
  try {
    const parsed = resolveCliContext(parseCliSyntax(['session', 'start']));
    assert.equal(parsed.target, undefined);
  } finally {
    if (previous === undefined) delete process.env.CDP_TARGET;
    else process.env.CDP_TARGET = previous;
  }
});

test('simultaneous session starts publish exactly one live session', async () => {
  clearActiveSession();
  process.exitCode = 0;
  const out = captureStdout();
  let active: ReturnType<typeof getActiveSession> = null;
  try {
    await Promise.all([
      sessionMain(sessionArgs(['start'], { json: true }), []),
      sessionMain(sessionArgs(['start'], { json: true }), []),
    ]);
    active = getActiveSession();
    assert.ok(active);
    const output = out.logs.join('');
    assert.equal((output.match(/\"tag\": \"session\"/g) ?? []).length, 1);
    assert.equal((output.match(/\"tag\": \"error\"/g) ?? []).length, 1);
    // The loser of the race is refused by the one-live-session-per-scope guard,
    // which names its own typed code and teaches the recovery routes.
    assert.match(output, /session_already_active/);
  } finally {
    out.restore();
    process.exitCode = 0;
    if (active) {
      await stopSilently(active.sessionId);
      fs.rmSync(active.dir, { recursive: true, force: true });
    }
    clearActiveSession();
  }
});

// --- Real-Chrome integration: `session start --url` acceptance ---------------

test('session start failure emits start_failed, sets exitCode 1, and leaves no stray session HAR', async () => {
  // A url with a port pointing at a closed CDP endpoint forces the openTab
  // CDP connect to fail, reaching the outer start_failed catch after the HAR
  // recording was already created.
  const captureRoot = CAPTURE_ROOT;
  const before = fs.existsSync(captureRoot) ? new Set(fs.readdirSync(captureRoot)) : new Set<string>();
  const out = captureStdout();
  try {
    await sessionMain(
      sessionArgs(['start'], { url: 'http://localhost:65500/', port: 65500 }),
      [],
    );
  } finally {
    out.restore();
  }
  const text = out.logs.join('');
  assert.ok(text.includes('<error'), text);
  assert.ok(text.includes('code="start_failed"'), text);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;

  // The HAR created during the failed start must be cleaned up: no new file
  // left behind in any newly created session .har directory.
  const deadline = Date.now() + 1000;
  let leaked: string[] = [];

  while (Date.now() < deadline) {
    const after = fs.existsSync(captureRoot) ? new Set(fs.readdirSync(captureRoot)) : new Set<string>();
    const newSessions = [...after].filter((name) => !before.has(name));
    leaked = newSessions.filter((name) => {
      const harDir = path.join(captureRoot, name, '.har');
      if (!fs.existsSync(harDir)) return false;
      return fs.readdirSync(harDir).some((f) => f.endsWith('.json'));
    });
    if (leaked.length === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  assert.deepEqual(leaked, [], `start failure leaked HAR file(s): ${leaked.join(', ')}`);

  // A failed start must not register an active session.
  assert.equal(getActiveSession(), null);
});

test('session start directs unsupported Target.createTarget endpoints to --target adoption', async () => {
  const out = captureStdout();
  __setSessionStartWorld({
    createHar: async () => 'fake-har',
    deleteHar: async () => {},
    openTab: async () => { throw new Error('Not supported'); },
  });
  try {
    await sessionMain(sessionArgs(['start'], { url: 'http://localhost:3069/', port: 9333 }), []);
  } finally {
    __setSessionStartWorld();
    out.restore();
  }

  const text = out.logs.join('');
  assert.match(text, /Target\.createTarget/);
  assert.match(text, /Target\.createTarget is unsupported on port 9333/);
  assert.match(text, /capture tab list --port 9333/);
  assert.match(text, /capture session start --target &lt;target-id&gt; --port 9333/);
  assert.equal(getActiveSession(), null);
  process.exitCode = 0;
});

test('session start --url file: opens a tab and stop bundles shots (not a11y)', liveChromeOpts, async () => {
  const { proc, port } = await spawnHeadlessChrome();
  const file = path.join(CAPTURE_ROOT, `session-start-${process.pid}-${Date.now()}.html`);
  fs.mkdirSync(CAPTURE_ROOT, { recursive: true });
  fs.writeFileSync(file, '<!doctype html><title>Capture session file target</title><main>ready</main>');
  const url = pathToFileURL(file).href;
  let dir: string | undefined;
  let id: string | undefined;
  try {
    const startOut = captureStdout();
    try {
      await sessionMain(sessionArgs(['start'], { url, port }), []);
    } finally {
      startOut.restore();
    }
    const startText = startOut.logs.join('');
    assert.ok(startText.includes('<session'), startText);
    assert.ok(/tab .* opened at/.test(startText), `expected a tab-opened fact, got: ${startText}`);

    const active = getActiveSession();
    assert.ok(active, 'session should be active after --url start');
    id = active!.sessionId;
    dir = active!.dir;

    const stopOut = captureStdout();
    try {
      await sessionMain(sessionArgs(['stop', id], { json: true }), []);
    } finally {
      stopOut.restore();
    }
    const stopJson = extractJsonResult(stopOut.logs.join(''));
    assert.equal(stopJson.tag, 'session-stopped');

    const bundle = JSON.parse(fs.readFileSync(path.join(dir!, 'bundle.json'), 'utf-8'));
    assert.ok('shots' in bundle, 'bundle manifest must carry a shots key');
    assert.ok(!('a11y' in bundle), 'bundle manifest must NOT carry an a11y key');
    assert.ok(!fs.existsSync(path.join(dir!, 'a11y')), 'a11y/ dir must NOT exist');
  } finally {
    await closeChrome(proc);
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(file, { force: true });
    clearActiveSession();
  }
});
