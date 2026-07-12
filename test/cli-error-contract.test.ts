import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-cli-error-'));
const entry = path.join(tempDir, 'capture.cjs');

// This executes the current TypeScript source, never the frozen bin/capture.
execFileSync(path.join(process.cwd(), 'node_modules/.bin/esbuild'), [
  'src/capture.ts', '--bundle', '--platform=node', '--format=cjs', `--outfile=${entry}`,
], { stdio: 'pipe' });

function run(args: string[], envOverrides: NodeJS.ProcessEnv = {}, preserveStale = true): ReturnType<typeof spawnSync> {
  const nodeId = `cli-error-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const active = path.join(os.tmpdir(), 'capture-sessions', `.active-${nodeId}`);
  fs.mkdirSync(path.dirname(active), { recursive: true });
  const stale = '{"sessionId":"stale","dir":"/does/not/exist"}\n';
  fs.writeFileSync(active, stale);
  const childEnv: NodeJS.ProcessEnv = { ...process.env, CRTR_NODE_ID: nodeId };
  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  }
  const result = spawnSync(process.execPath, [entry, ...args], {
    encoding: 'utf8',
    env: childEnv,
  });
  if (preserveStale) assert.equal(fs.readFileSync(active, 'utf8'), stale, `${args.join(' ')} must not hydrate or clean the stale pointer`);
  fs.rmSync(active, { force: true });
  return result;
}

function assertOneError(args: string[], env?: NodeJS.ProcessEnv): void {
  const result = run(args, env);
  assert.equal(result.status, 1, args.join(' '));
  assert.equal(result.stderr, '', args.join(' '));
  assert.match(result.stdout, /^<error\b[\s\S]*<\/error>\n$/, args.join(' '));
  assert.equal((result.stdout.match(/<error\b/g) ?? []).length, 1, args.join(' '));
}

test('source CLI renders malformed root, flag, env, numeric, and branch failures exactly once', () => {
  assertOneError(['unknown-root']);
  assertOneError(['page', 'click', '--nonsense']);
  assertOneError(['tab', 'list'], { CDP_PORT: '9222junk' });
  assertOneError(['tab', 'list'], { CDP_PORT: '' });
  assertOneError(['page', 'click', '--settle', '-1']);
  assertOneError(['page', 'unknown']);
  assertOneError(['tab', 'unknown']);
  assertOneError(['measure', 'unknown']);
  assertOneError(['measure', 'map', 'unknown']);
  assertOneError(['motion', 'unknown']);
});

test('source CLI emits the same single error mirror under --json', () => {
  const result = run(['page', 'unknown', '--json']);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  const output = JSON.parse(result.stdout) as { tag: string; attrs: { code: string } };
  assert.equal(output.tag, 'error');
  assert.equal(output.attrs.code, 'unknown_command');
});

test('a deterministic no-browser command failure is normalized at the root boundary', () => {
  const result = run(['page', 'elements', '--port', '1'], {}, false);
  assert.equal(result.status, 1);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /^<error\b[\s\S]*<\/error>\n$/);
});
