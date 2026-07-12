import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

// U05: the three input-dispatching page verbs (`page click`, `page type`,
// `page scroll`) on the unified live target grammar.
//
// Follows the repo's CDP-stub pattern (live-target-resolution.test.ts): a
// fake client answers exactly the CDP calls the leaf makes and a call log
// proves what was dispatched. The connection/session/screenshot seams are
// injected via click.ts's shared `__setPageInputDepsForTest`.

import { cmdPageClick, __setPageInputDepsForTest } from '../src/cdp/commands/page/click.js';
import { cmdPageType } from '../src/cdp/commands/page/type.js';
import { cmdPageScroll } from '../src/cdp/commands/page/scroll.js';
import { RecorderHeldClient } from '../src/cdp/recorder-client.js';
import type { ParsedArgs, CDPTarget } from '../src/cdp/types.js';
import type { ActiveSessionState } from '../src/session-context.js';

interface RecordedCall {
  method: string;
  params: Record<string, unknown>;
  mark?: string;
}

type Handlers = Record<string, (params: Record<string, unknown>) => unknown>;

function stubClient(handlers: Handlers, opts: { withMarkedLane?: boolean } = {}) {
  const calls: RecordedCall[] = [];
  const client: Record<string, unknown> & { calls: RecordedCall[] } = {
    calls,
    async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      calls.push({ method, params });
      const handler = handlers[method];
      if (!handler) throw new Error(`unexpected CDP call in test stub: ${method}`);
      return handler(params);
    },
  };
  if (opts.withMarkedLane) {
    client.sendMarked = async (method: string, params: Record<string, unknown>, mark: string) => {
      calls.push({ method, params, mark });
      const handler = handlers[method];
      if (!handler) throw new Error(`unexpected marked CDP call in test stub: ${method}`);
      return handler(params);
    };
  }
  return client;
}

// Fixture AX tree: two buttons sharing the "Send" substring plus a textbox.
const AX_NODES = [
  { nodeId: '1', backendDOMNodeId: 100, role: { value: 'RootWebArea' }, name: { value: 'Fixture' } },
  { nodeId: '5', backendDOMNodeId: 201, role: { value: 'button' }, name: { value: 'Send' } },
  { nodeId: '6', backendDOMNodeId: 202, role: { value: 'button' }, name: { value: 'Send later' } },
  { nodeId: '7', backendDOMNodeId: 203, role: { value: 'textbox' }, name: { value: 'Message' } },
];

function axHandlers(): Handlers {
  return {
    'Accessibility.enable': () => ({}),
    'Accessibility.disable': () => ({}),
    'DOM.enable': () => ({}),
    'Accessibility.getFullAXTree': () => ({ nodes: AX_NODES }),
  };
}

function clickDispatchHandlers(): Handlers {
  return {
    'DOM.scrollIntoViewIfNeeded': () => ({}),
    'DOM.getBoxModel': () => ({ model: { content: [10, 10, 30, 10, 30, 20, 10, 20] } }),
    'Input.dispatchMouseEvent': () => ({}),
    'Input.insertText': () => ({}),
  };
}

// `.feed` resolves to one node; the scroll dispatch drives its scrollTop.
function cssScrollHandlers(resultingScrollTop: number): Handlers {
  return {
    'DOM.enable': () => ({}),
    'DOM.getDocument': () => ({ root: { nodeId: 1 } }),
    'DOM.querySelectorAll': () => ({ nodeIds: [11] }),
    'DOM.describeNode': () => ({ node: { backendNodeId: 111 } }),
    'Accessibility.getPartialAXTree': () => ({
      nodes: [{ nodeId: 'ax-111', backendDOMNodeId: 111, role: { value: 'feed' }, name: { value: 'Feed' } }],
    }),
    'DOM.resolveNode': () => ({ object: { objectId: 'obj-1' } }),
    'Runtime.callFunctionOn': () => ({ result: { value: resultingScrollTop } }),
  };
}

const FAKE_TAB: CDPTarget = { id: 'tab-1', title: '', url: 'https://fixture.test/', type: 'page' };

const FAKE_SESSION: ActiveSessionState = {
  sessionId: 'sess-u05',
  dir: '/tmp/capture-sessions/sess-u05',
  harId: null,
  targetId: 'tab-1',
  stepCount: 0,
};

interface InstalledDeps {
  settleSeen: number | undefined;
  /** parsed.command as the connection seam saw it — connection.ts derives
   * the recorder landmark label from it, so it must be the VERB, not the
   * 'page' branch token (U06's heads-up: 'page' would mislabel landmarks and,
   * for type, leak typed text past deriveActionLabel's type-guard). */
  commandSeen: string | undefined;
  shots: Array<{ action: string; label: string; noScreenshot: boolean | undefined }>;
  restore: () => void;
}

