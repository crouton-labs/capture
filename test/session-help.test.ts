import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import type { ParsedArgs } from '../src/cdp/types.js';

const require = createRequire(import.meta.url);
const fs = require('node:fs') as typeof import('node:fs');

const HELP_TEXT = 'capture session — the artifact container';
const HAR_HELP_TEXT = 'capture session har [<session-id>]';
const LOG_HELP_TEXT = 'capture session log <path>';

function patchFs(): () => void {
  const originals = {
    existsSync: fs.existsSync,
    mkdirSync: fs.mkdirSync,
    readFileSync: fs.readFileSync,
    readdirSync: fs.readdirSync,
    writeFileSync: fs.writeFileSync,
    openSync: fs.openSync,
    closeSync: fs.closeSync,
    unlinkSync: fs.unlinkSync,
  };

  const fail = (name: string) => () => {
    throw new Error(`${name} should not run for capture session help`);
  };

  fs.existsSync = fail('fs.existsSync') as typeof fs.existsSync;
  fs.mkdirSync = fail('fs.mkdirSync') as typeof fs.mkdirSync;
  fs.readFileSync = fail('fs.readFileSync') as typeof fs.readFileSync;
  fs.readdirSync = fail('fs.readdirSync') as typeof fs.readdirSync;
  fs.writeFileSync = fail('fs.writeFileSync') as typeof fs.writeFileSync;
  fs.openSync = fail('fs.openSync') as typeof fs.openSync;
  fs.closeSync = fail('fs.closeSync') as typeof fs.closeSync;
  fs.unlinkSync = fail('fs.unlinkSync') as typeof fs.unlinkSync;
  syncBuiltinESMExports();

  return () => {
    fs.existsSync = originals.existsSync;
    fs.mkdirSync = originals.mkdirSync;
    fs.readFileSync = originals.readFileSync;
    fs.readdirSync = originals.readdirSync;
    fs.writeFileSync = originals.writeFileSync;
    fs.openSync = originals.openSync;
    fs.closeSync = originals.closeSync;
    fs.unlinkSync = originals.unlinkSync;
    syncBuiltinESMExports();
  };
}

test('session help flags are read-only for all session subcommands', async () => {
  const { sessionMain } = await import('../src/session/commands.js');
  const restoreFs = patchFs();
  const restoreExit = process.exit;
  const logs: string[] = [];
  const originalLog = console.log;

  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(' '));
  };
  process.exit = ((code?: number) => {
    throw new Error(`process.exit(${code ?? 0}) should not run for capture session help`);
  }) as typeof process.exit;

  try {
    for (const subcommand of ['start', 'stop', 'list', 'view', 'har', 'log']) {
      await sessionMain({ command: 'session', positional: [subcommand], help: true, json: false } as ParsedArgs, []);
    }
    await sessionMain({ command: 'session', positional: [], json: false } as ParsedArgs, []);

    const output = logs.join('\n');
    assert.ok(output.includes(HELP_TEXT));
    assert.ok(output.includes(HAR_HELP_TEXT));
    assert.ok(output.includes(LOG_HELP_TEXT));
    assert.ok(output.includes('<subcommand name="har"'));
    assert.ok(output.includes('<subcommand name="log"'));
  } finally {
    console.log = originalLog;
    process.exit = restoreExit;
    restoreFs();
  }
});
