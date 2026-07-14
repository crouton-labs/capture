import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

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
    // Creator provenance survives from the store header written at creation.
    assert.equal(afterAppend.log.creator.name, 'capture');
    assert.ok(afterAppend.log.creator.version.length > 0);
    // Wall-clock startedDateTime provenance survives the append/read roundtrip.
    assert.equal(
      afterAppend.log.entries[0].startedDateTime,
      new Date((1720000000 + 1) * 1000).toISOString(),
    );
    assert.equal(afterAppend.log.entries[0]._capture.clocks.requestWallTime, 1720000000 + 1);

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

test('stop-time read assembles exactly the appended batches, in append order', async () => {
  const { createHarRecording, readHarRecording, appendToHarRecording } = await loadHarManager();
  await withSession('assemble', async (sessionDir) => {
    const created = await createHarRecording(sessionDir);
    await appendToHarRecording(created.id, { entries: [makeCapturedEntry(10), makeCapturedEntry(11)], incompleteLifecycles: [] });
    await appendToHarRecording(created.id, { entries: [makeCapturedEntry(12)], incompleteLifecycles: [makeIncompleteLifecycle(3)] });
    const assembled = await readHarRecording(created.id);
    assert.deepEqual(
      assembled.log.entries.map((e) => e.request.url),
      ['https://example.com/10', 'https://example.com/11', 'https://example.com/12'],
    );
    assert.deepEqual(assembled.incompleteLifecycles.map((c) => c.requestId), ['req-3']);
  });
});

test('concurrent in-process appenders each land every batch exactly once', async () => {
  const { createHarRecording, readHarRecording, appendToHarRecording } = await loadHarManager();
  await withSession('inproc-concurrent', async (sessionDir) => {
    const created = await createHarRecording(sessionDir);
    const indexes = Array.from({ length: 20 }, (_, k) => 100 + k);
    await Promise.all(indexes.map((i) => appendToHarRecording(created.id, { entries: [makeCapturedEntry(i)], incompleteLifecycles: [] })));
    const har = await readHarRecording(created.id);
    assert.deepEqual(
      har.log.entries.map((e) => e._capture.requestId).sort(),
      indexes.map((i) => `req-${i}`).sort(),
    );
  });
});

// The V-13 regression proof: command-side and recorder-side appends are
// separate PROCESSES appending to the same live store. Under the deleted
// lock-guarded read-modify-write shape, one writer holding the 250ms lock
// turned ordinary contention into a fatal latched recorder error; under the
// O_APPEND log shape every writer must exit 0 and every batch must land
// exactly once, with no loss, duplication, or contention error.
test('concurrent subprocess appenders land every batch exactly once with no contention failure', async () => {
  const { createHarRecording, readHarRecording } = await loadHarManager();
  await withSession('subprocess-concurrent', async (sessionDir) => {
    const created = await createHarRecording(sessionDir);
    const workers = 4;
    const batchesPerWorker = 25;
    const harManagerUrl = pathToFileURL(path.resolve('src/har-manager.ts')).href;
    const script = [
      "import fs from 'node:fs';",
      'const { appendToHarRecording } = await import(process.env.HAR_MANAGER_URL);',
      "const { id, batches } = JSON.parse(fs.readFileSync(process.env.HAR_BATCH_FILE, 'utf8'));",
      'for (const batch of batches) await appendToHarRecording(id, batch);',
    ].join('\n');

    const expected: string[] = [];
    const children = Array.from({ length: workers }, (_, worker) => {
      const batches = Array.from({ length: batchesPerWorker }, (_, seq) => {
        const i = 1000 * (worker + 1) + seq;
        expected.push(`req-${i}`);
        return { entries: [makeCapturedEntry(i)], incompleteLifecycles: [] };
      });
      const batchFile = path.join(root, `worker-batches-${worker}.json`);
      fs.writeFileSync(batchFile, JSON.stringify({ id: created.id, batches }));
      const env = { ...process.env, CAPTURE_ROOT: root, HAR_MANAGER_URL: harManagerUrl, HAR_BATCH_FILE: batchFile };
      delete env.NODE_OPTIONS;
      const child = spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], { env, stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      return new Promise<void>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`appender worker ${worker} exited ${code}: ${stderr}`));
        });
      });
    });
    await Promise.all(children);

    const har = await readHarRecording(created.id);
    assert.equal(har.log.entries.length, workers * batchesPerWorker);
    assert.deepEqual(
      har.log.entries.map((e) => e._capture.requestId).sort(),
      expected.sort(),
    );
  });
});

