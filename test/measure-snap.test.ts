import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { closeChrome, spawnHeadlessChrome, type ChromeFixture } from './fixtures/chrome.js';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import { CDPClient } from '../src/cdp/client.js';
import { CAPTURE_ROOT, ensurePrivateDir, writeJsonPrivate } from '../src/session/artifacts.js';
import { clearActiveSession, setActiveSession } from '../src/session-context.js';
import { resolveSnapRef } from '../src/output/artifact.js';
import { withAppliedViewport } from '../src/cdp/commands/measure/snap.js';
import { CaptureError } from '../src/errors.js';

const scope = `measure-snap-test-${process.pid}-${Date.now()}`;
const secret = 'hunter2-should-not-appear';
let chrome: ChromeFixture | undefined;
let server: http.Server | undefined;
let cdpPort = 0;
let pageUrl = '';
let targetId = '';
const cleanupRoots = new Set<string>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(url: string): Promise<void> {
  let last: unknown;
  for (let i = 0; i < 100; i += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch (err) {
      last = err;
    }
    await sleep(50);
  }
  throw new Error(`Timed out waiting for ${url}: ${String(last)}`);
}

async function startFixtureServer(): Promise<number> {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><button>Measure</button><input type="password" value="${secret}">`);
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

async function startChrome(): Promise<void> {
  chrome = await spawnHeadlessChrome();
  cdpPort = chrome.port;
}

async function openFixturePage(): Promise<void> {
  const response = await fetch(`http://localhost:${cdpPort}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' });
  const page = await response.json() as { id?: string };
  assert.ok(page.id);
  targetId = page.id;
  await sleep(150);
}

async function readViewport(): Promise<{ width: number; height: number; dpr: number }> {
  const response = await fetch(`http://localhost:${cdpPort}/json/list`);
  const pages = await response.json() as Array<{ id?: string; webSocketDebuggerUrl?: string }>;
  const page = pages.find((entry) => entry.id === targetId);
  assert.ok(page?.webSocketDebuggerUrl);
  const client = new CDPClient(page.webSocketDebuggerUrl);
  await client.waitReady();
  try {
    const evaluated = await client.send('Runtime.evaluate', {
      expression: '({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio })',
      returnByValue: true,
    }) as { result?: { value?: { width?: number; height?: number; dpr?: number } } };
    const value = evaluated.result?.value;
    assert.equal(typeof value?.width, 'number');
    assert.equal(typeof value?.height, 'number');
    assert.equal(typeof value?.dpr, 'number');
    return { width: value.width!, height: value.height!, dpr: value.dpr! };
  } finally {
    client.close();
  }
}

function oneShotRoots(): string[] {
  try {
    return fs.readdirSync(CAPTURE_ROOT).filter((name) => name.startsWith('oneshot-')).sort();
  } catch {
    return [];
  }
}

function runCapture(args: string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', 'src/capture.ts', ...args], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, CRTR_NODE_ID: scope },
    encoding: 'utf8',
    timeout: 30_000,
  });
}

before(async () => {
  process.env.CRTR_NODE_ID = scope;
  const port = await startFixtureServer();
  pageUrl = `http://127.0.0.1:${port}/measure-snap-fixture`;
  await startChrome();
  await openFixturePage();
});

after(async () => {
  clearActiveSession();
  delete process.env.CRTR_NODE_ID;
  for (const root of cleanupRoots) {
    fs.rmSync(root, { recursive: true, force: true });
  }
  await chrome?.close();
  server?.close();
});

