/**
 * `session list` degrades around an unreadable `.session.json` record.
 *
 * Two regressions are pinned here. First: a legacy-schema record must never
 * reach `fact` interpolation as undefined and crash the renderer unbranded.
 * Second: one bad record on a shared capture root must not make the whole
 * listing unusable — a listing is what an agent reaches for precisely when it
 * is working out what state it is in, so the bad record lists as its own
 * `unreadable` row (naming the path and the reason) and every healthy session
 * still lists. Targeted commands keep `readSession`'s typed hard failure.
 *
 * Real-entrypoint probes (a temporary source bundle, never the frozen
 * bin/capture) against an ISOLATED CAPTURE_ROOT:
 *  (a) legacy-schema JSON (missing sessionId) → exit 0, one unreadable row
 *      naming the path, no error block;
 *  (b) corrupt non-JSON bytes → the same degraded row;
 *  (c) a fully VALID record still lists — guards against over-strict
 *      validation rejecting healthy records;
 *  (d) a bad record ALONGSIDE a healthy one never hides the healthy one.
 */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'u06-list-malformed-probe-'));
const probeEntry = path.join(tempDir, 'capture.cjs');

// Executes the current TypeScript source, never the frozen bin/capture.
execFileSync(path.join(process.cwd(), 'node_modules/.bin/esbuild'), [
  'src/capture.ts', '--bundle', '--platform=node', '--format=cjs', `--outfile=${probeEntry}`,
], { stdio: 'pipe' });

after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

interface ListProbe {
  status: number | null;
  stdout: string;
  stderr: string;
  metaPath: string;
}

/** Seeds one session dir with the given `.session.json` bytes under an
 * isolated CAPTURE_ROOT, runs `session list` from the source entrypoint,
 * and tears the root down. */
function probeList(dirName: string, sessionJsonBytes: string, extraArgs: string[] = [], extra: Record<string, string> = {}): ListProbe {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'u06-list-malformed-root-'));
  const sessionDir = path.join(root, dirName);
  const metaPath = path.join(sessionDir, '.session.json');
  fs.mkdirSync(sessionDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(metaPath, sessionJsonBytes, { mode: 0o600 });
  for (const [name, bytes] of Object.entries(extra)) {
    fs.mkdirSync(path.join(root, name), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(root, name, '.session.json'), bytes, { mode: 0o600 });
  }
  try {
    const result = spawnSync(process.execPath, [probeEntry, 'session', 'list', ...extraArgs], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CRTR_NODE_ID: `u06-list-malformed-${process.pid}`,
        CAPTURE_ROOT: root,
      },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, metaPath };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('session list: a legacy-schema record lists as unreadable, never the unbranded render crash', () => {
  // Old-schema record: no sessionId — the exact shape that used to reach the
  // renderer as `fact` interpolation of undefined and crash unbranded.
  const legacy = JSON.stringify({ id: 'legacy-1', dir: '/somewhere', startedAt: '2020-01-01T00:00:00.000Z' });
  const result = probeList('legacy-1', legacy);

  assert.equal(result.status, 0, `exit 0: ${result.stdout} ${result.stderr}`);
  assert.equal((result.stdout.match(/<error\b/g) ?? []).length, 0, `no error block: ${result.stdout}`);
  assert.match(result.stdout, /<sessions count="0" unreadable="1"/, result.stdout);
  assert.match(result.stdout, /legacy-1 — unreadable — /, result.stdout);
  assert.ok(result.stdout.includes(result.metaPath), `row names the record path: ${result.stdout}`);
  assert.ok(!result.stdout.includes('unbranded'), `no render-internal crash text: ${result.stdout}`);
  assert.ok(!result.stderr.includes('unbranded'), `no render-internal crash on stderr: ${result.stderr}`);
});

test('session list: corrupt non-JSON bytes list as the same unreadable row', () => {
  const result = probeList('corrupt-1', '{not json at all');

  assert.equal(result.status, 0, `exit 0: ${result.stdout} ${result.stderr}`);
  assert.equal((result.stdout.match(/<error\b/g) ?? []).length, 0, `no error block: ${result.stdout}`);
  assert.match(result.stdout, /corrupt-1 — unreadable — /, result.stdout);
  assert.ok(result.stdout.includes(result.metaPath), `row names the record path: ${result.stdout}`);
});

test('session list: --json mirrors the degraded listing for a malformed record', () => {
  const result = probeList('legacy-json', JSON.stringify({ id: 'legacy-json' }), ['--json']);

  assert.equal(result.status, 0, result.stdout);
  const parsed = JSON.parse(result.stdout) as { tag: string; attrs: { count: number; unreadable: number } };
  assert.equal(parsed.tag, 'sessions');
  assert.equal(parsed.attrs.count, 0);
  assert.equal(parsed.attrs.unreadable, 1);
});

test('session list: one bad record never hides a healthy session', () => {
  const healthyId = 'cap-healthy-1';
  const healthy = JSON.stringify({
    sessionId: healthyId,
    dir: '/tmp/anywhere',
    harId: null,
    startedAt: '2026-01-02T03:04:05.000Z',
    url: null,
    targetId: null,
    stepCount: 0,
    logPids: [],
    stoppedAt: null,
    stopping: false,
  });
  const result = probeList('legacy-mixed', '{not json at all', [], { [healthyId]: healthy });

  assert.equal(result.status, 0, `exit 0: ${result.stdout} ${result.stderr}`);
  assert.match(result.stdout, /<sessions count="1" unreadable="1"/, result.stdout);
  assert.ok(result.stdout.includes(`${healthyId} — active — started 2026-01-02T03:04:05.000Z`), result.stdout);
  assert.match(result.stdout, /legacy-mixed — unreadable — /, result.stdout);
});

test('session list: a fully valid record still lists (validation is not over-strict)', () => {
  const dirName = 'cap-valid-1';
  const valid = JSON.stringify({
    sessionId: dirName,
    dir: '/tmp/anywhere',
    harId: null,
    startedAt: '2026-01-02T03:04:05.000Z',
    url: null,
    targetId: null,
    stepCount: 0,
    logPids: [],
    stoppedAt: null,
    stopping: false,
  });
  const result = probeList(dirName, valid);

  assert.equal(result.status, 0, `exit 0: ${result.stdout} ${result.stderr}`);
  assert.match(result.stdout, /<sessions count="1" unreadable="0"/, result.stdout);
  assert.ok(result.stdout.includes(`${dirName} — active — started 2026-01-02T03:04:05.000Z`), result.stdout);
});
