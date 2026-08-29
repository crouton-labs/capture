import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CollectorHost } from '../src/cdp/host/core.js';
import { MotionCollector } from '../src/cdp/host/collectors/motion.js';
import { COLLECTOR_KINDS } from '../src/cdp/host/kinds.js';
import { CAPTURE_ROOT, ensurePrivateDir, processPidBirthProvider, readPrivateFile, removeArtifactTree } from '../src/session/artifacts.js';
import type { Collector, CollectorContext, DrainCause, DrainOutcome } from '../src/cdp/host/collector.js';

class FakeClient {
  private disconnect: (() => void) | undefined;
  on(): void {}
  onDisconnect(handler: () => void): void { this.disconnect = handler; }
  close(): void {}
  async send(): Promise<unknown> { return {}; }
}

function identity() {
  const observed = processPidBirthProvider.read(process.pid);
  assert.equal(observed.status, 'found');
  return observed.identity;
}

function freshSession(label: string): string {
  const dir = path.join(CAPTURE_ROOT, `collector-host-${label}-${process.pid}-${Math.random().toString(16).slice(2)}`);
  ensurePrivateDir(dir);
  return dir;
}

function withTraceCollector(factory: () => Collector, body: () => Promise<void>): Promise<void> {
  const previous = COLLECTOR_KINDS.trace;
  (COLLECTOR_KINDS as any).trace = { kind: 'trace', idSegments: ['test'], idPrefix: 'test', label: 'test', parseConfig: (value: unknown) => value, create: factory, reconstruct: () => ({ summary: {}, files: [] }) };
  return body().finally(() => { (COLLECTOR_KINDS as any).trace = previous; });
}

test('motion collector clears a viewport override when HAR startup fails', async () => {
  const dir = freshSession('motion-viewport-failure');
  const calls: string[] = [];
  const client = {
    on(): void {},
    onDisconnect(): void {},
    async send(method: string): Promise<unknown> {
      calls.push(method);
      if (method === 'Network.enable') throw new Error('Network.enable failed');
      return {};
    },
  };
  try {
    const collector = new MotionCollector();
    await assert.rejects(collector.start({
      client: client as never,
      dir,
      id: 'rec-test',
      targetId: 'tab',
      config: { harId: 'har-test', viewport: { width: 800, height: 600 } },
      appendRecord(): void {},
      openChunkFile(): never { throw new Error('not reached'); },
      noteLoss(): void {},
    }), /Network.enable failed/);
    assert.deepEqual(calls, ['Emulation.setDeviceMetricsOverride', 'Network.enable', 'Emulation.clearDeviceMetricsOverride']);
    assert.equal(fs.existsSync(path.join(dir, 'viewport-override.json')), false);
  } finally { removeArtifactTree(dir); }
});

test('collector host refuses a collector claim held by a non-collector reservation', async () => {
  const dir = freshSession('reservation');
  try {
    const host = new CollectorHost(new FakeClient() as never, dir, { pid: process.pid, birth: identity(), targetId: 'tab' }, () => {}, () => {});
    host.reserve(['tracing'], 'lighthouse', process.pid, identity());
    await assert.rejects(host.start('motion', { harId: 'har' }), /Claim "tracing" is held by reservation lighthouse/);
  } finally { removeArtifactTree(dir); }
});

test('collector host reserves claims before awaiting collector start', async () => {
  const dir = freshSession('starting');
  let releaseStart!: () => void;
  const starting = new Promise<void>(resolve => { releaseStart = resolve; });
  try {
    await withTraceCollector(() => ({
      kind: 'trace', claims: ['tracing'],
      async start(): Promise<void> { await starting; },
      closeAdmission(): void {},
      async drain(): Promise<DrainOutcome> { return { summary: {}, files: [] }; },
      abandon(): void {},
    }), async () => {
      const host = new CollectorHost(new FakeClient() as never, dir, { pid: process.pid, birth: identity(), targetId: 'tab' }, () => {}, () => {});
      const first = host.start('trace', {});
      await assert.rejects(host.start('trace', {}), /Claim "tracing" is held by collector test-/);
      releaseStart();
      await first;
    });
  } finally { removeArtifactTree(dir); }
});

test('collector host closes admission synchronously before drain and records verified committed bytes', async () => {
  const dir = freshSession('drain');
  let releaseDrain!: () => void;
  const draining = new Promise<void>(resolve => { releaseDrain = resolve; });
  let closed = false;
  try {
    await withTraceCollector(() => ({
      kind: 'trace', claims: [],
      async start(_ctx: CollectorContext): Promise<void> {},
      closeAdmission(): void { closed = true; },
      async drain(_cause: DrainCause): Promise<DrainOutcome> {
        await draining;
        return { summary: { ok: true }, files: [{ name: 'untrusted-name', bytes: 1 }] };
      },
      abandon(): void {},
    }), async () => {
      const host = new CollectorHost(new FakeClient() as never, dir, { pid: process.pid, birth: identity(), targetId: 'tab' }, () => {}, () => {});
      const row = await host.start('trace', {});
      const stop = host.stop(row.id);
      assert.equal(closed, true, 'admission must close in stop() before its first drain await');
      releaseDrain();
      await stop;
      const meta = JSON.parse(readPrivateFile(path.join(row.dir, 'meta.json')).toString('utf8')) as { files: Array<{ name: string; bytes: number }> };
      assert.deepEqual(meta.files, [], 'the host does not trust a collector-supplied file inventory');
    });
  } finally { removeArtifactTree(dir); }
});

test('collector host finalizes chunk artifacts from the bytes committed by its writer', async () => {
  const dir = freshSession('bytes');
  try {
    await withTraceCollector(() => {
      let context: CollectorContext;
      return {
        kind: 'trace', claims: [],
        async start(ctx: CollectorContext): Promise<void> { context = ctx; },
        closeAdmission(): void {},
        async drain(): Promise<DrainOutcome> {
          const chunk = context!.openChunkFile('trace.bin');
          chunk.write(Buffer.from([1, 2, 3, 4]));
          assert.equal(chunk.commit(), 4);
          return { summary: {}, files: [] };
        },
        abandon(): void {},
      };
    }, async () => {
      const host = new CollectorHost(new FakeClient() as never, dir, { pid: process.pid, birth: identity(), targetId: 'tab' }, () => {}, () => {});
      const row = await host.start('trace', {});
      await host.stop(row.id);
      const meta = JSON.parse(readPrivateFile(path.join(row.dir, 'meta.json')).toString('utf8')) as { files: Array<{ name: string; bytes: number }> };
      assert.deepEqual(meta.files, [{ name: 'trace.bin', bytes: 4 }]);
      assert.deepEqual(fs.readFileSync(path.join(row.dir, 'trace.bin')), Buffer.from([1, 2, 3, 4]));
    });
  } finally { removeArtifactTree(dir); }
});