/** Injects the connection/session/screenshot seams around a stub client. */
function installDeps(
  client: { send: (m: string, p?: Record<string, unknown>) => Promise<unknown> },
  opts: { session?: boolean; screenshotPath?: string | null } = {},
): InstalledDeps {
  const state: InstalledDeps = { settleSeen: undefined, commandSeen: undefined, shots: [], restore: () => {} };
  state.restore = __setPageInputDepsForTest({
    withConnection: (async (parsed: ParsedArgs, fn: (c: unknown, t: CDPTarget) => Promise<unknown>, o?: { settle?: number }) => {
      state.settleSeen = o?.settle;
      state.commandSeen = parsed.command;
      return fn(client, FAKE_TAB);
    }) as never,
    getActiveSession: () => (opts.session ? FAKE_SESSION : null),
    autoScreenshot: (async (_c: unknown, action: string, label: string, noScreenshot?: boolean) => {
      state.shots.push({ action, label, noScreenshot });
      if (noScreenshot) return null;
      return opts.screenshotPath ?? null;
    }) as never,
  });
  return state;
}

async function runCmd(fn: () => Promise<void>): Promise<{ stdout: string; exitCode: number | undefined }> {
  const origWrite = process.stdout.write.bind(process.stdout);
  const origLog = console.log;
  const origExit = process.exitCode;
  process.exitCode = undefined;
  let out = '';
  // TEE rather than swallow: the test reporter's own events flush
  // asynchronously and can land inside this window — swallowing them makes
  // the runner silently lose earlier tests from its stream.
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    out += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
    return (origWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof process.stdout.write;
  console.log = (value?: unknown) => {
    out += `${String(value ?? '')}\n`;
  };
  try {
    await fn();
    return { stdout: out, exitCode: process.exitCode as number | undefined };
  } finally {
    process.stdout.write = origWrite;
    console.log = origLog;
    process.exitCode = origExit;
  }
}

function parsedFor(positional: string[], flags: Partial<ParsedArgs> = {}): ParsedArgs {
  return { command: 'page', positional, ...flags } as ParsedArgs;
}

// ---------------------------------------------------------------------------
// page click
// ---------------------------------------------------------------------------

test('page click: an ambiguous ax: target exits 1 with the candidate list and backend:<id> recovery', async () => {
  const client = stubClient(axHandlers());
  const deps = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageClick(parsedFor(['ax:Send']), []));
    assert.equal(exitCode, 1);
    assert.match(stdout, /<error command="page click" code="ambiguous_target">/);
    assert.match(stdout, /matched 2 live elements; expected exactly one/);
    assert.match(stdout, /button "Send" — backend:201/);
    assert.match(stdout, /button "Send later" — backend:202/);
    assert.match(stdout, /follow_up: .*backend:<id>/);
    // No click was dispatched on an ambiguous target.
    assert.ok(!client.calls.some((c) => c.method === 'Input.dispatchMouseEvent'));
  } finally {
    deps.restore();
  }
});

test('page click: `ax:…` substring-resolves a single match and dispatches at the element center', async () => {
  const client = stubClient({ ...axHandlers(), ...clickDispatchHandlers() });
  const deps = installDeps(client, { session: true, screenshotPath: '/tmp/sess/shots/01-click.png' });
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageClick(parsedFor(['ax:later']), []));
    assert.equal(exitCode, undefined);
    // Block carries the resolved identity, backendNodeId included.
    assert.match(stdout, /<clicked backend-node-id="202" role="button" name="Send later">/);
    assert.match(stdout, /clicked button "Send later" \(backend:202\) at x=20 y=15/);
    assert.match(stdout, /screenshot: \/tmp\/sess\/shots\/01-click\.png/);
    const mouse = client.calls.filter((c) => c.method === 'Input.dispatchMouseEvent');
    assert.deepEqual(
      mouse.map((c) => [c.params.type, c.params.x, c.params.y]),
      [
        ['mousePressed', 20, 15],
        ['mouseReleased', 20, 15],
      ],
    );
    assert.deepEqual(deps.shots, [{ action: 'click', label: 'ax:later', noScreenshot: undefined }]);
    // The connection is opened as the VERB so a routed click's landmark
    // label derives as `click:<target>`, never `page:<target>`.
    assert.equal(deps.commandSeen, 'click');
  } finally {
    deps.restore();
  }
});

