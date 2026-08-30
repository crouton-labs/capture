import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { reconcile } from './reconcile.mjs';

const ROOT = '/Users/silasrhyneer/Code/cli/capture';
const WRAPPER = join(ROOT, 'audit/wrapper/capture');
const REAL_CAPTURE = join(ROOT, 'bin/capture');
const temporaryRoot = await mkdtemp(join(tmpdir(), 'capture-wrapper-test-'));

test.after(async () => rm(temporaryRoot, { recursive: true, force: true }));

function start(command, args, { env = {}, input } = {}) {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const stdout = [];
  const stderr = [];
  const events = [];
  const startedAt = Date.now();
  child.stdout.on('data', (chunk) => {
    stdout.push(chunk);
    events.push({ stream: 'stdout', chunk: Buffer.from(chunk), at: Date.now() - startedAt });
  });
  child.stderr.on('data', (chunk) => {
    stderr.push(chunk);
    events.push({ stream: 'stderr', chunk: Buffer.from(chunk), at: Date.now() - startedAt });
  });
  if (input === undefined) child.stdin.end();
  else child.stdin.end(input);

  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({
      code,
      signal,
      stdout: Buffer.concat(stdout),
      stderr: Buffer.concat(stderr),
      events,
      finishedAt: Date.now() - startedAt,
    }));
  });
  return { child, done };
}

async function runWrapper(args, options = {}) {
  const transcript = options.transcript ?? join(temporaryRoot, `transcript-${crypto.randomUUID()}.ndjson`);
  const result = await start(WRAPPER, args, {
    ...options,
    env: { ...options.env, AUDIT_TRANSCRIPT: transcript, AUDIT_RUN_ID: 'test-run' },
  }).done;
  return { ...result, transcript };
}

async function writeStub(name, source) {
  const stub = join(temporaryRoot, `${name}-${crypto.randomUUID()}.mjs`);
  await writeFile(stub, `#!/usr/bin/env node\n${source}`);
  await chmod(stub, 0o755);
  return stub;
}

for (const [name, args] of [
  ['root help', ['-h']],
  ['branch help', ['page', '-h']],
  ['leaf help', ['page', 'navigate', '-h']],
  ['unknown command', ['not-a-command']],
  ['large-output command', ['lib', 'list']],
]) {
  test(`forwards byte-identical real capture ${name}`, async () => {
    const direct = await start(REAL_CAPTURE, args).done;
    const wrapped = await runWrapper(args);
    assert.equal(wrapped.code, direct.code);
    assert.equal(wrapped.signal, direct.signal);
    assert.deepEqual(wrapped.stdout, direct.stdout);
    assert.deepEqual(wrapped.stderr, direct.stderr);
    if (name === 'unknown command') assert.equal(wrapped.code, 1);
  });
}

test('streams output before exit and preserves stdout/stderr ordering', async () => {
  const stub = await writeStub('stream', `
process.stdout.write('stdout-first');
setTimeout(() => {
  process.stderr.write('stderr-middle');
  setTimeout(() => {
    process.stdout.write('stdout-last');
    setTimeout(() => {}, 250);
  }, 70);
}, 70);
`);
  const wrapped = await runWrapper([], { env: { AUDIT_CAPTURE_BIN: stub } });
  assert.equal(wrapped.code, 0);
  assert.deepEqual(wrapped.stdout, Buffer.from('stdout-firststdout-last'));
  assert.deepEqual(wrapped.stderr, Buffer.from('stderr-middle'));
  assert.deepEqual(wrapped.events.map(({ stream, chunk }) => `${stream}:${chunk}`), [
    'stdout:stdout-first',
    'stderr:stderr-middle',
    'stdout:stdout-last',
  ]);
  assert.ok(wrapped.events[2].at - wrapped.events[0].at >= 120, 'later output was buffered until exit');
  assert.ok(wrapped.finishedAt - wrapped.events[0].at >= 300, 'first chunk was withheld until child exit');
});

