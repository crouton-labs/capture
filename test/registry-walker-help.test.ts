import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assembleHelp } from '../src/command-help.js';
import { resolveCommand } from '../src/command-resolution.js';
import { walkCommand } from '../src/command-walker.js';
import { CAPTURE_REGISTRY, type RegistryBranch, type RegistryLeaf, validateCaptureRegistry } from '../src/registry.js';

const valid = (result: { valid: boolean; errors: readonly string[] }): void => assert.equal(result.valid, true, result.errors.join('; '));
const branch = (path: string, root = CAPTURE_REGISTRY): RegistryBranch => root.children.find((child): child is RegistryBranch => child.kind === 'branch' && child.path === path)!;
const leaf = (path: string): RegistryLeaf => {
  const resolved = walkCommand(path.split(' '));
  assert.equal(resolved.kind, 'resolved');
  return (resolved as { node: RegistryLeaf }).node;
};

test('the static registry is the exact seven-noun public topology with an internal non-discoverable bridge', () => {
  valid(validateCaptureRegistry());
  assert.deepEqual(CAPTURE_REGISTRY.children.filter((child) => child.visibility === 'public').map((child) => child.path), ['session', 'page', 'measure', 'motion', 'traffic', 'browser', 'library']);
  assert.equal(walkCommand(['__bridge-serve']).kind, 'resolved', 'internal paths remain exact-resolvable for runtime wiring');
  const rootHelp = assembleHelp(CAPTURE_REGISTRY);
  assert.doesNotMatch(rootHelp, /__bridge-serve/);
  assert.deepEqual(branch('traffic').children.map((child) => child.path), ['traffic record', 'traffic har']);
});

test('walker is canonical-only and resolves the deepest path before leaf validation/effects', () => {
  const resolved = walkCommand(['measure', 'map', 'scroll', '--not-a-real-option']);
  assert.equal(resolved.kind, 'resolved');
  if (resolved.kind === 'resolved') {
    assert.equal(resolved.node.path, 'measure map scroll');
    assert.deepEqual(resolved.remaining, ['--not-a-real-option']);
  }
  assert.equal(walkCommand(['measure', 'map']).kind, 'resolved');
  assert.equal(walkCommand(['a11y']).kind, 'unknown-path');
  assert.equal(walkCommand(['browser', 'reset-tab']).kind, 'unknown-path');
});

test('root-only version precedes walking, while nested version is an invalid leaf argument', () => {
  assert.deepEqual(resolveCommand(['--version', 'page', 'click', '--bad']), { kind: 'version' });
  const nested = resolveCommand(['page', 'click', '--version']);
  assert.equal(nested.kind, 'dispatch');
  if (nested.kind === 'dispatch') assert.deepEqual(nested.argv, ['--version']);
  const help = resolveCommand(['page', 'click', '--bad', '-h']);
  assert.equal(help.kind, 'help', 'help wins after path resolution without parsing bad argv');
});

test('descriptor help snapshots root, branch, and raw leaf specification structure', () => {
  const root = assembleHelp(CAPTURE_REGISTRY);
  const measure = assembleHelp(branch('measure'));
  const cdp = assembleHelp(leaf('browser cdp'));
  assert.deepEqual(root.split('\n').filter((line) => /^(capture|Globals:|I\/O contract:|Commands:|  measure )/.test(line)), [
    'capture', 'Globals:', 'I/O contract: Leaf-declared flags and positionals are input. Structured leaves emit factual prose or JSON; exact-raw leaves emit declared bytes/text. Diagnostics are stderr; exit 0 is success and nonzero is failure.', 'Commands:', '  measure  immutable snapshots and factual rendered-structure reads. When to use: Choose this when working with immutable snapshots and factual rendered-structure reads.',
  ]);
  assert.deepEqual(measure.split('\n').filter((line) => /^(capture measure$|Model:|Commands:|  (snap|map|variation) )/.test(line)), [
    'capture measure', 'Model: A snapshot is an immutable explicit observation. snap acquires it; check, geometry, map, and explain read one explicit snapshot; variation owns cross-state work. Choose by fact resolution, not fixed sequence.', 'Commands:',
    '  snap  acquire one immutable structural snapshot. When to use: Choose this when you need acquire one immutable structural snapshot.',
    '  map  page-wide focus, scroll/container, or paint/layer topology. When to use: Choose this when working with page-wide focus, scroll/container, or paint/layer topology.',
    '  variation  compare states, distributions, or controlled environments. When to use: Choose this when working with compare states, distributions, or controlled environments.',
  ]);
  assert.deepEqual(cdp.split('\n').filter((line) => /^(capture browser cdp$|Parameters:|  --port|Constraints:|Output:|Artifact ownership:|Recovery:)/.test(line)), [
    'capture browser cdp', 'Parameters:', '  --port <1..65535> required units=tcp-port',
    'Constraints: Required singleton --port <1..65535>, one required method, and at most one JSON-object params positional (omitted means {}). No ambient endpoint, session, target, URL, stdin, or duplicate options.',
    'Output: Exactly the matching CDP response text-frame bytes, including byte order and final-newline absence; unrelated events are omitted.',
    'Artifact ownership: Creates no artifact. Exactly one CDP request is sent only after all validation and endpoint connection succeed.',
    'Recovery: Input failures: run capture browser cdp -h. Endpoint/transport failures: run capture browser list --port <port>; command failure: correct method or params from exact stdout response.',
  ]);
  assert.match(cdp, /output_mode_unsupported/);
});

