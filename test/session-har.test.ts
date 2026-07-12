/**
 * U15 — `session har` and `session log` acceptance.
 *
 * No real Chrome needed: `session start` with no --url creates the live HAR
 * recording without touching CDP, entries are appended through the same
 * har-manager append the auto-record path uses, and `session stop` bundles
 * har.json exactly as production does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { sessionMain } from '../src/session/commands.js';
import { appendToHarRecording, type HAREntry } from '../src/har-manager.js';
import { getActiveSession, clearActiveSession } from '../src/session-context.js';
import type { ParsedArgs } from '../src/cdp/types.js';

// Process-scope this file's active-session pointer.
process.env.CRTR_NODE_ID = `u15-har-test-${process.pid}-${Date.now()}`;

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

async function runSession(positional: string[], extra: Partial<ParsedArgs> = {}): Promise<string> {
  const out = captureStdout();
  try {
    await sessionMain(sessionArgs(positional, extra), []);
  } finally {
    out.restore();
  }
  return out.logs.join('');
}

function entry(over: {
  method?: string;
  url: string;
  status?: number;
  body?: string;
  postData?: string;
  reqHeaders?: Array<{ name: string; value: string }>;
}): HAREntry {
  return {
    startedDateTime: '2026-07-12T00:00:00.000Z',
    request: {
      method: over.method ?? 'GET',
      url: over.url,
      headers: over.reqHeaders ?? [{ name: 'accept', value: 'application/json' }],
      ...(over.postData !== undefined ? { postData: { text: over.postData } } : {}),
    },
    response: {
      status: over.status ?? 200,
      headers: [{ name: 'content-type', value: 'application/json' }],
      content: over.body !== undefined ? { text: over.body } : {},
    },
  };
}

const HOSTILE_URL = 'https://api.example.com/x?q=<img src=x onerror=alert(1)>';
const SECRET_BODY = 'SECRET_BODY_TOKEN_abc123';
const POST_BODY = 'POST_BODY_TOKEN_xyz789';

const FIXTURE_ENTRIES: HAREntry[] = [
  entry({ method: 'GET', url: 'https://api.example.com/users', status: 200, body: SECRET_BODY }),
  entry({ method: 'POST', url: 'https://api.example.com/users', status: 201, postData: POST_BODY, body: '{"ok":true}' }),
  entry({ method: 'GET', url: 'https://cdn.example.com/app.js', status: 404 }),
  entry({ method: 'GET', url: HOSTILE_URL, status: 500, body: 'boom' }),
];

/** Starts a session (no url — no CDP touched), appends the fixture entries to
 * its live HAR, and returns its id + dir. */
async function startSeededSession(): Promise<{ id: string; dir: string }> {
  await runSession(['start']);
  const active = getActiveSession();
  assert.ok(active, 'session should be active after start');
  assert.ok(active!.harId, 'session should carry a live HAR recording id');
  appendToHarRecording(active!.harId!, FIXTURE_ENTRIES);
  return { id: active!.sessionId, dir: active!.dir };
}

test('session har reads the LIVE accumulating HAR of a running session, with filters', async () => {
  const { id, dir } = await startSeededSession();
  try {
    const all = await runSession(['har']);
    assert.ok(all.startsWith('<session-har '), all);
    assert.ok(all.includes('source="live"'), all);
    assert.ok(all.includes('entries="4"'), all);
    assert.ok(all.includes('total="4"'), all);
    assert.ok(all.includes('GET 200'), all);
    assert.ok(all.includes('started 2026-07-12T00:00:00.000Z'), all);
    // The full-fidelity pointer is the live HAR file path.
    assert.ok(/path="[^"]*capture-har[^"]*\.json"/.test(all), all);

    const byUrl = await runSession(['har'], { filterUrl: 'cdn.example' });
    assert.ok(byUrl.includes('entries="1"') && byUrl.includes('total="4"'), byUrl);
    assert.ok(byUrl.includes('app.js'), byUrl);
    assert.ok(!byUrl.includes('api.example.com/users'), byUrl);

    const byStatusRange = await runSession(['har'], { filterStatus: '400-599' });
    assert.ok(byStatusRange.includes('entries="2"'), byStatusRange);

    const byStatusPrefix = await runSession(['har'], { filterStatus: '2' });
    assert.ok(byStatusPrefix.includes('entries="2"'), byStatusPrefix);

    const byMethod = await runSession(['har'], { filterMethod: 'post' });
    assert.ok(byMethod.includes('entries="1"'), byMethod);
    assert.ok(byMethod.includes('POST 201'), byMethod);

    const limited = await runSession(['har'], { limit: 2 });
    assert.ok(limited.includes('entries="2"') && limited.includes('total="4"'), limited);
    assert.ok(limited.includes('(limit=2)') || limited.includes('limit=2'), limited);
  } finally {
    await runSession(['stop', id], { json: true });
    fs.rmSync(dir, { recursive: true, force: true });
    clearActiveSession();
  }
});

