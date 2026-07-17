import { EventEmitter, once } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { CDPClient } from '../src/cdp/client.js';
import { sessionMain, waitForPageLoad } from '../src/session/commands.js';
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
    assert.match(output, /start_failed/);
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
