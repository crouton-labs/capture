import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  CAPTURE_ROOT,
  DIR_MODE,
  FILE_MODE,
  ensurePrivateDir,
  writePrivateFile,
  writeJsonPrivate,
  writeNdjsonPrivate,
  appendNdjsonPrivate,
  writeBinaryPrivate,
  removeArtifactTree,
  assertUnderCaptureRoot,
} from '../src/session/artifacts.js';

function mode(p: string): number {
  return fs.statSync(p).mode & 0o777;
}

function freshTestDir(): string {
  fs.mkdirSync(CAPTURE_ROOT, { recursive: true });
  const dir = path.join(CAPTURE_ROOT, `artifact-perm-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  return dir;
}

test('ensurePrivateDir creates nested dirs, all mode 0700, including missing parents', () => {
  const base = freshTestDir();
  const nested = path.join(base, 'measure', 'snaps', 'snap-1');
  try {
    const resolved = ensurePrivateDir(nested);
    assert.equal(resolved, nested);
    assert.ok(fs.statSync(nested).isDirectory());
    assert.equal(mode(base), DIR_MODE);
    assert.equal(mode(path.join(base, 'measure')), DIR_MODE);
    assert.equal(mode(path.join(base, 'measure', 'snaps')), DIR_MODE);
    assert.equal(mode(nested), DIR_MODE);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('ensurePrivateDir re-secures an existing directory left at a looser mode', () => {
  const base = freshTestDir();
  fs.mkdirSync(base, { recursive: true, mode: 0o755 });
  try {
    assert.equal(mode(base), 0o755);
    ensurePrivateDir(base);
    assert.equal(mode(base), DIR_MODE);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('ensurePrivateDir refuses a path outside CAPTURE_ROOT', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-perm-outside-'));
  try {
    assert.throws(() => ensurePrivateDir(outside), /escapes capture root/);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('ensurePrivateDir refuses a symlinked path segment', () => {
  const base = freshTestDir();
  fs.mkdirSync(base, { recursive: true });
  const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-perm-symlink-target-'));
  const linkPath = path.join(base, 'linked');
  try {
    fs.symlinkSync(realDir, linkPath);
    assert.throws(() => ensurePrivateDir(path.join(linkPath, 'child')), /symlink/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(realDir, { recursive: true, force: true });
  }
});

test('writePrivateFile writes mode-0600 content atomically and leaves no temp file behind', () => {
  const base = freshTestDir();
  const target = path.join(base, 'meta.json');
  try {
    writePrivateFile(target, 'hello world');
    assert.equal(fs.readFileSync(target, 'utf-8'), 'hello world');
    assert.equal(mode(target), FILE_MODE);
    const leftovers = fs.readdirSync(base).filter((f) => f.endsWith('.tmp'));
    assert.deepEqual(leftovers, []);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('writePrivateFile refuses to write through an existing symlink at the destination', () => {
  const base = freshTestDir();
  fs.mkdirSync(base, { recursive: true });
  const realFile = path.join(os.tmpdir(), `artifact-perm-symlink-file-${Date.now()}.txt`);
  fs.writeFileSync(realFile, 'do-not-touch');
  const linkPath = path.join(base, 'meta.json');
  try {
    fs.symlinkSync(realFile, linkPath);
    assert.throws(() => writePrivateFile(linkPath, 'attacker-controlled'), /symlink/);
    assert.equal(fs.readFileSync(realFile, 'utf-8'), 'do-not-touch');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
    fs.rmSync(realFile, { force: true });
  }
});

test('writeJsonPrivate round-trips a value as pretty JSON, private mode', () => {
  const base = freshTestDir();
  const target = path.join(base, 'meta.json');
  try {
    writeJsonPrivate(target, { id: 'snap-1', settled: true, count: 3 });
    const parsed = JSON.parse(fs.readFileSync(target, 'utf-8'));
    assert.deepEqual(parsed, { id: 'snap-1', settled: true, count: 3 });
    assert.equal(mode(target), FILE_MODE);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('writeNdjsonPrivate writes one JSON value per line, private mode', () => {
  const base = freshTestDir();
  const target = path.join(base, 'rects.jsonl');
  try {
    writeNdjsonPrivate(target, [{ frame: 0 }, { frame: 1 }, { frame: 2 }]);
    const lines = fs.readFileSync(target, 'utf-8').trim().split('\n');
    assert.deepEqual(lines.map((l) => JSON.parse(l)), [{ frame: 0 }, { frame: 1 }, { frame: 2 }]);
    assert.equal(mode(target), FILE_MODE);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('appendNdjsonPrivate appends one record per call, creating the file private', () => {
  const base = freshTestDir();
  const target = path.join(base, 'events.jsonl');
  try {
    appendNdjsonPrivate(target, { event: 'start' });
    appendNdjsonPrivate(target, { event: 'mutation' });
    appendNdjsonPrivate(target, { event: 'stop' });
    const lines = fs.readFileSync(target, 'utf-8').trim().split('\n');
    assert.deepEqual(
      lines.map((l) => JSON.parse(l)),
      [{ event: 'start' }, { event: 'mutation' }, { event: 'stop' }],
    );
    assert.equal(mode(target), FILE_MODE);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('writeBinaryPrivate writes raw buffer content, private mode', () => {
  const base = freshTestDir();
  const target = path.join(base, 'crop.png');
  const data = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]);
  try {
    writeBinaryPrivate(target, data);
    assert.deepEqual(fs.readFileSync(target), data);
    assert.equal(mode(target), FILE_MODE);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('removeArtifactTree deletes a session/oneshot subtree under CAPTURE_ROOT', () => {
  const base = freshTestDir();
  ensurePrivateDir(path.join(base, 'measure', 'snaps', 'snap-1'));
  writeJsonPrivate(path.join(base, 'measure', 'snaps', 'snap-1', 'meta.json'), { id: 'snap-1' });
  assert.ok(fs.existsSync(base));
  removeArtifactTree(base);
  assert.equal(fs.existsSync(base), false);
});

test('removeArtifactTree refuses a path outside CAPTURE_ROOT', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'artifact-perm-rm-outside-'));
  try {
    assert.throws(() => removeArtifactTree(outside), /escapes capture root/);
    assert.ok(fs.existsSync(outside));
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('removeArtifactTree refuses CAPTURE_ROOT itself', () => {
  fs.mkdirSync(CAPTURE_ROOT, { recursive: true });
  assert.throws(() => removeArtifactTree(CAPTURE_ROOT), /escapes capture root/);
  assert.ok(fs.existsSync(CAPTURE_ROOT));
});

test('assertUnderCaptureRoot accepts nested paths and rejects traversal out of the root', () => {
  const nested = path.join(CAPTURE_ROOT, 'sess-1', 'measure', 'snaps', 'snap-1');
  assert.equal(assertUnderCaptureRoot(nested), path.resolve(nested));
  assert.throws(() => assertUnderCaptureRoot(path.join(CAPTURE_ROOT, '..', 'evil')));
});
