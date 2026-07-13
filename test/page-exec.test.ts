import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// U09: `page exec` — inline result under the generous cap, oversize spill to
// a private artifact file (active session's page/ dir, else a one-shot
// artifact dir), full fidelity under --json.
//
// Follows the repo's CDP-stub pattern (page-input-verbs.test.ts): a fake
// client answers exactly the CDP calls the leaf makes and a call log proves
// what was dispatched. The connection/session/oneshot seams are injected via
// exec.ts's `__setPageExecDepsForTest`.

import { cmdPageExec, __setPageExecDepsForTest } from '../src/cdp/commands/page/exec.js';
import { captureError, CaptureError } from '../src/errors.js';
import { createOneshotSession, type OneshotSession } from '../src/session/commands.js';
import { CAPTURE_ROOT } from '../src/session/artifacts.js';
import type { ParsedArgs, CDPTarget } from '../src/cdp/types.js';
import type { ActiveSessionState } from '../src/session-context.js';

interface RecordedCall {
  method: string;
  params: Record<string, unknown>;
}

type Handlers = Record<string, (params: Record<string, unknown>) => unknown>;

function stubClient(handlers: Handlers) {
  const calls: RecordedCall[] = [];
  return {
    calls,
    async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      calls.push({ method, params });
      const handler = handlers[method];
      if (!handler) throw new Error(`unexpected CDP call in test stub: ${method}`);
      return handler(params);
    },
  };
}

function execHandlers(evalResponse: unknown): Handlers {
  return {
    'Emulation.setFocusEmulationEnabled': () => ({}),
    'Runtime.evaluate': () => evalResponse,
  };
}

const FAKE_TAB: CDPTarget = { id: 'tab-1', title: '', url: 'https://fixture.test/', type: 'page' };