test('measure snap writes one-shot and active-session substrates, including a hover state artifact', async () => {
  const oneShot = runCapture(['measure', 'snap', pageUrl, '--port', String(cdpPort), '--state', 'hover:button']);
  assert.equal(oneShot.status, 0, oneShot.stderr);
  const oneShotPath = oneShot.stdout.match(/path="([^"]+)"/)?.[1];
  assert.ok(oneShotPath, oneShot.stdout);
  cleanupRoots.add(path.resolve(oneShotPath, '../../..'));
  assert.match(oneShot.stdout, /<snapshot /);
  assert.match(oneShot.stdout, /elements="\d+"/);
  assert.match(oneShot.stdout, /Artifacts: .*geometry\.json/);
  assert.match(oneShot.stdout, /Artifacts: .*media\.json/);
  assert.match(oneShot.stdout, /Artifacts: .*meta\.json/);
  assert.match(oneShotPath, new RegExp(`^${CAPTURE_ROOT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/oneshot-[^/]+/measure/snaps/snap-`));
  assert.ok(fs.existsSync(path.join(oneShotPath, 'states.json')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(oneShotPath, 'states.json'), 'utf8')).requested, ['hover:button']);

  const jsonOneShot = runCapture(['measure', 'snap', pageUrl, '--port', String(cdpPort), '--json']);
  assert.equal(jsonOneShot.status, 0, jsonOneShot.stderr);
  const parsedJson = JSON.parse(jsonOneShot.stdout) as { attestation: { path: string }; attrs: { elements: number; settled: boolean; 'settle-ms': number }; artifacts: string };
  cleanupRoots.add(path.resolve(parsedJson.attestation.path, '../../..'));
  assert.equal(parsedJson.attrs.settled, true);
  assert.equal(typeof parsedJson.attrs.elements, 'number');
  assert.equal(typeof parsedJson.attrs['settle-ms'], 'number');
  assert.match(parsedJson.artifacts, /geometry\.json/);
  assert.match(parsedJson.artifacts, /media\.json/);
  assert.match(parsedJson.artifacts, /meta\.json/);
  assert.match(parsedJson.attestation.path, /oneshot-/);


  const sessionId = `cap-u15-${Date.now().toString(36)}`;
  const sessionDir = path.join(CAPTURE_ROOT, sessionId);
  cleanupRoots.add(sessionDir);
  ensurePrivateDir(sessionDir);
  writeJsonPrivate(path.join(sessionDir, '.session.json'), {
    id: sessionId, dir: sessionDir, harId: null, startedAt: new Date().toISOString(),
    url: pageUrl, targetId, stepCount: 0, logPids: [], bridgeSocket: null, bridgePid: null,
  });
  await setActiveSession({ sessionId, dir: sessionDir, harId: null, targetId, stepCount: 0, bridgeSocket: null });

  const active = runCapture(['measure', 'snap', '--port', String(cdpPort), '--state', 'hover:button', '--json']);
  assert.equal(active.status, 0, active.stderr);
  const activeResult = JSON.parse(active.stdout) as { attestation: { id: string; path: string } };
  assert.equal(activeResult.attestation.path, path.join(sessionDir, 'measure', 'snaps', activeResult.attestation.id));
  assert.ok(fs.existsSync(path.join(activeResult.attestation.path, 'states.json')));
  const resolved = await resolveSnapRef(activeResult.attestation.id);
  assert.equal(resolved.dir, activeResult.attestation.path, 'the active-session snap id resolves for later query leaves');

  const stopped = runCapture(['session', 'stop', sessionId]);
  assert.equal(stopped.status, 0, stopped.stderr);
  const viewed = runCapture(['session', 'view', sessionId, '--filter', 'measure']);
  assert.equal(viewed.status, 0, viewed.stderr);
  const listed = JSON.parse(viewed.stdout) as Array<{ id: string; path: string; settled: boolean }>;
  assert.equal(listed.length, 1);
  assert.equal(listed[0]?.id, activeResult.attestation.id);
  assert.equal(listed[0]?.path, activeResult.attestation.path);
  assert.equal(listed[0]?.settled, true);
});