test('real grammar declarations include value flags, CDP method plus optional params, and exact pagination census', () => {
  const start = leaf('session start');
  assert.deepEqual(start.flags.map((flag) => [flag.name, flag.grammar, flag.required, flag.repeatable]), [['--url', 'absolute-http(s)-url', true, undefined], ['--port', '1..65535', undefined, undefined]]);
  const cdp = leaf('browser cdp');
  assert.deepEqual(cdp.positionals.map((arg) => [arg.name, arg.required]), [['method', true], ['params-json-object', false]]);
  assert.deepEqual(cdp.flags.map((flag) => [flag.name, flag.grammar, flag.required]), [['--port', '1..65535', true]]);
  const snap = leaf('measure snap');
  assert.equal(snap.flags.find((flag) => flag.name === '--state')?.repeatable, true);
  assert.equal(snap.flags.find((flag) => flag.name === '--state')?.values, undefined);
  assert.equal(leaf('measure variation census').flags.find((flag) => flag.name === '--snapshot')?.repeatable, true);
  for (const path of ['browser detect', 'browser list', 'library list', 'library search', 'library show']) assert.equal((leaf(path).bounds?.paginated), true, path);
  for (const path of ['session list', 'session view']) assert.equal((leaf(path).bounds?.paginated), false, path);
});

test('registry validation rejects aliases, child overflow, incomplete help, invalid bounds, unbounded lists, and output-mode drift', () => {
  const clone = structuredClone(CAPTURE_REGISTRY) as RegistryBranch;
  const page = branch('page', clone);
  (page as { aliases?: readonly string[] }).aliases = ['p'];
  (page.children[0] as { help: { followUp: string } }).help.followUp = 'run capture does-not-exist -h';
  (page as unknown as { children: unknown[] }).children = [...page.children, structuredClone(page.children[0]), structuredClone(page.children[0])];
  const screenshot = page.children.find((child): child is RegistryLeaf => child.kind === 'leaf' && child.path === 'page screenshot')!;
  (screenshot as unknown as { outputMode: string; result: unknown; bounds?: unknown }).outputMode = 'exact-raw-json-rejected';
  (screenshot as unknown as { result: unknown; bounds?: unknown }).result = { kind: 'exact-raw', payload: 'wrong payload' };
  delete (screenshot as unknown as { bounds?: unknown }).bounds;
  const sessions = branch('session', clone);
  const sessionList = sessions.children.find((child): child is RegistryLeaf => child.kind === 'leaf' && child.path === 'session list')!;
  (sessionList as unknown as { bounds: { growing: boolean; paginated: boolean; maxBytes: number } }).bounds = { ...sessionList.bounds!, growing: true, paginated: false, maxBytes: 1 };
  const result = validateCaptureRegistry(clone);
  assert.equal(result.valid, false);
  assert.match(result.errors.join('\n'), /aliases/);
  assert.match(result.errors.join('\n'), /maximum is 7/);
  assert.match(result.errors.join('\n'), /follow-up does not resolve/);
  assert.match(result.errors.join('\n'), /wrong output mode|not declared exact-raw|exact-raw output mode/);
  assert.match(result.errors.join('\n'), /maxBytes|growing bounded collection/);
  const raw = sessions.children.find((child): child is RegistryLeaf => child.kind === 'leaf' && child.path === 'session log')!;
  (raw as unknown as { help: { rubric: string } }).help.rubric = 'output_mode_unsupported';
  const rawResult = validateCaptureRegistry(clone);
  assert.equal(rawResult.valid, false);
  assert.match(rawResult.errors.join('\n'), /full output_mode_unsupported diagnostic/);
});

test('output ownership is total and inverse-classified: structured accepts JSON while raw rejects it before effects', () => {
  assert.equal(leaf('page screenshot').outputMode, 'structured-json-capable');
  assert.equal(leaf('browser cdp').outputMode, 'exact-raw-json-rejected');
  const rawHelp = assembleHelp(leaf('browser cdp'));
  assert.match(rawHelp, /output_mode_unsupported/);
  assert.match(rawHelp, /final-newline absence/);
});
