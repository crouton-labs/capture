/**
 * `capture lib` conformance, proven against the built `bin/capture`:
 * render.ts blocks on stdout (`<libs>`/`<lib>` selection-first rows, no
 * bespoke JSON, no stderr "Next:" hints), the structured
 * `<error code="dev_only">` in published mode (vault/ source missing),
 * structured invocation errors, and the `--json` mirror.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const BIN = fileURLToPath(new URL('../bin/capture', import.meta.url));

function run(args: string[], bin: string = BIN) {
  return spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
}

test('`lib list` in a dev checkout renders a <libs> selection block, exit 0, no stderr hints', () => {
  const result = run(['lib', 'list']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /<libs count="\d+">/);
  // Selection-first rows: name — one-line summary — function count.
  assert.match(result.stdout, /amazon — .+ \(\d+ functions\)/);
  assert.ok(result.stdout.includes('follow_up:'), result.stdout);
  // The old stdout-JSON + stderr-hint contract is gone.
  assert.ok(!result.stdout.trimStart().startsWith('['), 'stdout must be a rendered block, not bespoke JSON');
  assert.ok(!result.stderr.includes('Next:'), `stderr coaching survived: ${result.stderr}`);
});

test('`lib list --json` mirrors the rendered result', () => {
  const result = run(['lib', 'list', '--json']);
  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as { tag: string; attrs: { count: number } };
  assert.equal(parsed.tag, 'libs');
  assert.ok(parsed.attrs.count > 0);
});

test('published mode (vault/ source missing) exits 1 with a structured dev_only error, prose and --json', () => {
  // Copy the self-contained bin somewhere with no vault/ up the tree — the
  // exact shape of the published package.
  const dir = mkdtempSync(path.join(os.tmpdir(), 'capture-lib-published-'));
  try {
    const binDir = path.join(dir, 'nested', 'bin');
    mkdirSync(binDir, { recursive: true });
    const publishedBin = path.join(binDir, 'capture');
    copyFileSync(BIN, publishedBin);
    chmodSync(publishedBin, 0o755);

    const prose = run(['lib', 'list'], publishedBin);
    assert.equal(prose.status, 1);
    assert.ok(prose.stdout.includes('<error code="dev_only"'), prose.stdout);
    assert.ok(prose.stdout.includes('dev-only feature'), prose.stdout);

    const json = run(['lib', 'list', '--json'], publishedBin);
    assert.equal(json.status, 1);
    const parsed = JSON.parse(json.stdout) as { tag: string; attrs: { code: string } };
    assert.equal(parsed.tag, 'error');
    assert.equal(parsed.attrs.code, 'dev_only');

    // -h never touches vault/, so help still works in the published package.
    const help = run(['lib', '-h'], publishedBin);
    assert.equal(help.status, 0, help.stderr);
    assert.ok(help.stdout.includes('<subcommand name="list"'), help.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('`lib search` without a query is a structured invalid_input error; with a query it ranks rows', () => {
  const missing = run(['lib', 'search']);
  assert.equal(missing.status, 1);
  assert.ok(missing.stdout.includes('<error code="invalid_input"'), missing.stdout);

  const result = run(['lib', 'search', 'searchProducts']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /<libs query="searchProducts" hits="\d+" shown="\d+">/);
  assert.match(result.stdout, /amazon\.searchProducts — function-name/);
  assert.ok(!result.stderr.includes('Next:'), result.stderr);
});

test('`lib show <name>` renders a <lib> block with function summary rows and the src pointer', () => {
  const result = run(['lib', 'show', 'amazon']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /<lib name="amazon" functions="\d+" src="[^"]*vault\/libs\/amazon\/index\.ts">/);
  assert.match(result.stdout, /searchProducts — /);
  // show carries summaries only — no schemas.
  assert.ok(!result.stdout.includes('input:'), result.stdout);
});

test('`lib read <name> <fn>` renders capped input/output schemas; an unknown fn is a structured error', () => {
  const result = run(['lib', 'read', 'amazon', 'searchProducts']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /<lib name="amazon" src="[^"]*vault\/libs\/amazon\/index\.ts">/);
  assert.match(result.stdout, /input: \{"\$schema"/);
  assert.match(result.stdout, /output: \{"\$schema"/);
  assert.ok(result.stdout.includes('follow_up:'), result.stdout);

  const unknown = run(['lib', 'read', 'amazon', 'nope']);
  assert.equal(unknown.status, 1);
  assert.ok(unknown.stdout.includes('<error code="unknown_function"'), unknown.stdout);
  assert.ok(unknown.stdout.includes('getContext'), 'error must list the available functions');
});

test('an unknown lib name is a structured unknown_lib error', () => {
  const result = run(['lib', 'show', 'zzz-no-such-lib']);
  assert.equal(result.status, 1);
  assert.ok(result.stdout.includes('<error code="unknown_lib"'), result.stdout);
});

test('bare `lib` prints branch usage exit 0; an unknown lib leaf is central-dispatch unknown_command — same posture as the other root branches', () => {
  // FROZEN-BIN-PENDING (U23): the bare-`lib` expectation goes red against the
  // frozen bin/capture (which still errors exit 1) until U23 rebuilds it. The
  // same behavior is proven against source in test/cli-error-contract.test.ts.
  const bare = run(['lib']);
  assert.equal(bare.status, 0, bare.stdout);
  assert.ok(bare.stdout.includes('capture lib — vault-lib introspection'), bare.stdout);
  assert.ok(bare.stdout.includes('<subcommand name="list"'), bare.stdout);

  const bogus = run(['lib', 'bogus']);
  assert.equal(bogus.status, 1);
  assert.ok(bogus.stdout.includes('<error code="unknown_command"'), bogus.stdout);
  assert.ok(bogus.stdout.includes('Unknown lib leaf: bogus.'), bogus.stdout);
});

test('`lib -h` is the branch help; `lib read -h` is the leaf help — both exit 0, no examples', () => {
  const branch = run(['lib', '-h']);
  assert.equal(branch.status, 0, branch.stderr);
  for (const name of ['list', 'search', 'show', 'read']) {
    assert.ok(branch.stdout.includes(`<subcommand name="${name}"`), `missing <subcommand name="${name}">`);
  }

  const leaf = run(['lib', 'read', '-h']);
  assert.equal(leaf.status, 0, leaf.stderr);
  assert.ok(leaf.stdout.includes('capture lib read <name> [fn…]'), leaf.stdout);
  assert.ok(!leaf.stdout.includes('<subcommand'), 'leaf help must not carry branch rows');
});