test('measure snap rejects invalid viewport input before capture and preserves structured recovery evidence', () => {
  clearActiveSession();
  const rootsBeforeRejectedViewport = oneShotRoots();
  const rejectedViewport = runCapture(['measure', 'snap', pageUrl, '--port', String(cdpPort), '--viewport', 'not-a-viewport', '--json']);
  assert.equal(rejectedViewport.status, 1);
  const rejectedViewportResult = JSON.parse(rejectedViewport.stdout) as { attrs: { status: string }; sections: string[] };
  assert.equal(rejectedViewportResult.attrs.status, 'invalid_input');
  assert.match(rejectedViewportResult.sections[0] ?? '', /<positive-safe-int>x<positive-safe-int>/);
  assert.deepEqual(oneShotRoots(), rootsBeforeRejectedViewport, 'an invalid viewport must not allocate a one-shot root');

  const repeatedWithInvalidTail = runCapture([
    'measure', 'snap', pageUrl, '--port', String(cdpPort),
    '--viewport', '321x222', '--viewport', '390X844', '--json',
  ]);
  assert.equal(repeatedWithInvalidTail.status, 1);
  assert.deepEqual(oneShotRoots(), rootsBeforeRejectedViewport, 'all repeated viewports are validated before the first capture');

  const pat = 'github_pat_abcdefghijklmnopqrstuvwxyz0123456789';
  const missingRef = path.join(CAPTURE_ROOT, `missing-prefix-${pat}`);
  for (const json of [false, true]) {
    const result = runCapture(['measure', 'snap', missingRef, ...(json ? ['--json'] : [])]);
    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes(pat), 'structured artifact recovery preserves the exact ref and path evidence');
    if (json) {
      const body = JSON.parse(result.stdout) as { attrs: Record<string, unknown>; sections: string[] };
      assert.equal(body.attrs.status, 'snapshot_ref_unavailable');
      assert.equal(body.attrs.recovery, 'artifact-resolution-error');
      assert.equal(body.attrs.ref, missingRef);
      assert.equal(body.attrs.searched, missingRef);
      assert.equal(body.attrs['searched-paths'], 1);
      assert.equal(body.attrs['creating-command'], 'capture measure snap');
      assert.ok(body.sections.some((section) => section.includes('ref:')));
      assert.ok(body.sections.some((section) => section.includes('searched:')));
      assert.ok(body.sections.some((section) => section.includes('creating-command:')));
    }
  }
});

// A real high-DPI (Retina) display or headed-Chrome window cannot be produced
// inside this headless harness, so ownership classification for a native DPR
// that is not 1 is exercised against a structural CDP client: page DPR read +
// Emulation.getScreenInfos, plus the set/clear override calls it records.
function fakeViewportClient(pageDpr: number, screenDprs: number[]) {
  const sent: string[] = [];
  return {
    sent,
    send: async (method: string) => {
      sent.push(method);
      if (method === 'Runtime.evaluate') return { result: { value: pageDpr } };
      if (method === 'Emulation.getScreenInfos') return { screenInfos: screenDprs.map((dpr) => ({ devicePixelRatio: dpr })) };
      return {};
    },
  };
}

test('withAppliedViewport owns a native high-DPI target whose DPR matches a real display', async () => {
  const client = fakeViewportClient(2, [2]);
  let ran = false;
  await withAppliedViewport(client as never, { label: '390x844', width: 390, height: 844 }, async () => { ran = true; });
  assert.ok(ran, 'a native DPR-2 display is owned, so capture runs under the requested viewport');
  assert.deepEqual(
    client.sent.filter((method) => method.startsWith('Emulation.setDeviceMetricsOverride') || method.startsWith('Emulation.clearDeviceMetricsOverride')),
    ['Emulation.setDeviceMetricsOverride', 'Emulation.clearDeviceMetricsOverride'],
    'the temporary override is applied and then cleared',
  );
});