test('propagates zero, one, and non-standard exit codes', async () => {
  const stub = await writeStub('exit', 'process.exit(Number(process.argv[2]));\n');
  for (const code of [0, 1, 37]) {
    const wrapped = await runWrapper([String(code)], { env: { AUDIT_CAPTURE_BIN: stub } });
    assert.equal(wrapped.code, code);
    assert.equal(wrapped.signal, null);
  }
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  test(`forwards ${signal} and records child termination`, async () => {
    const stub = await writeStub(`signal-${signal}`, `
setTimeout(() => process.stdout.write('ready'), 100);
setInterval(() => {}, 1_000);
`);
    const transcript = join(temporaryRoot, `signal-${signal}-${crypto.randomUUID()}.ndjson`);
    const running = start(WRAPPER, [], {
      env: { AUDIT_CAPTURE_BIN: stub, AUDIT_TRANSCRIPT: transcript, AUDIT_RUN_ID: 'test-run' },
    });
    await Promise.race([
      new Promise((resolve) => running.child.stdout.once('data', resolve)),
      new Promise((_, reject) => running.child.once('close', () => reject(new Error('wrapper exited before the child became ready')))),
    ]);
    running.child.kill(signal);
    const result = await running.done;
    assert.equal(result.signal, null);
    assert.equal(result.code, signal === 'SIGTERM' ? 143 : 130);
    const [event] = (await readFile(transcript, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(event.signal, signal);
    assert.equal(event.exitCode, null);
  });
}

test('pipes binary stdin unchanged', async () => {
  const stub = await writeStub('stdin', 'process.stdin.pipe(process.stdout);\n');
  const input = Buffer.from([0, 255, 1, 10, 128, 65]);
  const wrapped = await runWrapper([], { env: { AUDIT_CAPTURE_BIN: stub }, input });
  assert.equal(wrapped.code, 0);
  assert.deepEqual(wrapped.stdout, input);
});

test('concurrent invocations allocate unique gapless transcript ordinals', async () => {
  const stub = await writeStub('concurrent', "process.stdout.write('ok');\n");
  const transcript = join(temporaryRoot, `concurrent-${crypto.randomUUID()}.ndjson`);
  const count = 32;
  const results = await Promise.all(Array.from({ length: count }, () => runWrapper([], {
    transcript,
    env: { AUDIT_CAPTURE_BIN: stub },
  })));
  assert.deepEqual(results.map(({ code }) => code), Array(count).fill(0));
  const events = (await readFile(transcript, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(events.length, count);
  assert.deepEqual(events.map(({ ordinal }) => ordinal), Array.from({ length: count }, (_, index) => index + 1));
});

test('records real capture stdout byte count exactly', async () => {
  const wrapped = await runWrapper(['-h']);
  const [event] = (await readFile(wrapped.transcript, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(event.stdoutBytes, wrapped.stdout.length);
  assert.equal(event.stderrBytes, wrapped.stderr.length);
  assert.equal(event.artifactPaths.includes('/'), false);
});

test('records only the exact emitted artifact path', async () => {
  const artifactDirectory = join(temporaryRoot, `artifacts-${crypto.randomUUID()}`);
  await mkdir(artifactDirectory);
  const basePath = join(artifactDirectory, 'artifact');
  const emittedPath = `${basePath}?run=1`;
  const decoratedPath = join(artifactDirectory, 'sweep.json');
  await Promise.all([writeFile(basePath, 'base'), writeFile(emittedPath, 'emitted'), writeFile(decoratedPath, 'decorated')]);
  const stub = await writeStub('artifact', "process.stdout.write(process.env.ARTIFACT);\n");
  const output = `${emittedPath}\nSweep artifact written to ${decoratedPath}. path=${decoratedPath}`;
  const wrapped = await runWrapper([], { env: { AUDIT_CAPTURE_BIN: stub, ARTIFACT: output } });
  const [event] = (await readFile(wrapped.transcript, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(event.artifactPaths, [emittedPath, decoratedPath]);
});

test('marks a stale transcript lock without changing the child result', async () => {
  const transcript = join(temporaryRoot, `stale-lock-${crypto.randomUUID()}.ndjson`);
  await writeFile(`${transcript}.lock`, 'stale');
  const stub = await writeStub('stale-lock', "process.stdout.write('child-output');\n");
  const wrapped = await runWrapper([], { transcript, env: { AUDIT_CAPTURE_BIN: stub } });
  assert.equal(wrapped.code, 0);
  assert.equal(wrapped.stdout.toString(), 'child-output');
  assert.equal(await readFile(transcript, 'utf8'), '');
  assert.ok(existsSync(`${transcript}.failure`));
  const connections = join(temporaryRoot, `stale-lock-connections-${crypto.randomUUID()}.ndjson`);
  await writeFile(connections, '');
  await assert.rejects(reconcile(transcript, connections), /transcript recording failed/);
});

test('makes an unwritable transcript detectable without running the child', async () => {
  const transcriptDirectory = join(temporaryRoot, `not-a-file-${crypto.randomUUID()}`);
  await mkdir(transcriptDirectory);
  const stub = await writeStub('must-not-run', "process.stdout.write('child ran');\n");
  const result = await start(WRAPPER, [], {
    env: { AUDIT_CAPTURE_BIN: stub, AUDIT_TRANSCRIPT: transcriptDirectory, AUDIT_RUN_ID: 'test-run' },
  }).done;
  assert.equal(result.code, 70);
  assert.equal(result.stdout.toString(), '');
  assert.match(result.stderr.toString(), /configuration error/);
  assert.ok(existsSync(`${transcriptDirectory}.failure`));
});

test('records the invocation when a downstream consumer closes the pipe early', async () => {
  const stub = await writeStub('flood', `
const chunk = 'x'.repeat(64 * 1024);
for (let i = 0; i < 40; i += 1) process.stdout.write(chunk);
`);
  const transcript = join(temporaryRoot, `transcript-${crypto.randomUUID()}.ndjson`);
  await writeFile(transcript, '');

  const piped = await start('sh', ['-c', `"$0" flood | head -c 100 > /dev/null`, WRAPPER], {
    env: { AUDIT_TRANSCRIPT: transcript, AUDIT_RUN_ID: 'test-run', AUDIT_CAPTURE_BIN: stub },
  }).done;
  const direct = await start('sh', ['-c', `"$0" | head -c 100 > /dev/null`, stub]).done;

  const lines = (await readFile(transcript, 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.equal(lines.length, 1, 'a piped invocation must still reach the transcript');
  assert.equal(lines[0].ordinal, 1);
  assert.deepEqual(lines[0].argv, ['flood']);
  assert.equal(lines[0].outputPipeErrors?.stdout, 'EPIPE', 'the lost consumer is recorded, not silently swallowed');
  assert.equal(piped.code, direct.code, 'exit code matches the unwrapped pipeline');
});