test('page click: a text: target is rejected naming the accepted prefixes, without touching the page', async () => {
  const client = stubClient({});
  const deps = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageClick(parsedFor(['text:x']), []));
    assert.equal(exitCode, 1);
    assert.match(stdout, /<error command="page click" code="unsupported_prefix">/);
    assert.match(stdout, /CSS selector, ax:<name>, axid:<id>, backend:<id>/);
    assert.equal(client.calls.length, 0);
  } finally {
    deps.restore();
  }
});

test('page click: no-match exits 1 and names page elements as the recovery', async () => {
  const client = stubClient(axHandlers());
  const deps = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageClick(parsedFor(['ax:nonexistent']), []));
    assert.equal(exitCode, 1);
    assert.match(stdout, /<error command="page click" code="no_match">/);
    assert.match(stdout, /follow_up: .*page elements/);
  } finally {
    deps.restore();
  }
});

test('page click: missing target is a structured invalid_input error', async () => {
  const client = stubClient({});
  const deps = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageClick(parsedFor([]), []));
    assert.equal(exitCode, 1);
    assert.match(stdout, /<error command="page click" code="invalid_input">/);
    assert.equal(client.calls.length, 0);
  } finally {
    deps.restore();
  }
});

test('page click: --no-screenshot opts out and the block carries no screenshot line', async () => {
  const client = stubClient({ ...axHandlers(), ...clickDispatchHandlers() });
  const deps = installDeps(client, { session: true, screenshotPath: '/tmp/never.png' });
  try {
    const { stdout } = await runCmd(() => cmdPageClick(parsedFor(['ax:later'], { noScreenshot: true }), []));
    assert.match(stdout, /<clicked /);
    assert.ok(!stdout.includes('screenshot:'));
    assert.deepEqual(deps.shots, [{ action: 'click', label: 'ax:later', noScreenshot: true }]);
  } finally {
    deps.restore();
  }
});

// ---------------------------------------------------------------------------
// Settle defaults — keyed off active-session presence; --settle (incl. 0) wins
// ---------------------------------------------------------------------------

test('settle defaults: click 1000/2500, type 500/1500, scroll 1000/2500; --settle 0 overrides', async () => {
  // click
  for (const [session, expected] of [
    [false, 1000],
    [true, 2500],
  ] as const) {
    const client = stubClient({ ...axHandlers(), ...clickDispatchHandlers() });
    const deps = installDeps(client, { session });
    try {
      await runCmd(() => cmdPageClick(parsedFor(['ax:later']), []));
      assert.equal(deps.settleSeen, expected, `click settle with session=${session}`);
    } finally {
      deps.restore();
    }
  }
  // type
  for (const [session, expected] of [
    [false, 500],
    [true, 1500],
  ] as const) {
    const client = stubClient(clickDispatchHandlers());
    const deps = installDeps(client, { session });
    try {
      await runCmd(() => cmdPageType(parsedFor(['hello']), []));
      assert.equal(deps.settleSeen, expected, `type settle with session=${session}`);
    } finally {
      deps.restore();
    }
  }
  // scroll
  for (const [session, expected] of [
    [false, 1000],
    [true, 2500],
  ] as const) {
    const client = stubClient(cssScrollHandlers(100));
    const deps = installDeps(client, { session });
    try {
      await runCmd(() => cmdPageScroll(parsedFor(['.feed'], { to: 'bottom' }), []));
      assert.equal(deps.settleSeen, expected, `scroll settle with session=${session}`);
    } finally {
      deps.restore();
    }
  }
  // explicit --settle 0 wins even in a session
  const client = stubClient({ ...axHandlers(), ...clickDispatchHandlers() });
  const deps = installDeps(client, { session: true });
  try {
    await runCmd(() => cmdPageClick(parsedFor(['ax:later'], { settle: 0 }), []));
    assert.equal(deps.settleSeen, 0);
  } finally {
    deps.restore();
  }
});

// ---------------------------------------------------------------------------
// page type
// ---------------------------------------------------------------------------

test('page type: without --into inserts into the focused element and echoes the agent-supplied text', async () => {
  const client = stubClient(clickDispatchHandlers());
  const deps = installDeps(client, { session: true, screenshotPath: '/tmp/sess/shots/02-type.png' });
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageType(parsedFor(['hello world']), []));
    assert.equal(exitCode, undefined);
    assert.match(stdout, /<typed>/);
    assert.match(stdout, /typed "hello world" into the focused element/);
    const insert = client.calls.find((c) => c.method === 'Input.insertText');
    assert.ok(insert);
    assert.equal(insert.params.text, 'hello world');
    // The screenshot label identifies the field, never the typed content.
    assert.deepEqual(deps.shots, [{ action: 'type', label: 'focused element', noScreenshot: undefined }]);
    // The connection is opened as command 'type' — that is what engages
    // deriveActionLabel's type-guard so the typed text never becomes a
    // recorder landmark label.
    assert.equal(deps.commandSeen, 'type');
  } finally {
    deps.restore();
  }
});

