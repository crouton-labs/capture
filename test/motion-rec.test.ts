import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { closeChrome, spawnHeadlessChrome } from './fixtures/chrome.js';

import { CAPTURE_ROOT, ensurePrivateDir, writeJsonPrivate, writeNdjsonPrivate, writeBinaryPrivate } from '../src/session/artifacts.js';
import { setActiveSession, clearActiveSession } from '../src/session-context.js';
import { startComposedRecorder } from '../src/cdp/motion/recorder.js';
import { cmdPageType } from '../src/cdp/commands/page/type.js';

async function spawnTestRecorderBridge(socketPath: string, port: number, targetId: string, recDir: string): Promise<{ socketPath: string; pid: number }> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/capture.ts', '__bridge-serve', '--socket', socketPath, '--port', String(port), '--target', targetId, 'recorder', recDir], { cwd: process.cwd(), detached: true, stdio: 'ignore' });
  child.unref();
  if (!child.pid) throw new Error('test recorder bridge did not spawn');
  const deadline = Date.now() + 8000;
  while (!fs.existsSync(socketPath)) {
    if (Date.now() > deadline) throw new Error('test recorder bridge did not become reachable');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return { socketPath, pid: child.pid };
}

import {
  __setMotionRecDepsForTest,
  cmdMotionRec,
  driveOneShotAction,
  DoActionError,
  finalizeOneShotRecording,
  encodeVideoIfAvailable,
  encodeTimeoutMs,
  classifyEncodeFailure,
} from '../src/cdp/commands/motion/rec.js';

const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');

type Sent = { method: string; params?: Record<string, unknown> };

class FakeClient {
  sent: Sent[] = [];
  async waitReady(): Promise<void> {}
  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    this.sent.push({ method, params });
    if (method === 'Runtime.evaluate') {
      const expression = String(params?.expression ?? '');
      if (expression.includes('document.readyState')) {
        return { result: { value: { readyState: 'complete', href: 'https://fixture.test/' } } };
      }
    }
    if (method === 'DOM.getDocument') return { root: { nodeId: 1 } };
    if (method === 'DOM.querySelectorAll') return { nodeIds: [101] };
    if (method === 'DOM.describeNode') return { node: { backendNodeId: 201 } };
    if (method === 'Accessibility.getPartialAXTree') {
      return { nodes: [{ nodeId: 'ax-201', backendDOMNodeId: 201, role: { value: 'button' }, name: { value: 'Send' } }] };
    }
    if (method === 'DOM.getBoxModel') return { model: { content: [10, 20, 30, 20, 30, 40, 10, 40] } };
    return {};
  }
  on(): void {}
  onDisconnect(): void {}
  close(): void {}
}

class FakeRecorderSession {
  readonly marks: string[] = [];
  readonly cdp: Array<{ method?: string; mark?: string }> = [];
  constructor(private opts: { client: FakeClient; recDir: string }) {}
  async start(): Promise<void> {
    ensurePrivateDir(path.join(this.opts.recDir, 'frames'));
    writeBinaryPrivate(path.join(this.opts.recDir, 'frames', '000001.png'), TINY_PNG);
    writeNdjsonPrivate(path.join(this.opts.recDir, 'rects.jsonl'), [{ frame: 1, elements: [] }]);
  }
  async handleCdp(req: { method?: string; params?: Record<string, unknown>; mark?: string }): Promise<{ result?: unknown }> {
    this.cdp.push({ method: req.method, mark: req.mark });
    if (req.mark) this.marks.push(req.mark);
    return { result: await this.opts.client.send(req.method ?? '', req.params) };
  }
  async stop(): Promise<{ frameCount: number; eventCount: number; durationMs: number; markers: unknown }> {
    writeNdjsonPrivate(path.join(this.opts.recDir, 'events.jsonl'), this.marks.map((mark) => ({ kind: 'input', mark })));
    return {
      frameCount: 1,
      eventCount: this.marks.length,
      durationMs: 100,
      markers: { performanceNowMs: 10, firstScreencastTimestampSec: 1, firstTraceEventTsUs: 2, baselinesPending: false },
    };
  }
}

function makeRoot(name: string): string {
  const root = path.join(CAPTURE_ROOT, `u24-motion-rec-${process.pid}-${Date.now()}-${name}`);
  fs.rmSync(root, { recursive: true, force: true });
  ensurePrivateDir(root);
  return root;
}