test('session har escapes entry URLs and never inlines bodies by default; --full opts in', async () => {
  const { id, dir } = await startSeededSession();
  try {
    const rendered = await runSession(['har']);
    // Hostile URL is escaped — the raw tag opener must not survive.
    assert.ok(!rendered.includes('<img src=x'), rendered);
    assert.ok(rendered.includes('&lt;img src=x'), rendered);
    // Bodies NEVER inlined by default (I-7): sizes only.
    assert.ok(!rendered.includes(SECRET_BODY), rendered);
    assert.ok(!rendered.includes(POST_BODY), rendered);
    assert.ok(rendered.includes(`${Buffer.byteLength(SECRET_BODY)} bytes`), rendered);
    // An entry without a captured body says so explicitly.
    assert.ok(rendered.includes('body not captured'), rendered);

    const full = await runSession(['har'], { full: true });
    assert.ok(full.includes(SECRET_BODY), full);
    assert.ok(full.includes(POST_BODY), full);
    assert.ok(full.includes('req accept: application/json'), full);
    assert.ok(full.includes('res content-type: application/json'), full);
    // Escaping still applies under --full.
    assert.ok(!full.includes('<img src=x'), full);
  } finally {
    await runSession(['stop', id], { json: true });
    fs.rmSync(dir, { recursive: true, force: true });
    clearActiveSession();
  }
});

test('session har works against a STOPPED session\'s bundled har.json, and --json mirrors', async () => {
  const { id, dir } = await startSeededSession();
  try {
    await runSession(['stop', id], { json: true });
    assert.ok(fs.existsSync(path.join(dir, 'har.json')), 'stop must bundle har.json');

    // Explicit session-id form (no active session remains after stop).
    const bundled = await runSession(['har', id]);
    assert.ok(bundled.startsWith('<session-har '), bundled);
    assert.ok(bundled.includes('source="bundle"'), bundled);
    assert.ok(bundled.includes(`path="${path.join(dir, 'har.json')}"`), bundled);
    assert.ok(bundled.includes('total="4"'), bundled);
    assert.ok(!bundled.includes(SECRET_BODY), bundled);

    const filtered = await runSession(['har', id], { filterMethod: 'POST' });
    assert.ok(filtered.includes('entries="1"'), filtered);

    const json = JSON.parse(await runSession(['har', id], { json: true }));
    assert.equal(json.tag, 'session-har');
    assert.equal(json.attrs.id, id);
    assert.equal(json.attrs.source, 'bundle');
    assert.equal(json.attrs.total, 4);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    clearActiveSession();
  }
});

test('session har errors: no active session, unknown session — structured, exit 1', async () => {
  clearActiveSession();
  const noActive = await runSession(['har']);
  assert.ok(noActive.includes('<error'), noActive);
  assert.ok(noActive.includes('code="no_active_session"'), noActive);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;

  const unknown = await runSession(['har', 'cap-does-not-exist']);
  assert.ok(unknown.includes('code="unknown_session"'), unknown);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
});

test('session log tails a file into the session logs/ dir and emits <log-tail>', async () => {
  await runSession(['start']);
  const active = getActiveSession();
  assert.ok(active);
  const id = active!.sessionId;
  const dir = active!.dir;

  const src = path.join(os.tmpdir(), `u15-log-src-${process.pid}.log`);
  fs.writeFileSync(src, 'hello line one\n');
  try {
    const rendered = await runSession(['log', src], { name: 'mylog' });
    assert.ok(rendered.startsWith('<log-tail '), rendered);
    assert.ok(rendered.includes(`session="${id}"`), rendered);
    const dest = path.join(dir, 'logs', 'mylog.log');
    assert.ok(rendered.includes(dest), rendered);
    assert.ok(fs.existsSync(dest), 'dest log file must exist in the session logs/ dir');

    // The tailer pid is registered on the session so stop can kill it.
    const meta = JSON.parse(fs.readFileSync(path.join(dir, '.session.json'), 'utf-8'));
    assert.equal(meta.logPids.length, 1);
    assert.equal(meta.logPids[0].name, 'mylog');
    assert.equal(meta.logPids[0].sourcePath, src);

    // Tail actually flows: appended source lines land in dest (timestamped).
    fs.appendFileSync(src, 'second line\n');
    const deadline = Date.now() + 5000;
    let destContent = '';
    while (Date.now() < deadline) {
      destContent = fs.existsSync(dest) ? fs.readFileSync(dest, 'utf-8') : '';
      if (destContent.includes('second line')) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(destContent.includes('second line'), `tail output never arrived: ${destContent}`);

    // Stop kills the tailer and bundles the log.
    const stopJson = JSON.parse(await runSession(['stop', id], { json: true }));
    assert.equal(stopJson.tag, 'session-stopped');
    const bundle = JSON.parse(fs.readFileSync(path.join(dir, 'bundle.json'), 'utf-8'));
    assert.equal(bundle.logs.length, 1);
    assert.equal(bundle.logs[0].name, 'mylog.log');
  } finally {
    fs.rmSync(src, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
    clearActiveSession();
  }
});

test('session log errors: missing path, missing file, no active session', async () => {
  clearActiveSession();
  const missingArg = await runSession(['log']);
  assert.ok(missingArg.includes('code="missing_argument"'), missingArg);
  process.exitCode = 0;

  const missingFile = await runSession(['log', '/nonexistent/u15-nope.log']);
  assert.ok(missingFile.includes('code="log_file_not_found"'), missingFile);
  process.exitCode = 0;

  const src = path.join(os.tmpdir(), `u15-log-src2-${process.pid}.log`);
  fs.writeFileSync(src, 'x\n');
  try {
    const noSession = await runSession(['log', src]);
    assert.ok(noSession.includes('code="no_active_session"'), noSession);
    process.exitCode = 0;
  } finally {
    fs.rmSync(src, { force: true });
  }
});
