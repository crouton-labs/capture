import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-har-manager-'));
process.env.CAPTURE_ROOT = root;
const harManager = import('../src/har-manager.js');

async function loadHarManager() {
  return harManager;
}

function makeCapturedEntry(i: number, body = 'ok', status = 200): ReturnType<typeof baseEntry> {
  return baseEntry(i, {
    body,
    status,
    requestWallTime: 1720000000 + i,
  });
}

function baseEntry(
  i: number,
  {
    body,
    status,
    requestWallTime,
  }: {
    body: string;
    status: number;
    requestWallTime: number;
  },
) {
  const requestMonotonic = i * 11 + 100;
  const responseMonotonic = requestMonotonic + 10;
  const terminalMonotonic = responseMonotonic + 10;
  return {
    startedDateTime: new Date(requestWallTime * 1000).toISOString(),
    time: (terminalMonotonic - requestMonotonic) * 1000,
    request: {
      method: 'GET',
      url: `https://example.com/${i}`,
      headers: [{ name: 'accept', value: '*/*' }],
    },
    response: {
      status,
      headers: [{ name: 'content-type', value: 'text/plain' }],
      content: {
        text: body,
      },
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
        encodedDataLength: Buffer.byteLength(body, 'utf-8'),
      },
      response: {
        state: 'received',
      },
      body: {
        state: 'captured',
        sourceEncoding: 'text',
        decodedByteLength: Buffer.byteLength(body, 'utf-8'),
        capturedByteLength: Buffer.byteLength(body, 'utf-8'),
        truncated: false,
      },
    },
  };
}

function makeIncompleteLifecycle(i: number): {
  kind: 'stopped_before_terminal';
  requestId: string;
  generation: number;
  startedDateTime: string;
  request: {
    method: string;
    url: string;
    headers: { name: string; value: string }[];
  };
  _capture: { schemaVersion: 1; requestWallTime: number; requestMonotonic: number; response: { status: number; headers: { name: string; value: string }[]; responseMonotonic: number; } | null; };
} {
  return {
    kind: 'stopped_before_terminal',
    requestId: `req-${i}`,
    generation: 1,
    startedDateTime: new Date((1720001000 + i) * 1000).toISOString(),
    request: {
      method: 'GET',
      url: `https://example.com/incomplete-${i}`,
      headers: [{ name: 'accept', value: '*/*' }],
    },
    _capture: {
      schemaVersion: 1,
      requestWallTime: 1720001000 + i,
      requestMonotonic: i + 5,
      response: {
        status: 200,
        headers: [{ name: 'content-type', value: 'text/plain' }],
        responseMonotonic: i + 10,
      },
    },
  };
}

async function withSession<T>(name: string, fn: (dir: string) => Promise<T>): Promise<T> {
  const sessionDir = path.join(root, name);
  return fn(sessionDir);
}

test('create/read/append/delete roundtrip with private session HAR pathing', async () => {
  const { createHarRecording, readHarRecording, appendToHarRecording, deleteHarRecording, harFilePath } = await loadHarManager();
  await withSession('roundtrip', async (sessionDir) => {
    const created = await createHarRecording(sessionDir);
    assert.equal(created.id, created.path);
    assert.ok(created.path.startsWith(path.join(sessionDir, '.har')));

    const empty = await readHarRecording(created.id);
    assert.equal(empty.log.entries.length, 0);
    assert.equal(empty.incompleteLifecycles.length, 0);
    assert.equal(harFilePath(created.id), created.path);

    await appendToHarRecording(created.id, {
      entries: [makeCapturedEntry(1)],
      incompleteLifecycles: [makeIncompleteLifecycle(1)],
    });

    const afterAppend = await readHarRecording(created.id);
    assert.equal(afterAppend.log.entries.length, 1);
    assert.equal(afterAppend.incompleteLifecycles.length, 1);

    await deleteHarRecording(created.id);
    assert.ok(!fs.existsSync(created.path));
    await assert.rejects(readHarRecording(created.id), (err: unknown) => {
      return err instanceof Error && /recording|ENOENT|HAR validation failed|missing/.test(err.message);
    });
  });
});

test('appendToHarRecording no-op on empty batch', async () => {
  const { createHarRecording, readHarRecording, appendToHarRecording, deleteHarRecording } = await loadHarManager();
  await withSession('noop', async (sessionDir) => {
    const created = await createHarRecording(sessionDir);
    const before = await readHarRecording(created.id);
    await appendToHarRecording(created.id, { entries: [], incompleteLifecycles: [] });
    const after = await readHarRecording(created.id);
    assert.equal(after.log.entries.length, before.log.entries.length);
    await deleteHarRecording(created.id);
  });
});

test('strict validator rejects malformed batches and unknown keys', async () => {
  const { validateHarAppendBatch } = await loadHarManager();
  const validEntry = makeCapturedEntry(2, 'x', 200);
  const withUnknown = {
    ...JSON.parse(JSON.stringify(validEntry)),
    unknownTop: true,
  };
  assert.throws(() => {
    validateHarAppendBatch({
      entries: [withUnknown],
      incompleteLifecycles: [],
    }, 'har-append');
  }, /is an unknown key/);

  const invalidDiscriminator = {
    ...JSON.parse(JSON.stringify(validEntry)),
    _capture: {
      ...(validEntry as { _capture: Record<string, unknown> })._capture,
      terminal: { kind: 'bogus' },
    },
  };
  assert.throws(() => {
    validateHarAppendBatch({
      entries: [invalidDiscriminator],
      incompleteLifecycles: [],
    }, 'har-append');
  }, /must be "finished", "redirect", or "failed"/);
});

after(async () => {
  await fs.promises.rm(root, { recursive: true, force: true });
});