async function captureCommand(fn: () => Promise<void>): Promise<{ stdout: string; exitCode: string | number | undefined }> {
  const oldLog = console.log;
  const oldExitCode = process.exitCode;
  let stdout = '';
  console.log = (value?: unknown) => { stdout += `${String(value ?? '')}\n`; };
  process.exitCode = undefined;
  try {
    await fn();
    return { stdout, exitCode: process.exitCode };
  } finally {
    console.log = oldLog;
    process.exitCode = oldExitCode;
  }
}

test('cmdMotionRec one-shot waits for readiness, applies/restores viewport, records one input landmark, and finalizes artifacts', async () => {
  const root = makeRoot('oneshot');
  const client = new FakeClient();
  let recorder: FakeRecorderSession | null = null;
  const restore = __setMotionRecDepsForTest({
    detectCdpPort: async () => 9222,
    openTab: async () => ({ id: 'target-1', title: '', url: 'https://fixture.test/', type: 'page', webSocketDebuggerUrl: 'ws://fixture' }),
    createClient: () => client as never,
    createRecorderSession: (opts) => {
      recorder = new FakeRecorderSession(opts as never);
      return recorder as never;
    },
    createOneshotSession: () => ({ id: 'oneshot-test', dir: root, kind: 'motion', artifactsDir: path.join(root, 'motion', 'recs') }),
    getActiveSession: () => null,
  });

  try {
    await captureCommand(() => cmdMotionRec({ command: 'motion', positional: ['https://fixture.test/'], do: 'click:button.send', viewport: '390x844' }, []));
    assert.ok(recorder, 'one-shot constructs a RecorderSession');
    assert.deepEqual(
      client.sent.filter((s) => s.method.startsWith('Emulation.')).map((s) => s.method),
      ['Emulation.setDeviceMetricsOverride', 'Emulation.clearDeviceMetricsOverride'],
    );
    assert.deepEqual(client.sent.find((s) => s.method === 'Emulation.setDeviceMetricsOverride')?.params, {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const runtimeIndex = client.sent.findIndex((s) => s.method === 'Runtime.evaluate' && String(s.params?.expression ?? '').includes('document.readyState'));
    const mouseIndex = client.sent.findIndex((s) => s.method === 'Input.dispatchMouseEvent');
    assert.ok(runtimeIndex >= 0 && mouseIndex > runtimeIndex, 'readiness is checked before the input dispatch');
    assert.deepEqual(recorder!.marks, ['click:button.send'], 'one coherent input landmark is emitted for one click');
    assert.deepEqual(recorder!.cdp.map((c) => [c.method, c.mark ?? null]), [
      ['DOM.enable', null],
      ['DOM.getDocument', null],
      ['DOM.querySelectorAll', null],
      ['DOM.describeNode', null],
      ['Accessibility.getPartialAXTree', null],
      ['DOM.scrollIntoViewIfNeeded', null],
      ['DOM.getBoxModel', null],
      ['Input.dispatchMouseEvent', 'click:button.send'],
      ['Input.dispatchMouseEvent', null],
    ], 'the target resolves through the unified live grammar before the marked dispatch');

    const recRoot = path.join(root, 'motion', 'recs');
    const recDir = path.join(recRoot, fs.readdirSync(recRoot)[0]);
    for (const artifact of ['frames', 'rects.jsonl', 'events.jsonl', 'markers.json', 'meta.json']) {
      assert.ok(fs.existsSync(path.join(recDir, artifact)), `${artifact} exists`);
    }
    const video = JSON.parse(fs.readFileSync(path.join(recDir, 'meta.json'), 'utf8')).video;
    assert.ok(['encoded', 'unavailable', 'failed'].includes(video.status), 'video outcome is factual');
    const meta = JSON.parse(fs.readFileSync(path.join(recDir, 'meta.json'), 'utf8'));
    assert.equal(meta.action, 'click:button.send');
    assert.equal(meta.eventCount, 1);
  } finally {
    restore();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('motion rec one-shot uses the active session tab when URL is omitted, while explicit URLs and no-session validation retain their contracts', async () => {
  const root = makeRoot('active-session-target');
  const client = new FakeClient();
  const session = { sessionId: 'session-test', dir: root, harId: null, targetId: 'session-tab', stepCount: 0 };
  let active: typeof session | null = session;
  let opened = 0;
  let resolved = 0;
  let oneshots = 0;
  const restore = __setMotionRecDepsForTest({
    detectCdpPort: async () => 9222,
    openTab: async () => {
      opened++;
      return { id: 'explicit-tab', title: '', url: 'https://explicit.test/', type: 'page', webSocketDebuggerUrl: 'ws://fixture' };
    },
    findTabById: async (_port, targetId) => {
      resolved++;
      assert.equal(targetId, 'session-tab');
      return { id: targetId, title: '', url: 'https://session.test/current', type: 'page', webSocketDebuggerUrl: 'ws://fixture' };
    },
    createClient: () => client as never,
    createRecorderSession: (opts) => new FakeRecorderSession(opts as never) as never,
    createOneshotSession: () => {
      oneshots++;
      return { id: 'oneshot-test', dir: root, kind: 'motion', artifactsDir: path.join(root, 'motion', 'recs') };
    },
    getActiveSession: () => active,
    encodeVideo: () => ({ status: 'unavailable', reason: 'test' }),
  });

  try {
    const activeOutput = await captureCommand(() => cmdMotionRec({ command: 'motion', positional: [], do: 'click:button.send' }, []));
    assert.equal(activeOutput.exitCode, undefined, activeOutput.stdout);
    assert.equal(resolved, 1, 'missing URL resolves the active session tab');
    assert.equal(opened, 0, 'missing URL does not open a new tab');
    assert.equal(oneshots, 0, 'an active-session recording belongs to the session bundle');
    assert.equal(fs.readdirSync(path.join(root, 'motion', 'recs')).length, 1);

    active = null;
    const explicitOutput = await captureCommand(() => cmdMotionRec({ command: 'motion', positional: ['https://explicit.test/'], do: 'click:button.send' }, []));
    assert.equal(explicitOutput.exitCode, undefined, explicitOutput.stdout);
    assert.equal(opened, 1, 'an explicit URL retains the new-tab one-shot behavior');
    assert.equal(oneshots, 1, 'an explicit URL without a session uses private one-shot storage');

    const missingOutput = await captureCommand(() => cmdMotionRec({ command: 'motion', positional: [], do: 'click:button.send' }, []));
    assert.equal(missingOutput.exitCode, 1, 'without a session, a URL remains required');
  } finally {
    restore();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('one-shot restores a viewport when set may have reached Chrome but its response fails', async () => {
  const root = makeRoot('oneshot-viewport-response-failure');
  const client = new FakeClient();
  const send = client.send.bind(client);
  client.send = async (method, params) => {
    if (method === 'Emulation.setDeviceMetricsOverride') {
      client.sent.push({ method, params });
      throw new Error('set response lost');
    }
    return send(method, params);
  };
  const restore = __setMotionRecDepsForTest({
    detectCdpPort: async () => 9222,
    openTab: async () => ({ id: 'target-1', title: '', url: 'https://fixture.test/', type: 'page', webSocketDebuggerUrl: 'ws://fixture' }),
    createClient: () => client as never,
    createOneshotSession: () => ({ id: 'oneshot-test', dir: root, kind: 'motion', artifactsDir: path.join(root, 'motion', 'recs') }),
    getActiveSession: () => null,
  });
  try {
    const output = await captureCommand(() => cmdMotionRec({ command: 'motion', positional: ['https://fixture.test/'], do: 'click:button.send', viewport: '390x844' }, []));
    assert.equal(output.exitCode, 1);
    assert.deepEqual(client.sent.filter((entry) => entry.method.startsWith('Emulation.')).map((entry) => entry.method), [
      'Emulation.setDeviceMetricsOverride',
      'Emulation.clearDeviceMetricsOverride',
    ]);
  } finally {
    restore();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('motion rec one-shot records a real Chrome action through the real CDP client and RecorderSession', async () => {
  const root = makeRoot('real-chrome-oneshot');
  const chrome = await spawnHeadlessChrome();
  const restore = __setMotionRecDepsForTest({
    createOneshotSession: () => ({ id: 'oneshot-real', dir: root, kind: 'motion', artifactsDir: path.join(root, 'motion', 'recs') }),
    getActiveSession: () => null,
  });
  try {
    const url = `data:text/html,${encodeURIComponent('<button id="go">Go</button><script>document.querySelector("#go").addEventListener("click", () => document.body.dataset.clicked = "yes")</script>')}`;
    const output = await captureCommand(() => cmdMotionRec({ command: 'motion', positional: [url], do: 'click:#go', port: chrome.port, duration: 0.1 }, []));
    assert.equal(output.exitCode, undefined, output.stdout);
    const recRoot = path.join(root, 'motion', 'recs');
    const recDir = path.join(recRoot, fs.readdirSync(recRoot)[0]);
    const meta = JSON.parse(fs.readFileSync(path.join(recDir, 'meta.json'), 'utf8'));
    assert.ok(meta.frames > 0, 'RecorderSession captured real screencast frames');
    assert.equal(meta.action, 'click:#go', 'the real action is retained as recording provenance');
  } finally {
    restore();
    await closeChrome(chrome.proc);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('motion rec composed lifecycle records a real Chrome routed type action between start and stop', async () => {
  const root = makeRoot('real-chrome-composed');
  const chrome = await spawnHeadlessChrome();
  const target = await (await fetch(`http://localhost:${chrome.port}/json/new?${encodeURIComponent(`data:text/html,${encodeURIComponent('<input aria-label="Message">')}`)}`, { method: 'PUT' })).json() as { id: string };
  await setActiveSession({ sessionId: 'real-composed', dir: root, harId: null, targetId: target.id, stepCount: 0 });
  const restore = __setMotionRecDepsForTest({
    startComposedRecorder: (opts) => startComposedRecorder(opts, {
      detectPort: async () => chrome.port,
      spawnRecorderBridge: (socketPath, port, targetId, recDir) => spawnTestRecorderBridge(socketPath, port, targetId, recDir),
    }),
  });
  try {
    await captureCommand(() => cmdMotionRec({ command: 'motion', positional: [], start: true }, []));
    await cmdPageType({ command: 'page', positional: ['hello'], into: 'ax:Message', port: chrome.port, noScreenshot: true }, []);
    await captureCommand(() => cmdMotionRec({ command: 'motion', positional: [], stop: true }, []));
    const recDir = path.join(root, 'motion', 'recs', fs.readdirSync(path.join(root, 'motion', 'recs'))[0]);
    const events = fs.readFileSync(path.join(recDir, 'events.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    assert.equal(events.filter((event) => event.action === 'type:ax:Message').length, 1, 'the routed command preserves one coherent original action identity');
    assert.match(events.find((event) => event.action === 'type:ax:Message').mark, /^mark-[a-f0-9]{64}$/, 'the internal structural mark is distinct');
  } finally {
    restore();
    clearActiveSession();
    await closeChrome(chrome.proc);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

/** Scripted stand-in for RecorderSession.handleCdp — answers each CDP method
 * from `handlers`, recording the dispatched methods and marks. */
function stubRecorder(handlers: Record<string, (params?: Record<string, unknown>) => unknown>) {
  const calls: Array<{ method: string; mark: string | null }> = [];
  return {
    calls,
    handleCdp: async (req: { method?: string; params?: Record<string, unknown>; mark?: string }) => {
      calls.push({ method: req.method ?? '', mark: req.mark ?? null });
      const handler = handlers[req.method ?? ''];
      return { result: handler ? handler(req.params) : {} };
    },
  };
}

const SINGLE_PANE_RESOLUTION = {
  'DOM.getDocument': () => ({ root: { nodeId: 1 } }),
  'DOM.querySelectorAll': () => ({ nodeIds: [101] }),
  'DOM.describeNode': () => ({ node: { backendNodeId: 201 } }),
  'Accessibility.getPartialAXTree': () => ({ nodes: [{ nodeId: 'ax-201', backendDOMNodeId: 201, role: { value: 'generic' }, name: { value: 'pane' } }] }),
  'DOM.resolveNode': () => ({ object: { objectId: 'obj-1' } }),
};

test('one-shot scroll drives the shared scrollResolved helper and carries the action landmark', async () => {
  const recorder = stubRecorder({
    ...SINGLE_PANE_RESOLUTION,
    'Runtime.callFunctionOn': () => ({ result: { value: 240 } }),
  });
  await driveOneShotAction(recorder as never, 'scroll:.pane,to=bottom');
  const scrollCall = recorder.calls.find((c) => c.method === 'Runtime.callFunctionOn');
  assert.ok(scrollCall, 'scroll dispatches through Runtime.callFunctionOn on the resolved node');
  assert.equal(scrollCall!.mark, 'scroll:.pane,to=bottom', 'the one mutating call carries the action landmark');
});

test('one-shot scroll rejects in-page exceptions and missing scroll payloads', async () => {
  await assert.rejects(
    () => driveOneShotAction(stubRecorder({
      ...SINGLE_PANE_RESOLUTION,
      'Runtime.callFunctionOn': () => ({ exceptionDetails: { text: 'bad target' } }),
    }) as never, 'scroll:.pane,to=bottom'),
    /threw in-page/,
  );
  await assert.rejects(
    () => driveOneShotAction(stubRecorder({
      ...SINGLE_PANE_RESOLUTION,
      'Runtime.callFunctionOn': () => ({ result: { value: 'nope' } }),
    }) as never, 'scroll:.pane,to=bottom'),
    /valid scrollTop payload/,
  );
});

test('one-shot click:ax:<name> resolves by case-insensitive substring over live AX names', async () => {
  const recorder = stubRecorder({
    'Accessibility.getFullAXTree': () => ({
      nodes: [
        { nodeId: '1', backendDOMNodeId: 11, role: { value: 'button' }, name: { value: 'Send message' } },
        { nodeId: '2', backendDOMNodeId: 12, role: { value: 'button' }, name: { value: 'Cancel' } },
      ],
    }),
    'DOM.getBoxModel': () => ({ model: { content: [0, 0, 10, 0, 10, 10, 0, 10] } }),
  });
  await driveOneShotAction(recorder as never, 'click:ax:send');
  const boxCall = recorder.calls.find((c) => c.method === 'DOM.getBoxModel');
  assert.ok(boxCall, 'the resolved element is clicked via its box model');
  const press = recorder.calls.find((c) => c.method === 'Input.dispatchMouseEvent');
  assert.equal(press?.mark, 'click:ax:send', 'the initiating press carries the action landmark');
});

test('one-shot click with an ambiguous target rejects with the candidate list', async () => {
  const recorder = stubRecorder({
    'Accessibility.getFullAXTree': () => ({
      nodes: [
        { nodeId: '1', backendDOMNodeId: 11, role: { value: 'button' }, name: { value: 'Send' } },
        { nodeId: '2', backendDOMNodeId: 12, role: { value: 'button' }, name: { value: 'Send later' } },
      ],
    }),
  });
  await assert.rejects(
    () => driveOneShotAction(recorder as never, 'click:ax:Send'),
    (err: unknown) => {
      assert.ok(err instanceof DoActionError);
      assert.equal(err.status, 'target_resolution_failed');
      assert.match(err.message, /matched 2 live elements/);
      assert.match(err.message, /backend:11/);
      assert.match(err.message, /backend:12/);
      assert.match(err.message, /Send later/);
      return true;
    },
  );
  assert.equal(recorder.calls.filter((c) => c.method === 'Input.dispatchMouseEvent').length, 0, 'no input is dispatched on an ambiguous target');
});

test('one-shot click rejects a text: target naming the accepted prefixes', async () => {
  const recorder = stubRecorder({});
  await assert.rejects(
    () => driveOneShotAction(recorder as never, 'click:text:x'),
    (err: unknown) => {
      assert.ok(err instanceof DoActionError);
      assert.equal(err.status, 'unsupported_target_prefix');
      assert.match(err.message, /css selector/);
      assert.match(err.message, /ax:<name>/);
      assert.match(err.message, /axid:<id>/);
      assert.match(err.message, /backend:<id>/);
      return true;
    },
  );
  assert.equal(recorder.calls.length, 0, 'a rejected prefix never reaches the page');
});

test('one-shot click with a no-match target rejects without dispatching input', async () => {
  const recorder = stubRecorder({
    'DOM.getDocument': () => ({ root: { nodeId: 1 } }),
    'DOM.querySelectorAll': () => ({ nodeIds: [] }),
  });
  await assert.rejects(
    () => driveOneShotAction(recorder as never, 'click:.missing'),
    (err: unknown) => {
      assert.ok(err instanceof DoActionError);
      assert.equal(err.status, 'target_resolution_failed');
      assert.match(err.message, /matched no live element/);
      return true;
    },
  );
  assert.equal(recorder.calls.filter((c) => c.method === 'Input.dispatchMouseEvent').length, 0);
});

test('cmdMotionRec rejects incompatible lifecycle inputs before touching the recorder', async () => {
  let touched = false;
  const restore = __setMotionRecDepsForTest({
    getActiveSession: () => { touched = true; return null; },
    startComposedRecorder: async () => { touched = true; throw new Error('should not start'); },
  });
  const oldExitCode = process.exitCode;
  try {
    process.exitCode = undefined;
    const result = await captureCommand(() => cmdMotionRec({ command: 'motion', positional: ['https://fixture.test/'], start: true, do: 'click:button' }, []));
    assert.equal(result.exitCode, 1);
    assert.equal(touched, false);
  } finally {
    process.exitCode = oldExitCode;
    restore();
  }
});

test('cmdMotionRec rejects --rec-id outside --stop before touching any lifecycle', async () => {
  let touched = false;
  const restore = __setMotionRecDepsForTest({ getActiveSession: () => { touched = true; return null; } });
  try {
    const result = await captureCommand(() => cmdMotionRec({ command: 'motion', positional: ['https://fixture.test/'], do: 'click:.send', recId: 'rec-other' }, []));
    assert.equal(result.exitCode, 1);
    assert.equal(touched, false);
  } finally { restore(); }
});

test('cmdMotionRec applies the shared exact viewport grammar before lifecycle effects', async () => {
  let touched = false;
  const restore = __setMotionRecDepsForTest({
    getActiveSession: () => { touched = true; return null; },
    createOneshotSession: () => { touched = true; throw new Error('must not allocate'); },
    openTab: async () => { touched = true; throw new Error('must not open'); },
    startComposedRecorder: async () => { touched = true; throw new Error('must not start'); },
  });
  try {
    for (const viewport of ['390X844', ' 390x844', '+390x844', '390.0x844', '39e1x844', 'desktop', '0x844', '9007199254740992x1']) {
      touched = false;
      const oneShot = await captureCommand(() => cmdMotionRec({
        command: 'motion',
        positional: ['https://fixture.test/'],
        do: 'click:.send',
        viewport,
      }, []));
      assert.equal(oneShot.exitCode, 1, `--viewport ${viewport} must be rejected`);
      assert.equal(touched, false, `--viewport ${viewport} must fail before one-shot effects`);
    }

    const composed = await captureCommand(() => cmdMotionRec({ command: 'motion', positional: [], start: true, viewport: '390X844' }, []));
    assert.equal(composed.exitCode, 1);
    assert.equal(touched, false, 'composed start validates viewport before reading or starting the session lifecycle');
  } finally { restore(); }
});

test('cmdMotionRec composed start/stop applies viewport for the recording window and finalizes the same inventory', async () => {
  const root = makeRoot('composed');
  const recDir = path.join(root, 'motion', 'recs', 'rec-composed');
  let startOpts: { sessionDir: string; targetId: string | null; port?: number; viewport?: { width: number; height: number } } | null = null;
  const restore = __setMotionRecDepsForTest({
    getActiveSession: () => ({ sessionId: 'cap-test', dir: root, harId: null, targetId: 'target-1', port: 52621, stepCount: 0, activeRecId: 'rec-composed' }),
    startComposedRecorder: async (opts) => {
      startOpts = opts;
      ensurePrivateDir(path.join(recDir, 'frames'));
      writeBinaryPrivate(path.join(recDir, 'frames', '000001.png'), TINY_PNG);
      writeNdjsonPrivate(path.join(recDir, 'events.jsonl'), [{ kind: 'input', mark: 'click:button.send' }]);
      writeNdjsonPrivate(path.join(recDir, 'rects.jsonl'), [{ frame: 1, elements: [] }]);
      return { recId: 'rec-composed', recDir, state: 'recording', reapedStale: null };
    },
    stopComposedRecorder: async () => {
      writeJsonPrivate(path.join(recDir, 'markers.json'), { performanceNowMs: 10, firstScreencastTimestampSec: 1, firstTraceEventTsUs: 2, baselinesPending: false });
      writeJsonPrivate(path.join(recDir, 'meta.json'), { id: 'rec-composed', action: null, frames: 1, durationMs: 100, state: 'finalized', url: 'https://fixture.test/', fps: 10, eventCount: 1 });
      return { recId: 'rec-composed', recDir, frames: 1, durationMs: 100, fps: 10, state: 'finalized', eventCount: 1 };
    },
  });

  try {
    await captureCommand(() => cmdMotionRec({ command: 'motion', positional: [], start: true, port: 52621, viewport: '390x844' }, []));
    assert.deepEqual(startOpts, { sessionDir: root, targetId: 'target-1', port: 52621, viewport: { width: 390, height: 844 } }, 'the command passes endpoint and viewport ownership into the lifecycle');

    await captureCommand(() => cmdMotionRec({ command: 'motion', positional: [], stop: true }, []));
    // The recorder lifecycle owns restoration, including reaps/session-stop;
    // this command-level stub bypasses that lifecycle implementation.
    for (const artifact of ['frames', 'rects.jsonl', 'events.jsonl', 'markers.json', 'meta.json']) {
      assert.ok(fs.existsSync(path.join(recDir, artifact)), `${artifact} exists`);
    }
    const video = JSON.parse(fs.readFileSync(path.join(recDir, 'meta.json'), 'utf8')).video;
    assert.ok(['encoded', 'unavailable', 'failed'].includes(video.status), 'video outcome is factual');
  } finally {
    restore();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('video encoding contract receives measured duration and never writes through a final-path symlink', () => {
  const root = makeRoot('video-contract');
  const recDir = path.join(root, 'motion', 'recs', 'rec-video');
  const victim = path.join(root, 'victim');
  try {
    ensurePrivateDir(path.join(recDir, 'frames'));
    writeBinaryPrivate(path.join(recDir, 'frames', '000001.png'), TINY_PNG);
    fs.writeFileSync(victim, 'unchanged');
    fs.symlinkSync(victim, path.join(recDir, 'video.webm'));
    const outcome = encodeVideoIfAvailable(recDir, 1000);
    assert.equal(fs.readFileSync(victim, 'utf8'), 'unchanged');
    assert.ok(['encoded', 'unavailable', 'failed'].includes(outcome.status));

    let receivedDuration = 0;
    finalizeOneShotRecording(recDir, 'rec-video', 'https://fixture.test/', 'click:.send', { frameCount: 60, eventCount: 1, durationMs: 1000, markers: {} }, (_dir, durationMs) => {
      receivedDuration = durationMs;
      return { status: 'encoded' };
    });
    assert.equal(receivedDuration, 1000, 'encoder cadence derives from the recorded duration');

    // This is intentionally capability-gated: a present ffmpeg binary alone
    // does not prove that its VP9 encoder and ffprobe are usable.
    const capabilities = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
    const ffprobe = spawnSync('ffprobe', ['-version'], { encoding: 'utf8' });
    if (capabilities.status === 0 && capabilities.stdout.includes('libvpx-vp9') && ffprobe.status === 0) {
      const smokeDir = path.join(root, 'motion', 'recs', 'rec-video-smoke');
      ensurePrivateDir(path.join(smokeDir, 'frames'));
      writeBinaryPrivate(path.join(smokeDir, 'frames', '000001.png'), TINY_PNG);
      writeBinaryPrivate(path.join(smokeDir, 'frames', '000002.png'), TINY_PNG);
      assert.deepEqual(encodeVideoIfAvailable(smokeDir, 1000), { status: 'encoded' });
      const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path.join(smokeDir, 'video.webm')], { encoding: 'utf8' });
      assert.equal(probe.status, 0, probe.stderr);
      assert.ok(Math.abs(Number(probe.stdout.trim()) - 1) < 0.05, `VP9 duration must follow recording timing, got ${probe.stdout.trim()}s`);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('encodeTimeoutMs scales with frame count so long recordings finish, within an upper safety bound', () => {
  // A short recording still gets the generous fixed base.
  assert.ok(encodeTimeoutMs(1) >= 30_000);
  // The 2561-frame long recording that spuriously timed out at the fixed 30s ceiling
  // now gets minutes of budget.
  assert.ok(encodeTimeoutMs(2561) > 120_000, `2561 frames must budget well beyond the old 30s ceiling, got ${encodeTimeoutMs(2561)}ms`);
  // Monotonic in frame count.
  assert.ok(encodeTimeoutMs(5000) >= encodeTimeoutMs(2561));
  // Capped by the upper safety bound so a pathological run cannot hang indefinitely.
  assert.equal(encodeTimeoutMs(10_000_000), 15 * 60_000);
});

test('classifyEncodeFailure only reports a timeout when ETIMEDOUT establishes it, not on a bare SIGTERM', () => {
  const etimedout = Object.assign(new Error('spawnSync ffmpeg ETIMEDOUT'), { code: 'ETIMEDOUT' });
  // ETIMEDOUT (with the SIGTERM spawnSync sends to kill the child) is the only genuine timeout.
  assert.equal(classifyEncodeFailure({ error: etimedout, signal: 'SIGTERM' }), 'ffmpeg_encoding_timed_out');
  assert.equal(classifyEncodeFailure({ error: etimedout, signal: null }), 'ffmpeg_encoding_timed_out', 'ETIMEDOUT alone establishes the timeout');
  // A bare SIGTERM with no ETIMEDOUT is external/self termination, NOT proof of a timeout — false provenance if labeled timed-out.
  assert.equal(classifyEncodeFailure({ error: null, signal: 'SIGTERM' }), 'ffmpeg_terminated', 'a bare SIGTERM without ETIMEDOUT is termination, not a timeout');
  assert.equal(classifyEncodeFailure({ error: Object.assign(new Error('spawn ffmpeg ENOENT'), { code: 'ENOENT' }), signal: null }), 'ffmpeg_execution_failed');
  assert.equal(classifyEncodeFailure({ error: null, signal: null }), 'ffmpeg_encoding_failed', 'a nonzero exit / missing output maps to encoding_failed');
});

test('one-shot with zero frames writes a factual partial no-frames artifact instead of finalized success', () => {
  const root = makeRoot('no-frames');
  const recDir = path.join(root, 'motion', 'recs', 'rec-no-frames');
  try {
    const result = finalizeOneShotRecording(recDir, 'rec-no-frames', 'https://example.test/?token=evidence', 'click:button[data-action="send now"]', {
      frameCount: 0, eventCount: 3, durationMs: 1000, markers: { performanceNowMs: 1 },
    }, () => ({ status: 'unavailable', reason: 'no_frames' }));
    const meta = JSON.parse(fs.readFileSync(path.join(recDir, 'meta.json'), 'utf8'));
    assert.equal(result.state, 'partial');
    assert.equal(meta.state, 'partial');
    assert.equal(meta.reason, 'no_frames');
    assert.equal(meta.action, 'click:button[data-action="send now"]');
    assert.equal(meta.url, 'https://example.test/?token=evidence');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('motion rec one-shot finalizer preserves finalized metadata shape and private permissions', () => {
  const root = makeRoot('finalizer');
  const oneShotDir = path.join(root, 'oneshot', 'motion', 'recs', 'rec-one-shot');
  const composedDir = path.join(root, 'session', 'motion', 'recs', 'rec-composed');

  try {
    ensurePrivateDir(path.join(oneShotDir, 'frames'));
    ensurePrivateDir(path.join(composedDir, 'frames'));
    writeNdjsonPrivate(path.join(oneShotDir, 'events.jsonl'), [{ kind: 'input', mark: 'click:button.send-btn' }]);
    writeNdjsonPrivate(path.join(oneShotDir, 'rects.jsonl'), [{ frame: 1, elements: [] }]);
    writeNdjsonPrivate(path.join(composedDir, 'events.jsonl'), [{ kind: 'input', mark: 'click:button.send-btn' }]);
    writeNdjsonPrivate(path.join(composedDir, 'rects.jsonl'), [{ frame: 1, elements: [] }]);

    const stopped = { frameCount: 1, eventCount: 1, durationMs: 100, markers: { performanceNowMs: 10, firstScreencastTimestampSec: 1, firstTraceEventTsUs: 2, baselinesPending: false } };
    const finalized = finalizeOneShotRecording(oneShotDir, 'rec-one-shot', 'https://example.test/chat', 'click:button.send-btn', stopped);

    writeJsonPrivate(path.join(composedDir, 'markers.json'), stopped.markers);
    writeJsonPrivate(path.join(composedDir, 'meta.json'), {
      id: 'rec-composed', action: null, frames: 1, durationMs: 100,
      state: 'finalized', url: 'https://example.test/chat', fps: 10, eventCount: 1,
    });

    assert.equal(finalized.state, 'finalized');
    assert.equal(finalized.frames, 1);
    assert.equal(finalized.fps, 10);
    assert.equal(fs.statSync(path.join(oneShotDir, 'meta.json')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(oneShotDir, 'events.jsonl')).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.join(oneShotDir, 'frames')).mode & 0o777, 0o700);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