function makeFakeSession(): ActiveSessionState {
  const sessionId = `sess-u09-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return {
    sessionId,
    dir: path.join(CAPTURE_ROOT, sessionId),
    harId: null,
    targetId: 'tab-1',
    stepCount: 0,
  };
}

interface InstalledDeps {
  settleSeen: number | undefined;
  /** parsed.command as the connection seam saw it — connection.ts derives
   * its per-invocation label from it, so it must be the VERB, never the
   * 'page' branch token. */
  commandSeen: string | undefined;
  oneshots: OneshotSession[];
  restore: () => void;
}

/** Injects the connection/session/oneshot seams around a stub client. */
function installDeps(
  client: { send: (m: string, p?: Record<string, unknown>) => Promise<unknown> },
  opts: { session?: ActiveSessionState } = {},
): InstalledDeps {
  const state: InstalledDeps = { settleSeen: undefined, commandSeen: undefined, oneshots: [], restore: () => {} };
  state.restore = __setPageExecDepsForTest({
    withPageAction: (async (
      parsed: ParsedArgs,
      opts: { settleMs: number },
      fn: (c: unknown, t: CDPTarget) => Promise<unknown>,
    ) => {
      state.settleSeen = opts?.settleMs;
      state.commandSeen = parsed.command;
      const result = await fn(client, FAKE_TAB);
      const waitedMs = opts.settleMs === 0 ? 0 : opts.settleMs + 7;
      return { result, settle: { requestedMs: opts.settleMs, waitedMs, completed: true } };
    }) as never,
    getActiveSession: () => opts.session ?? null,
    createOneshotSession: ((kind: 'measure' | 'motion' | 'page') => {
      const oneshot = createOneshotSession(kind);
      state.oneshots.push(oneshot);
      return oneshot;
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

/** The one spill file inside `dir`, with private-perm assertions. */
function theSpillFileIn(dir: string): { filePath: string; content: string } {
  assert.ok(fs.existsSync(dir), `spill dir must exist: ${dir}`);
  const dirMode = fs.statSync(dir).mode & 0o777;
  assert.equal(dirMode, 0o700, 'spill dir must be private (0700)');
  const files = fs.readdirSync(dir);
  assert.equal(files.length, 1, `expected exactly one spill file in ${dir}`);
  const filePath = path.join(dir, files[0]);
  const fileMode = fs.statSync(filePath).mode & 0o777;
  assert.equal(fileMode, 0o600, 'spill file must be private (0600)');
  return { filePath, content: fs.readFileSync(filePath, 'utf-8') };
}

// A value whose JSON serialization exceeds the 4000-char generous cap.
const BIG_VALUE = 'x'.repeat(6000);
const BIG_PAYLOAD = JSON.stringify(BIG_VALUE); // 6002 chars

// ---------------------------------------------------------------------------
// Small result — inline, no spill
// ---------------------------------------------------------------------------

test('page exec: a small result renders whole inline with no spill file', async () => {
  const client = stubClient(execHandlers({ result: { value: { ok: true, n: 1 } } }));
  const deps = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageExec(parsedFor(['({ok: true, n: 1})']), []));
    assert.equal(exitCode, undefined);
    const smallPayload = JSON.stringify({ ok: true, n: 1 });
    assert.ok(stdout.includes(`<exec-result result-chars="${smallPayload.length}">`));
    assert.ok(stdout.includes('result: {"ok":true,"n":1}'));
    assert.ok(!stdout.includes('result-file'), 'no spill attr for a small result');
    assert.ok(!stdout.includes('written whole'), 'no spill fact for a small result');
    assert.equal(deps.oneshots.length, 0, 'no oneshot dir created for a small result');

    const evalCall = client.calls.find((c) => c.method === 'Runtime.evaluate');
    assert.ok(evalCall, 'the code must run via Runtime.evaluate');
    assert.equal(evalCall.params.awaitPromise, true);
    assert.equal(evalCall.params.returnByValue, true);
    assert.ok(String(evalCall.params.expression).includes('({ok: true, n: 1})'));
    // Focus emulation is a single state transaction around the evaluate:
    // enable(true) precedes evaluation (so triggered requests aren't deferred),
    // and disable(false) is the last call (restored before the command returns).
    assert.equal(client.calls.length, 3);
    assert.equal(client.calls[0].method, 'Emulation.setFocusEmulationEnabled');
    assert.equal(client.calls[0].params.enabled, true);
    assert.equal(client.calls[1].method, 'Runtime.evaluate');
    assert.equal(client.calls[2].method, 'Emulation.setFocusEmulationEnabled');
    assert.equal(client.calls[2].params.enabled, false);
    // The connection is opened as the VERB, never the 'page' branch token.
    assert.equal(deps.commandSeen, 'exec');
    // Default settle is 3000ms.
    assert.equal(deps.settleSeen, 3000);
    // The block reports the MEASURED settle (waited 3007 != requested 3000),
    // proving it renders the measured wait rather than echoing the option.
    assert.match(stdout, /settle: requested 3000ms, waited 3007ms/);
  } finally {
    deps.restore();
  }
});

test('page exec: a typed CaptureError from the wrapper (recorder_unavailable) propagates unrelabeled, not exec_failed', async () => {
  const baseDeps = installDeps({ send: async () => ({}) });
  const restore = __setPageExecDepsForTest({
    withPageAction: (async () => {
      throw captureError('precondition', 'recorder_unavailable', 'the recorder handle is gone');
    }) as never,
  });
  try {
    let thrown: unknown;
    const { stdout } = await runCmd(async () => {
      try {
        await cmdPageExec(parsedFor(['1'], { target: 'tab-1' }), []);
      } catch (err) {
        thrown = err;
      }
    });
    assert.ok(thrown instanceof CaptureError, 'the typed failure must propagate to the root boundary');
    assert.equal((thrown as CaptureError).descriptor.code, 'recorder_unavailable');
    assert.ok(!stdout.includes('exec_failed'), 'a recorder_unavailable must never be relabeled exec_failed');
  } finally {
    restore();
    baseDeps.restore();
  }
});

test('page exec: --settle 0 overrides the 3000ms default', async () => {
  const client = stubClient(execHandlers({ result: { value: 1 } }));
  const deps = installDeps(client);
  try {
    await runCmd(() => cmdPageExec(parsedFor(['1'], { settle: 0 }), []));
    assert.equal(deps.settleSeen, 0);
  } finally {
    deps.restore();
  }
});

test('page exec: --file reads the source from disk', async () => {
  const srcPath = path.join(os.tmpdir(), `u09-exec-src-${process.pid}.js`);
  fs.writeFileSync(srcPath, 'document.title');
  const client = stubClient(execHandlers({ result: { value: 'Fixture' } }));
  const deps = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageExec(parsedFor([], { file: srcPath }), []));
    assert.equal(exitCode, undefined);
    assert.match(stdout, /<exec-result /);
    assert.ok(stdout.includes('result: "Fixture"'));
    const evalCall = client.calls.find((c) => c.method === 'Runtime.evaluate');
    assert.ok(String(evalCall?.params.expression).includes('document.title'));
  } finally {
    deps.restore();
    fs.rmSync(srcPath, { force: true });
  }
});

// ---------------------------------------------------------------------------
// Oversize result — capped inline + whole-content spill
// ---------------------------------------------------------------------------

test('page exec: an oversize result is capped inline and spilled whole into the active session page/ dir', async () => {
  const session = makeFakeSession();
  const client = stubClient(execHandlers({ result: { value: BIG_VALUE } }));
  const deps = installDeps(client, { session });
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageExec(parsedFor(['big()']), []));
    assert.equal(exitCode, undefined);

    // Inline value is generously capped (well past the 200-char default),
    // then truncated with the cap marker.
    assert.ok(stdout.includes(`result: "${'x'.repeat(3999)}`), 'inline must carry the first 4000 chars');
    assert.match(stdout, /…\[\+2002 chars\]/);

    // The spill file holds the WHOLE payload, private perms, and its
    // absolute path appears in the block (attr + fact line).
    const { filePath, content } = theSpillFileIn(path.join(session.dir, 'page'));
    assert.equal(content, BIG_PAYLOAD);
    assert.ok(stdout.includes(`result-file="${filePath}"`));
    assert.ok(stdout.includes(`full result (${BIG_PAYLOAD.length} chars) written whole to ${filePath}`));
    assert.equal(deps.oneshots.length, 0, 'an active session must not spawn a oneshot dir');
  } finally {
    deps.restore();
    fs.rmSync(session.dir, { recursive: true, force: true });
  }
});

