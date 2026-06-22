import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/capture', import.meta.url));
const SESSION_HELP = 'capture session — manage capture sessions';
const LOG_HELP = 'Usage: capture log <path> [--name label] [--session <id>]';

test('bin/capture help flags stay read-only', () => {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'capture-bin-help-'));
  const env = {
    ...process.env,
    TMPDIR: tempRoot,
    TMP: tempRoot,
    TEMP: tempRoot,
  };

  try {
    for (const args of [
      ['session', 'start', '-h'],
      ['session', 'start', '--help'],
      ['log', '-h'],
      ['log', '--help'],
    ]) {
      const result = spawnSync(process.execPath, [BIN, ...args], {
        env,
        encoding: 'utf8',
      });

      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.error, undefined);
      assert.equal(result.stderr, '');
      assert.ok(result.stdout.includes(SESSION_HELP) || result.stdout.includes(LOG_HELP));
    }

    assert.deepEqual(readdirSync(tempRoot), []);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
