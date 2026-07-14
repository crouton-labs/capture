/**
 * Root-router surface contract, proven against the built `bin/capture`:
 * assembled root help (seven <command> blocks + I/O footer), structured
 * unknown-command errors, `--version` as the only version invocation,
 * branch-grammar leaf validation (`page click` rejected with a leaf-specific
 * diagnostic before any effect), and the dispatch-level `--gate` guard
 * (rejected everywhere except `measure check|diff`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/capture', import.meta.url));

/** Isolated TMPDIR per run so no real active session on this machine leaks
 * into targeting, and so read-only invocations provably create no files. */
function run(args: string[], tempRoot: string) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      CAPTURE_ROOT: path.join(tempRoot, 'capture-sessions'),
      TMPDIR: tempRoot,
      TMP: tempRoot,
      TEMP: tempRoot,
      CDP_PORT: '',
      CDP_TARGET: '',
    },
  });
}

function withTempRoot(fn: (tempRoot: string) => void): void {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'capture-bin-help-'));
  try {
    fn(tempRoot);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

test('bare `capture` and `capture -h` print the assembled root help: seven <command> blocks + footer, exit 0, read-only', () => {
  withTempRoot((tempRoot) => {
    for (const args of [[], ['-h']]) {
      const result = run(args, tempRoot);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');

      const blocks = result.stdout.match(/<command name="/g) ?? [];
      assert.equal(blocks.length, 7, `expected exactly seven <command> blocks, got ${blocks.length}`);
      for (const name of ['session', 'page', 'tab', 'measure', 'motion', 'cdp', 'lib']) {
        assert.ok(result.stdout.includes(`<command name="${name}">`), `missing <command name="${name}">`);
      }

      // I/O contract footer + the single environment line + env pinning.
      assert.ok(result.stdout.includes('I/O contract:'));
      assert.ok(result.stdout.includes('stderr carries in-flight diagnostics only'));
      assert.ok(result.stdout.includes('`capture tab list` is the probe'));
      assert.ok(result.stdout.includes('CDP_PORT / CDP_TARGET'));
      assert.ok(result.stdout.includes('explicit flag > active session > env'));
    }

    assert.deepEqual(readdirSync(tempRoot), []);
  });
});

test('an unknown command is a structured <error code="unknown_command" kind="invocation"> naming the seven roots, exit 1, read-only', () => {
  withTempRoot((tempRoot) => {
    const result = run(['bogus'], tempRoot);
    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes('<error code="unknown_command" kind="invocation">'), result.stdout);
    assert.ok(result.stdout.includes('session, page, tab, measure, motion, cdp, lib'));
    assert.deepEqual(readdirSync(tempRoot), []);
  });
});

test('`capture --version` prints a version; `-v` and the `version` word are unknown commands, read-only', () => {
  withTempRoot((tempRoot) => {
    const version = run(['--version'], tempRoot);
    assert.equal(version.status, 0, version.stderr);
    assert.match(version.stdout.trim(), /^(\d+\.\d+\.\d+\S*|unknown)$/);

    for (const args of [['-v'], ['version']]) {
      const result = run(args, tempRoot);
      assert.equal(result.status, 1, `${args.join(' ')} should be an unknown command`);
      assert.ok(result.stdout.includes('<error code="unknown_command" kind="invocation">'), result.stdout);
    }

    assert.deepEqual(readdirSync(tempRoot), []);
  });
});

test('page branch grammar names the leaf: `page click` is rejected at the validation boundary with a leaf-specific diagnostic, read-only', () => {
  withTempRoot((tempRoot) => {
    const result = run(['page', 'click'], tempRoot);
    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes('<error code="invalid_input" kind="invocation">'), result.stdout);
    assert.ok(result.stdout.includes('page click received 0 positional argument(s); expected exactly 1.'), result.stdout);
    assert.ok(!result.stdout.includes('not_implemented'), result.stdout);
    assert.deepEqual(readdirSync(tempRoot), []);
  });
});

test('the dispatch-level guard rejects --gate on every leaf except measure check|diff', () => {
  // FROZEN-BIN-PENDING (U23): the typed one-boundary shape below
  // (<error code="unsupported_flag" kind="invocation">) goes red against the
  // frozen bin/capture (which renders the old command/status shape from the
  // guard itself) until U23 rebuilds it. Proven against source in
  // test/cli-error-contract.test.ts.
  withTempRoot((tempRoot) => {
    const pageScroll = run(['page', 'scroll', '--gate', 'x'], tempRoot);
    assert.equal(pageScroll.status, 1);
    assert.ok(pageScroll.stdout.includes('<error code="unsupported_flag" kind="invocation">'), pageScroll.stdout);
    assert.ok(pageScroll.stdout.includes('page scroll'), pageScroll.stdout);

    const sessionList = run(['session', 'list', '--gate'], tempRoot);
    assert.equal(sessionList.status, 1);
    assert.ok(sessionList.stdout.includes('<error code="unsupported_flag" kind="invocation">'), sessionList.stdout);
    assert.ok(sessionList.stdout.includes('session list'), sessionList.stdout);

    // measure check accepts --gate: it must NOT be rejected at dispatch.
    // (With no snapshot target it fails later, as a measure-check artifact
    // error — never as a gate rejection.)
    const measureCheck = run(['measure', 'check', '--gate'], tempRoot);
    assert.ok(!measureCheck.stdout.includes('unsupported_flag'), measureCheck.stdout);
    assert.ok(!measureCheck.stdout.includes('--gate` is not accepted'), measureCheck.stdout);
  });
});
