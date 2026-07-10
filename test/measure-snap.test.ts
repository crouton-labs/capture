import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';

import { CAPTURE_ROOT, ensurePrivateDir, writeJsonPrivate } from '../src/session/artifacts.js';
import { clearActiveSession, setActiveSession } from '../src/session-context.js';
import { resolveSnapRef } from '../src/output/artifact.js';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const scope = `measure-snap-test-${process.pid}-${Date.now()}`;
const secret = 'hunter2-should-not-appear';
let chrome: ChildProcess | undefined;
let server: http.Server | undefined;
let cdpPort = 0;
let pageUrl = '';
let targetId = '';

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
  cdpPort = 22000 + Math.floor(Math.random() * 1000);
  chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${cdpPort}`, 'about:blank',
  ], { stdio: 'ignore' });
  await waitFor(`http://localhost:${cdpPort}/json/version`);
}

async function openFixturePage(): Promise<void> {
  const response = await fetch(`http://localhost:${cdpPort}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' });
  const page = await response.json() as { id?: string };
  assert.ok(page.id);
  targetId = page.id;
  await sleep(150);
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

after(() => {
  clearActiveSession();
  delete process.env.CRTR_NODE_ID;
  try { chrome?.kill('SIGKILL'); } catch { /* already stopped */ }
  server?.close();
});

test('measure snap writes one-shot and active-session substrates, including a hover state artifact with redacted output', async () => {
  const oneShot = runCapture(['measure', 'snap', pageUrl, '--port', String(cdpPort), '--state', 'hover:button']);
  assert.equal(oneShot.status, 0, oneShot.stderr);
  assert.match(oneShot.stdout, /<snapshot /);
  assert.match(oneShot.stdout, /elements="\d+"/);
  assert.match(oneShot.stdout, /Artifacts: .*geometry\.json/);
  assert.ok(!oneShot.stdout.includes(secret), 'rendered output must not expose password values');
  const oneShotPath = oneShot.stdout.match(/path="([^"]+)"/)?.[1];
  assert.ok(oneShotPath, oneShot.stdout);
  assert.match(oneShotPath, new RegExp(`^${CAPTURE_ROOT.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}/oneshot-[^/]+/measure/snaps/snap-`));
  assert.ok(fs.existsSync(path.join(oneShotPath, 'states.json')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(oneShotPath, 'states.json'), 'utf8')).requested, ['hover:button']);

  const jsonOneShot = runCapture(['measure', 'snap', pageUrl, '--port', String(cdpPort), '--json']);
  assert.equal(jsonOneShot.status, 0, jsonOneShot.stderr);
  assert.ok(!jsonOneShot.stdout.includes(secret), 'JSON output must apply the same default redaction');
  const parsedJson = JSON.parse(jsonOneShot.stdout) as { attestation: { path: string }; attrs: { elements: number; settled: boolean; 'settle-ms': number }; artifacts: string };
  assert.equal(parsedJson.attrs.settled, true);
  assert.equal(typeof parsedJson.attrs.elements, 'number');
  assert.equal(typeof parsedJson.attrs['settle-ms'], 'number');
  assert.match(parsedJson.artifacts, /geometry\.json/);
  assert.match(parsedJson.attestation.path, /oneshot-/);

  const sessionId = `cap-u15-${Date.now().toString(36)}`;
  const sessionDir = path.join(CAPTURE_ROOT, sessionId);
  ensurePrivateDir(sessionDir);
  writeJsonPrivate(path.join(sessionDir, '.session.json'), {
    id: sessionId, dir: sessionDir, harId: null, startedAt: new Date().toISOString(),
    url: pageUrl, targetId, stepCount: 0, logPids: [], bridgeSocket: null, bridgePid: null,
  });
  setActiveSession({ sessionId, dir: sessionDir, harId: null, targetId, stepCount: 0, bridgeSocket: null });

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

  fs.rmSync(path.resolve(oneShotPath, '../../..'), { recursive: true, force: true });
  fs.rmSync(sessionDir, { recursive: true, force: true });
});