test('page type: --into resolves the field, focus-clicks it, and the block carries its backendNodeId', async () => {
  const client = stubClient({ ...axHandlers(), ...clickDispatchHandlers() });
  const deps = installDeps(client, { session: true, screenshotPath: '/tmp/sess/shots/03-type.png' });
  try {
    const { stdout } = await runCmd(() => cmdPageType(parsedFor(['hi'], { into: 'ax:Message' }), []));
    assert.match(stdout, /<typed backend-node-id="203" role="textbox" name="Message">/);
    assert.match(stdout, /typed "hi" into textbox "Message" \(backend:203\)/);
    assert.match(stdout, /screenshot: \/tmp\/sess\/shots\/03-type\.png/);
    const methods = client.calls.map((c) => c.method);
    assert.ok(methods.indexOf('Input.insertText') > methods.lastIndexOf('Input.dispatchMouseEvent'));
    assert.deepEqual(deps.shots, [{ action: 'type', label: 'ax:Message', noScreenshot: undefined }]);
  } finally {
    deps.restore();
  }
});

test('page type: an ambiguous --into target exits 1 with candidates and never types', async () => {
  const client = stubClient(axHandlers());
  const deps = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageType(parsedFor(['secret'], { into: 'ax:Send' }), []));
    assert.equal(exitCode, 1);
    assert.match(stdout, /<error command="page type" code="ambiguous_target">/);
    assert.match(stdout, /backend:201/);
    assert.ok(!client.calls.some((c) => c.method === 'Input.insertText'));
    // The typed text never appears in the error output.
    assert.ok(!stdout.includes('secret'));
  } finally {
    deps.restore();
  }
});

// ---------------------------------------------------------------------------
// page scroll
// ---------------------------------------------------------------------------

test('page scroll: --to bottom moves the container and auto-screenshots', async () => {
  const client = stubClient(cssScrollHandlers(640));
  const deps = installDeps(client, { session: true, screenshotPath: '/tmp/sess/shots/04-scroll.png' });
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageScroll(parsedFor(['.feed'], { to: 'bottom' }), []));
    assert.equal(exitCode, undefined);
    assert.match(stdout, /<scrolled backend-node-id="111" role="feed" name="Feed" to="bottom" scroll-top="640">/);
    assert.match(stdout, /scrolled feed "Feed" \(backend:111\) to bottom — scrollTop now 640/);
    assert.match(stdout, /screenshot: \/tmp\/sess\/shots\/04-scroll\.png/);
    const scrollCall = client.calls.find((c) => c.method === 'Runtime.callFunctionOn');
    assert.ok(scrollCall, 'the scroll must drive scrollTop in-page');
    assert.deepEqual(scrollCall.params.arguments, [{ value: 'bottom' }]);
    assert.deepEqual(deps.shots, [{ action: 'scroll', label: '.feed', noScreenshot: undefined }]);
    // The connection is opened as the VERB so a routed scroll's
    // connection-level label derives as `scroll:<target>`.
    assert.equal(deps.commandSeen, 'scroll');
  } finally {
    deps.restore();
  }
});

test('page scroll: missing or invalid --to is a structured invalid_input error before any CDP call', async () => {
  for (const flags of [{}, { to: 'sideways' }] as Array<Partial<ParsedArgs>>) {
    const client = stubClient({});
    const deps = installDeps(client);
    try {
      const { stdout, exitCode } = await runCmd(() => cmdPageScroll(parsedFor(['.feed'], flags), []));
      assert.equal(exitCode, 1);
      assert.match(stdout, /<error command="page scroll" code="invalid_input">/);
      assert.match(stdout, /top|bottom/);
      assert.equal(client.calls.length, 0);
    } finally {
      deps.restore();
    }
  }
});

test('page scroll: an ambiguous target exits 1 with candidates', async () => {
  const client = stubClient(axHandlers());
  const deps = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageScroll(parsedFor(['ax:Send'], { to: 'top' }), []));
    assert.equal(exitCode, 1);
    assert.match(stdout, /<error command="page scroll" code="ambiguous_target">/);
    assert.match(stdout, /backend:201/);
    assert.match(stdout, /backend:202/);
  } finally {
    deps.restore();
  }
});

