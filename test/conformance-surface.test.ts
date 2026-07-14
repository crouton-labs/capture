import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../', import.meta.url));
const BIN = fileURLToPath(new URL('../bin/capture', import.meta.url));

interface SurfaceNode {
  readonly name: string;
  readonly children?: readonly SurfaceNode[];
}

// Settled D5 tree. Parent-help assertions below prove that this explicit tree
// remains identical to the executable surface before every leaf help is run.
const SURFACE: readonly SurfaceNode[] = [
  {
    name: 'session',
    children: [
      { name: 'start' },
      { name: 'stop' },
      { name: 'list' },
      { name: 'view' },
      { name: 'har' },
      { name: 'log' },
    ],
  },
  {
    name: 'page',
    children: [
      { name: 'click' },
      { name: 'type' },
      { name: 'scroll' },
      { name: 'navigate' },
      { name: 'exec' },
      { name: 'shot' },
      { name: 'elements' },
    ],
  },
  {
    name: 'tab',
    children: [{ name: 'list' }, { name: 'open' }, { name: 'reset' }, { name: 'network' }],
  },
  {
    name: 'measure',
    children: [
      { name: 'snap' },
      { name: 'check' },
      { name: 'diff' },
      { name: 'census' },
      { name: 'explain' },
      { name: 'sweep' },
      {
        name: 'map',
        children: [{ name: 'focus' }, { name: 'scroll' }, { name: 'layers' }, { name: 'ax' }],
      },
    ],
  },
  {
    name: 'motion',
    children: [{ name: 'rec' }, { name: 'mask' }, { name: 'timeline' }, { name: 'jank' }, { name: 'response' }],
  },
  { name: 'cdp' },
  {
    name: 'lib',
    children: [{ name: 'list' }, { name: 'search' }, { name: 'show' }, { name: 'read' }],
  },
];

type Result = SpawnSyncReturns<string>;

