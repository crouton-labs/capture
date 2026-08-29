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

test('bare `capture` and `capture -h` print the assembled root help: ten <command> blocks + footer, exit 0, read-only', () => {
  withTempRoot((tempRoot) => {
    for (const args of [[], ['-h']]) {
      const result = run(args, tempRoot);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');

      const blocks = result.stdout.match(/<command name="/g) ?? [];
      assert.equal(blocks.length, 10, `expected exactly ten <command> blocks, got ${blocks.length}`);
      for (const name of ['session', 'page', 'tab', 'measure', 'motion', 'perf', 'heap', 'lighthouse', 'cdp', 'lib']) {
        assert.ok(result.stdout.includes(`<command name="${name}">`), `missing <command name="${name}">`);
        const block = new RegExp(`<command name="${name}">\\n[^\\n]+\\nuse (?:when|for) [^\\n]+\\n</command>`).exec(result.stdout)?.[0];
        assert.ok(block, `${name} must contribute exactly a concept line and a selection rule at root`);
      }
      assert.ok(!result.stdout.includes(' · '), 'root help must not catalog branch leaves');

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

test('each branch help lists description-and-selection rows without leaf signatures', () => {
  const branches = [
    { args: ['session', '-h'], name: 'session', leaves: ['start', 'stop', 'list', 'view', 'har', 'log', 'collectors'] },
    { args: ['page', '-h'], name: 'page', leaves: ['click', 'type', 'scroll', 'navigate', 'exec', 'shot', 'elements'] },
    { args: ['tab', '-h'], name: 'tab', leaves: ['launch', 'quit', 'list', 'open', 'close', 'reset', 'network', 'mock'] },
    { args: ['tab', 'mock', '-h'], name: 'mock', leaves: ['start', 'stop'] },
    { args: ['measure', '-h'], name: 'measure', leaves: ['snap', 'check', 'diff', 'census', 'explain', 'sweep', 'map'] },
    { args: ['measure', 'map', '-h'], name: 'map', leaves: ['focus', 'scroll', 'layers', 'ax', 'paint'] },
    { args: ['motion', '-h'], name: 'motion', leaves: ['rec', 'mask', 'timeline', 'jank', 'response'] },
    { args: ['perf', '-h'], name: 'perf', leaves: ['trace', 'vitals', 'insights'] },
    { args: ['heap', '-h'], name: 'heap', leaves: ['snapshot', 'census', 'objects', 'retainers', 'diff'] },
    { args: ['lib', '-h'], name: 'lib', leaves: ['list', 'search', 'show', 'read'] },
  ];

  withTempRoot((tempRoot) => {
    for (const { args, name, leaves } of branches) {
      const result = run(args, tempRoot);
      assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`);
      assert.equal(result.stderr, '', `${args.join(' ')} must not write diagnostics`);
      assert.match(result.stdout, new RegExp(`<command name="${name}" description="[^"]+">\\n<model>[^\\n]+</model>`), result.stdout);
      assert.equal(result.stdout.match(/<command\b/g)?.length, 1, result.stdout);
      assert.equal(result.stdout.match(/<model>/g)?.length, 1, result.stdout);
      assert.match(result.stdout, /<\/command>\n?$/, result.stdout);
      for (const leaf of leaves) {
        assert.match(result.stdout, new RegExp(`<subcommand name="${leaf}" description="[^"]+" whenToUse="[^"]+"/>`), result.stdout);
      }
      assert.doesNotMatch(result.stdout, /<subcommand\b[^>]*\bargs=/, result.stdout);
    }
  });
});

test('an unknown command is a structured <error code="unknown_command" kind="invocation"> naming the ten roots, exit 1, read-only', () => {
  withTempRoot((tempRoot) => {
    const result = run(['bogus'], tempRoot);
    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes('<error code="unknown_command" kind="invocation">'), result.stdout);
    assert.ok(result.stdout.includes('session, page, tab, measure, motion, perf, heap, lighthouse, cdp, lib'));
    assert.deepEqual(readdirSync(tempRoot), []);
  });
});

test('a guessable former/legacy root name still fails, but the unknown_command message hints its current destination', () => {
  withTempRoot((tempRoot) => {
    const result = run(['screenshot'], tempRoot);
    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes('<error code="unknown_command" kind="invocation">'), result.stdout);
    assert.ok(result.stdout.includes('did you mean `capture page shot`?'), result.stdout);
    assert.ok(result.stdout.includes('session, page, tab, measure, motion, perf, heap, lighthouse, cdp, lib'));
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

test('every new leaf is registered with its own clear non-zero scaffold', () => {
  withTempRoot((tempRoot) => {
    const commands = [
      ['perf', 'trace'],
      ['perf', 'vitals', 'trace-1'],
      ['perf', 'insights', 'trace-1'],
      ['heap', 'snapshot'],
      ['heap', 'census', 'heap-1'],
      ['heap', 'objects', 'heap-1', '--constructor', 'Object'],
      ['heap', 'retainers', 'heap-1', '--node', '1'],
      ['heap', 'diff', '--before', 'before', '--after', 'after'],
      ['lighthouse', 'https://example.com'],
      ['tab', 'mock', 'start', '--rules', 'rules.json'],
      ['tab', 'mock', 'stop'],
      ['session', 'collectors'],
    ];
    for (const command of commands) {
      const result = run([...command, '--port', '1'], tempRoot);
      assert.equal(result.status, 1, `${command.join(' ')}: ${result.stdout}`);
      assert.equal(result.stderr, '', `${command.join(' ')}: ${result.stderr}`);
      assert.match(result.stdout, /<error code="not_implemented" kind="precondition">/, result.stdout);
      assert.match(result.stdout, /is not yet implemented\./, result.stdout);
    }
    assert.deepEqual(readdirSync(tempRoot), []);
  });
});

test('new-leaf schema failures name the received input, expected shape, field, and leaf help', () => {
  withTempRoot((tempRoot) => {
    for (const command of [
      ['heap', 'objects', 'heap-1'],
      ['tab', 'mock', 'start'],
      ['lighthouse'],
      ['perf', 'trace', '--start', '--stop'],
    ]) {
      const result = run([...command, '--port', '1'], tempRoot);
      assert.equal(result.status, 1, `${command.join(' ')}: ${result.stdout}`);
      assert.match(result.stdout, /received:/, result.stdout);
      assert.match(result.stdout, /expected:/, result.stdout);
      assert.match(result.stdout, /field:/, result.stdout);
      const helpCommand = command[0] === 'tab' ? command.slice(0, 3) : command[0] === 'lighthouse' ? command.slice(0, 1) : command.slice(0, 2);
      assert.ok(result.stdout.includes(`Next: Run \`capture ${helpCommand.join(' ')} -h\``), result.stdout);
    }
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