test('page exec: a sessionless oversize result spills into a oneshot page/ dir, never /tmp loose', async () => {
  const client = stubClient(execHandlers({ result: { value: BIG_VALUE } }));
  const deps = installDeps(client);
  let oneshotDir: string | undefined;
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageExec(parsedFor(['big()']), []));
    assert.equal(exitCode, undefined);

    assert.equal(deps.oneshots.length, 1, 'exactly one oneshot dir for the spill');
    const oneshot = deps.oneshots[0];
    oneshotDir = oneshot.dir;
    assert.equal(oneshot.kind, 'page');
    assert.ok(oneshot.dir.startsWith(CAPTURE_ROOT + path.sep), 'oneshot dir lives under CAPTURE_ROOT');
    assert.ok(path.basename(oneshot.dir).startsWith('oneshot-'));
    assert.equal(path.basename(oneshot.artifactsDir), 'page');

    const { filePath, content } = theSpillFileIn(oneshot.artifactsDir);
    assert.equal(content, BIG_PAYLOAD);
    assert.ok(stdout.includes(filePath), 'the rendered block carries the spill file path');
  } finally {
    deps.restore();
    if (oneshotDir) fs.rmSync(oneshotDir, { recursive: true, force: true });
  }
});

test('page exec: --json mirrors the oversize result at full fidelity and still writes the spill', async () => {
  const session = makeFakeSession();
  const client = stubClient(execHandlers({ result: { value: BIG_VALUE } }));
  const deps = installDeps(client, { session });
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageExec(parsedFor(['big()'], { json: true }), []));
    assert.equal(exitCode, undefined);
    const parsed = JSON.parse(stdout) as {
      tag: string;
      attrs: Record<string, unknown>;
      sections: string[];
    };
    assert.equal(parsed.tag, 'exec-result');
    assert.equal(parsed.attrs['result-chars'], BIG_PAYLOAD.length);
    // Full fidelity: the whole payload inline, no cap marker.
    assert.equal(parsed.sections[0], `result: ${BIG_PAYLOAD}`);

    const { filePath, content } = theSpillFileIn(path.join(session.dir, 'page'));
    assert.equal(content, BIG_PAYLOAD);
    assert.equal(parsed.attrs['result-file'], filePath);
  } finally {
    deps.restore();
    fs.rmSync(session.dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Errors — structured, exit 1
// ---------------------------------------------------------------------------

test('page exec: a page exception is a structured exec_exception error', async () => {
  const client = stubClient(
    execHandlers({ exceptionDetails: { exception: { description: 'TypeError: boom at <anonymous>:1:1' } } }),
  );
  const deps = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageExec(parsedFor(['boom()']), []));
    assert.equal(exitCode, 1);
    assert.match(stdout, /<error command="page exec" code="exec_exception">/);
    assert.ok(stdout.includes('TypeError: boom'));
    // A page exception is still a successful evaluate, so the focus override is
    // restored: the last call is disable(false), and the code stays exec_exception.
    const last = client.calls[client.calls.length - 1];
    assert.equal(last.method, 'Emulation.setFocusEmulationEnabled');
    assert.equal(last.params.enabled, false);
  } finally {
    deps.restore();
  }
});

