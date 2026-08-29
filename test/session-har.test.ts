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
import { __setLogTailWorld } from '../src/session/log-tailer.js';
import { appendToHarRecording, readHarRecording, type HarFile, type HAREntry, type IncompleteLifecycle } from '../src/har-manager.js';
import { getActiveSession, clearActiveSession } from '../src/session-context.js';
import { workerExecArgv } from './fixtures/worker-exec-argv.js';
import type { ParsedArgs } from '../src/cdp/types.js';

// Process-scope this file's active-session pointer.
process.env.CRTR_NODE_ID = `u15-har-test-${process.pid}-${Date.now()}`;

// `session log` self-spawns the hidden `__log-tail-serve` route; under the test
// runner the built bin's default entry (process.argv[1]) is not capture.ts, so
// point the tailer world's entry at the real source. `workerExecArgv()` drops
// the isolate-capture-root preamble so the worker inherits this process's
// CAPTURE_ROOT by env instead of re-randomizing it (empty execArgv in the
// built bin resolves the same way).
const CAPTURE_SRC = path.resolve('src/capture.ts');
__setLogTailWorld({ entryArgv: () => [...workerExecArgv(), CAPTURE_SRC] });

function sessionArgs(positional: string[], extra: Partial<ParsedArgs> = {}): ParsedArgs {
  return { command: 'session', positional, json: false, ...extra } as ParsedArgs;
}

function captureStdout(): { logs: string[]; restore: () => void } {
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
  resHeaders?: Array<{ name: string; value: string }>;
}): HAREntry {
  const i = FIXTURE_SEED;
  FIXTURE_SEED += 1;
  const requestWallTime = 1783814400 + i;
  const requestMonotonic = i * 10 + 10;
  const responseMonotonic = requestMonotonic + 12;
  const terminalMonotonic = responseMonotonic + 18;
  const captured = over.body !== undefined || over.postData !== undefined;
  const bodyText = captured ? over.body ?? '' : '';
  const capturedBytes = Buffer.byteLength(bodyText, 'utf-8');
  const content = captured
    ? { text: bodyText }
    : {};

  return {
    startedDateTime: new Date(requestWallTime * 1000).toISOString(),
    time: (terminalMonotonic - requestMonotonic) * 1000,
    request: {
      method: over.method ?? 'GET',
      url: over.url,
      headers: over.reqHeaders ?? [{ name: 'accept', value: 'application/json' }],
      ...(over.postData !== undefined ? { postData: { mimeType: 'application/json', text: over.postData } } : {}),
    },
    response: {
      status: over.status ?? 200,
      headers: over.resHeaders ?? [{ name: 'content-type', value: 'application/json' }],
      content,
    },
    _capture: {
      schemaVersion: 1,
      requestId: `req-${i}`,
      generation: 1,
      clocks: {
        requestWallTime,
        requestMonotonic,
        responseMonotonic,
        terminalMonotonic,
      },
      terminal: {
        kind: 'finished',
        encodedDataLength: capturedBytes,
      },
      response: {
        state: 'received',
      },
      body: {
        state: captured ? 'captured' : 'fetch_failed',
        ...(captured
          ? {
            sourceEncoding: 'text',
            decodedByteLength: capturedBytes,
            capturedByteLength: capturedBytes,
            truncated: false,
          }
          : {
            error: 'not captured',
          }),
      },
    },
  };
}

let FIXTURE_SEED = 0;

function failedEntry(url: string): HAREntry {
  const failed = entry({ url, status: 0 });
  failed.response = { status: 0, headers: [], content: {} };
  failed._capture.clocks.responseMonotonic = null;
  failed._capture.terminal = {
    kind: 'failed',
    errorText: 'net::ERR_FAILED',
    canceled: false,
    blockedReason: null,
    resourceType: null,
  };
  failed._capture.response = { state: 'unavailable' };
  failed._capture.body = { state: 'not_applicable', reason: 'no_response' };
  return failed;
}