test('a corrupt NDJSON line fails the read closed without any rewrite', async () => {
  const { createHarRecording, readHarRecording, appendToHarRecording } = await loadHarManager();
  await withSession('corrupt-line', async (sessionDir) => {
    const created = await createHarRecording(sessionDir);
    await appendToHarRecording(created.id, { entries: [makeCapturedEntry(50)], incompleteLifecycles: [] });
    fs.appendFileSync(created.path, '{"entries":[oops\n');
    const before = fs.readFileSync(created.path);
    await assert.rejects(readHarRecording(created.id), /HAR validation failed.*is not valid JSON/);
    assert.ok(before.equals(fs.readFileSync(created.path)), 'a failed read must never rewrite the store');
  });
});

test('an unterminated trailing record fails the read closed', async () => {
  const { createHarRecording, readHarRecording } = await loadHarManager();
  await withSession('unterminated', async (sessionDir) => {
    const created = await createHarRecording(sessionDir);
    fs.appendFileSync(created.path, '{"entries":[],"incompleteLifecycles":[]}');
    const before = fs.readFileSync(created.path);
    await assert.rejects(readHarRecording(created.id), /unterminated record/);
    assert.ok(before.equals(fs.readFileSync(created.path)));
  });
});

test('append to a missing (deleted) store fails explicitly and never recreates it', async () => {
  const { createHarRecording, appendToHarRecording, deleteHarRecording } = await loadHarManager();
  await withSession('append-missing', async (sessionDir) => {
    const created = await createHarRecording(sessionDir);
    await deleteHarRecording(created.id);
    await assert.rejects(
      appendToHarRecording(created.id, { entries: [makeCapturedEntry(60)], incompleteLifecycles: [] }),
      /live HAR recording is missing/,
    );
    assert.equal(fs.existsSync(created.path), false, 'a failed append must never create the store');
  });
});

test('a pre-cut whole-file JSON store fails closed and is never recreated as empty', async () => {
  const { readHarRecording } = await loadHarManager();
  await withSession('legacy-shape', async (sessionDir) => {
    const harDir = path.join(sessionDir, '.har');
    fs.mkdirSync(harDir, { recursive: true, mode: 0o700 });
    // The deleted store shape: one pretty-printed HarFile JSON document.
    const legacyPretty = path.join(harDir, 'legacy-pretty.json');
    fs.writeFileSync(legacyPretty, JSON.stringify({ log: { version: '1.2', creator: { name: 'capture', version: 'x' }, entries: [] }, incompleteLifecycles: [] }, null, 2), { mode: 0o600 });
    let before = fs.readFileSync(legacyPretty);
    await assert.rejects(readHarRecording(legacyPretty), /HAR validation failed.*(is not valid JSON|unterminated record)/);
    assert.ok(before.equals(fs.readFileSync(legacyPretty)), 'the unknown-shape store must not be rewritten');

    // A single-line JSON document parses but is not the store header: fail closed.
    const legacyCompact = path.join(harDir, 'legacy-compact.json');
    fs.writeFileSync(legacyCompact, `${JSON.stringify({ log: { version: '1.2', creator: { name: 'capture', version: 'x' }, entries: [] }, incompleteLifecycles: [] })}\n`, { mode: 0o600 });
    before = fs.readFileSync(legacyCompact);
    await assert.rejects(readHarRecording(legacyCompact), /harStoreHeader/);
    assert.ok(before.equals(fs.readFileSync(legacyCompact)));

    // A zero-byte file is not a store either — and is never "repaired" to one.
    const empty = path.join(harDir, 'empty.json');
    fs.writeFileSync(empty, '', { mode: 0o600 });
    await assert.rejects(readHarRecording(empty), /is empty/);
    assert.equal(fs.readFileSync(empty).length, 0);
  });
});

test('store file is created 0600 under a 0700 .har dir; a symlinked store path is refused untouched', async () => {
  const { createHarRecording, readHarRecording, appendToHarRecording } = await loadHarManager();
  await withSession('perms', async (sessionDir) => {
    const created = await createHarRecording(sessionDir);
    assert.equal(fs.statSync(created.path).mode & 0o777, 0o600);
    assert.equal(fs.statSync(path.dirname(created.path)).mode & 0o777, 0o700);

    // Final-component symlink trap: no-follow refuses it and the target's
    // bytes stay untouched, for both append and read.
    const outside = path.join(os.tmpdir(), `har-symlink-target-${process.pid}`);
    fs.writeFileSync(outside, 'outside bytes');
    try {
      fs.unlinkSync(created.path);
      fs.symlinkSync(outside, created.path);
      await assert.rejects(
        appendToHarRecording(created.id, { entries: [makeCapturedEntry(70)], incompleteLifecycles: [] }),
        (err: unknown) => (err as NodeJS.ErrnoException).code === 'ELOOP',
      );
      await assert.rejects(readHarRecording(created.id), (err: unknown) => (err as NodeJS.ErrnoException).code === 'ELOOP');
      assert.equal(fs.readFileSync(outside, 'utf8'), 'outside bytes');
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});

after(async () => {
  await fs.promises.rm(root, { recursive: true, force: true });
});
