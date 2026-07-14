import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import * as http from 'node:http';
import { type AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const BIN = fileURLToPath(new URL('../bin/capture', import.meta.url));

interface SurfaceNode {
  readonly name: string;
  readonly children?: readonly SurfaceNode[];
}

// Settled D5 tree. Parent-help assertions below prove that this explicit tree
// remains identical to the executable surface before every leaf help is run.
const SURFACE: readonly SurfaceNode[] = [
  {
    name: 'session',
    children: [
      { name: 'start' },
      { name: 'stop' },
      { name: 'list' },
      { name: 'view' },
      { name: 'har' },
      { name: 'log' },
    ],
  },
  {
    name: 'page',
    children: [
      { name: 'click' },
      { name: 'type' },
      { name: 'scroll' },
      { name: 'navigate' },
      { name: 'exec' },
      { name: 'shot' },
      { name: 'elements' },
    ],
  },
  {
    name: 'tab',
    children: [{ name: 'list' }, { name: 'open' }, { name: 'reset' }, { name: 'network' }],
  },
  {
    name: 'measure',
    children: [
      { name: 'snap' },
      { name: 'check' },
      { name: 'diff' },
      { name: 'census' },
      { name: 'explain' },
      { name: 'sweep' },
      {
        name: 'map',
        children: [{ name: 'focus' }, { name: 'scroll' }, { name: 'layers' }, { name: 'ax' }],
      },
    ],
  },
  {
    name: 'motion',
    children: [{ name: 'rec' }, { name: 'mask' }, { name: 'timeline' }, { name: 'jank' }, { name: 'response' }],
  },
  { name: 'cdp' },
  {
    name: 'lib',
    children: [{ name: 'list' }, { name: 'search' }, { name: 'show' }, { name: 'read' }],
  },
];

type Result = SpawnSyncReturns<string>;

function run(args: readonly string[], tempRoot: string, envOverrides: NodeJS.ProcessEnv = {}): Result {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ['CRTR_NODE_ID', 'CDP_PORT', 'CDP_TARGET']) delete env[key];

  Object.assign(env, {
    CAPTURE_ROOT: path.join(tempRoot, 'capture-sessions'),
    TMPDIR: tempRoot,
    TMP: tempRoot,
    TEMP: tempRoot,
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    LC_ALL: 'C',
  });
  // Applied last so a caller can deliberately re-supply CDP_PORT/CDP_TARGET
  // (stripped above) to probe env-driven behavior against the final binary.
  Object.assign(env, envOverrides);

  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env,
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

/**
 * Async twin of {@link run}, for the one probe below that must keep this
 * process's event loop alive while its child is running: that child dials
 * back into an in-process fake CDP server, and `spawnSync` blocks the whole
 * thread (no event-loop turns), so the fake server could never accept the
 * connection — a same-process client/server pair deadlocks under a
 * synchronous spawn. Every other probe in this file has no such loopback
 * and stays on the synchronous `run()`.
 */
function runAsync(args: readonly string[], tempRoot: string, envOverrides: NodeJS.ProcessEnv = {}): Promise<Result> {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ['CRTR_NODE_ID', 'CDP_PORT', 'CDP_TARGET']) delete env[key];

  Object.assign(env, {
    CAPTURE_ROOT: path.join(tempRoot, 'capture-sessions'),
    TMPDIR: tempRoot,
    TMP: tempRoot,
    TEMP: tempRoot,
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    LC_ALL: 'C',
  });
  Object.assign(env, envOverrides);

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd: REPO_ROOT, env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => { child.kill('SIGTERM'); }, 10_000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, stdout, stderr, pid: child.pid ?? 0, output: [null, stdout, stderr] } as unknown as Result);
    });
  });
}