test('page exec: missing code, code+--file together, and an unreadable --file are structured errors before any CDP call', async () => {
  const cases: Array<{ positional: string[]; flags: Partial<ParsedArgs>; code: string }> = [
    { positional: [], flags: {}, code: 'invalid_input' },
    { positional: ['1'], flags: { file: '/tmp/whatever.js' }, code: 'invalid_input' },
    { positional: [], flags: { file: path.join(os.tmpdir(), 'u09-definitely-missing.js') }, code: 'file_unreadable' },
  ];
  for (const c of cases) {
    const client = stubClient({});
    const deps = installDeps(client);
    try {
      const { stdout, exitCode } = await runCmd(() => cmdPageExec(parsedFor(c.positional, c.flags), []));
      assert.equal(exitCode, 1);
      assert.match(stdout, new RegExp(`<error command="page exec" code="${c.code}">`));
      assert.equal(client.calls.length, 0, 'no CDP call on invalid input');
    } finally {
      deps.restore();
    }
  }
});

test('page exec: a connection failure is a structured exec_failed error', async () => {
  const deps = installDeps({ send: async () => ({}) });
  const restore = __setPageExecDepsForTest({
    withPageAction: (async () => {
      throw new Error('No tab found for target "nope"');
    }) as never,
  });
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageExec(parsedFor(['1'], { target: 'nope' }), []));
    assert.equal(exitCode, 1);
    assert.match(stdout, /<error command="page exec" code="exec_failed">/);
    assert.ok(stdout.includes('No tab found'));
  } finally {
    restore();
    deps.restore();
  }
});

// ---------------------------------------------------------------------------
// Focus-emulation scope — exactly-once disable, structured failures (U17)
// ---------------------------------------------------------------------------

test('page exec: a lost enable response still sends the disable and never evaluates', async () => {
  // Restoration ownership is claimed BEFORE the enable is awaited, so even if
  // the enable response is lost the matching disable(false) is still sent, no
  // evaluate runs, and the enable failure surfaces as exec_failed.
  const client = stubClient({
    'Emulation.setFocusEmulationEnabled': (params) => {
      if (params.enabled === true) throw new Error('enable response lost');
      return {};
    },
    'Runtime.evaluate': () => {
      throw new Error('the code must never run after a failed enable');
    },
  });
  const deps = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageExec(parsedFor(['1']), []));
    assert.equal(exitCode, 1);
    assert.match(stdout, /<error command="page exec" code="exec_failed">/);
    assert.ok(stdout.includes('enable response lost'), 'the enable failure message surfaces');
    assert.ok(
      client.calls.some((c) => c.method === 'Emulation.setFocusEmulationEnabled' && c.params.enabled === false),
      'disable(false) is always sent, even when enable failed',
    );
    assert.ok(!client.calls.some((c) => c.method === 'Runtime.evaluate'), 'no evaluate after a failed enable');
  } finally {
    deps.restore();
  }
});

test('page exec: an evaluate transport failure still restores focus and is exec_failed', async () => {
  const client = stubClient({
    'Emulation.setFocusEmulationEnabled': () => ({}),
    'Runtime.evaluate': () => {
      throw new Error('evaluate transport down');
    },
  });
  const deps = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageExec(parsedFor(['1']), []));
    assert.equal(exitCode, 1);
    assert.match(stdout, /<error command="page exec" code="exec_failed">/);
    assert.ok(stdout.includes('evaluate transport down'), 'the evaluate failure message surfaces');
    const last = client.calls[client.calls.length - 1];
    assert.equal(last.method, 'Emulation.setFocusEmulationEnabled');
    assert.equal(last.params.enabled, false);
  } finally {
    deps.restore();
  }
});