/** One retained `stopped_before_terminal` record — a request the recorder saw
 * start (and optionally answer) but never terminate. `wallTime` is explicit so
 * a record can be placed BETWEEN two completed entries. */
function stoppedBeforeTerminal(over: {
  url: string;
  method?: string;
  wallTime: number;
  status?: number;
  reqHeaders?: Array<{ name: string; value: string }>;
  resHeaders?: Array<{ name: string; value: string }>;
}): IncompleteLifecycle {
  return {
    kind: 'stopped_before_terminal',
    requestId: `inc-stopped-${over.wallTime}`,
    generation: 1,
    startedDateTime: new Date(over.wallTime * 1000).toISOString(),
    request: {
      method: over.method ?? 'GET',
      url: over.url,
      headers: over.reqHeaders ?? [{ name: 'accept', value: 'text/event-stream' }],
    },
    _capture: {
      schemaVersion: 1,
      requestWallTime: over.wallTime,
      requestMonotonic: 5,
      response: over.status === undefined
        ? null
        : { status: over.status, headers: over.resHeaders ?? [{ name: 'content-type', value: 'text/event-stream' }], responseMonotonic: 7 },
    },
  };
}

/** A persisted schema-v1 invalid-clock record. */
function terminalBeforeResponse(over: { url: string; wallTime: number }): IncompleteLifecycle {
  return {
    kind: 'invalid_clock_order',
    requestId: `inc-clock-${over.wallTime}`,
    generation: 1,
    startedDateTime: new Date(over.wallTime * 1000).toISOString(),
    request: {
      method: 'POST',
      url: over.url,
      headers: [{ name: 'accept', value: 'application/json' }],
    },
    response: { status: 204, headers: [{ name: 'content-type', value: 'application/json' }], responseMonotonic: 40 },
    terminal: { kind: 'finished', terminalMonotonic: 30, encodedDataLength: 0 },
    _capture: { schemaVersion: 1, requestWallTime: over.wallTime, requestMonotonic: 10 },
    violation: 'terminal_before_response',
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
  await appendToHarRecording(active!.harId!, { entries: FIXTURE_ENTRIES, incompleteLifecycles: [] });
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
    assert.ok(all.includes('duration 30000 ms'), all);
    assert.ok(all.includes('response ended 2026-07-12T00:00:30.000Z'), all);
    // The full-fidelity pointer is the live HAR file path under this session.
    assert.ok(all.includes(path.join(dir, '.har')), all);

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

test('session har reports failed response completion without inventing a response end', async () => {
  await runSession(['start']);
  const active = getActiveSession();
  assert.ok(active?.harId);
  const { sessionId: id, dir } = active!;
  await appendToHarRecording(active!.harId!, {
    entries: [failedEntry('https://api.example.com/failed')],
    incompleteLifecycles: [],
  });

  try {
    const rendered = await runSession(['har']);
    assert.ok(rendered.includes('duration 30000 ms'), rendered);
    assert.ok(rendered.includes('response incomplete: failed'), rendered);
    assert.ok(!rendered.includes('response ended'), rendered);
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

test('session har lists incomplete lifecycle records beside completed entries, in one chronological selection', async () => {
  // The Cloudflare bundle that motivated this: 24 completed entries beside 739
  // retained incomplete records, none of which any `session har` read could see.
  const incomplete = [
    // 00:00:00.500 — between fixture entries 0 (00:00:00) and 1 (00:00:01).
    stoppedBeforeTerminal({ url: 'https://api.example.com/stream', wallTime: 1783814400.5, status: 200 }),
    // No response ever observed — no status to filter on.
    stoppedBeforeTerminal({ url: 'https://api.example.com/pending', method: 'PUT', wallTime: 1783814410 }),
    terminalBeforeResponse({ url: 'https://api.example.com/events', wallTime: 1783814411 }),
  ];
  await runSession(['start']);
  const active = getActiveSession();
  assert.ok(active?.harId);
  const { sessionId: id, dir } = active!;
  await appendToHarRecording(active!.harId!, { entries: FIXTURE_ENTRIES, incompleteLifecycles: incomplete });

  try {
    const all = await runSession(['har']);
    assert.ok(all.includes('entries="4"'), all);
    assert.ok(all.includes('incomplete="3"'), all);
    assert.ok(all.includes('total="4"'), all);
    assert.ok(all.includes('total-incomplete="3"'), all);
    assert.ok(all.includes('incomplete: stopped_before_terminal'), all);
    // A clock violation names the violation, not just the kind.
    assert.ok(all.includes('incomplete: invalid_clock_order/terminal_before_response'), all);
    assert.ok(all.includes('PUT no-response'), all);
    const pending = await runSession(['har'], { filterUrl: 'pending' });
    assert.ok(pending.includes('response incomplete: terminal event never observed'), pending);
    assert.ok(!pending.includes('response ended'), pending);

    // Chronological merge: the 00:00:00.500 record sits between entry 1 and 2.
    const rows = all.split('\n').filter((l) => /^\d+\. /.test(l.trim()));
    const streamRow = rows.findIndex((r) => r.includes('/stream'));
    assert.equal(streamRow, 1, rows.join('\n'));

    // Filters select across both populations.
    const byMethod = await runSession(['har'], { filterMethod: 'PUT' });
    assert.ok(byMethod.includes('entries="0"') && byMethod.includes('incomplete="1"'), byMethod);
    const byStatus = await runSession(['har'], { filterStatus: '204' });
    assert.ok(byStatus.includes('entries="0"') && byStatus.includes('incomplete="1"'), byStatus);
    // A status filter never matches a record with no observed response.
    const byUrl = await runSession(['har'], { filterUrl: 'pending', filterStatus: '2' });
    assert.ok(byUrl.includes('incomplete="0"'), byUrl);

    // The bound is truthful about what it left out.
    const limited = await runSession(['har'], { limit: 2 });
    assert.ok(limited.includes('truncated="true"'), limited);
    assert.ok(limited.includes('5 further matching rows are not listed'), limited);

    // --full explains WHY the lifecycle never completed.
    const full = await runSession(['har'], { full: true, filterUrl: 'events' });
    assert.ok(full.includes('terminal: finished'), full);
    assert.ok(full.includes('res content-type: application/json'), full);

    const json = JSON.parse(await runSession(['har'], { json: true }));
    assert.equal(json.attrs.incomplete, 3);
    assert.equal(json.attrs['total-incomplete'], 3);
  } finally {
    await runSession(['stop', id], { json: true });
    fs.rmSync(dir, { recursive: true, force: true });
    clearActiveSession();
  }
});

test('session har redacts credential query values and header values while the HAR artifact keeps them', async () => {
  const SECRET = 'cf-live-key-abc123XYZ';
  const HEADER_SECRET = 'reddit-header-credential-abc123XYZ';
  const credentialUrl = `https://dash.cloudflare.com/api/tail?account=acct-42&key=${SECRET}&page=2`;
  const oauthUrl = `https://auth.example.com/callback?code=${SECRET}&state=keep-me#access_token=${SECRET}`;
  const assertHeaderArtifact = (har: HarFile): void => {
    const complete = har.log.entries.find((record) => record.request.url === credentialUrl);
    assert.ok(complete, 'complete request must remain in the HAR artifact');
    assert.equal(complete.request.headers.find((header) => header.name === 'x-reddit-loid')?.value, HEADER_SECRET);
    assert.equal(complete.response.headers.find((header) => header.name === 'x-session-token')?.value, HEADER_SECRET);
    const incomplete = har.incompleteLifecycles.find((record) => record.request.url === oauthUrl);
    assert.ok(incomplete, 'incomplete request must remain in the HAR artifact');
    assert.equal(incomplete.request.headers.find((header) => header.name === 'x-auth-token')?.value, HEADER_SECRET);
    assert.ok(incomplete._capture.response, 'incomplete response must remain in the HAR artifact');
    assert.equal(incomplete._capture.response.headers.find((header) => header.name === 'x-session-secret')?.value, HEADER_SECRET);
  };
  await runSession(['start']);
  const active = getActiveSession();
  assert.ok(active?.harId);
  const { sessionId: id, dir } = active!;
  await appendToHarRecording(active!.harId!, {
    entries: [entry({
      url: credentialUrl,
      status: 200,
      reqHeaders: [
        { name: 'x-reddit-loid', value: HEADER_SECRET },
        { name: 'accept', value: 'application/json' },
      ],
      resHeaders: [
        { name: 'x-session-token', value: HEADER_SECRET },
        { name: 'content-type', value: 'application/json' },
      ],
    })],
    incompleteLifecycles: [stoppedBeforeTerminal({
      url: oauthUrl,
      wallTime: 1783814500,
      status: 200,
      reqHeaders: [{ name: 'x-auth-token', value: HEADER_SECRET }],
      resHeaders: [{ name: 'x-session-secret', value: HEADER_SECRET }],
    })],
  });

  try {
    const rendered = await runSession(['har']);
    assert.ok(!rendered.includes(SECRET), rendered);
    assert.ok(rendered.includes('key=REDACTED'), rendered);
    assert.ok(rendered.includes('code=REDACTED'), rendered);
    assert.ok(rendered.includes('access_token=REDACTED'), rendered);
    // Only credential-named parameters are touched.
    assert.ok(rendered.includes('account=acct-42'), rendered);
    assert.ok(rendered.includes('page=2'), rendered);
    assert.ok(rendered.includes('state=keep-me'), rendered);

    // --full opts into bodies and headers, never back into credential values.
    const full = await runSession(['har'], { full: true });
    assert.ok(!full.includes(SECRET), full);
    assert.ok(!full.includes(HEADER_SECRET), full);
    assert.ok(full.includes('key=REDACTED'), full);
    for (const name of ['x-reddit-loid', 'x-session-token', 'x-auth-token', 'x-session-secret']) {
      assert.ok(full.includes(`${name}: redacted · ${HEADER_SECRET.length} chars`), full);
    }
    assert.ok(full.includes('accept: application/json'), full);
    assert.ok(full.includes('content-type: application/json'), full);

    const json = await runSession(['har'], { full: true, json: true });
    assert.ok(!json.includes(SECRET), json);
    assert.ok(!json.includes(HEADER_SECRET), json);
    for (const name of ['x-reddit-loid', 'x-session-token', 'x-auth-token', 'x-session-secret']) {
      assert.ok(json.includes(`${name}: redacted · ${HEADER_SECRET.length} chars`), json);
    }
    assert.ok(json.includes('accept: application/json'), json);
    assert.ok(json.includes('content-type: application/json'), json);

    // Filters match the URL AS CAPTURED, so the real value still selects.
    const filtered = await runSession(['har'], { filterUrl: SECRET });
    assert.ok(filtered.includes('entries="1"') && filtered.includes('incomplete="1"'), filtered);

    // The full-fidelity artifact is untouched — both live and bundled.
    const live = fs.readFileSync(path.join(dir, '.har', fs.readdirSync(path.join(dir, '.har'))[0]), 'utf-8');
    assert.ok(live.includes(SECRET), 'live HAR store must keep the captured query value');
    assertHeaderArtifact(await readHarRecording(active!.harId!));
    await runSession(['stop', id], { json: true });
    const bundled = fs.readFileSync(path.join(dir, 'har.json'), 'utf-8');
    assert.ok(bundled.includes(SECRET), 'bundled har.json must keep the captured query value');
    assertHeaderArtifact(JSON.parse(bundled) as HarFile);
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