function withIsolatedCaptureRoot(fn: (tempRoot: string) => void): void {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'capture-conformance-'));
  try {
    fn(tempRoot);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function transcript(result: Result): string {
  return `status=${String(result.status)} signal=${String(result.signal)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}

function assertExit(result: Result, status: number): void {
  assert.equal(result.error, undefined, transcript(result));
  assert.equal(result.signal, null, transcript(result));
  assert.equal(result.status, status, transcript(result));
}

function tagNames(text: string, tag: 'command' | 'subcommand'): string[] {
  const tags = text.match(new RegExp(`<${tag}\\b`, 'g')) ?? [];
  const names = Array.from(text.matchAll(new RegExp(`<${tag}\\b[^\\n]*?\\bname="([^"]+)"`, 'g')), (match) => match[1]!);
  assert.equal(names.length, tags.length, `every <${tag}> must carry a name attribute\n${text}`);
  return names;
}

function errorAttributes(text: string): Record<string, string> {
  const opening = text.match(/<error\b([^>]*)>/);
  assert.ok(opening, `expected one structured <error> opening tag\n${text}`);
  assert.equal(text.match(/<error\b/g)?.length, 1, `expected exactly one structured error\n${text}`);

  return Object.fromEntries(Array.from(opening[1]!.matchAll(/([\w-]+)="([^"]*)"/g), (match) => [match[1]!, match[2]!]));
}

function branches(nodes: readonly SurfaceNode[], prefix: readonly string[] = []): Array<{ path: string[]; children: string[] }> {
  const found: Array<{ path: string[]; children: string[] }> = [];
  for (const node of nodes) {
    const commandPath = [...prefix, node.name];
    if (!node.children) continue;
    found.push({ path: commandPath, children: node.children.map((child) => child.name) });
    found.push(...branches(node.children, commandPath));
  }
  return found;
}

function leaves(nodes: readonly SurfaceNode[], prefix: readonly string[] = []): string[][] {
  const found: string[][] = [];
  for (const node of nodes) {
    const commandPath = [...prefix, node.name];
    if (node.children) found.push(...leaves(node.children, commandPath));
    else found.push(commandPath);
  }
  return found;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('root -h exposes exactly the seven settled command blocks, with no duplicates or extras', () => {
  withIsolatedCaptureRoot((tempRoot) => {
    const result = run(['-h'], tempRoot);
    assertExit(result, 0);
    assert.equal(result.stderr, '');
    assert.deepEqual(tagNames(result.stdout, 'command'), SURFACE.map((node) => node.name));
  });
});

test('--help is an unknown command while -h is honored at root, branch, and leaf', () => {
  withIsolatedCaptureRoot((tempRoot) => {
    const rejected = run(['--help'], tempRoot);
    assertExit(rejected, 1);
    assert.equal(errorAttributes(rejected.stdout).code, 'unknown_command');

    const rootHelp = run(['-h'], tempRoot);
    assertExit(rootHelp, 0);
    assert.ok(tagNames(rootHelp.stdout, 'command').length > 0);

    const branchHelp = run(['page', '-h'], tempRoot);
    assertExit(branchHelp, 0);
    assert.ok(tagNames(branchHelp.stdout, 'subcommand').length > 0);

    const leafHelp = run(['page', 'click', '-h'], tempRoot);
    assertExit(leafHelp, 0);
    assert.match(leafHelp.stdout, /^capture page click\b/);
    assert.match(leafHelp.stdout, /(?:^|\n)\s*input:/i);
  });
});

test('an unknown root command emits structured unknown_command and exits 1', () => {
  withIsolatedCaptureRoot((tempRoot) => {
    const result = run(['not-a-root'], tempRoot);
    assertExit(result, 1);
    assert.equal(errorAttributes(result.stdout).code, 'unknown_command');
  });
});

test('--gate is confined to measure check and measure diff at built-binary dispatch', () => {
  withIsolatedCaptureRoot((tempRoot) => {
    const rejected: Array<{ args: string[]; command: string }> = [
      { args: ['session', 'list', '--gate'], command: 'session list' },
      { args: ['page', 'elements', '--gate'], command: 'page elements' },
      { args: ['tab', 'list', '--gate'], command: 'tab list' },
      { args: ['cdp', '--gate'], command: 'cdp' },
      { args: ['lib', 'list', '--gate'], command: 'lib list' },
      { args: ['measure', '--gate'], command: 'measure' },
      { args: ['measure', 'map', '--gate'], command: 'measure map' },
      { args: ['measure', 'snap', '--gate'], command: 'measure snap' },
      { args: ['motion', '--gate'], command: 'motion' },
      { args: ['motion', 'timeline', '--gate'], command: 'motion timeline' },
    ];

    // FROZEN-BIN-PENDING (U23): the typed one-boundary shape below (code +
    // kind attrs, leaf named in the message) goes red against the frozen
    // bin/capture (old command/status shape) until U23 rebuilds it. Proven
    // against source in test/cli-error-contract.test.ts.
    for (const probe of rejected) {
      const result = run(probe.args, tempRoot);
      assertExit(result, 1);
      const attrs = errorAttributes(result.stdout);
      assert.equal(attrs.code, 'unsupported_flag', `${probe.args.join(' ')}\n${transcript(result)}`);
      assert.equal(attrs.kind, 'invocation', `${probe.args.join(' ')}\n${transcript(result)}`);
      assert.ok(
        result.stdout.includes(`'--gate' is not accepted on '${probe.command}'`),
        `${probe.args.join(' ')}\n${transcript(result)}`,
      );
    }

    for (const probe of [
      ['measure', 'check', '--gate'],
      ['measure', 'diff', '--gate'],
    ]) {
      const result = run(probe, tempRoot);
      assertExit(result, 1);
      const attrs = errorAttributes(result.stdout);
      assert.notEqual(attrs.status, 'unsupported_flag', transcript(result));
      assert.notEqual(attrs.code, 'unsupported_flag', transcript(result));
      assert.doesNotMatch(result.stdout, /unsupported_flag/);
    }
  });
});

test('the settled branch tree is executable and every routed leaf has example-free -h help', () => {
  withIsolatedCaptureRoot((tempRoot) => {
    for (const branch of branches(SURFACE)) {
      const result = run([...branch.path, '-h'], tempRoot);
      assertExit(result, 0);
      assert.equal(result.stderr, '', `${branch.path.join(' ')}\n${transcript(result)}`);
      assert.deepEqual(tagNames(result.stdout, 'subcommand'), branch.children, branch.path.join(' '));
      assert.doesNotMatch(result.stdout, /\bexamples?\b/i, branch.path.join(' '));
      assert.doesNotMatch(result.stdout, /\busage\s*:/i, branch.path.join(' '));
    }

    const routedLeaves = leaves(SURFACE);
    assert.equal(routedLeaves.length, 37, 'the settled surface has 37 routed leaves');

    for (const commandPath of routedLeaves) {
      const command = commandPath.join(' ');
      const result = run([...commandPath, '-h'], tempRoot);
      assertExit(result, 0);
      assert.equal(result.stderr, '', `${command}\n${transcript(result)}`);
      assert.match(result.stdout, new RegExp(`^capture ${escapeRegExp(command)}(?:\\s|$)`), command);
      assert.match(result.stdout, /(?:^|\n)\s*input:/i, `${command}: missing input schema`);
      assert.match(result.stdout, /(?:^|\n)\s*output:/i, `${command}: missing output schema`);
      assert.match(result.stdout, /(?:^|\n)\s*effects:/i, `${command}: missing effects declaration`);
      assert.doesNotMatch(result.stdout, /<subcommand\b/, `${command}: leaf help rendered branch rows`);
      assert.doesNotMatch(result.stdout, /\bexamples?\b/i, `${command}: example text is forbidden`);
      assert.doesNotMatch(result.stdout, /\busage\s*:/i, `${command}: legacy Usage format is forbidden`);
    }
  });
});

// ---------------------------------------------------------------------------
// U23 final-binary matrices. These mirror the source-truth twins already
// proven against a temporary source bundle in test/cli-error-contract.test.ts
// (structured errors, env/numeric domains, world/no-browser failure),
// test/positional-cardinality.test.ts and test/session-positionals.test.ts
// (surplus-positional rejection), but run them here against the committed
// BIN via the existing run() harness. Until U23's single rebuild, BIN is the
// pre-refactor frozen blob, so several of these are expected RED against it
// (see the FROZEN-BIN-PENDING convention already used above) and only go
// green once U23 regenerates bin/capture from final source.
// ---------------------------------------------------------------------------

// FROZEN-BIN-PENDING (U23): unknown flags render the typed one-boundary
// <error code="unknown_flag" kind="invocation"> shape only once the frozen
// bin/capture is rebuilt from final source. Proven against source in
// test/cli-error-contract.test.ts (`assertOneError(['page', 'click', '--nonsense'])`).
test('the final binary renders a structured unknown-flag error for `page click --nonsense`, exit 1, one error block', () => {
  withIsolatedCaptureRoot((tempRoot) => {
    const result = run(['page', 'click', '--nonsense'], tempRoot);
    assertExit(result, 1);
    assert.equal(result.stderr, '', transcript(result));
    const attrs = errorAttributes(result.stdout);
    assert.equal(attrs.code, 'unknown_flag', transcript(result));
    assert.equal(attrs.kind, 'invocation', transcript(result));
    assert.ok(result.stdout.includes('--nonsense'), transcript(result));
  });
});

// FROZEN-BIN-PENDING (U23): a malformed/empty CDP_PORT renders a typed
// invalid_input error naming CDP_PORT only once the frozen bin/capture is
// rebuilt. Proven against source in test/cli-error-contract.test.ts
// (`assertOneError(['tab', 'list'], { CDP_PORT: '9222junk' })` and `{ CDP_PORT: '' }`).
test('a malformed or empty CDP_PORT is one structured invalid_input error at the final binary, never a crash', () => {
  withIsolatedCaptureRoot((tempRoot) => {
    for (const cdpPort of ['9222junk', '']) {
      const result = run(['tab', 'list'], tempRoot, { CDP_PORT: cdpPort });
      assertExit(result, 1);
      assert.equal(result.stderr, '', `CDP_PORT=${JSON.stringify(cdpPort)}\n${transcript(result)}`);
      const attrs = errorAttributes(result.stdout);
      assert.equal(attrs.code, 'invalid_input', `CDP_PORT=${JSON.stringify(cdpPort)}\n${transcript(result)}`);
      assert.ok(result.stdout.includes('CDP_PORT'), `CDP_PORT=${JSON.stringify(cdpPort)}\n${transcript(result)}`);
    }
  });
});

// FROZEN-BIN-PENDING (U23): the strict full-grammar integer parser (no sign,
// no partial token, exact min/max) only rejects these before the old bin is
// rebuilt. Every case below is attached to the read-only `session list` leaf
// so the flag is parsed to failure before any leaf-specific dispatch —
// leaf choice is irrelevant to which flag token fails. Proven against source
// in test/cli-error-contract.test.ts (`--settle -1`) and U16/A4's documented
// numeric domains for --port/--timeout/--limit.
test('numeric flag domains reject out-of-range or malformed tokens as one invalid_input error at the final binary', () => {
  withIsolatedCaptureRoot((tempRoot) => {
    const cases: Array<{ args: string[]; fragment: string }> = [
      { args: ['session', 'list', '--settle', '-1'], fragment: 'Invalid --settle' },
      { args: ['session', 'list', '--port', '0'], fragment: 'Invalid --port' },
      { args: ['session', 'list', '--port', '65536'], fragment: 'Invalid --port' },
      { args: ['session', 'list', '--port', '9222junk'], fragment: 'Invalid --port' },
      { args: ['session', 'list', '--timeout', '0'], fragment: 'Invalid --timeout' },
      { args: ['session', 'list', '--limit', '0'], fragment: 'Invalid --limit' },
    ];
    for (const { args, fragment } of cases) {
      const result = run(args, tempRoot);
      assertExit(result, 1);
      const attrs = errorAttributes(result.stdout);
      assert.equal(attrs.code, 'invalid_input', `${args.join(' ')}\n${transcript(result)}`);
      assert.ok(result.stdout.includes(fragment), `${args.join(' ')}\n${transcript(result)}`);
    }
  });
});

// FROZEN-BIN-PENDING (U23): the one-error-block, empty-stderr no-browser
// shape is proven against source as the last case in
// test/cli-error-contract.test.ts (`page elements --port 1`).
test('a deterministic no-browser command failure is normalized as one <error> block at the final binary', () => {
  withIsolatedCaptureRoot((tempRoot) => {
    const result = run(['page', 'elements', '--port', '1'], tempRoot);
    assertExit(result, 1);
    assert.equal(result.stderr, '', transcript(result));
    assert.match(result.stdout, /^<error\b[\s\S]*<\/error>\n$/, transcript(result));
    assert.equal((result.stdout.match(/<error\b/g) ?? []).length, 1, transcript(result));
  });
});

// FROZEN-BIN-PENDING (U23): U16's exact-cardinality-before-effects boundary.
// Restricted to read-only leaves (session list/har/view/log never touch
// CDP; page elements/tab list/cdp additionally pin --port 1 so even a
// pre-U16 binary that dispatches before validating cannot reach a real
// browser on this machine). Proven against source in
// test/positional-cardinality.test.ts and test/session-positionals.test.ts.
test('surplus positionals on read-only session/page/tab/cdp leaves are one invalid_input before any effect at the final binary', () => {
  withIsolatedCaptureRoot((tempRoot) => {
    const cases: Array<{ args: string[]; fragment: string }> = [
      { args: ['session', 'list', 'surplus'], fragment: 'session list received 1 positional argument(s); expected exactly 0' },
      { args: ['session', 'har', 'some-id', 'surplus'], fragment: 'session har received 2 positional argument(s); expected 0..1' },
      { args: ['session', 'view', 'some-id', 'surplus'], fragment: 'session view received 2 positional argument(s); expected exactly 1' },
      { args: ['session', 'log', '/tmp/does-not-matter.log', 'surplus'], fragment: 'session log received 2 positional argument(s); expected exactly 1' },
      { args: ['page', 'elements', 'surplus', '--port', '1'], fragment: 'page elements received 1 positional argument(s); expected exactly 0' },
      { args: ['tab', 'list', 'surplus', '--port', '1'], fragment: 'tab list received 1 positional argument(s); expected exactly 0' },
      { args: ['cdp', 'Browser.getVersion', 'Page.enable', '--port', '1'], fragment: 'cdp received 2 positional argument(s); expected 0..1' },
    ];
    for (const { args, fragment } of cases) {
      const result = run(args, tempRoot);
      assertExit(result, 1);
      const attrs = errorAttributes(result.stdout);
      assert.equal(attrs.code, 'invalid_input', `${args.join(' ')}\n${transcript(result)}`);
      assert.ok(result.stdout.includes(fragment), `${args.join(' ')}\n${transcript(result)}`);
    }
  });
});

// The committed pre-refactor blob had real `detect`/`har`/`exec` roots (see
// U22's hard-cut deletion list); `workflow`/`console` were never real roots.
// All five must be unknown_command once bin/capture is the final surface —
// this is expected GREEN even against the current frozen bin, since it
// already only has the seven settled roots... unless the frozen blob
// predates U22's cut and still answers one of these, in which case it is
// expected RED against the frozen bin specifically for that root (see the
// recorded expected-red list in the final report).
test('removed pre-refactor roots and aliases are unknown_command at the final binary', () => {
  withIsolatedCaptureRoot((tempRoot) => {
    for (const root of ['detect', 'har', 'exec', 'workflow', 'console']) {
      const result = run([root], tempRoot);
      assertExit(result, 1);
      assert.equal(errorAttributes(result.stdout).code, 'unknown_command', `${root}\n${transcript(result)}`);
    }
  });
});

// FROZEN-BIN-PENDING (U23): mirrors the --json error shape proven against
// source in test/cli-error-contract.test.ts (`page unknown --json`).
test('the final binary emits the same single error mirror under --json for an unknown branch leaf', () => {
  withIsolatedCaptureRoot((tempRoot) => {
    const result = run(['page', 'unknown', '--json'], tempRoot);
    assertExit(result, 1);
    assert.equal(result.stderr, '', transcript(result));
    const output = JSON.parse(result.stdout) as { tag: string; attrs: { code: string } };
    assert.equal(output.tag, 'error', transcript(result));
    assert.equal(output.attrs.code, 'unknown_command', transcript(result));
  });
});

/**
 * A compact fake CDP endpoint (node:http `/json/version` + a `ws`
 * WebSocketServer) for the U14 browser-target-provenance probe below: real
 * enough for `getBrowserClient`/`findTabById` to drive against it, with every
 * inbound protocol method recorded so the test can assert exactly which CDP
 * calls a `--browser` invocation made.
 */
async function startFakeCdpEndpoint(): Promise<{ port: number; calls: string[]; close: () => Promise<void> }> {
  const calls: string[] = [];
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;

  server.on('request', (req, res) => {
    if (req.url === '/json/version') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/fake` }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    ws.on('message', (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as { id: number; method: string };
      calls.push(msg.method);
      let result: unknown = {};
      if (msg.method === 'Target.getTargets') {
        result = { targetInfos: [{ targetId: 't1', type: 'page', title: '', url: 'https://example.test/' }] };
      } else if (msg.method === 'Target.attachToTarget') {
        result = { sessionId: 'flat-session-1' };
      } else if (msg.method === 'Browser.getVersion') {
        result = { protocolVersion: '1.3', product: 'FakeChrome/1.0', revision: 'r1', userAgent: 'fake', jsVersion: '1' };
      }
      ws.send(JSON.stringify({ id: msg.id, result }));
    });
  });

  return {
    port,
    calls,
    close: () => new Promise<void>((resolve) => { wss.close(); server.close(() => resolve()); }),
  };
}

// FROZEN-BIN-PENDING (U23): U14's targetSource-gated attach — `--browser`
// with only an ambient CDP_TARGET env (targetSource 'env') must never
// attach a flattened session; an explicit `--target` flag (targetSource
// 'flag') must. The source-truth twins for this exact distinction already
// live in test/cdp-command.test.ts (`runBrowserScope` driven with injected
// fake deps — no real socket); this is the same assertion proven instead at
// the compiled-binary boundary over a real CDP HTTP+WS endpoint.
test('browser-target provenance at the final binary: an ambient CDP_TARGET env never attaches; an explicit --target flag does', async () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'capture-conformance-cdp-'));
  const fake = await startFakeCdpEndpoint();
  try {
    const envResult = await runAsync(['cdp', 'Browser.getVersion', '--browser'], tempRoot, {
      CDP_PORT: String(fake.port),
      CDP_TARGET: 'env-target-must-be-ignored',
    });
    assertExit(envResult, 0);
    assert.ok(fake.calls.includes('Browser.getVersion'), fake.calls.join(','));
    assert.ok(!fake.calls.includes('Target.attachToTarget'), fake.calls.join(','));

    fake.calls.length = 0;
    const flagResult = await runAsync(['cdp', 'Browser.getVersion', '--browser', '--target', 't1'], tempRoot, {
      CDP_PORT: String(fake.port),
    });
    assertExit(flagResult, 0);
    assert.ok(fake.calls.includes('Target.attachToTarget'), fake.calls.join(','));
    assert.ok(fake.calls.includes('Browser.getVersion'), fake.calls.join(','));
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    await fake.close();
  }
});