function run(args: readonly string[], tempRoot: string): Result {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of ['CRTR_NODE_ID', 'CDP_PORT', 'CDP_TARGET']) delete env[key];

  Object.assign(env, {
    CAPTURE_ROOT: path.join(tempRoot, 'capture-sessions'),
    TMPDIR: tempRoot,
    TMP: tempRoot,
    TEMP: tempRoot,
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    LC_ALL: 'C',
  });

  return spawnSync(process.execPath, [BIN, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env,
    timeout: 10_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function withIsolatedCaptureRoot(fn: (tempRoot: string) => void): void {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'capture-conformance-'));
  try {
    fn(tempRoot);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function transcript(result: Result): string {
  return `status=${String(result.status)} signal=${String(result.signal)}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`;
}

function assertExit(result: Result, status: number): void {
  assert.equal(result.error, undefined, transcript(result));
  assert.equal(result.signal, null, transcript(result));
  assert.equal(result.status, status, transcript(result));
}

function tagNames(text: string, tag: 'command' | 'subcommand'): string[] {
  const tags = text.match(new RegExp(`<${tag}\\b`, 'g')) ?? [];
  const names = Array.from(text.matchAll(new RegExp(`<${tag}\\b[^\\n]*?\\bname="([^"]+)"`, 'g')), (match) => match[1]!);
  assert.equal(names.length, tags.length, `every <${tag}> must carry a name attribute\n${text}`);
  return names;
}

function errorAttributes(text: string): Record<string, string> {
  const opening = text.match(/<error\b([^>]*)>/);
  assert.ok(opening, `expected one structured <error> opening tag\n${text}`);
  assert.equal(text.match(/<error\b/g)?.length, 1, `expected exactly one structured error\n${text}`);

  return Object.fromEntries(Array.from(opening[1]!.matchAll(/([\w-]+)="([^"]*)"/g), (match) => [match[1]!, match[2]!]));
}

function branches(nodes: readonly SurfaceNode[], prefix: readonly string[] = []): Array<{ path: string[]; children: string[] }> {
  const found: Array<{ path: string[]; children: string[] }> = [];
  for (const node of nodes) {
    const commandPath = [...prefix, node.name];
    if (!node.children) continue;
    found.push({ path: commandPath, children: node.children.map((child) => child.name) });
    found.push(...branches(node.children, commandPath));
  }
  return found;
}

function leaves(nodes: readonly SurfaceNode[], prefix: readonly string[] = []): string[][] {
  const found: string[][] = [];
  for (const node of nodes) {
    const commandPath = [...prefix, node.name];
    if (node.children) found.push(...leaves(node.children, commandPath));
    else found.push(commandPath);
  }
  return found;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('root -h exposes exactly the seven settled command blocks, with no duplicates or extras', () => {
  withIsolatedCaptureRoot((tempRoot) => {
    const result = run(['-h'], tempRoot);
    assertExit(result, 0);
    assert.equal(result.stderr, '');
    assert.deepEqual(tagNames(result.stdout, 'command'), SURFACE.map((node) => node.name));
  });
});

test('--help is an unknown command while -h is honored at root, branch, and leaf', () => {
  withIsolatedCaptureRoot((tempRoot) => {
    const rejected = run(['--help'], tempRoot);
    assertExit(rejected, 1);
    assert.equal(errorAttributes(rejected.stdout).code, 'unknown_command');

    const rootHelp = run(['-h'], tempRoot);
    assertExit(rootHelp, 0);
    assert.ok(tagNames(rootHelp.stdout, 'command').length > 0);

    const branchHelp = run(['page', '-h'], tempRoot);
    assertExit(branchHelp, 0);
    assert.ok(tagNames(branchHelp.stdout, 'subcommand').length > 0);

    const leafHelp = run(['page', 'click', '-h'], tempRoot);
    assertExit(leafHelp, 0);
    assert.match(leafHelp.stdout, /^capture page click\b/);
    assert.match(leafHelp.stdout, /(?:^|\n)\s*input:/i);
  });
});

test('an unknown root command emits structured unknown_command and exits 1', () => {
  withIsolatedCaptureRoot((tempRoot) => {
    const result = run(['not-a-root'], tempRoot);
    assertExit(result, 1);
    assert.equal(errorAttributes(result.stdout).code, 'unknown_command');
  });
});

test('--gate is confined to measure check and measure diff at built-binary dispatch', () => {
  withIsolatedCaptureRoot((tempRoot) => {
    const rejected: Array<{ args: string[]; command: string }> = [
      { args: ['session', 'list', '--gate'], command: 'session list' },
      { args: ['page', 'elements', '--gate'], command: 'page elements' },
      { args: ['tab', 'list', '--gate'], command: 'tab list' },
      { args: ['cdp', '--gate'], command: 'cdp' },
      { args: ['lib', 'list', '--gate'], command: 'lib list' },
      { args: ['measure', '--gate'], command: 'measure' },
      { args: ['measure', 'map', '--gate'], command: 'measure map' },
      { args: ['measure', 'snap', '--gate'], command: 'measure snap' },
      { args: ['motion', '--gate'], command: 'motion' },
      { args: ['motion', 'timeline', '--gate'], command: 'motion timeline' },
    ];

    // FROZEN-BIN-PENDING (U23): the typed one-boundary shape below (code +
    // kind attrs, leaf named in the message) goes red against the frozen
    // bin/capture (old command/status shape) until U23 rebuilds it. Proven
    // against source in test/cli-error-contract.test.ts.
    for (const probe of rejected) {
      const result = run(probe.args, tempRoot);
      assertExit(result, 1);
      const attrs = errorAttributes(result.stdout);
      assert.equal(attrs.code, 'unsupported_flag', `${probe.args.join(' ')}\n${transcript(result)}`);
      assert.equal(attrs.kind, 'invocation', `${probe.args.join(' ')}\n${transcript(result)}`);
      assert.ok(
        result.stdout.includes(`'--gate' is not accepted on '${probe.command}'`),
        `${probe.args.join(' ')}\n${transcript(result)}`,
      );
    }

    for (const probe of [
      ['measure', 'check', '--gate'],
      ['measure', 'diff', '--gate'],
    ]) {
      const result = run(probe, tempRoot);
      assertExit(result, 1);
      const attrs = errorAttributes(result.stdout);
      assert.notEqual(attrs.status, 'unsupported_flag', transcript(result));
      assert.notEqual(attrs.code, 'unsupported_flag', transcript(result));
      assert.doesNotMatch(result.stdout, /unsupported_flag/);
    }
  });
});

test('the settled branch tree is executable and every routed leaf has example-free -h help', () => {
  withIsolatedCaptureRoot((tempRoot) => {
    for (const branch of branches(SURFACE)) {
      const result = run([...branch.path, '-h'], tempRoot);
      assertExit(result, 0);
      assert.equal(result.stderr, '', `${branch.path.join(' ')}\n${transcript(result)}`);
      assert.deepEqual(tagNames(result.stdout, 'subcommand'), branch.children, branch.path.join(' '));
      assert.doesNotMatch(result.stdout, /\bexamples?\b/i, branch.path.join(' '));
      assert.doesNotMatch(result.stdout, /\busage\s*:/i, branch.path.join(' '));
    }

    const routedLeaves = leaves(SURFACE);
    assert.equal(routedLeaves.length, 37, 'the settled surface has 37 routed leaves');

    for (const commandPath of routedLeaves) {
      const command = commandPath.join(' ');
      const result = run([...commandPath, '-h'], tempRoot);
      assertExit(result, 0);
      assert.equal(result.stderr, '', `${command}\n${transcript(result)}`);
      assert.match(result.stdout, new RegExp(`^capture ${escapeRegExp(command)}(?:\\s|$)`), command);
      assert.match(result.stdout, /(?:^|\n)\s*input:/i, `${command}: missing input schema`);
      assert.match(result.stdout, /(?:^|\n)\s*output:/i, `${command}: missing output schema`);
      assert.match(result.stdout, /(?:^|\n)\s*effects:/i, `${command}: missing effects declaration`);
      assert.doesNotMatch(result.stdout, /<subcommand\b/, `${command}: leaf help rendered branch rows`);
      assert.doesNotMatch(result.stdout, /\bexamples?\b/i, `${command}: example text is forbidden`);
      assert.doesNotMatch(result.stdout, /\busage\s*:/i, `${command}: legacy Usage format is forbidden`);
    }
  });
});
