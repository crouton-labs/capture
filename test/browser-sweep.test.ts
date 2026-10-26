/**
 * `sweepOwnedBrowsers` must reap only browsers it has evidence are dead or
 * unusable. A slow answer, an unreadable process table, or a launch still in
 * flight in another capture process is not that evidence (NL-66).
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-browser-sweep-'));
process.env.CAPTURE_ROOT = root;
const browserProcess = import('../src/cdp/browser-process.js');
const artifacts = import('../src/session/artifacts.js');

const children: Array<ReturnType<typeof spawn>> = [];
const servers: net.Server[] = [];
after(() => {
  for (const child of children) child.kill('SIGKILL');
  for (const server of servers) server.close();
  fs.rmSync(root, { recursive: true, force: true });
});

async function registerLiveProcess(port: number | null): Promise<{ pid: number }> {
  const { processPidBirthProvider, writeJsonPrivate, ensurePrivateDir } = await artifacts;
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
  children.push(child);
  const pid = child.pid!;
  const observed = processPidBirthProvider.read(pid);
  assert.equal(observed.status, 'found');
  const token = crypto.randomBytes(8).toString('hex');
  const profileDir = ensurePrivateDir(path.join(root, 'browsers', 'profiles', token));
  const now = new Date().toISOString();
  writeJsonPrivate(path.join(root, 'browsers', `${token}.json`), {
    version: 1, token, port, pid, birth: (observed as { identity: unknown }).identity, profileDir,
    executablePath: process.execPath, source: 'system', headless: true, startedAt: now, lastUsedAt: now,
  });
  return { pid };
}

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('a browser whose CDP endpoint is slow to answer is not reaped as unreachable', async () => {
  // Accepts the connection and never replies: the probe times out, which a
  // CPU-starved but healthy browser also looks like.
  const server = net.createServer(() => {});
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { sweepOwnedBrowsers, readOwnedBrowsers } = await browserProcess;
  const { pid } = await registerLiveProcess((server.address() as net.AddressInfo).port);
  const reaped = await sweepOwnedBrowsers();
  assert.deepEqual(reaped, []);
  assert.ok(alive(pid), 'the sweep must not signal a browser that merely answered slowly');
  assert.equal(readOwnedBrowsers().length, 1);
});

test('a record with no port yet, still inside its launch window, is left to the launching process', async () => {
  const { sweepOwnedBrowsers, readOwnedBrowsers } = await browserProcess;
  for (const record of readOwnedBrowsers()) fs.rmSync(path.join(root, 'browsers', `${record.token}.json`));
  const { pid } = await registerLiveProcess(null);
  const reaped = await sweepOwnedBrowsers();
  assert.deepEqual(reaped, []);
  assert.ok(alive(pid), 'a launch in flight in another capture process must not be killed by this sweep');
});