test('withAppliedViewport refuses a foreign DPR override that matches no display', async () => {
  const client = fakeViewportClient(2, [1]);
  await assert.rejects(
    withAppliedViewport(client as never, { label: '390x844', width: 390, height: 844 }, async () => {}),
    (err: unknown) => {
      assert.ok(err instanceof CaptureError, 'the refusal is a typed CaptureError');
      assert.equal(err.descriptor.code, 'viewport_unavailable');
      assert.match(err.message, /foreign-owned/);
      return true;
    },
  );
  assert.equal(client.sent.includes('Emulation.setDeviceMetricsOverride'), false, 'a foreign override is never replaced');
});

// Failure-injecting variant of fakeViewportClient: a native (owned) target
// whose set/clear override calls can be made to reject deterministically.
function failingViewportClient(opts: { failSet?: boolean; failClear?: boolean }) {
  const sent: string[] = [];
  return {
    sent,
    send: async (method: string) => {
      sent.push(method);
      if (method === 'Runtime.evaluate') return { result: { value: 2 } };
      if (method === 'Emulation.getScreenInfos') return { screenInfos: [{ devicePixelRatio: 2 }] };
      if (method === 'Emulation.setDeviceMetricsOverride' && opts.failSet) throw new Error('set-override-failed');
      if (method === 'Emulation.clearDeviceMetricsOverride' && opts.failClear) throw new Error('clear-override-failed');
      return {};
    },
  };
}

test('withAppliedViewport propagates a primary capture failure and still clears its override', async () => {
  const client = failingViewportClient({});
  const primary = new Error('capture-exploded');
  await assert.rejects(
    withAppliedViewport(client as never, { label: '390x844', width: 390, height: 844 }, async () => { throw primary; }),
    (err: unknown) => err === primary,
  );
  assert.ok(client.sent.includes('Emulation.clearDeviceMetricsOverride'), 'the override is cleared even when capture fails');
});

test('withAppliedViewport reports a dual failure as an AggregateError preserving both errors in order', async () => {
  const client = failingViewportClient({ failClear: true });
  const primary = new Error('capture-exploded');
  await assert.rejects(
    withAppliedViewport(client as never, { label: '390x844', width: 390, height: 844 }, async () => { throw primary; }),
    (err: unknown) => {
      assert.ok(err instanceof AggregateError, 'a dual failure is an AggregateError');
      assert.equal(err.errors.length, 2);
      assert.equal(err.errors[0], primary, 'the primary failure comes first');
      assert.match((err.errors[1] as Error).message, /clear-override-failed/);
      assert.equal(err.cause, primary, 'the primary failure is the cause');
      return true;
    },
  );
});

test('withAppliedViewport still attempts the clear when the override request itself rejects', async () => {
  const client = failingViewportClient({ failSet: true });
  await assert.rejects(
    withAppliedViewport(client as never, { label: '390x844', width: 390, height: 844 }, async () => {}),
    /set-override-failed/,
  );
  assert.ok(client.sent.includes('Emulation.clearDeviceMetricsOverride'), 'ownership is claimed before the set is awaited, so the clear still runs');
});

test('viewport capture applies native metrics during capture and clears them afterward', async () => {
  clearActiveSession();
  const baseline = await readViewport();
  const response = await fetch(`http://localhost:${cdpPort}/json/list`);
  const pages = await response.json() as Array<{ id?: string; webSocketDebuggerUrl?: string }>;
  const page = pages.find((entry) => entry.id === targetId);
  assert.ok(page?.webSocketDebuggerUrl);
  const client = new CDPClient(page.webSocketDebuggerUrl);
  await client.waitReady();
  try {
    await withAppliedViewport(client, { label: '321x222', width: 321, height: 222 }, async () => {
      assert.deepEqual(await readViewport(), { width: 321, height: 222, dpr: 1 }, 'capture runs under the requested viewport');
    });
    assert.deepEqual(await readViewport(), baseline, 'temporary viewport is cleared after capture');
  } finally {
    client.close();
  }
});