test('page exec: a disable failure alone throws focus_cleanup_failed and prevents success', async () => {
  // Primary evaluate succeeds, but disable(false) fails: the tab may retain an
  // override, so cmdPageExec throws a typed cleanup failure to the root
  // boundary and emits NO exec-result (success is prevented).
  const client = stubClient({
    'Emulation.setFocusEmulationEnabled': (params) => {
      if (params.enabled === false) throw new Error('disable failed');
      return {};
    },
    'Runtime.evaluate': () => ({ result: { value: 1 } }),
  });
  const deps = installDeps(client);
  try {
    let thrown: unknown;
    const { stdout } = await runCmd(async () => {
      try {
        await cmdPageExec(parsedFor(['1']), []);
      } catch (err) {
        thrown = err;
      }
    });
    assert.ok(thrown instanceof CaptureError, 'the cleanup failure propagates to the root boundary');
    assert.equal((thrown as CaptureError).descriptor.code, 'focus_cleanup_failed');
    assert.ok(!stdout.includes('<exec-result'), 'a disable failure prevents a success result');
  } finally {
    deps.restore();
  }
});

test('page exec: a primary+disable dual failure reports exec_failed preserving both messages', async () => {
  const client = stubClient({
    'Emulation.setFocusEmulationEnabled': (params) => {
      if (params.enabled === false) throw new Error('cleanup boom');
      return {};
    },
    'Runtime.evaluate': () => {
      throw new Error('primary boom');
    },
  });
  const deps = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() => cmdPageExec(parsedFor(['1']), []));
    assert.equal(exitCode, 1);
    assert.match(stdout, /<error command="page exec" code="exec_failed">/);
    // Both failure facts are preserved distinctly: the primary evaluate
    // message, and the typed cleanup fact (the raw cleanup cause is wrapped in
    // the focus_cleanup_failed CaptureError; the fact reports its message).
    assert.ok(stdout.includes('execution failed (primary boom)'), 'the primary failure is preserved');
    assert.ok(
      stdout.includes('focus-emulation cleanup also failed') && stdout.includes('may retain a focus-emulation override'),
      'the cleanup failure is preserved as a distinct fact',
    );
  } finally {
    deps.restore();
  }
});

test('page exec: a held recorder connection with no active session throws recorder_session_missing before any CDP call', async () => {
  const client = stubClient(execHandlers({ result: { value: 1 } }));
  const deps = installDeps(client); // no session → getActiveSession() returns null
  const restore = __setPageExecDepsForTest({ isRecorderHeldClient: () => true });
  try {
    let thrown: unknown;
    await runCmd(async () => {
      try {
        await cmdPageExec(parsedFor(['1']), []);
      } catch (err) {
        thrown = err;
      }
    });
    assert.ok(thrown instanceof CaptureError, 'a held client with no session is a typed internal failure');
    assert.equal((thrown as CaptureError).descriptor.code, 'recorder_session_missing');
    assert.equal(client.calls.length, 0, 'no focus/evaluate CDP call is made without a session to serialize under');
  } finally {
    restore();
    deps.restore();
  }
});

