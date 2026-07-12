import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { sessionMain, waitForPageLoad } from '../src/session/commands.js';
import { getActiveSession, clearActiveSession } from '../src/session-context.js';
import { HAR_DIR } from '../src/har-manager.js';
import type { ParsedArgs } from '../src/cdp/types.js';

// Process-scope this file's active-session pointer (node's test runner
// process-isolates each test file, so this only scopes THIS file).
process.env.CRTR_NODE_ID = `u04-start-test-${process.pid}-${Date.now()}`;

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function sessionArgs(positional: string[], extra: Partial<ParsedArgs> = {}): ParsedArgs {
  return { command: 'session', positional, json: false, ...extra } as ParsedArgs;
}

function captureStdout(): { logs: string[]; restore: () => void } {
  const logs: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown) => {
    logs.push(typeof chunk === 'string' ? chunk : String(chunk));
    return true;
  }) as typeof process.stdout.write;
  return { logs, restore: () => { process.stdout.write = originalWrite; } };
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

    assert.ok(text.startsWith('<session '), `expected a rendered <session> block, got: ${text}`);
    assert.ok(!text.startsWith('{'), 'default output must be rendered prose, not JSON');
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
    const parsed = JSON.parse(out.logs.join(''));
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

// --- Real-Chrome integration: `session start --url` acceptance ---------------

async function waitForHttpOk(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown;
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url);
      if (resp.ok) return;
    } catch (err) {
      lastErr = err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${url}: ${String(lastErr)}`);
}

async function spawnHeadlessChrome(): Promise<{ proc: ChildProcess; port: number }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const port = 19900 + Math.floor(Math.random() * 700) + attempt * 137;
    const proc = spawn(
      CHROME_PATH,
      [
        '--headless=new',
        '--disable-gpu',
        `--remote-debugging-port=${port}`,
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    try {
      await waitForHttpOk(`http://localhost:${port}/json/version`, 8000);
      return { proc, port };
    } catch (err) {
      lastErr = err;
      try {
        proc.kill('SIGKILL');
      } catch {
        // already dead
      }
    }
  }
  throw new Error(`failed to spawn headless Chrome after 3 attempts: ${String(lastErr)}`);
}

test('session start failure emits start_failed, sets exitCode 1, and leaves no stray HAR file', async () => {
  // A url with a port pointing at a closed CDP endpoint forces the openTab
  // CDP connect to fail, reaching the outer start_failed catch after the HAR
  // recording was already created.
  const before = fs.existsSync(HAR_DIR) ? new Set(fs.readdirSync(HAR_DIR)) : new Set<string>();
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
  // left behind in the HAR store.
  const after = fs.existsSync(HAR_DIR) ? new Set(fs.readdirSync(HAR_DIR)) : new Set<string>();
  const leaked = [...after].filter((f) => !before.has(f));
  assert.deepEqual(leaked, [], `start failure leaked HAR file(s): ${leaked.join(', ')}`);

  // A failed start must not register an active session.
  assert.equal(getActiveSession(), null);
});

test('session start --url opens a tab and stop bundles shots (not a11y)', async () => {
  const { proc, port } = await spawnHeadlessChrome();
  let dir: string | undefined;
  let id: string | undefined;
  try {
    const startOut = captureStdout();
    try {
      await sessionMain(sessionArgs(['start'], { url: 'data:text/html,<h1>ok</h1>', port }), []);
    } finally {
      startOut.restore();
    }
    const startText = startOut.logs.join('');
    assert.ok(startText.startsWith('<session'), startText);
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
    const stopJson = JSON.parse(stopOut.logs.join(''));
    assert.equal(stopJson.tag, 'session-stopped');

    const bundle = JSON.parse(fs.readFileSync(path.join(dir!, 'bundle.json'), 'utf-8'));
    assert.ok('shots' in bundle, 'bundle manifest must carry a shots key');
    assert.ok(!('a11y' in bundle), 'bundle manifest must NOT carry an a11y key');
    assert.ok(!fs.existsSync(path.join(dir!, 'a11y')), 'a11y/ dir must NOT exist');
  } finally {
    try { proc.kill('SIGKILL'); } catch { /* already dead */ }
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
    clearActiveSession();
  }
});
