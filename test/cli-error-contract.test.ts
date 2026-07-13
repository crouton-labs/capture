import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';

// The process-start frozen root. Spawned CLI children inherit this process's
// environment, so they resolve the same root and the oneshot leak detector
// below watches exactly the root those children write to.
import { CAPTURE_ROOT } from '../src/session/artifacts.js';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-cli-error-'));
const entry = path.join(tempDir, 'capture.cjs');

// This executes the current TypeScript source, never the frozen bin/capture.
execFileSync(path.join(process.cwd(), 'node_modules/.bin/esbuild'), [
  'src/capture.ts', '--bundle', '--platform=node', '--format=cjs', `--outfile=${entry}`,
], { stdio: 'pipe' });

function run(
  args: string[],
  envOverrides: NodeJS.ProcessEnv = {},
  preserveStale = true,
  setup?: (activePath: string, nodeId: string) => void,
): ReturnType<typeof spawnSync> {
  const nodeId = `cli-error-${process.pid}-${Math.random().toString(16).slice(2)}`;
  const active = path.join(CAPTURE_ROOT, `.active-${nodeId}`);
  const stale = '{"sessionId":"stale","dir":"/does/not/exist"}\n';
  fs.writeFileSync(active, stale);
  setup?.(active, nodeId);
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

test('session stop ignores malformed CDP_PORT because it does not use CDP', () => {
  let sessionDir = '';
  const id = `stop-no-cdp-${process.pid}-${Date.now()}`;
  try {
    const result = run(['session', 'stop', id], { CDP_PORT: 'garbage' }, false, (activePath) => {
      sessionDir = path.join(path.dirname(activePath), id);
      fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(sessionDir, '.session.json'), JSON.stringify({
        sessionId: id,
        dir: sessionDir,
        harId: null,
        targetId: null,
        stepCount: 0,
        startedAt: new Date().toISOString(),
      }), { mode: 0o600 });
    });
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /<session-stopped\b/);
    assert.equal(fs.existsSync(path.join(sessionDir, 'bundle.json')), true);
  } finally {
    if (sessionDir) fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('a session endpoint wins over malformed CDP_PORT before page dispatch', () => {
  let sessionDir = '';
  try {
    const result = run(['page', 'click', '.button'], { CDP_PORT: 'garbage' }, false, (activePath, nodeId) => {
      sessionDir = path.join(path.dirname(activePath), `endpoint-${nodeId}`);
      fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
      const session = {
        sessionId: `endpoint-${nodeId}`,
        dir: sessionDir,
        harId: null,
        targetId: 'target-abc',
        stepCount: 0,
        port: 1,
      };
      fs.writeFileSync(path.join(sessionDir, '.session.json'), JSON.stringify(session), { mode: 0o600 });
      fs.writeFileSync(activePath, JSON.stringify({ sessionId: session.sessionId, dir: sessionDir }), { mode: 0o600 });
    });
    assert.equal(result.status, 1);
    assert.doesNotMatch(result.stdout, /Invalid CDP_PORT/);
  } finally {
    if (sessionDir) fs.rmSync(sessionDir, { recursive: true, force: true });
  }
});

test('leaf grammar rejects before stale-pointer cleanup or one-shot allocation', () => {
  const root = CAPTURE_ROOT;
  const before = new Set(fs.readdirSync(root).filter(name => name.startsWith('oneshot-')));
  for (const args of [
    ['page', 'navigate', 'not-a-url'],
    ['measure', 'sweep', '--axis', 'width', '--from', 'bogus'],
    ['measure', 'sweep', '--axis', 'color-scheme', '--from', 'light', '--to', 'light'],
    ['motion', 'rec', 'https://example.test/', '--do', 'bad-action'],
    ['motion', 'rec', 'https://example.test/', '--do', 'scroll:.pane,to=bogus'],
  ]) {
    assertOneError(args);
  }
  const after = new Set(fs.readdirSync(root).filter(name => name.startsWith('oneshot-')));
  assert.deepEqual(after, before);
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