test('page exec: two held-recorder callers serialize the whole focus scope via the session lock (A2)', async () => {
  // Real acquirePrivateLock through the production default path. The recorder
  // holds one persistent connection whose focus state outlives a single
  // command, so two concurrent routed execs must not interleave their
  // enable/evaluate/disable. The scope runs under the session's
  // `.focus-scope.lock`; assertions are event-ordered (no wall-time sleeps —
  // the lock's internal poll is production behavior).
  const session = makeFakeSession();
  fs.mkdirSync(session.dir, { recursive: true, mode: 0o700 }); // CAPTURE_ROOT + parent must exist for the lock

  const log: Array<{ who: string; method: string; enabled?: unknown }> = [];
  let releaseAGate!: () => void;
  const aGate = new Promise<void>((resolve) => {
    releaseAGate = resolve;
  });
  let signalAReached!: () => void;
  const aReached = new Promise<void>((resolve) => {
    signalAReached = resolve;
  });

  const makeClient = (who: string) => ({
    async send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
      log.push({ who, method, enabled: params.enabled });
      if (method === 'Runtime.evaluate') {
        if (who === 'A') {
          signalAReached(); // A has entered its held scope
          await aGate; // and holds it open until the test releases the gate
        }
        return { result: { value: 1 } };
      }
      return {};
    },
  });
  const clientA = makeClient('A');
  const clientB = makeClient('B');

  let callCount = 0;
  const restore = __setPageExecDepsForTest({
    withPageAction: (async (
      _parsed: ParsedArgs,
      _opts: { settleMs: number },
      fn: (c: unknown, t: CDPTarget) => Promise<unknown>,
    ) => {
      const client = callCount++ === 0 ? clientA : clientB;
      const result = await fn(client, FAKE_TAB);
      return { result, settle: { requestedMs: 0, waitedMs: 0, completed: true } };
    }) as never,
    getActiveSession: () => session,
    isRecorderHeldClient: () => true,
  });

  const fmt = () =>
    log.map((e) => `${e.who}:${e.method}${e.enabled !== undefined ? `(${String(e.enabled)})` : ''}`);

  try {
    await runCmd(async () => {
      const execA = cmdPageExec(parsedFor(['1'], { settle: 0 }), []);
      await aReached; // A now holds the focus scope
      const execB = cmdPageExec(parsedFor(['1'], { settle: 0 }), []);
      // Give B several event-loop turns to attempt (and block on) the lock.
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      // While A holds the scope, B has made ZERO CDP calls.
      assert.deepEqual(fmt(), [
        'A:Emulation.setFocusEmulationEnabled(true)',
        'A:Runtime.evaluate',
      ]);
      releaseAGate();
      await execA;
      await execB;
    });
    // Full order: A's complete scope, then B's complete scope — never interleaved.
    assert.deepEqual(fmt(), [
      'A:Emulation.setFocusEmulationEnabled(true)',
      'A:Runtime.evaluate',
      'A:Emulation.setFocusEmulationEnabled(false)',
      'B:Emulation.setFocusEmulationEnabled(true)',
      'B:Runtime.evaluate',
      'B:Emulation.setFocusEmulationEnabled(false)',
    ]);
  } finally {
    restore();
    fs.rmSync(session.dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Bundle path integration — the natural final-expression value round-trips
// ---------------------------------------------------------------------------

test('page exec: an import-bearing body returns its natural final value through the bundle path', async () => {
  // Leading lib import → bundleExec builds a self-contained IIFE; evaluating it
  // (mirroring Runtime.evaluate awaitPromise:true) yields the natural final
  // expression value, which lands in the <exec-result> block.
  const client = stubClient({
    'Emulation.setFocusEmulationEnabled': () => ({}),
    'Runtime.evaluate': async (params) => ({ result: { value: await eval(String(params.expression)) } }),
  });
  const deps = installDeps(client);
  try {
    const { stdout, exitCode } = await runCmd(() =>
      cmdPageExec(parsedFor(["import * as day from 'libs/day'; const f = () => 21 * 2; f()"]), []),
    );
    assert.equal(exitCode, undefined);
    assert.match(stdout, /<exec-result /);
    assert.ok(stdout.includes('result: 42'), 'the natural final-expression value round-trips through the bundle path');
  } finally {
    deps.restore();
  }
});

// ---------------------------------------------------------------------------
// Help — D6 leaf shape
// ---------------------------------------------------------------------------

test('page exec: -h is the leaf shape — lowercase schema headers, settle default inline, no examples', async () => {
  const { stdout, exitCode } = await runCmd(() => cmdPageExec(parsedFor([], { help: true }), []));
  assert.equal(exitCode, undefined);
  assert.match(stdout, /^input:$/m);
  assert.match(stdout, /^output:$/m);
  assert.match(stdout, /^effects:$/m);
  assert.ok(stdout.includes('default: 3000'), 'help states the settle default inline');
  assert.ok(stdout.includes('--file <path>'));
  assert.ok(!/example/i.test(stdout), 'leaf help carries no examples');
});