test('measure snap completes two repeated native viewport captures and clears the final override', async () => {
  clearActiveSession();
  const baseline = await readViewport();
  const repeated = runCapture(['measure', 'snap', pageUrl, '--port', String(cdpPort), '--viewport', '319x219', '--viewport', '321x222', '--json']);
  assert.equal(repeated.status, 0, repeated.stderr);
  const results = JSON.parse(repeated.stdout) as Array<{ attestation: { path: string }; attrs: { viewport: string } }>;
  assert.equal(results.length, 2);
  assert.deepEqual(results.map((result) => result.attrs.viewport), ['319x219', '321x222']);
  for (const result of results) {
    cleanupRoots.add(path.resolve(result.attestation.path, '../../..'));
    assert.ok(fs.existsSync(path.join(result.attestation.path, 'geometry.json')));
  }
  assert.deepEqual(await readViewport(), baseline, 'the second capture also clears its temporary viewport');
});

test('viewport request preserves a foreign DPR2 override without allocating artifacts', async () => {
  clearActiveSession();
  const rootsBefore = oneShotRoots();
  const response = await fetch(`http://localhost:${cdpPort}/json/list`);
  const pages = await response.json() as Array<{ id?: string; webSocketDebuggerUrl?: string }>;
  const page = pages.find((entry) => entry.id === targetId);
  assert.ok(page?.webSocketDebuggerUrl);
  const client = new CDPClient(page.webSocketDebuggerUrl);
  await client.waitReady();
  try {
    await client.send('Emulation.setDeviceMetricsOverride', { width: 444, height: 333, deviceScaleFactor: 2, mobile: false });
    assert.deepEqual(await readViewport(), { width: 444, height: 333, dpr: 2 });
    const rejected = runCapture(['measure', 'snap', pageUrl, '--port', String(cdpPort), '--viewport', '321x222', '--json']);
    assert.equal(rejected.status, 1);
    const result = JSON.parse(rejected.stdout) as { attrs: { status: string } };
    assert.equal(result.attrs.status, 'viewport_unavailable');
    assert.deepEqual(oneShotRoots(), rootsBefore, 'a foreign override rejection must precede one-shot allocation');
    assert.deepEqual(await readViewport(), { width: 444, height: 333, dpr: 2 }, 'snap must preserve the existing viewport and DPR');
  } finally {
    await client.send('Emulation.clearDeviceMetricsOverride');
    client.close();
  }
});

test('viewport request rejects a recorder-held target before it allocates a session snap', async () => {
  const sessionId = `cap-recorder-viewport-${Date.now().toString(36)}`;
  const sessionDir = path.join(CAPTURE_ROOT, sessionId);
  const recId = 'rec-live';
  const recDir = path.join(sessionDir, 'motion', 'recs', recId);
  cleanupRoots.add(sessionDir);
  ensurePrivateDir(recDir);
  writeJsonPrivate(path.join(recDir, 'recorder.json'), {
    recId,
    pid: process.pid,
    socketPath: path.join(recDir, 'recorder.sock'),
    nonce: 'a'.repeat(64),
    targetId,
    url: pageUrl,
    startedAt: new Date().toISOString(),
    state: 'recording',
    markers: { performanceNowMs: 0, wallClockMs: 0, firstScreencastTimestampSec: null, firstTraceEventTsUs: null, baselinesPending: true },
  });
  await setActiveSession({ sessionId, dir: sessionDir, harId: null, targetId, stepCount: 0, bridgeSocket: null, activeRecId: recId });
  try {
    const rejected = runCapture(['measure', 'snap', '--port', String(cdpPort), '--viewport', '321x222', '--json']);
    assert.equal(rejected.status, 1);
    const result = JSON.parse(rejected.stdout) as { attrs: { status: string } };
    assert.equal(result.attrs.status, 'viewport_unavailable');
    assert.equal(fs.existsSync(path.join(sessionDir, 'measure', 'snaps')), false, 'a recorder-owned target must reject before session snap allocation');
  } finally {
    clearActiveSession();
  }
});