test('page scroll: the one mutating call carries the landmark when the transport records marks', async () => {
  const client = stubClient(cssScrollHandlers(999), { withMarkedLane: true });
  const deps = installDeps(client);
  try {
    await runCmd(() => cmdPageScroll(parsedFor(['.feed'], { to: 'bottom' }), []));
    const scrollCall = client.calls.find((c) => c.method === 'Runtime.callFunctionOn');
    assert.equal(scrollCall?.mark, 'scroll:.feed,to=bottom');
    const resolveCall = client.calls.find((c) => c.method === 'DOM.resolveNode');
    assert.equal(resolveCall?.mark, undefined, 'node resolution is incidental — never marked');
  } finally {
    deps.restore();
  }
});

// ---------------------------------------------------------------------------
// Recorder routing — the landmark fires for all three verbs through a real
// RecorderHeldClient (scroll needs the sendMarked lane added in this unit).
// ---------------------------------------------------------------------------

function startFakeRecorderServer(socketPath: string): {
  seen: Array<Record<string, unknown>>;
  close: () => Promise<void>;
} {
  const seen: Array<Record<string, unknown>> = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const idx = buffer.indexOf('\n');
      if (idx < 0) return;
      const req = JSON.parse(buffer.slice(0, idx)) as Record<string, unknown>;
      seen.push(req);
      const resp = { reqId: req.reqId, ok: true, type: 'cdp', result: { result: { value: 640 } } };
      socket.write(`${JSON.stringify(resp)}\n`);
    });
  });
  server.listen(socketPath);
  return {
    seen,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

test('recorder routing: click, type, and scroll each land exactly one labeled landmark', async () => {
  const socketPath = path.join(os.tmpdir(), `u05-rec-${process.pid}-${Date.now()}.sock`);
  fs.rmSync(socketPath, { force: true });
  const server = startFakeRecorderServer(socketPath);
  try {
    const held = new RecorderHeldClient({ socketPath, actionLabel: 'page:target' });

    // click — the press edge auto-marks; the release does not.
    await held.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 1, y: 1 });
    await held.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 1, y: 1 });
    // type — Input.insertText auto-marks; resolution calls do not.
    await held.send('DOM.enable', {});
    await held.send('Input.insertText', { text: 'hello' });
    // scroll — the explicit marked lane this unit adds.
    await held.sendMarked('Runtime.callFunctionOn', { objectId: 'obj-1' }, 'scroll:.feed,to=bottom');

    const marks = server.seen.map((r) => [r.method, r.mark]);
    assert.deepEqual(marks, [
      ['Input.dispatchMouseEvent', 'page:target'],
      ['Input.dispatchMouseEvent', undefined],
      ['DOM.enable', undefined],
      ['Input.insertText', 'page:target'],
      ['Runtime.callFunctionOn', 'scroll:.feed,to=bottom'],
    ]);
  } finally {
    await server.close();
    fs.rmSync(socketPath, { force: true });
  }
});

// ---------------------------------------------------------------------------
// Surface hygiene
// ---------------------------------------------------------------------------

test('no --role anywhere in the three leaf sources; help states settle defaults inline', async () => {
  const leafDir = path.join(process.cwd(), 'src', 'cdp', 'commands', 'page');
  for (const leaf of ['click.ts', 'type.ts', 'scroll.ts']) {
    const source = fs.readFileSync(path.join(leafDir, leaf), 'utf-8');
    assert.ok(!source.includes('--role'), `${leaf} must not mention --role`);
  }

  // Each leaf's -h states its own defaults inline and exits 0 without connecting.
  const expectations: Array<{ run: () => Promise<void>; defaults: [number, number] }> = [
    { run: () => cmdPageClick(parsedFor([], { help: true }), []), defaults: [1000, 2500] },
    { run: () => cmdPageType(parsedFor([], { help: true }), []), defaults: [500, 1500] },
    { run: () => cmdPageScroll(parsedFor([], { help: true }), []), defaults: [1000, 2500] },
  ];
  for (const { run, defaults } of expectations) {
    const { stdout, exitCode } = await runCmd(run);
    assert.equal(exitCode, undefined);
    assert.ok(stdout.includes(`default: ${defaults[0]}`), `help must state the standalone default ${defaults[0]}`);
    assert.ok(stdout.includes(`${defaults[1]} with an active session`), `help must state the in-session default ${defaults[1]}`);
    assert.ok(!/example/i.test(stdout), 'leaf help carries no examples');
  }
});
